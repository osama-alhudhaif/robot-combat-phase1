/** Headless checks of the shared simulation. Run with `npm test`. */
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG, Simulation, dummyDesign, driveDummy, validateDesign, parseRobotFile, serializeRobot, type DesignPart, type RobotDesign, type Vec3 } from '../src/index';

let failed = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) failed++; };

function testBot(weapon?: string): RobotDesign {
  const parts: DesignPart[] = [];
  const put = (type: string, position: Vec3, extra: Partial<DesignPart> = {}) => parts.push({ type, position, rotation: [0, 0, 0], color: '#888888', ...extra });
  for (let x = 4; x <= 7; x++) for (let z = 4; z <= 7; z++) {
    if (z === 5 && x === 4) put('motor_medium', [x, 0, z], { rotation: [0, 270, 0], id: 'right', attachment: 'wheel_small' });
    else if (z === 5 && x === 7) put('motor_medium', [x, 0, z], { rotation: [0, 90, 0], id: 'left', attachment: 'wheel_small' });
    else if ((z === 4 || z === 7) && (x === 5 || x === 6)) put('caster', [x, 0, z]);
    else put('frame', [x, 0, z]);
  }
  put('control_core', [5, 1, 5]);
  put('battery_small', [6, 1, 5]);
  put('sensor_radar', [5, 1, 6], { id: 'radar' });
  put('sensor_gyro', [6, 1, 6], { id: 'gyro' });
  put('sensor_distance', [5, 1, 7], { id: 'dist' });
  if (weapon === 'hammer' || weapon === 'flipper') put(weapon, [5, 0, 8], { id: 'w' });
  else if (weapon) { put('frame', [5, 0, 8]); put('motor_medium', [5, 1, 8], { rotation: [270, 0, 0], id: 'w', attachment: weapon }); }
  return { formatVersion: 1, name: 'test', parts, code: '' };
}

function run(sim: Simulation, seconds: number, each?: () => void) {
  for (let i = 0; i < seconds * 60; i++) { each?.(); sim.step(); }
}

await RAPIER.init();

{
  const d = testBot();
  check('test bot is valid', validateDesign(d).every((i) => i.level !== 'error'), JSON.stringify(validateDesign(d)));
  check('dummy is valid', validateDesign(dummyDesign()).every((i) => i.level !== 'error'), JSON.stringify(validateDesign(dummyDesign())));
  const back = parseRobotFile(serializeRobot(d));
  check('export then import round-trips', back.ok && JSON.stringify(back.design) === JSON.stringify(d));
  check('import rejects unknown parts', !parseRobotFile(JSON.stringify({ formatVersion: 1, name: 'x', parts: [{ type: 'laser', position: [0, 0, 0], rotation: [0, 0, 0] }] })).ok);
}

{
  const sim = new Simulation(RAPIER, [testBot(), dummyDesign()]);
  sim.active = true;
  run(sim, 2);
  const p0 = sim.pose(0).pos;
  check('robot rests and does not move without commands', Math.hypot(p0[0], p0[2] + 4) < 0.05 && p0[1] < 0.2, p0.map((n) => n.toFixed(3)).join(','));
  sim.setCommands(0, { motors: { left: 1, right: 1 }, fire: [] });
  run(sim, 1.5);
  const p1 = sim.pose(0).pos;
  check('drives forward with power', p1[2] - p0[2] > 1.5 && Math.abs(p1[0]) < 0.3, `dz=${(p1[2] - p0[2]).toFixed(2)} x=${p1[0].toFixed(2)}`);
  const st = sim.programState(0);
  check('motor speed reads positive going forward', st.motors.left.speed > 0.3, String(st.motors.left.speed));
  check('radar sees the target ahead', !!st.sensors.radar && st.sensors.radar.kind === 'radar' && Math.abs(st.sensors.radar.target!.bearing) < 15, JSON.stringify(st.sensors.radar));
  sim.setCommands(0, { motors: { left: 0, right: 0 }, fire: [] });
  run(sim, 2);
  const h0 = (sim.programState(0).sensors.gyro as any).heading;
  sim.setCommands(0, { motors: { left: 1, right: -1 }, fire: [] });
  run(sim, 0.4);
  const h1 = (sim.programState(0).sensors.gyro as any).heading;
  check('left wheel forward turns right (heading increases)', ((h1 - h0 + 360) % 360) > 5 && ((h1 - h0 + 360) % 360) < 180, `${h0.toFixed(0)} -> ${h1.toFixed(0)}`);
  check('energy drains', st.battery < 1);
  sim.free();
}

{
  const sim = new Simulation(RAPIER, [testBot(), dummyDesign()]);
  sim.active = true;
  sim.setCommands(0, { motors: { left: 1, right: 1 }, fire: [] });
  let stopped = -1;
  run(sim, 200, () => { if (stopped < 0 && sim.programState(0).battery === 0) stopped = sim.time; });
  const a = sim.pose(0).pos; run(sim, 1); const b = sim.pose(0).pos;
  check('robot stops at zero energy', stopped > 0 && Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.02, `empty at ${stopped.toFixed(0)}s`);
  sim.free();
}

for (const weapon of ['spinner_bar', 'spinner_disc', 'drum', 'saw', 'hammer', 'flipper']) {
  const sim = new Simulation(RAPIER, [testBot(weapon), dummyDesign()], [{ x: 0, z: -1.2, yaw: 0 }, { x: 0, z: 0, yaw: Math.PI }]);
  sim.active = true;
  let maxY = 0, firstHit = 0;
  run(sim, 2);
  run(sim, 25, () => {
    const st = sim.programState(0);
    const dist = (st.sensors.radar as any).target.distance;
    const near = dist < 0.75;
    const spinner = weapon !== 'hammer' && weapon !== 'flipper';
    // Spinners charge only once the weapon is up to speed, and back off to spin up again.
    const go = !spinner || weapon === 'saw' || st.motors.w.speed > 0.85 ? (near ? 0.2 : 0.6) : (dist < 1.3 ? -0.5 : 0);
    sim.setCommands(0, { motors: { left: go, right: go, ...(spinner ? { w: 1 } : {}) }, fire: st.actuators.w?.ready && near ? ['w'] : [] });
    maxY = Math.max(maxY, sim.pose(1).pos[1]);
    if (!firstHit && sim.robots[0].damageDealt > 0) firstHit = sim.robots[0].damageDealt;
  });
  const snap = sim.snapshot();
  const broken = snap.robots[1].parts.filter((p) => p.hp < 0).length;
  if (weapon === 'flipper') check('flipper launches the target', maxY > 0.35, `peak y=${maxY.toFixed(2)}`);
  else check(`${weapon} damages the target`, sim.robots[0].damageDealt > 20, `dealt=${sim.robots[0].damageDealt.toFixed(0)} first=${firstHit.toFixed(0)} broken=${broken} ko=${snap.robots[1].knockedOut}`);
  sim.free();
}

{
  // A core sitting on a low base: two hammer blows must knock it out and leave debris.
  const P = (type: string, position: Vec3): DesignPart => ({ type, position, rotation: [0, 0, 0], color: '#888888' });
  const weak: RobotDesign = { formatVersion: 1, name: 'weak', code: '', parts: [
    ...[4, 5, 6].flatMap((x) => [4, 5, 6].map((z) => P(x === 5 && z === 5 ? 'battery_small' : 'frame', [x, 0, z]))),
    P('control_core', [5, 1, 5]),
  ] };
  const sim = new Simulation(RAPIER, [testBot('hammer'), weak], [{ x: 0, z: -1.2, yaw: 0 }, { x: 0, z: 0, yaw: Math.PI }]);
  sim.active = true;
  let ko = -1, debris = 0;
  run(sim, 30, () => {
    const st = sim.programState(0);
    const near = (st.sensors.radar as any).target.distance < 0.75;
    sim.setCommands(0, { motors: { left: near ? 0.1 : 0.5, right: near ? 0.1 : 0.5 }, fire: st.actuators.w.ready && near ? ['w'] : [] });
    debris = Math.max(debris, sim.snapshot().debris.length);
    if (ko < 0 && sim.robots[1].knockedOut) ko = sim.time;
  });
  check('parts break off as debris', debris > 0, `max debris ${debris}`);
  check('destroying the Control Core knocks the target out', ko > 0, `at ${ko.toFixed(1)}s`);
  sim.free();
}

{
  const sim = new Simulation(RAPIER, [testBot(), dummyDesign()]);
  sim.active = true;
  const start = sim.pose(1).pos;
  let travelled = 0, last = start;
  run(sim, 20, () => { driveDummy(sim, 1, 'moving'); const p = sim.pose(1).pos; travelled += Math.hypot(p[0] - last[0], p[2] - last[2]); last = p; });
  check('moving target moves slowly', travelled > 2 && travelled < 30, `${travelled.toFixed(1)} m in 20 s`);
  sim.free();
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
