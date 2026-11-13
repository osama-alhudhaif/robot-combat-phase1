/** Three.js models for every catalog part, built in the part's own frame (anchor cell centre, metres). */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { PARTS } from '@shared/config';

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key) as T;
}

type Mat = THREE.MeshStandardMaterial;
const tint = (color: string, metal = 0.5, rough = 0.55): Mat => {
  const m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
  m.userData.tint = true;
  return m;
};
const fixed = (color: string, metal = 0.45, rough = 0.45): Mat => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
const glow = (color: string): Mat => new THREE.MeshStandardMaterial({ color: '#111', emissive: color, emissiveIntensity: 1.6, roughness: 0.3 });

function box(w: number, h: number, d: number, mat: Mat, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Cylinder along the given axis. */
function cyl(r: number, length: number, mat: Mat, axis: 'x' | 'y' | 'z', x = 0, y = 0, z = 0, seg = 20): THREE.Mesh {
  const mesh = new THREE.Mesh(geo(`c${r},${length},${seg}`, () => new THREE.CylinderGeometry(r, r, length, seg)), mat);
  if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  if (axis === 'x') mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

function edges(mesh: THREE.Mesh): THREE.LineSegments {
  const g = geo(`e${mesh.geometry.uuid}`, () => new THREE.EdgesGeometry(mesh.geometry, 30));
  const lines = new THREE.LineSegments(g, edgeMat);
  lines.raycast = () => {};
  return lines;
}
const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });

const STEEL = '#B8BEC7';
const DARK = '#22262C';

export function buildPartMesh(type: string, color: string): THREE.Group {
  const g = new THREE.Group();
  const def = PARTS[type];
  const add = (...objs: THREE.Object3D[]) => { g.add(...objs); return objs[0]; };
  const outlined = (m: THREE.Mesh) => { m.add(edges(m)); return m; };

  switch (type) {
    case 'frame':
      add(outlined(box(0.097, 0.097, 0.097, tint(color))));
      add(box(0.06, 0.099, 0.06, fixed(DARK, 0.3, 0.8)), box(0.099, 0.06, 0.06, fixed(DARK, 0.3, 0.8)), box(0.06, 0.06, 0.099, fixed(DARK, 0.3, 0.8)));
      break;
    case 'wedge': {
      const pts = (def.shape as { pts: number[][] }).pts.map((p) => new THREE.Vector3(p[0] * 0.097, p[1] * 0.097, p[2] * 0.097));
      add(outlined(new THREE.Mesh(geo('wedge', () => new ConvexGeometry(pts)), tint(color))));
      break;
    }
    case 'panel':
      add(outlined(box(0.097, 0.018, 0.097, tint(color), 0, -0.04, 0)));
      break;
    case 'plate_light': case 'plate_medium': case 'plate_heavy': {
      const t = type === 'plate_light' ? 0.016 : type === 'plate_medium' ? 0.024 : 0.03;
      add(outlined(box(0.197, t, 0.197, tint(color, 0.5, 0.35), 0.05, -0.05 + t / 2 + 0.001, 0.05)));
      for (const [x, z] of [[-0.03, -0.03], [0.13, -0.03], [-0.03, 0.13], [0.13, 0.13]]) add(cyl(0.007, t + 0.006, fixed(DARK), 'y', x, -0.05 + t / 2, z, 8));
      break;
    }
    case 'motor_small': case 'motor_medium': case 'motor_large': {
      const r = type === 'motor_small' ? 0.03 : type === 'motor_medium' ? 0.038 : 0.045;
      add(outlined(box(0.094, 0.094, 0.06, tint(color), 0, 0, -0.016)));
      add(cyl(r, 0.036, fixed('#6B7380'), 'z', 0, 0, 0.03));
      add(cyl(0.012, 0.03, fixed(STEEL, 0.5, 0.2), 'z', 0, 0, 0.06, 10));
      add(box(0.02, 0.008, 0.02, glow('#FFC400'), 0, 0.045, -0.02));
      break;
    }
    case 'wheel_small': case 'wheel_medium': case 'wheel_large': {
      const sh = def.shape as { r: number; hh: number };
      const r = sh.r * 0.1, w = sh.hh * 0.2;
      const spin = new THREE.Group();
      spin.position.z = 0.1;
      spin.add(cyl(r, w, tint(color, 0.1, 0.9), 'z', 0, 0, 0, 28));
      spin.add(cyl(r * 0.55, w + 0.006, fixed(STEEL, 0.5, 0.3), 'z', 0, 0, 0, 6));
      spin.add(box(r * 1.5, r * 0.16, w + 0.008, fixed(DARK)));
      g.userData.spin = add(spin);
      add(cyl(0.012, 0.05, fixed(STEEL, 0.5, 0.2), 'z', 0, 0, 0.07, 10));
      break;
    }
    case 'caster':
      add(new THREE.Mesh(geo('ball', () => new THREE.SphereGeometry(0.049, 18, 12)), tint(color, 0.5, 0.25)));
      add(cyl(0.03, 0.012, fixed(DARK), 'y', 0, 0.044, 0, 12));
      break;
    case 'spinner_bar': case 'spinner_disc': case 'drum': case 'saw': {
      const sh = def.shape as { c: number[]; r: number; hh: number };
      const spin = new THREE.Group();
      spin.position.z = sh.c[2] * 0.1;
      const steel = tint(color, 0.5, 0.25);
      if (type === 'spinner_bar') {
        spin.add(outlined(box(0.4, 0.05, 0.034, steel)), box(0.05, 0.06, 0.036, fixed(DARK), 0.176), box(0.05, 0.06, 0.036, fixed(DARK), -0.176));
      } else if (type === 'spinner_disc') {
        spin.add(cyl(0.135, 0.034, steel, 'z', 0, 0, 0, 24), box(0.04, 0.05, 0.036, fixed(DARK), 0.132), box(0.04, 0.05, 0.036, fixed(DARK), -0.132));
        spin.add(box(0.2, 0.012, 0.037, fixed(DARK)));
      } else if (type === 'drum') {
        spin.add(cyl(0.05, 0.196, steel, 'z', 0, 0, 0, 16), box(0.022, 0.03, 0.06, fixed(DARK), 0.05, 0, -0.05), box(0.022, 0.03, 0.06, fixed(DARK), -0.05, 0, 0.05));
      } else {
        const blade = new THREE.Mesh(geo('saw', () => new THREE.CylinderGeometry(0.1, 0.1, 0.012, 14)), steel);
        blade.rotation.x = Math.PI / 2;
        (steel as Mat).flatShading = true;
        spin.add(blade, box(0.2, 0.012, 0.014, fixed(DARK)), box(0.012, 0.2, 0.014, fixed(DARK)));
      }
      spin.add(cyl(0.028, sh.hh * 0.2 + 0.016, fixed(DARK), 'z', 0, 0, 0, 12));
      g.userData.spin = add(spin);
      add(cyl(0.012, 0.06, fixed(STEEL, 0.5, 0.2), 'z', 0, 0, 0.075, 10));
      break;
    }
    case 'flipper': {
      add(outlined(box(0.097, 0.05, 0.097, tint(color), 0, -0.024, 0)));
      add(cyl(0.012, 0.099, fixed(STEEL), 'x', 0, -0.03, -0.04, 10));
      const arm = new THREE.Group();
      arm.position.set(0, -0.036, -0.04);
      arm.add(outlined(box(0.09, 0.014, 0.186, fixed('#D7DBE0', 0.5, 0.3), 0, 0, 0.094)));
      arm.add(box(0.09, 0.016, 0.02, glow('#FFC400'), 0, 0, 0.176));
      g.userData.arm = add(arm);
      g.userData.armKind = 'flipper';
      break;
    }
    case 'hammer': {
      add(outlined(box(0.097, 0.097, 0.097, tint(color))));
      const arm = new THREE.Group();
      arm.position.set(0, 0.035, 0);
      arm.add(box(0.02, 0.02, 0.2, fixed(STEEL), 0, 0, 0.1), outlined(box(0.07, 0.06, 0.05, fixed('#3A4048', 0.5, 0.3), 0, 0, 0.2)));
      add(cyl(0.02, 0.1, fixed(DARK), 'x', 0, 0.035, 0, 10));
      g.userData.arm = add(arm);
      g.userData.armKind = 'hammer';
      break;
    }
    case 'sensor_distance':
      add(outlined(box(0.05, 0.05, 0.06, tint(color, 0.3, 0.6), 0, 0, -0.02)), cyl(0.016, 0.01, glow('#22E1FF'), 'z', 0, 0, 0.012, 12));
      break;
    case 'sensor_radar': {
      add(outlined(box(0.06, 0.03, 0.06, fixed(DARK, 0.3, 0.6), 0, -0.035, 0)), cyl(0.006, 0.03, fixed(STEEL), 'y', 0, -0.01, 0, 6));
      const dish = cyl(0.034, 0.008, tint(color, 0.4, 0.4), 'z', 0, 0.015, 0, 16);
      dish.rotation.x = Math.PI / 2 - 0.5;
      add(dish);
      break;
    }
    case 'sensor_gyro':
      add(outlined(box(0.06, 0.04, 0.06, fixed(DARK, 0.3, 0.6), 0, -0.03, 0)), cyl(0.018, 0.006, tint(color, 0.2, 0.4), 'y', 0, -0.008, 0, 16), box(0.008, 0.008, 0.03, glow('#22E1FF'), 0, -0.006, 0));
      break;
    case 'sensor_bumper':
      add(outlined(box(0.097, 0.097, 0.05, fixed(DARK, 0.3, 0.7), 0, 0, -0.025)), box(0.09, 0.09, 0.02, tint(color, 0.1, 0.8), 0, 0, 0.01));
      break;
    case 'battery_small': case 'battery_large': {
      const big = type === 'battery_large';
      const w = big ? 0.197 : 0.097, x = big ? 0.05 : 0;
      add(outlined(box(w, 0.097, 0.097, tint(color, 0.3, 0.6), x)));
      add(box(w + 0.002, 0.02, 0.099, fixed(DARK), x, 0.02, 0));
      add(cyl(0.01, 0.012, fixed('#D9A441', 0.5, 0.3), 'y', x - 0.02, 0.052, 0, 8), cyl(0.01, 0.012, fixed(STEEL, 0.5, 0.3), 'y', x + 0.02, 0.052, 0, 8));
      break;
    }
    case 'control_core':
      add(outlined(box(0.097, 0.097, 0.097, fixed('#20252C', 0.6, 0.5))));
      add(box(0.06, 0.1, 0.06, glow(color)), box(0.1, 0.03, 0.06, glow(color)), box(0.06, 0.03, 0.1, glow(color)));
      break;
    default:
      add(box(0.09, 0.09, 0.09, tint(color)));
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Frees the per-part materials. Geometries are shared and stay cached. */
export function disposePart(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (mat && mat !== edgeMat) mat.dispose();
  });
}
