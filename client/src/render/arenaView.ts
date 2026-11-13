/** Draws a fight from simulation snapshots: arena, robots, debris, sparks and smoke. */
import * as THREE from 'three';
import { CONFIG, PLAYER_COLORS } from '@shared/config';
import type { RobotDesign, Snapshot } from '@shared/types';
import type { Quality } from '../store/settings';
import { buildPartMesh, disposePart } from './partMeshes';
import { RobotView } from './robotView';

export type CameraMode = 'follow' | 'overhead';

const QUALITY: Record<Quality, { scale: number; shadows: number; sparks: number; smoke: boolean }> = {
  low: { scale: 0.75, shadows: 0, sparks: 80, smoke: false },
  medium: { scale: 1.5, shadows: 1024, sparks: 240, smoke: true },
  high: { scale: 2, shadows: 2048, sparks: 480, smoke: true },
};

function floorTexture(): THREE.Texture {
  const size = 1024, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#343A43';
  g.fillRect(0, 0, size, size);
  // Steel plates
  const plates = 6, step = size / plates;
  for (let i = 0; i < plates; i++) for (let j = 0; j < plates; j++) {
    const v = 46 + ((i * 7 + j * 13) % 5) * 3;
    g.fillStyle = `rgb(${v},${v + 5},${v + 12})`;
    g.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
  }
  // Scuffs and scrapes
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI, l = 10 + rnd() * 70;
    g.strokeStyle = `rgba(${rnd() > 0.5 ? '190,200,215' : '10,12,16'},${0.05 + rnd() * 0.12})`;
    g.lineWidth = 1 + rnd() * 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // Hazard stripes around the edge
  const band = size * 0.035;
  g.save();
  g.beginPath(); g.rect(0, 0, size, size); g.rect(band, band, size - band * 2, size - band * 2); g.clip('evenodd');
  g.fillStyle = '#15181D'; g.fillRect(0, 0, size, size);
  g.strokeStyle = '#FFC400'; g.lineWidth = band * 0.45;
  for (let x = -size; x < size * 2; x += band * 1.3) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + size, size); g.stroke(); }
  g.restore();
  // Centre ring and spawn marks
  g.strokeStyle = 'rgba(34,225,255,0.35)'; g.lineWidth = 5;
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.09, 0, Math.PI * 2); g.stroke();
  const spawn = (CONFIG.arena.spawnDistance / CONFIG.arena.size) * size;
  for (const s of [-1, 1]) g.strokeRect(size / 2 - 60, size / 2 + s * spawn - 60, 120, 120);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  constructor(private count: number, size: number, color: number, additive: boolean, private gravity: number, private maxLife: number) {
    this.pos = new Float32Array(count * 3).fill(-999);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, color, transparent: true, opacity: additive ? 1 : 0.35, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
  }
  emit(p: THREE.Vector3Like, speed: number, up: number) {
    if (!this.count) return;
    const i = this.next = (this.next + 1) % this.count;
    this.pos.set([p.x, p.y, p.z], i * 3);
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
    this.vel.set([Math.cos(a) * s, up * (0.4 + Math.random()), Math.sin(a) * s], i * 3);
    this.life[i] = this.maxLife * (0.5 + Math.random() * 0.5);
  }
  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) { this.pos[k + 1] = -999; continue; }
      this.vel[k + 1] -= this.gravity * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.01 && this.gravity > 0) { this.pos[k + 1] = 0.01; this.vel[k + 1] *= -0.4; }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export class ArenaView {
  cameraMode: CameraMode = 'follow';
  followIndex = 0;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.05, 80);
  private robots: RobotView[];
  private markers: THREE.Group[] = [];
  private debris = new Map<number, THREE.Group>();
  private sparks: Particles;
  private smoke: Particles;
  private q: (typeof QUALITY)[Quality];
  private camPos = new THREE.Vector3(0, 3, -8);
  private camAim = new THREE.Vector3();
  private smokeClock = 0;

  constructor(private canvas: HTMLCanvasElement, designs: RobotDesign[], quality: Quality) {
    this.q = QUALITY[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = this.q.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color('#07090C');
    this.scene.fog = new THREE.Fog('#07090C', 14, 34);

    const half = CONFIG.arena.size / 2, wallH = CONFIG.arena.wallHeight;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), new THREE.MeshStandardMaterial({ map: floorTexture(), metalness: 0.55, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: '#2A3038', metalness: 0.6, roughness: 0.55 });
    const capMat = new THREE.MeshStandardMaterial({ color: '#FFC400', metalness: 0.3, roughness: 0.6 });
    for (const [x, z, w, d] of [[0, half + 0.15, half * 2 + 0.6, 0.3], [0, -half - 0.15, half * 2 + 0.6, 0.3], [half + 0.15, 0, 0.3, half * 2], [-half - 0.15, 0, 0.3, half * 2]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      wall.position.set(x, wallH / 2, z);
      wall.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), capMat);
      cap.position.set(x, wallH + 0.04, z);
      this.scene.add(wall, cap);
    }
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#0B0E12', roughness: 1 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.01;
    this.scene.add(apron);

    // Floodlights
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a1d22, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(5, 11, -4);
    if (this.q.shadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(this.q.shadows, this.q.shadows);
      const cam = key.shadow.camera;
      cam.left = cam.bottom = -half - 1; cam.right = cam.top = half + 1; cam.far = 30;
      key.shadow.bias = -0.0006;
    }
    this.scene.add(key);
    if (quality !== 'low') {
      for (const [x, z, col] of [[-7, 7, 0x22e1ff], [7, 7, 0xffc400]] as const) {
        const spot = new THREE.SpotLight(col, 60, 30, 0.7, 0.6, 1.4);
        spot.position.set(x, 8, z);
        spot.target.position.set(0, 0, 0);
        this.scene.add(spot, spot.target);
      }
    }

    this.robots = designs.map((d, i) => {
      const view = new RobotView(d);
      this.scene.add(view.group);
      const marker = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: PLAYER_COLORS[i % 2], transparent: true, opacity: 0.9, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.64, 48), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      const pip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 4), mat);
      pip.rotation.x = Math.PI;
      pip.name = 'pip';
      marker.add(ring, pip);
      this.scene.add(marker);
      this.markers.push(marker);
      return view;
    });

    this.sparks = new Particles(this.q.sparks, 0.05, 0xffc040, true, 9, 0.6);
    this.smoke = new Particles(this.q.smoke ? 140 : 0, 0.22, 0x30343a, false, -0.6, 1.6);
    this.scene.add(this.sparks.points, this.smoke.points);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.q.scale < 1 ? Math.min(dpr, 1) * this.q.scale : Math.min(dpr, this.q.scale));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 70 : 55;
    this.camera.updateProjectionMatrix();
  }

  render(snap: Snapshot, dt: number) {
    snap.robots.forEach((r, i) => {
      this.robots[i].update(r);
      const m = this.markers[i];
      m.position.set(r.pos[0], 0, r.pos[2]);
      m.getObjectByName('pip')!.position.y = r.pos[1] + 0.75 + Math.sin(snap.time * 3 + i) * 0.03;
      m.visible = !r.knockedOut;
    });

    // Debris appears when a part breaks off and fades from the scene when the simulation drops it.
    const seen = new Set<number>();
    for (const d of snap.debris) {
      seen.add(d.id);
      let obj = this.debris.get(d.id);
      if (!obj) {
        obj = buildPartMesh(d.type, d.color);
        obj.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.userData?.tint) m.color.multiplyScalar(0.3); });
        this.scene.add(obj);
        this.debris.set(d.id, obj);
      }
      obj.position.set(...d.pos);
      obj.quaternion.set(...d.quat);
    }
    for (const [id, obj] of this.debris) if (!seen.has(id)) { this.scene.remove(obj); disposePart(obj); this.debris.delete(id); }

    for (const e of snap.events) {
      const p = { x: e.pos[0], y: e.pos[1], z: e.pos[2] };
      const n = e.kind === 'fire' ? 0 : Math.min(26, 4 + Math.round(e.power / 4));
      for (let i = 0; i < n; i++) this.sparks.emit(p, 2.5 + e.power / 30, 2.5);
    }
    this.smokeClock += dt;
    if (this.q.smoke && this.smokeClock > 0.09) {
      this.smokeClock = 0;
      const hot: THREE.Vector3[] = [];
      snap.robots.forEach((r, i) => this.robots[i].smokingParts(r, hot));
      for (const p of hot.slice(0, 10)) this.smoke.emit(p, 0.15, 0.5);
    }
    this.sparks.update(dt);
    this.smoke.update(dt);

    this.updateCamera(snap, dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(snap: Snapshot, dt: number) {
    const target = new THREE.Vector3(), aim = new THREE.Vector3();
    const r = snap.robots[this.followIndex];
    if (this.cameraMode === 'overhead' || !r) {
      const tall = this.camera.aspect < 1;
      target.set(0, tall ? 17 : 11.5, tall ? -6 : -7.5);
      aim.set(0, 0, tall ? -0.3 : -0.6);
    } else {
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...r.quat));
      front.y = 0;
      if (front.lengthSq() < 0.01) front.set(0, 0, 1);
      front.normalize();
      target.set(r.pos[0], 0, r.pos[2]).addScaledVector(front, -2.9).setY(1.9);
      aim.set(r.pos[0], 0.25, r.pos[2]).addScaledVector(front, 1.2);
      const lim = CONFIG.arena.size / 2 - 0.3;
      target.x = THREE.MathUtils.clamp(target.x, -lim, lim);
      target.z = THREE.MathUtils.clamp(target.z, -lim, lim);
    }
    const k = 1 - Math.exp(-dt * 5);
    this.camPos.lerp(target, k);
    this.camAim.lerp(aim, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camAim);
  }

  dispose() {
    this.robots.forEach((r) => r.dispose());
    this.debris.forEach((d) => disposePart(d));
    this.renderer.dispose();
  }
}
