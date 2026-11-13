/**
 * The training target. It exists only as an opponent in the test arena:
 * players cannot select, copy or edit it, and it is never saved or exported.
 */
import type { Simulation } from './sim/simulation';
import { quatRotate } from './geometry';
import type { DesignPart, RobotDesign, Vec3 } from './types';

export type DummyMode = 'still' | 'moving';

export function dummyDesign(): RobotDesign {
  const parts: DesignPart[] = [];
  const put = (type: string, position: Vec3, extra: Partial<DesignPart> = {}) =>
    parts.push({ type, position, rotation: [0, 0, 0], color: (position[0] + position[2]) % 2 ? '#FFC400' : '#2A2F37', ...extra });
  for (let x = 4; x <= 7; x++) for (let z = 4; z <= 7; z++) {
    const edgeZ = z === 4 || z === 7, midX = x === 5 || x === 6;
    if (edgeZ && midX) put('caster', [x, 0, z], { color: '#8A939E' });
    else if (z === 5 && x === 4) put('motor_small', [x, 0, z], { rotation: [0, 270, 0], id: 'a', attachment: 'wheel_small', color: '#3A4048' });
    else if (z === 5 && x === 7) put('motor_small', [x, 0, z], { rotation: [0, 90, 0], id: 'b', attachment: 'wheel_small', color: '#3A4048' });
    else put('frame', [x, 0, z]);
    if (x === 5 && z === 5) put('control_core', [x, 1, z], { color: '#FF3B30' });
    else if (x === 6 && z === 5) put('battery_small', [x, 1, z], { color: '#3D8B5A' });
    else put('frame', [x, 1, z]);
  }
  for (const [x, z] of [[4, 4], [6, 4], [4, 6], [6, 6]]) put('plate_medium', [x, 2, z], { color: '#8A939E' });
  return { formatVersion: 1, name: 'Training target', parts, code: '' };
}

/** Drives the target slowly around the arena. Called by the test arena, not by a control program. */
export function driveDummy(sim: Simulation, index: number, mode: DummyMode) {
  if (mode === 'still') { sim.setCommands(index, { motors: { a: 0, b: 0 }, fire: [] }); return; }
  const { pos, quat } = sim.pose(index);
  const lap = 40; // seconds per circuit
  const angle = (sim.time / lap) * Math.PI * 2 + Math.PI / 2;
  const target: Vec3 = [Math.cos(angle) * 3.5, 0, Math.sin(angle) * 3.5];
  const local = quatRotate([-quat[0], -quat[1], -quat[2], quat[3]], [target[0] - pos[0], 0, target[2] - pos[2]]);
  const bearing = Math.atan2(-local[0], local[2]); // positive: target is to the right
  const turn = Math.max(-0.25, Math.min(0.25, bearing * 0.4));
  const drive = Math.abs(bearing) > 1.2 ? 0 : 0.3;
  sim.setCommands(index, { motors: { a: drive - turn, b: drive + turn }, fire: [] });
}
