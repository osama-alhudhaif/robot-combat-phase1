import { CONFIG, PARTS } from './config';
import { allCells, cellKey, connectedToCore, designStats, inGrid } from './geometry';
import type { DesignPart, Issue, RobotDesign } from './types';

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Checks a design against the build rules. Errors block testing and matches; warnings do not. */
export function validateDesign(design: RobotDesign): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, params?: Issue['params']) => issues.push({ level: 'error', code, params });
  const warn = (code: string, params?: Issue['params']) => issues.push({ level: 'warning', code, params });
  const { build } = CONFIG;
  const stats = designStats(design);

  if (design.parts.length === 0) { err('empty'); return issues; }
  if (stats.weight > build.maxWeight) err('overWeight', { kg: Math.round((stats.weight - build.maxWeight) * 10) / 10 });
  if (stats.partCount > build.maxParts) err('tooManyParts', { n: stats.partCount - build.maxParts });

  const cores = design.parts.filter((p) => PARTS[p.type]?.core).length;
  if (cores === 0) err('noCore');
  if (cores > 1) err('multiCore', { n: cores });
  if (stats.battery === 0) err('noBattery');

  const seen = new Set<string>();
  let outside = 0, overlaps = 0;
  for (const p of design.parts) {
    const cells = allCells(p);
    if (cells.some((c) => !inGrid(c))) outside++;
    if (cells.some((c) => seen.has(cellKey(c)))) overlaps++;
    cells.forEach((c) => seen.add(cellKey(c)));
  }
  if (outside) err('outOfBounds', { n: outside });
  if (overlaps) err('overlap', { n: overlaps });

  if (cores === 1) {
    const loose = connectedToCore(design.parts).filter((ok) => !ok).length;
    if (loose) err('disconnected', { n: loose });
  }

  const ids = new Set<string>();
  let driveWheels = 0;
  for (const p of design.parts) {
    const def = PARTS[p.type];
    if (def.idPrefix) {
      if (!p.id || !ID_RE.test(p.id) || p.id.length > build.maxIdLength) err('badId', { id: p.id ?? '' });
      else if (ids.has(p.id)) err('dupId', { id: p.id });
      else ids.add(p.id);
    }
    if (def.motor) {
      if (!p.attachment) warn('motorEmpty', { id: p.id ?? '' });
      else if (PARTS[p.attachment]?.wheel) driveWheels++;
    }
  }
  if (driveWheels === 0) warn('noWheels');
  return issues;
}

export const isValid = (design: RobotDesign) => !validateDesign(design).some((i) => i.level === 'error');

export type ParseResult = { ok: true; design: RobotDesign } | { ok: false; code: string; params?: Record<string, string | number> };

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const isVec = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isInt);
const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

/**
 * Reads an exported robot file. Rejects anything that is not a well-formed
 * version 1 robot made only of catalog parts. Used for import now and by the
 * server for incoming designs in Phase 2.
 */
export function parseRobotFile(text: string): ParseResult {
  let raw: any;
  try { raw = JSON.parse(text); } catch { return { ok: false, code: 'notJson' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'malformed' };
  if (raw.formatVersion !== 1) return { ok: false, code: 'badVersion', params: { v: String(raw.formatVersion) } };
  if (typeof raw.name !== 'string' || !Array.isArray(raw.parts)) return { ok: false, code: 'malformed' };
  if (raw.parts.length > CONFIG.build.maxParts * 2) return { ok: false, code: 'malformed' };
  const code = typeof raw.code === 'string' ? raw.code : '';
  if (code.length > CONFIG.build.maxCodeBytes) return { ok: false, code: 'codeTooLong' };

  const parts: DesignPart[] = [];
  for (const p of raw.parts) {
    if (!p || typeof p !== 'object') return { ok: false, code: 'malformed' };
    const def = PARTS[p.type];
    if (typeof p.type !== 'string' || !def || def.attaches) return { ok: false, code: 'unknownPart', params: { type: String(p.type) } };
    if (!isVec(p.position) || !isVec(p.rotation) || p.rotation.some((r: number) => r % 90 !== 0)) return { ok: false, code: 'malformed' };
    const part: DesignPart = {
      type: p.type,
      position: p.position,
      rotation: p.rotation.map((r: number) => ((r % 360) + 360) % 360) as DesignPart['rotation'],
      color: isColor(p.color) ? p.color : '#888888',
    };
    if (def.idPrefix) part.id = typeof p.id === 'string' ? p.id.slice(0, CONFIG.build.maxIdLength) : '';
    if (p.attachment !== undefined && p.attachment !== null) {
      const att = PARTS[p.attachment];
      if (typeof p.attachment !== 'string' || !att) return { ok: false, code: 'unknownPart', params: { type: String(p.attachment) } };
      if (!att.attaches || !def.motor) return { ok: false, code: 'malformed' };
      part.attachment = p.attachment;
      if (isColor(p.attachmentColor)) part.attachmentColor = p.attachmentColor;
    }
    parts.push(part);
  }
  return { ok: true, design: { formatVersion: 1, name: raw.name.slice(0, CONFIG.build.maxNameLength) || 'Robot', parts, code } };
}

export function serializeRobot(design: RobotDesign): string {
  return JSON.stringify({ formatVersion: 1, name: design.name, parts: design.parts, code: design.code }, null, 2);
}
