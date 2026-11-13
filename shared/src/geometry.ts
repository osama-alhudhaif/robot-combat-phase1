import { CONFIG, DEFAULT_COLORS, PARTS, type PartDef } from './config';
import type { DesignPart, Quat, RobotDesign, Vec3 } from './types';

export type Mat3 = number[]; // row-major 3×3

const c90 = (deg: number) => Math.round(Math.cos((deg * Math.PI) / 180));
const s90 = (deg: number) => Math.round(Math.sin((deg * Math.PI) / 180));

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const m = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) m[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return m;
}

export function axisMat(axis: 0 | 1 | 2, deg: number): Mat3 {
  const c = c90(deg), s = s90(deg);
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Rotation matrix for Euler degrees [rx, ry, rz], applied z first, then x, then y. */
export function rotMat(rot: Vec3): Mat3 {
  return matMul(axisMat(1, rot[1]), matMul(axisMat(0, rot[0]), axisMat(2, rot[2])));
}

export function applyMat(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

const ALL_ROTS: { rot: Vec3; m: Mat3 }[] = [];
for (const rz of [0, 90, 180, 270]) for (const rx of [0, 90, 180, 270]) for (const ry of [0, 90, 180, 270]) {
  ALL_ROTS.push({ rot: [rx, ry, rz], m: rotMat([rx, ry, rz]) });
}

/** Finds the Euler triple for one of the 24 grid orientations. */
export function rotFromMat(m: Mat3): Vec3 {
  const hit = ALL_ROTS.find((r) => r.m.every((v, i) => v === m[i]));
  return hit ? [...hit.rot] as Vec3 : [0, 0, 0];
}

/** Rotates an existing orientation by 90° about a world axis. */
export function rotateAbout(rot: Vec3, axis: 0 | 1 | 2, deg = 90): Vec3 {
  return rotFromMat(matMul(axisMat(axis, deg), rotMat(rot)));
}

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatAxis(axis: Vec3, rad: number): Quat {
  const s = Math.sin(rad / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)];
}

export function quatFromRot(rot: Vec3): Quat {
  const r = (d: number) => (d * Math.PI) / 180;
  return quatMul(quatAxis([0, 1, 0], r(rot[1])), quatMul(quatAxis([1, 0, 0], r(rot[0])), quatAxis([0, 0, 1], r(rot[2]))));
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Turns cylinders (built along y) onto the shaft axis (local +z). */
export const SHAFT_QUAT: Quat = quatAxis([1, 0, 0], Math.PI / 2);

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const cellKey = (c: Vec3) => `${c[0]},${c[1]},${c[2]}`;

/** Centre of a grid cell in the robot's body frame, in metres. Front is +z, up is +y. */
export function cellToLocal(c: Vec3): Vec3 {
  const [gx, , gz] = CONFIG.build.grid;
  const s = CONFIG.cellSize;
  return [(c[0] - (gx - 1) / 2) * s, (c[1] + 0.5) * s, (c[2] - (gz - 1) / 2) * s];
}

function cellsOf(def: PartDef, part: DesignPart): Vec3[] {
  const m = rotMat(part.rotation);
  return def.cells.map((o) => add(part.position, applyMat(m, o)));
}

export const partCells = (part: DesignPart): Vec3[] => cellsOf(PARTS[part.type], part);
export const attachmentCells = (part: DesignPart): Vec3[] =>
  part.attachment && PARTS[part.attachment] ? cellsOf(PARTS[part.attachment], part) : [];
export const allCells = (part: DesignPart): Vec3[] => [...partCells(part), ...attachmentCells(part)];

export function inGrid(c: Vec3): boolean {
  const g = CONFIG.build.grid;
  return c[0] >= 0 && c[1] >= 0 && c[2] >= 0 && c[0] < g[0] && c[1] < g[1] && c[2] < g[2];
}

/** Map from occupied cell to the design part index that owns it. */
export function occupancy(parts: DesignPart[], skip = -1): Map<string, number> {
  const map = new Map<string, number>();
  parts.forEach((p, i) => { if (i !== skip) for (const c of allCells(p)) map.set(cellKey(c), i); });
  return map;
}

/** True if the part fits in the grid without overlapping any other part. */
export function fits(parts: DesignPart[], part: DesignPart, skip = -1): boolean {
  const occ = occupancy(parts, skip);
  return allCells(part).every((c) => inGrid(c) && !occ.has(cellKey(c)));
}

const NEIGHBOURS: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Which design parts still reach the Control Core through touching parts.
 * Attachments ride on their motor and never bridge two parts.
 */
export function connectedToCore(parts: DesignPart[], alive?: boolean[]): boolean[] {
  const ok = (i: number) => !alive || alive[i];
  const owner = new Map<string, number>();
  parts.forEach((p, i) => { if (ok(i)) for (const c of partCells(p)) owner.set(cellKey(c), i); });
  const seen = parts.map(() => false);
  const queue: number[] = [];
  parts.forEach((p, i) => { if (ok(i) && PARTS[p.type]?.core) { seen[i] = true; queue.push(i); } });
  while (queue.length) {
    const i = queue.pop()!;
    for (const c of partCells(parts[i])) for (const n of NEIGHBOURS) {
      const j = owner.get(cellKey(add(c, n)));
      if (j !== undefined && !seen[j]) { seen[j] = true; queue.push(j); }
    }
  }
  return seen;
}

/** Orientation that points the part's mount axis along a surface normal, spun in 90° steps about it. */
export function orientToNormal(def: PartDef, normal: Vec3, spin = 0): Vec3 {
  const axis: Vec3 = def.mountAxis === 'z' ? [0, 0, 1] : [0, 1, 0];
  const base = ALL_ROTS.find((r) => r.rot[2] === 0 && applyMat(r.m, axis).every((v, i) => v === normal[i]));
  if (!base) return [0, 0, 0];
  const ax = normal[0] !== 0 ? 0 : normal[1] !== 0 ? 1 : 2;
  return rotFromMat(matMul(axisMat(ax as 0 | 1 | 2, 90 * spin * (normal[ax] > 0 ? 1 : -1)), base.m));
}

/** The same part reflected across the robot's centre line (the x middle of the grid). */
export function mirrorPart(part: DesignPart): DesignPart {
  const S: Mat3 = [-1, 0, 0, 0, 1, 0, 0, 0, 1];
  const m = rotMat(part.rotation);
  const sm = matMul(S, m);
  const maxX = Math.max(...PARTS[part.type].cells.map((o) => o[0]));
  const shift = applyMat(sm, [maxX, 0, 0]);
  const w = CONFIG.build.grid[0];
  return {
    ...part,
    position: [w - 1 - part.position[0] + shift[0], part.position[1] + shift[1], part.position[2] + shift[2]],
    rotation: rotFromMat(matMul(sm, S)),
  };
}

export function nextId(parts: DesignPart[], prefix: string): string {
  const used = new Set(parts.map((p) => p.id));
  for (let n = 1; ; n++) if (!used.has(prefix + n)) return prefix + n;
}

export interface DesignStats { weight: number; partCount: number; battery: number; drain: number }

export function designStats(design: RobotDesign): DesignStats {
  const s = { weight: 0, partCount: 0, battery: 0, drain: 0 };
  for (const p of design.parts) {
    for (const t of [p.type, p.attachment]) {
      const def = t ? PARTS[t] : undefined;
      if (!def) continue;
      s.weight += def.weight;
      s.partCount += 1;
      s.battery += def.battery ?? 0;
      s.drain += def.motor?.drain ?? 0;
    }
  }
  s.weight = Math.round(s.weight * 10) / 10;
  return s;
}

/** A part as the simulation and the renderer see it. Attachments become parts of their own. */
export interface RuntimePart {
  index: number;
  designIndex: number;
  /** Runtime index of the motor this part is mounted on, or -1. */
  parent: number;
  /** Runtime index of the attachment mounted on this motor, or -1. */
  child: number;
  def: PartDef;
  id?: string;
  color: string;
  /** Anchor cell centre in the body frame, metres. */
  pos: Vec3;
  quat: Quat;
}

export function expandDesign(design: RobotDesign): RuntimePart[] {
  const out: RuntimePart[] = [];
  design.parts.forEach((p, designIndex) => {
    const base = { designIndex, pos: cellToLocal(p.position), quat: quatFromRot(p.rotation) };
    const self: RuntimePart = { ...base, index: out.length, parent: -1, child: -1, def: PARTS[p.type], id: p.id, color: p.color };
    out.push(self);
    if (p.attachment && PARTS[p.attachment]) {
      self.child = out.length;
      out.push({ ...base, index: out.length, parent: self.index, child: -1, def: PARTS[p.attachment], color: p.attachmentColor ?? DEFAULT_COLORS[PARTS[p.attachment].category] });
    }
  });
  return out;
}

/** Position of a point given in a part's local cell units, in the body frame (metres). */
export function partPoint(rt: RuntimePart, local: Vec3): Vec3 {
  return add(rt.pos, quatRotate(rt.quat, scale(local, CONFIG.cellSize)));
}
