/** Pure editing operations on a robot's part list. The 3D editor and its panels call these. */
import { CONFIG, DEFAULT_COLORS, PARTS } from '@shared/config';
import {
  allCells, attachmentCells, axisMat, cellKey, fits, inGrid, matMul, mirrorPart, nextId, occupancy,
  orientToNormal, rotFromMat, rotateAbout,
} from '@shared/geometry';
import type { DesignPart, Vec3 } from '@shared/types';

export type Tool = 'place' | 'select' | 'paint' | 'erase';

export interface Hit {
  designIndex: number; // -1 when the grid floor was hit
  isAttachment: boolean;
  point: Vec3; // in cell units
  normal: Vec3;
}

export type OpResult = { parts: DesignPart[]; selected?: number } | { error: 'cantPlace' | 'needMotor' | 'cantMove' };

const round = (p: Vec3): Vec3 => [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])];
const same = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** The cell a new part would go in: the one just outside the surface that was hit. */
function targetCell(parts: DesignPart[], hit: Hit): Vec3 {
  const step = (k: number): Vec3 => round([hit.point[0] + hit.normal[0] * k, hit.point[1] + hit.normal[1] * k, hit.point[2] + hit.normal[2] * k]);
  let cell = step(0.5);
  if (hit.designIndex >= 0 && allCells(parts[hit.designIndex]).some((c) => same(c, cell))) cell = step(1.5); // thin parts
  return cell;
}

/** Where and how a part of this type would be placed for a hit. Null for shaft-mounted parts. */
export function candidate(parts: DesignPart[], type: string, hit: Hit, spin: number, tilt: number, color?: string): DesignPart | null {
  const def = PARTS[type];
  if (!def || def.attaches) return null;
  const rotation = def.mountAxis
    ? orientToNormal(def, hit.normal, spin)
    : rotFromMat(matMul(axisMat(1, 90 * spin), axisMat(0, 90 * tilt)));
  return { type, position: targetCell(parts, hit), rotation, color: color ?? DEFAULT_COLORS[def.category] };
}

function mirrorIndex(parts: DesignPart[], index: number): number {
  const m = mirrorPart(parts[index]);
  return parts.findIndex((p, i) => i !== index && p.type === m.type && same(p.position, m.position));
}

export function place(parts: DesignPart[], type: string, hit: Hit, spin: number, tilt: number, mirror: boolean, color?: string): OpResult {
  const def = PARTS[type];
  if (def.attaches) {
    const motor = hit.designIndex >= 0 ? parts[hit.designIndex] : null;
    if (!motor || !PARTS[motor.type].motor) return { error: 'needMotor' };
    const next = parts.map((p) => ({ ...p }));
    const mount = (i: number): boolean => {
      const trial = { ...next[i], attachment: type, attachmentColor: color ?? DEFAULT_COLORS[def.category] };
      const occ = occupancy(next, i);
      const own = new Set(allCells({ ...trial, attachment: undefined }).map(cellKey));
      if (!attachmentCells(trial).every((c) => inGrid(c) && !occ.has(cellKey(c)) && !own.has(cellKey(c)))) return false;
      next[i] = trial;
      return true;
    };
    if (!mount(hit.designIndex)) return { error: 'cantPlace' };
    if (mirror) { const j = mirrorIndex(next, hit.designIndex); if (j >= 0 && PARTS[next[j].type].motor) mount(j); }
    return { parts: next };
  }
  const part = candidate(parts, type, hit, spin, tilt, color);
  if (!part || !fits(parts, part)) return { error: 'cantPlace' };
  if (def.idPrefix) part.id = nextId(parts, def.idPrefix);
  const next = [...parts, part];
  if (mirror) {
    const twin = mirrorPart(part);
    if (fits(next, twin)) {
      if (def.idPrefix) twin.id = nextId(next, def.idPrefix);
      next.push(twin);
    }
  }
  return { parts: next };
}

export function erase(parts: DesignPart[], hit: Hit, mirror: boolean): OpResult {
  if (hit.designIndex < 0) return { parts };
  const targets = [hit.designIndex];
  if (mirror) { const j = mirrorIndex(parts, hit.designIndex); if (j >= 0) targets.push(j); }
  if (hit.isAttachment) return { parts: parts.map((p, i) => (targets.includes(i) ? { ...p, attachment: undefined, attachmentColor: undefined } : p)) };
  return { parts: parts.filter((_, i) => !targets.includes(i)) };
}

export function paint(parts: DesignPart[], hit: Hit, color: string, mirror: boolean): OpResult {
  if (hit.designIndex < 0) return { parts };
  const targets = [hit.designIndex];
  if (mirror) { const j = mirrorIndex(parts, hit.designIndex); if (j >= 0) targets.push(j); }
  return { parts: parts.map((p, i) => (!targets.includes(i) ? p : hit.isAttachment ? { ...p, attachmentColor: color } : { ...p, color })) };
}

export function rotateSelected(parts: DesignPart[], index: number, axis: 0 | 1 | 2): OpResult {
  const next = { ...parts[index], rotation: rotateAbout(parts[index].rotation, axis) };
  if (!fits(parts, next, index)) return { error: 'cantMove' };
  return { parts: parts.map((p, i) => (i === index ? next : p)) };
}

export function moveSelected(parts: DesignPart[], index: number, delta: Vec3): OpResult {
  const p = parts[index];
  const next = { ...p, position: [p.position[0] + delta[0], p.position[1] + delta[1], p.position[2] + delta[2]] as Vec3 };
  if (!fits(parts, next, index)) return { error: 'cantMove' };
  return { parts: parts.map((q, i) => (i === index ? next : q)) };
}

export function patchPart(parts: DesignPart[], index: number, patch: Partial<DesignPart>): DesignPart[] {
  return parts.map((p, i) => (i === index ? { ...p, ...patch } : p));
}

export const worldToCellUnits = (x: number, y: number, z: number): Vec3 => {
  const [gx, , gz] = CONFIG.build.grid, s = CONFIG.cellSize;
  return [x / s + (gx - 1) / 2, y / s - 0.5, z / s + (gz - 1) / 2];
};
