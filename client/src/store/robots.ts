/** Robots live on the player's device only: design and code together, in localStorage. */
import { useSyncExternalStore } from 'react';
import type { RobotDesign } from '@shared/types';

export interface SavedRobot { id: string; updatedAt: number; design: RobotDesign }

const KEY = 'rc.robots.v1';
const listeners = new Set<() => void>();

/** What a new robot's program starts as: the two required functions, with no logic. */
export const EMPTY_PROGRAM = `function setup(robot, controls) {

}

function loop(robot, input, dt) {

}
`;

function load(): SavedRobot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === 'string' && r.design?.parts) : [];
  } catch { return []; }
}

let robots = load();

/** Returns false when the device refuses to store more (storage full). */
function commit(next: SavedRobot[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { return false; }
  robots = next;
  listeners.forEach((l) => l());
  return true;
}

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const robotStore = {
  all: () => robots,
  get: (id: string) => robots.find((r) => r.id === id),
  create(name: string): SavedRobot | null {
    return this.add({ formatVersion: 1, name, parts: [], code: EMPTY_PROGRAM });
  },
  add(design: RobotDesign): SavedRobot | null {
    const robot: SavedRobot = { id: newId(), updatedAt: Date.now(), design };
    return commit([robot, ...robots]) ? robot : null;
  },
  save(id: string, design: RobotDesign): boolean {
    return commit(robots.map((r) => (r.id === id ? { ...r, design, updatedAt: Date.now() } : r)));
  },
  remove(id: string) { commit(robots.filter((r) => r.id !== id)); },
};

export function useRobots(): SavedRobot[] {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => robots);
}
