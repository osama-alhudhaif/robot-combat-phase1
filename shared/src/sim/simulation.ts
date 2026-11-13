/**
 * The match simulation. This one file is the whole fight: physics, drive,
 * weapons, damage, energy and sensors. The test arena runs it in the browser
 * and (from Phase 2) the server runs the same code, so a robot behaves the
 * same offline and online. It never sees or runs player code: it only takes
 * Commands in and gives Snapshots and sensor readings out.
 */
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { CONFIG, type PartDef } from '../config';
import {
  SHAFT_QUAT, add, connectedToCore, cross, dot, expandDesign, len, norm, partPoint,
  quatMul, quatRotate, scale, sub, type RuntimePart,
} from '../geometry';
import type {
  Commands, ProgramState, Quat, RobotDesign, SensorReading, SimEvent, Snapshot, Vec3,
} from '../types';

type Rapier = typeof RAPIER_NS;
type Body = RAPIER_NS.RigidBody;
type Collider = RAPIER_NS.Collider;

const S = CONFIG.cellSize;
const DT = 1 / CONFIG.physics.stepsPerSecond;
const v3 = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const xyz = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });
const q4 = (q: { x: number; y: number; z: number; w: number }): Quat => [q.x, q.y, q.z, q.w];
const xyzw = (q: Quat) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

interface PartState {
  rt: RuntimePart;
  def: PartDef;
  hp: number;
  alive: boolean;
  collider: Collider | null;
  power: number; // motors: commanded power
  omega: number; // rad/s of whatever turns on this shaft
  angle: number; // shaft angle for rendering
  cooldown: number; // actuators and spinner hit timing
  sinceFire: number; // actuators: seconds since the last strike
  rollSign: number; // wheels: +1 or -1 so that reported speed is positive when driving forward
}

interface Robot {
  design: RobotDesign;
  parts: PartState[];
  ids: Map<string, number>;
  body: Body;
  maxHp: number;
  capacity: number;
  energy: number;
  knockedOut: boolean;
  damageDealt: number;
  pendingFire: Set<number>;
  prevLin: Vec3;
  prevAng: Vec3;
}

interface Debris { id: number; body: Body; rt: RuntimePart; ttl: number }

export interface Spawn { x: number; z: number; yaw: number }

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Default spawn points: opposite sides, facing each other. */
export function defaultSpawns(): Spawn[] {
  const d = CONFIG.arena.spawnDistance;
  return [{ x: 0, z: -d, yaw: 0 }, { x: 0, z: d, yaw: Math.PI }];
}

export class Simulation {
  readonly world: RAPIER_NS.World;
  readonly robots: Robot[] = [];
  /** While false (countdown, pause, round over) robots ignore every command. */
  active = false;
  time = 0;
  /** Seconds of fighting so far. This is what programs see as robot.time. */
  roundTime = 0;

  private R: Rapier;
  private queue: RAPIER_NS.EventQueue;
  private owners = new Map<number, { robot: number; part: number }>();
  private debris: Debris[] = [];
  private events: SimEvent[] = [];
  private ramTimers = new Map<string, number>();
  private nextDebrisId = 1;
  private rand: () => number;
  private stepCount = 0;

  constructor(R: Rapier, designs: RobotDesign[], spawns: Spawn[] = defaultSpawns(), seed = 1) {
    this.R = R;
    this.rand = mulberry32(seed);
    this.world = new R.World({ x: 0, y: -CONFIG.physics.gravity, z: 0 });
    this.world.timestep = DT;
    this.queue = new R.EventQueue(true);
    this.buildArena();
    designs.forEach((d, i) => this.robots.push(this.buildRobot(d, i, spawns[i])));
  }

  free() {
    this.queue.free();
    this.world.free();
  }

  // ---------------------------------------------------------------- setup

  private buildArena() {
    const { R, world } = this;
    const half = CONFIG.arena.size / 2;
    const fixed = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
      world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(CONFIG.physics.floorFriction).setRestitution(CONFIG.physics.restitution));
    fixed(half + 1, 0.5, half + 1, 0, -0.5, 0);
    // Walls are taller than they look, so a launched robot always comes back down inside.
    const wh = 3;
    fixed(half + 1, wh, 0.5, 0, wh, half + 0.5);
    fixed(half + 1, wh, 0.5, 0, wh, -half - 0.5);
    fixed(0.5, wh, half + 1, half + 0.5, wh, 0);
    fixed(0.5, wh, half + 1, -half - 0.5, wh, 0);
  }

  private colliderDesc(rt: RuntimePart): RAPIER_NS.ColliderDesc {
    const { R } = this;
    const sh = rt.def.shape;
    const inset = CONFIG.physics.colliderInset;
    let desc: RAPIER_NS.ColliderDesc;
    if (sh.kind === 'box') {
      desc = R.ColliderDesc.cuboid(sh.h[0] * S - inset, sh.h[1] * S - inset, sh.h[2] * S - inset)
        .setTranslation(...partPoint(rt, sh.c)).setRotation(xyzw(rt.quat));
    } else if (sh.kind === 'hull') {
      const pts = new Float32Array(sh.pts.flatMap((p) => scale(p, S * (1 - inset / S))));
      desc = R.ColliderDesc.convexHull(pts)!.setTranslation(...rt.pos).setRotation(xyzw(rt.quat));
    } else if (sh.kind === 'cyl') {
      desc = R.ColliderDesc.cylinder(sh.hh * S, sh.r * S)
        .setTranslation(...partPoint(rt, sh.c)).setRotation(xyzw(quatMul(rt.quat, SHAFT_QUAT)));
    } else {
      desc = R.ColliderDesc.ball(sh.r * S).setTranslation(...partPoint(rt, sh.c));
    }
    desc.setMass(rt.def.weight).setRestitution(CONFIG.physics.restitution).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    if (rt.def.wheel || rt.def.free) {
      // Wheels and casters slide freely as shapes. Grip comes from the drive model below.
      desc.setFriction(0).setFrictionCombineRule(R.CoefficientCombineRule.Min);
    } else {
      desc.setFriction(CONFIG.physics.bodyFriction);
    }
    return desc;
  }

  /** Lowest point of a part in the body frame, used to rest the robot on the floor at spawn. */
  private lowestY(rt: RuntimePart): number {
    const sh = rt.def.shape;
    if (sh.kind === 'hull') return Math.min(...sh.pts.map((p) => partPoint(rt, p)[1]));
    const cy = partPoint(rt, sh.c)[1];
    if (sh.kind === 'ball') return cy - sh.r * S;
    if (sh.kind === 'cyl') return cy - (Math.abs(quatRotate(rt.quat, [0, 0, 1])[1]) > 0.5 ? sh.hh : sh.r) * S;
    return cy - Math.abs(quatRotate(rt.quat, sh.h)[1]) * S;
  }

  private buildRobot(design: RobotDesign, index: number, spawn: Spawn): Robot {
    const { R, world } = this;
    const rts = expandDesign(design);
    const minY = Math.min(0, ...rts.map((rt) => this.lowestY(rt)));
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, -minY + 0.02, spawn.z)
        .setRotation({ x: 0, y: Math.sin(spawn.yaw / 2), z: 0, w: Math.cos(spawn.yaw / 2) })
        .setLinearDamping(CONFIG.physics.linearDamping)
        .setAngularDamping(CONFIG.physics.angularDamping)
        .setCcdEnabled(true),
    );
    const parts: PartState[] = rts.map((rt) => {
      const collider = world.createCollider(this.colliderDesc(rt), body);
      this.owners.set(collider.handle, { robot: index, part: rt.index });
      return { rt, def: rt.def, hp: rt.def.hp, alive: true, collider, power: 0, omega: 0, angle: 0, cooldown: 0, sinceFire: 99, rollSign: 1 };
    });
    const ids = new Map<string, number>();
    parts.forEach((p) => { if (p.rt.id) ids.set(p.rt.id, p.rt.index); });
    const capacity = parts.reduce((s, p) => s + (p.def.battery ?? 0), 0);
    return {
      design, parts, ids, body, capacity, energy: capacity,
      maxHp: parts.reduce((s, p) => s + p.def.hp, 0),
      knockedOut: false, damageDealt: 0, pendingFire: new Set(),
      prevLin: [0, 0, 0], prevAng: [0, 0, 0],
    };
  }

  // ------------------------------------------------------------- commands

  /** Applies a program's commands. Values are clamped; unknown or destroyed parts are ignored. */
  setCommands(robotIndex: number, cmd: Commands) {
    const robot = this.robots[robotIndex];
    if (!robot || !cmd) return;
    for (const [id, power] of Object.entries(cmd.motors ?? {})) {
      const p = robot.parts[robot.ids.get(id) ?? -1];
      if (p?.def.motor && p.alive && Number.isFinite(power)) p.power = clamp(power, -1, 1);
    }
    for (const id of cmd.fire ?? []) {
      const p = robot.parts[robot.ids.get(id) ?? -1];
      if (p?.def.actuator && p.alive) robot.pendingFire.add(p.rt.index);
    }
  }

  /** Zeroes every motor, for when a program is stopped. */
  clearCommands(robotIndex: number) {
    const robot = this.robots[robotIndex];
    robot.parts.forEach((p) => { p.power = 0; });
    robot.pendingFire.clear();
  }

  // ----------------------------------------------------------------- step

  step() {
    for (let i = 0; i < this.robots.length; i++) this.driveRobot(i);
    for (const r of this.robots) { r.prevLin = v3(r.body.linvel()); r.prevAng = v3(r.body.angvel()); }
    this.world.step(this.queue);
    this.queue.drainCollisionEvents((h1, h2, started) => { if (started) this.onContact(h1, h2); });
    for (let i = 0; i < this.robots.length; i++) this.spinnerHits(i);
    for (const [k, t] of this.ramTimers) { if (t <= DT) this.ramTimers.delete(k); else this.ramTimers.set(k, t - DT); }
    this.debris = this.debris.filter((d) => {
      d.ttl -= DT;
      if (d.ttl <= 0) this.world.removeRigidBody(d.body);
      return d.ttl > 0;
    });
    this.time += DT;
    if (this.active) this.roundTime += DT;
    this.stepCount++;
  }

  private frame(robot: Robot) {
    const t = v3(robot.body.translation());
    const q = q4(robot.body.rotation());
    return {
      t, q,
      dir: (v: Vec3) => quatRotate(q, v),
      pt: (p: Vec3) => add(t, quatRotate(q, p)),
    };
  }

  private velocityAt(body: Body, lin: Vec3, ang: Vec3, point: Vec3): Vec3 {
    return add(lin, cross(ang, sub(point, v3(body.worldCom()))));
  }

  private driveRobot(index: number) {
    const robot = this.robots[index];
    const { body, parts } = robot;
    const P = CONFIG.physics;
    const powered = this.active && !robot.knockedOut && robot.energy > 0;
    const f = this.frame(robot);
    const mass = body.mass();

    // Actuators
    for (const p of parts) {
      if (!p.def.actuator) continue;
      p.cooldown = Math.max(0, p.cooldown - DT);
      p.sinceFire += DT;
      if (robot.pendingFire.has(p.rt.index) && powered && p.alive && p.cooldown <= 0 && robot.energy >= p.def.actuator.energy) {
        this.fireActuator(index, p);
      }
    }
    robot.pendingFire.clear();

    // What is holding the robot up: grounded wheels and casters share its weight.
    interface Grip { wheel: PartState; motor: PartState; point: Vec3; normal: Vec3; axis: Vec3; radius: number }
    const grips: Grip[] = [];
    let supports = 0;
    for (const p of parts) {
      if (!p.alive || p.def.shape.kind === 'box' || p.def.shape.kind === 'hull') continue;
      const centre = f.pt(partPoint(p.rt, p.def.shape.c));
      if (p.def.free) {
        const r = (p.def.shape as { r: number }).r * S;
        if (this.world.castRay(new this.R.Ray(xyz(centre), { x: 0, y: -1, z: 0 }), r + 0.015, true, undefined, undefined, undefined, body)) supports++;
      } else if (p.def.wheel) {
        const axis = f.dir(quatRotate(p.rt.quat, [0, 0, 1]));
        let down: Vec3 = sub([0, -1, 0], scale(axis, -axis[1]));
        if (len(down) < 0.3) continue; // lying flat on its side
        down = norm(down);
        const radius = p.def.wheel.radius * S;
        const hit = this.world.castRay(new this.R.Ray(xyz(centre), xyz(down)), radius + 0.015, true, undefined, undefined, undefined, body);
        if (!hit) continue;
        const toi = (hit as any).timeOfImpact ?? (hit as any).toi;
        grips.push({ wheel: p, motor: parts[p.rt.parent], point: add(centre, scale(down, toi)), normal: scale(down, -1), axis, radius });
        supports++;
      }
    }

    const lin = v3(body.linvel()), ang = v3(body.angvel());
    const load = supports ? (mass * P.gravity) / supports : 0;
    const share = supports ? mass / supports : 0;
    const front = f.dir([0, 0, 1]), side = f.dir([1, 0, 0]);
    const grounded = new Set<PartState>();

    for (const g of grips) {
      // Positive power always drives the robot towards its front.
      let fwd = norm(cross(g.axis, g.normal));
      let rollSign = 1;
      const ref = Math.abs(dot(fwd, front)) > 0.1 ? front : side;
      if (dot(fwd, ref) < 0) { fwd = scale(fwd, -1); rollSign = -1; }
      const lat = norm(sub(g.axis, scale(g.normal, dot(g.axis, g.normal))));
      const v = this.velocityAt(body, lin, ang, g.point);
      const vLong = dot(v, fwd), vLat = dot(v, lat);
      const m = g.motor.def.motor!;
      const wMax = (m.rpm * 2 * Math.PI) / 60;
      const w = vLong / g.radius;
      let force: number;
      if (powered && g.motor.alive) {
        const torque = P.baseTorque * m.torque * (g.motor.power - w / wMax);
        force = clamp(torque / g.radius, -P.wheelGrip * load, P.wheelGrip * load);
      } else {
        force = -Math.sign(vLong) * Math.min(P.rollingResistance * load, (Math.abs(vLong) * share) / DT);
      }
      const jLat = clamp(-vLat * share, -P.lateralGrip * load * DT, P.lateralGrip * load * DT);
      body.applyImpulseAtPoint(xyz(add(scale(fwd, force * DT), scale(lat, jLat))), xyz(g.point), true);
      g.wheel.omega = w * rollSign;
      g.wheel.rollSign = rollSign;
      grounded.add(g.wheel);
    }

    // Shafts: free wheels, spinning weapons, bare motors. Also the energy bill.
    let drain = 0;
    for (const p of parts) {
      const m = p.def.motor;
      if (!m) continue;
      const on = powered && p.alive;
      const power = on ? p.power : 0;
      drain += m.drain * Math.abs(power);
      const wMax = (m.rpm * 2 * Math.PI) / 60;
      const stall = P.baseTorque * m.torque;
      const load = p.rt.child >= 0 ? parts[p.rt.child] : null;
      if (load && load.alive && load.def.spin) {
        const torque = on ? stall * (power - load.omega / wMax) : -0.15 * stall * (load.omega / wMax);
        load.omega += (torque / load.def.spin.inertia) * DT;
        load.angle += load.omega * DT;
      } else {
        const target = load && load.alive ? load : p;
        if (!grounded.has(target)) target.omega += (power * wMax - target.omega) * Math.min(1, 12 * DT);
        target.angle += target.omega * DT;
      }
    }
    if (powered) robot.energy = Math.max(0, robot.energy - drain * DT);
  }

  // -------------------------------------------------------------- weapons

  private fireActuator(index: number, p: PartState) {
    const robot = this.robots[index];
    const act = p.def.actuator!;
    const D = CONFIG.damage;
    const f = this.frame(robot);
    robot.energy -= act.energy;
    p.cooldown = act.cooldown;
    p.sinceFire = 0;
    const partQ = quatMul(f.q, p.rt.quat);
    const up = quatRotate(partQ, [0, 1, 0]);
    const isFlipper = act.kind === 'flipper';
    const zoneC: Vec3 = isFlipper ? [0, 0.2, 0.5] : [0, 0.3, 2.0];
    const zoneH: Vec3 = isFlipper ? [0.5, 0.75, 1.0] : [0.6, 1.3, 1.1];
    const tip = f.pt(partPoint(p.rt, isFlipper ? [0, -0.3, 0.7] : [0, 0.5, 2.0]));
    this.events.push({ kind: 'fire', pos: tip, power: 1 });

    const hitRobots = new Map<number, { part: number; height: number }>();
    const hitDebris = new Set<Body>();
    this.world.intersectionsWithShape(
      xyz(f.pt(partPoint(p.rt, zoneC))), xyzw(partQ), new this.R.Cuboid(zoneH[0] * S, zoneH[1] * S, zoneH[2] * S),
      (c) => {
        const own = this.owners.get(c.handle);
        if (own) {
          const height = dot(v3(c.translation()), up);
          const best = hitRobots.get(own.robot);
          if (!best || height > best.height) hitRobots.set(own.robot, { part: own.part, height });
        } else if (c.parent()?.isDynamic()) hitDebris.add(c.parent()!);
        return true;
      },
      undefined, undefined, undefined, robot.body,
    );

    for (const [ri, hit] of hitRobots) {
      const target = this.robots[ri];
      if (isFlipper) {
        const j = Math.min(D.flipperImpulse, target.body.mass() * D.flipperMaxSpeed);
        target.body.applyImpulseAtPoint(xyz(scale(up, j)), xyz(tip), true);
      } else {
        const point = v3(target.parts[hit.part].collider!.translation());
        target.body.applyImpulseAtPoint(xyz(scale(up, -D.hammerImpulse)), xyz(point), true);
        this.damage(ri, hit.part, act.damage, point, index);
      }
    }
    for (const b of hitDebris) b.applyImpulse(xyz(scale(up, isFlipper ? 8 : -4)), true);

    // Nothing to hit and the arm is pointing at the floor: the strike pushes the robot itself over.
    if (hitRobots.size === 0 && up[1] < -0.5) {
      const ray = new this.R.Ray(xyz(tip), xyz(up));
      const hit = this.world.castRay(ray, D.actuatorReach, true, undefined, undefined, undefined, robot.body);
      if (hit && !hit.collider.parent()?.isDynamic()) {
        robot.body.applyImpulseAtPoint(xyz(scale(up, -robot.body.mass() * D.selfRightSpeed)), xyz(tip), true);
      }
    }
  }

  private spinnerHits(index: number) {
    const robot = this.robots[index];
    if (robot.knockedOut) return;
    const D = CONFIG.damage;
    const f = this.frame(robot);
    for (const p of robot.parts) {
      const spin = p.def.spin;
      if (!spin || !p.alive) continue;
      p.cooldown = Math.max(0, p.cooldown - DT);
      const motor = robot.parts[p.rt.parent].def.motor!;
      const frac = Math.abs(p.omega) / ((motor.rpm * 2 * Math.PI) / 60);
      if (frac < (spin.dps ? 0.05 : D.spinMinSpeed) || p.cooldown > 0) continue;
      const sh = p.def.shape as { c: Vec3; r: number; hh: number };
      const centre = f.pt(partPoint(p.rt, sh.c));
      let hit: { robot: number; part: number } | null = null;
      this.world.intersectionsWithShape(
        xyz(centre), xyzw(quatMul(f.q, quatMul(p.rt.quat, SHAFT_QUAT))), new this.R.Cylinder(sh.hh * S + 0.012, sh.r * S + 0.012),
        (c) => { hit = this.owners.get(c.handle) ?? null; return !hit; },
        undefined, undefined, undefined, robot.body,
      );
      if (!hit) continue;
      const h = hit as { robot: number; part: number };
      const target = this.robots[h.robot];
      const point = v3(target.parts[h.part].collider!.translation());
      if (spin.dps) {
        this.damage(h.robot, h.part, spin.dps * frac * DT, point, index, this.stepCount % 6 === 0);
        p.omega *= 1 - 0.6 * DT;
        continue;
      }
      const energy = 0.5 * spin.inertia * p.omega * p.omega;
      p.omega *= D.spinKeepOnHit;
      p.cooldown = D.spinHitCooldown;
      const away = sub(point, centre);
      const flat = norm([away[0], 0, away[2]]);
      const j = Math.min(D.knockbackMax, D.knockbackPerSqrtJoule * Math.sqrt(energy), target.body.mass() * D.knockbackMaxSpeed);
      target.body.applyImpulseAtPoint(xyz(scale(norm([flat[0], spin.lift, flat[2]]), j)), xyz(point), true);
      robot.body.applyImpulseAtPoint(xyz(scale(flat, -j * D.recoilFraction)), xyz(centre), true);
      this.damage(h.robot, h.part, energy * D.spinDamagePerJoule * spin.damageMult, point, index);
    }
  }

  /** Ramming: two robots' parts have just touched. */
  private onContact(h1: number, h2: number) {
    const a = this.owners.get(h1), b = this.owners.get(h2);
    if (!a || !b || a.robot === b.robot) return;
    const D = CONFIG.damage;
    const key = a.robot < b.robot ? `${a.robot}-${b.robot}` : `${b.robot}-${a.robot}`;
    if (this.ramTimers.has(key)) return;
    const ra = this.robots[a.robot], rb = this.robots[b.robot];
    const pa = ra.parts[a.part], pb = rb.parts[b.part];
    if (!pa.collider || !pb.collider) return;
    const spinning = (r: Robot, p: PartState) =>
      !!p.def.spin && Math.abs(p.omega) / ((r.parts[p.rt.parent].def.motor!.rpm * 2 * Math.PI) / 60) >= D.spinMinSpeed;
    if (spinning(ra, pa) || spinning(rb, pb)) return;
    const point = scale(add(v3(pa.collider.translation()), v3(pb.collider.translation())), 0.5);
    const rel = sub(this.velocityAt(ra.body, ra.prevLin, ra.prevAng, point), this.velocityAt(rb.body, rb.prevLin, rb.prevAng, point));
    const closing = dot(rel, norm(sub(v3(rb.body.translation()), v3(ra.body.translation()))));
    if (closing < D.ramMinSpeed) return;
    this.ramTimers.set(key, D.ramCooldown);
    const ma = ra.body.mass(), mb = rb.body.mass();
    const energy = 0.5 * ((ma * mb) / (ma + mb)) * closing * closing;
    const dmg = energy * D.ramMultiplier * D.ramDamagePerJoule;
    this.damage(a.robot, a.part, dmg, point, b.robot);
    this.damage(b.robot, b.part, dmg, point, a.robot, false);
  }

  // --------------------------------------------------------------- damage

  private damage(robotIndex: number, partIndex: number, raw: number, point: Vec3, attacker: number, spark = true) {
    const robot = this.robots[robotIndex];
    const p = robot.parts[partIndex];
    if (!p.alive || !this.active) return;
    const amount = raw * (1 - (p.def.armor ?? 0));
    this.robots[attacker].damageDealt += Math.min(amount, p.hp);
    p.hp -= amount;
    if (spark) this.events.push({ kind: 'spark', pos: point, power: amount });
    if (p.hp > 0) return;
    this.breakPart(robot, p);
    if (!robot.knockedOut) {
      // Anything that no longer reaches the Control Core falls off with it.
      const base = robot.design.parts.map(() => false);
      robot.parts.forEach((q) => { if (q.rt.parent < 0) base[q.rt.designIndex] = q.alive; });
      const linked = connectedToCore(robot.design.parts, base);
      robot.parts.forEach((q) => { if (q.alive && q.rt.parent < 0 && !linked[q.rt.designIndex]) this.breakPart(robot, q); });
    }
  }

  private breakPart(robot: Robot, p: PartState) {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.power = 0;
    p.omega = 0;
    if (p.def.battery && robot.capacity > 0) {
      robot.energy *= 1 - p.def.battery / robot.capacity;
      robot.capacity -= p.def.battery;
    }
    if (p.def.core) robot.knockedOut = true;
    if (p.collider) {
      const pos = v3(p.collider.translation());
      this.owners.delete(p.collider.handle);
      this.world.removeCollider(p.collider, true);
      p.collider = null;
      const src = robot.body;
      const kick = () => (this.rand() - 0.5) * 3;
      const lin = v3(src.linvel());
      const body = this.world.createRigidBody(
        this.R.RigidBodyDesc.dynamic().setTranslation(...v3(src.translation())).setRotation(src.rotation())
          .setLinvel(lin[0] + kick(), lin[1] + 1.5 + this.rand() * 2, lin[2] + kick())
          .setAngvel({ x: kick() * 3, y: kick() * 3, z: kick() * 3 }),
      );
      this.world.createCollider(this.colliderDesc(p.rt).setActiveEvents(0), body);
      this.debris.push({ id: this.nextDebrisId++, body, rt: p.rt, ttl: CONFIG.physics.debrisSeconds });
      this.events.push({ kind: 'break', pos, power: p.def.hp });
    }
    if (p.rt.child >= 0) this.breakPart(robot, robot.parts[p.rt.child]);
  }

  // -------------------------------------------------------------- reading

  health(robot: Robot): number {
    return robot.parts.reduce((s, p) => s + (p.alive ? Math.max(0, p.hp) : 0), 0) / robot.maxHp;
  }

  pose(index: number): { pos: Vec3; quat: Quat } {
    const b = this.robots[index].body;
    return { pos: v3(b.translation()), quat: q4(b.rotation()) };
  }

  /** Reports and clears the events since the last call. */
  snapshot(): Snapshot {
    const events = this.events;
    this.events = [];
    return {
      time: this.time,
      events,
      robots: this.robots.map((r) => ({
        ...this.pose(this.robots.indexOf(r)),
        energy: r.capacity ? r.energy / r.capacity : 0,
        health: this.health(r),
        knockedOut: r.knockedOut,
        damageDealt: r.damageDealt,
        parts: r.parts.map((p) => ({
          hp: p.alive ? p.hp / p.def.hp : -1,
          anim: p.def.actuator ? Math.max(0, 1 - p.sinceFire / 0.35) : p.angle,
        })),
      })),
      debris: this.debris.map((d) => {
        const t = v3(d.body.translation()), q = q4(d.body.rotation());
        return { id: d.id, type: d.rt.def.type, color: d.rt.color, pos: add(t, quatRotate(q, d.rt.pos)), quat: quatMul(q, d.rt.quat) };
      }),
    };
  }

  /** Everything one robot's program may read. Only parts the robot has, only while they work. */
  programState(index: number): ProgramState {
    const robot = this.robots[index];
    const f = this.frame(robot);
    const out: ProgramState = {
      time: this.roundTime, battery: robot.capacity ? robot.energy / robot.capacity : 0, health: this.health(robot),
      motors: {}, actuators: {}, sensors: {},
    };
    for (const p of robot.parts) {
      const id = p.rt.id;
      if (!id) continue;
      const hp = p.alive ? p.hp / p.def.hp : 0;
      if (p.def.motor) {
        const load = p.rt.child >= 0 && robot.parts[p.rt.child].alive ? robot.parts[p.rt.child] : p;
        const sign = load.def.wheel ? load.rollSign : 1;
        out.motors[id] = { speed: clamp((load.omega * sign) / ((p.def.motor.rpm * 2 * Math.PI) / 60), -1, 1), health: hp };
      } else if (p.def.actuator) {
        out.actuators[id] = { ready: p.alive && p.cooldown <= 0 && robot.energy >= p.def.actuator.energy && robot.energy > 0, health: hp };
      } else if (p.def.sensor) {
        out.sensors[id] = p.alive ? this.readSensor(index, p, f) : { kind: 'dead' };
      }
    }
    return out;
  }

  private readSensor(index: number, p: PartState, f: ReturnType<Simulation['frame']>): SensorReading {
    const robot = this.robots[index];
    const sensor = p.def.sensor!;
    if (sensor.kind === 'distance') {
      const ray = new this.R.Ray(xyz(f.pt(partPoint(p.rt, [0, 0, 0.1]))), xyz(f.dir(quatRotate(p.rt.quat, [0, 0, 1]))));
      const hit = this.world.castRay(ray, sensor.range!, true, undefined, undefined, undefined, robot.body);
      return { kind: 'distance', distance: hit ? ((hit as any).timeOfImpact ?? (hit as any).toi) : null };
    }
    if (sensor.kind === 'radar') {
      const other = this.robots.find((r) => r !== robot);
      if (!other) return { kind: 'radar', target: null };
      const local = quatRotate(conj(f.q), sub(v3(other.body.worldCom()), v3(robot.body.worldCom())));
      return { kind: 'radar', target: { distance: len(local), bearing: (Math.atan2(-local[0], local[2]) * 180) / Math.PI } };
    }
    if (sensor.kind === 'gyro') {
      const front = f.dir([0, 0, 1]), up = f.dir([0, 1, 0]);
      return {
        kind: 'gyro',
        heading: ((Math.atan2(-front[0], front[2]) * 180) / Math.PI + 360) % 360,
        tilt: (Math.acos(clamp(up[1], -1, 1)) * 180) / Math.PI,
        upsideDown: up[1] < 0,
      };
    }
    let touching = false;
    this.world.intersectionsWithShape(
      xyz(f.pt(partPoint(p.rt, [0, 0, 0.4]))), xyzw(quatMul(f.q, p.rt.quat)), new this.R.Cuboid(0.48 * S, 0.48 * S, 0.22 * S),
      () => { touching = true; return false; },
      undefined, undefined, undefined, robot.body,
    );
    return { kind: 'bumper', touching };
  }
}
