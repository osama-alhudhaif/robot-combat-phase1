/**
 * Every tunable value in the game lives in this file: build rules, arena,
 * physics, damage, program limits and the part catalog. Game logic reads
 * from here and never hard-codes a balance number.
 */
import type { Vec3 } from './types';

export const CONFIG = {
  cellSize: 0.1, // metres per grid cell

  build: {
    maxWeight: 100,
    grid: [12, 8, 12] as Vec3, // cells: width (x), height (y), length (z). Front is +z.
    maxParts: 80,
    maxNameLength: 32,
    maxIdLength: 24,
    maxCodeBytes: 100_000,
  },

  arena: {
    size: 12, // metres, square floor
    wallHeight: 1.5,
    spawnDistance: 4, // metres from centre, on opposite sides
    countdownSeconds: 3,
  },

  physics: {
    stepsPerSecond: 60,
    gravity: 9.81,
    colliderInset: 0.002, // metres shaved off block colliders so wheels touch first
    floorFriction: 0.5,
    bodyFriction: 0.25,
    restitution: 0.1,
    linearDamping: 0.05,
    angularDamping: 0.4,
    baseTorque: 6, // N·m at "torque ×1"
    wheelGrip: 0.95, // friction coefficient of a driven wheel
    lateralGrip: 0.9,
    rollingResistance: 0.03,
    debrisSeconds: 4,
  },

  damage: {
    spinDamagePerJoule: 0.06, // HP per joule of stored spin energy, before the weapon multiplier
    spinKeepOnHit: 0.25, // fraction of spin speed kept after a hit
    spinMinSpeed: 0.3, // below this fraction of top speed a spinner only pushes
    spinHitCooldown: 0.25, // seconds
    knockbackPerSqrtJoule: 4.5, // N·s
    recoilFraction: 0.5, // share of the knockback the attacker feels
    knockbackMax: 260,
    knockbackMaxSpeed: 4, // m/s cap so light robots are not launched across the arena
    ramMultiplier: 0.3,
    ramDamagePerJoule: 0.15,
    ramMinSpeed: 1.2, // m/s closing speed
    ramCooldown: 0.4,
    flipperImpulse: 300, // N·s on whatever is on the arm
    flipperMaxSpeed: 4, // m/s cap on how fast a flipper can launch a light robot
    actuatorReach: 0.35, // metres an arm can reach to push off the floor
    selfRightSpeed: 4.2, // m/s kick a flipper or hammer gives its own robot off the floor
    hammerImpulse: 60,
    smokeBelow: 0.35, // HP fraction under which a part smokes
  },

  program: {
    ticksPerSecond: 30,
    loopBudgetMs: 5,
    budgetStrikes: 15, // over-budget ticks allowed within the strike window
    strikeWindow: 60, // ticks
    hangTimeoutMs: 400,
    maxSticks: 2,
    maxButtons: 6,
    reservedKeys: ['Escape', 'KeyV'],
    maxLogsPerTick: 20,
  },

  countOut: { stillDistance: 0.5, stillSeconds: 5, countSeconds: 10 }, // used from Phase 2

  match: { rounds: 3, roundSeconds: 180 }, // used from Phase 2
};

export type Category =
  | 'structure' | 'armor' | 'motor' | 'wheel' | 'spinner'
  | 'actuator' | 'sensor' | 'power' | 'control';

export const CATEGORY_ORDER: Category[] = [
  'control', 'power', 'structure', 'armor', 'motor', 'wheel', 'spinner', 'actuator', 'sensor',
];

/** Collision shape in the part's local frame, in cell units. */
export type Shape =
  | { kind: 'box'; c: Vec3; h: Vec3 }
  | { kind: 'hull'; pts: Vec3[] }
  | { kind: 'cyl'; c: Vec3; r: number; hh: number } // axis along local +z (the shaft)
  | { kind: 'ball'; c: Vec3; r: number };

export interface PartDef {
  type: string;
  category: Category;
  weight: number;
  hp: number;
  /** Cells the part occupies, relative to its anchor cell, before rotation. */
  cells: Vec3[];
  shape: Shape;
  /** Fraction of incoming damage ignored. */
  armor?: number;
  /** Prefix for auto-generated program IDs. */
  idPrefix?: string;
  /** Local axis that should point away from the surface the part is placed on. */
  mountAxis?: 'y' | 'z';
  motor?: { torque: number; rpm: number; drain: number };
  /** Mounts on a motor shaft instead of the grid. */
  attaches?: true;
  wheel?: { radius: number };
  free?: true; // caster: rolls freely, no motor
  spin?: { damageMult: number; inertia: number; dps?: number; lift: number };
  actuator?: { kind: 'flipper' | 'hammer'; cooldown: number; energy: number; damage: number };
  sensor?: { kind: 'distance' | 'radar' | 'gyro' | 'bumper'; range?: number };
  battery?: number;
  core?: true;
}

const cell: Vec3[] = [[0, 0, 0]];
const plateCells: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]];
const plateShape: Shape = { kind: 'box', c: [0.5, -0.35, 0.5], h: [1, 0.15, 1] };
const hub: Vec3[] = [[0, 0, 1]];
const full: Shape = { kind: 'box', c: [0, 0, 0], h: [0.5, 0.5, 0.5] };

const list: PartDef[] = [
  // Structure
  { type: 'frame', category: 'structure', weight: 1.0, hp: 40, cells: cell, shape: full },
  {
    type: 'wedge', category: 'structure', weight: 0.8, hp: 35, cells: cell,
    // Full height at the back (-z), sloping to the floor at the front (+z).
    shape: { kind: 'hull', pts: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
  },
  { type: 'panel', category: 'structure', weight: 0.4, hp: 20, cells: cell, mountAxis: 'y', shape: { kind: 'box', c: [0, -0.4, 0], h: [0.5, 0.1, 0.5] } },

  // Armor
  { type: 'plate_light', category: 'armor', weight: 1.5, hp: 80, armor: 0.15, cells: plateCells, mountAxis: 'y', shape: plateShape },
  { type: 'plate_medium', category: 'armor', weight: 3.0, hp: 160, armor: 0.30, cells: plateCells, mountAxis: 'y', shape: plateShape },
  { type: 'plate_heavy', category: 'armor', weight: 5.0, hp: 260, armor: 0.45, cells: plateCells, mountAxis: 'y', shape: plateShape },

  // Motors. The shaft points along local +z.
  { type: 'motor_small', category: 'motor', weight: 2.0, hp: 50, cells: cell, shape: full, idPrefix: 'motor', mountAxis: 'z', motor: { torque: 1, rpm: 600, drain: 2 } },
  { type: 'motor_medium', category: 'motor', weight: 4.0, hp: 70, cells: cell, shape: full, idPrefix: 'motor', mountAxis: 'z', motor: { torque: 2, rpm: 450, drain: 4 } },
  { type: 'motor_large', category: 'motor', weight: 7.0, hp: 100, cells: cell, shape: full, idPrefix: 'motor', mountAxis: 'z', motor: { torque: 4, rpm: 300, drain: 8 } },

  // Wheels
  { type: 'wheel_small', category: 'wheel', weight: 0.5, hp: 30, attaches: true, cells: hub, wheel: { radius: 0.5 }, shape: { kind: 'cyl', c: [0, 0, 1], r: 0.5, hh: 0.25 } },
  { type: 'wheel_medium', category: 'wheel', weight: 1.0, hp: 45, attaches: true, cells: hub, wheel: { radius: 1.0 }, shape: { kind: 'cyl', c: [0, 0, 1], r: 1.0, hh: 0.3 } },
  { type: 'wheel_large', category: 'wheel', weight: 2.0, hp: 60, attaches: true, cells: hub, wheel: { radius: 1.5 }, shape: { kind: 'cyl', c: [0, 0, 1], r: 1.5, hh: 0.4 } },
  { type: 'caster', category: 'wheel', weight: 0.3, hp: 25, free: true, cells: cell, shape: { kind: 'ball', c: [0, 0, 0], r: 0.5 } },

  // Spinning weapons
  { type: 'spinner_bar', category: 'spinner', weight: 6.0, hp: 150, attaches: true, cells: hub, spin: { damageMult: 3.0, inertia: 0.5, lift: 0.25 }, shape: { kind: 'cyl', c: [0, 0, 1], r: 2.0, hh: 0.2 } },
  { type: 'spinner_disc', category: 'spinner', weight: 5.0, hp: 140, attaches: true, cells: hub, spin: { damageMult: 2.5, inertia: 0.3, lift: 0.25 }, shape: { kind: 'cyl', c: [0, 0, 1], r: 1.5, hh: 0.2 } },
  { type: 'drum', category: 'spinner', weight: 7.0, hp: 180, attaches: true, cells: [[0, 0, 1], [0, 0, 2]], spin: { damageMult: 2.2, inertia: 0.25, lift: 1.0 }, shape: { kind: 'cyl', c: [0, 0, 1.5], r: 0.6, hh: 1.0 } },
  { type: 'saw', category: 'spinner', weight: 2.0, hp: 80, attaches: true, cells: hub, spin: { damageMult: 0, inertia: 0.05, dps: 25, lift: 0 }, shape: { kind: 'cyl', c: [0, 0, 1], r: 1.0, hh: 0.1 } },

  // Actuated weapons. Both act along local +y; the flipper arm lies along local +z.
  {
    type: 'flipper', category: 'actuator', weight: 8.0, hp: 120, cells: [[0, 0, 0], [0, 0, 1]], idPrefix: 'flipper',
    actuator: { kind: 'flipper', cooldown: 2.0, energy: 15, damage: 0 },
    shape: { kind: 'hull', pts: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, 0, -0.5], [0.5, 0, -0.5], [-0.5, -0.5, 1.5], [0.5, -0.5, 1.5], [-0.5, -0.38, 1.5], [0.5, -0.38, 1.5]] },
  },
  {
    type: 'hammer', category: 'actuator', weight: 9.0, hp: 130, cells: cell, idPrefix: 'hammer', shape: full,
    actuator: { kind: 'hammer', cooldown: 1.5, energy: 10, damage: 60 },
  },

  // Sensors. Distance sensors and bumpers face local +z.
  { type: 'sensor_distance', category: 'sensor', weight: 0.2, hp: 15, cells: cell, idPrefix: 'distance', mountAxis: 'z', sensor: { kind: 'distance', range: 5 }, shape: { kind: 'box', c: [0, 0, -0.2], h: [0.25, 0.25, 0.3] } },
  { type: 'sensor_radar', category: 'sensor', weight: 0.5, hp: 20, cells: cell, idPrefix: 'radar', mountAxis: 'y', sensor: { kind: 'radar' }, shape: { kind: 'box', c: [0, -0.2, 0], h: [0.3, 0.3, 0.3] } },
  { type: 'sensor_gyro', category: 'sensor', weight: 0.2, hp: 15, cells: cell, idPrefix: 'gyro', mountAxis: 'y', sensor: { kind: 'gyro' }, shape: { kind: 'box', c: [0, -0.3, 0], h: [0.3, 0.2, 0.3] } },
  { type: 'sensor_bumper', category: 'sensor', weight: 0.2, hp: 20, cells: cell, idPrefix: 'bumper', mountAxis: 'z', sensor: { kind: 'bumper' }, shape: { kind: 'box', c: [0, 0, -0.15], h: [0.5, 0.5, 0.35] } },

  // Power
  { type: 'battery_small', category: 'power', weight: 4.0, hp: 60, cells: cell, shape: full, battery: 1000 },
  { type: 'battery_large', category: 'power', weight: 8.0, hp: 90, cells: [[0, 0, 0], [1, 0, 0]], shape: { kind: 'box', c: [0.5, 0, 0], h: [1, 0.5, 0.5] }, battery: 2200 },

  // Control
  { type: 'control_core', category: 'control', weight: 3.0, hp: 120, cells: cell, shape: full, core: true },
];

export const PARTS: Record<string, PartDef> = Object.fromEntries(list.map((p) => [p.type, p]));
export const PART_LIST: PartDef[] = list;

export const DEFAULT_COLORS: Record<Category, string> = {
  structure: '#5B6470', armor: '#8A939E', motor: '#3A4048', wheel: '#1E2228', spinner: '#C9CED6',
  actuator: '#FFC400', sensor: '#22E1FF', power: '#3D8B5A', control: '#FFC400',
};

/** Fixed marker colours for the two fighters. */
export const PLAYER_COLORS = ['#22E1FF', '#FF7A1A'];
