export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

/** One placed part in a saved robot. Rotation is Euler degrees in 90° steps. */
export interface DesignPart {
  type: string;
  position: Vec3;
  rotation: Vec3;
  color: string;
  /** Program-facing ID. Present on motors, actuators and sensors. */
  id?: string;
  /** Wheel or spinning weapon mounted on a motor's shaft. */
  attachment?: string;
  attachmentColor?: string;
}

export interface RobotDesign {
  formatVersion: 1;
  name: string;
  parts: DesignPart[];
  code: string;
}

export type IssueLevel = 'error' | 'warning';
export interface Issue {
  level: IssueLevel;
  code: string;
  params?: Record<string, string | number>;
}

/** What a control program sends each tick. */
export interface Commands {
  motors: Record<string, number>;
  fire: string[];
}

export type SensorReading =
  | { kind: 'distance'; distance: number | null }
  | { kind: 'radar'; target: { distance: number; bearing: number } | null }
  | { kind: 'gyro'; heading: number; tilt: number; upsideDown: boolean }
  | { kind: 'bumper'; touching: boolean }
  | { kind: 'dead' };

/** Everything a control program is allowed to know about its own robot. */
export interface ProgramState {
  time: number;
  battery: number;
  health: number;
  motors: Record<string, { speed: number; health: number }>;
  actuators: Record<string, { ready: boolean; health: number }>;
  sensors: Record<string, SensorReading>;
}

export interface PartSnap {
  /** Remaining HP from 0 to 1. -1 once the part has broken off. */
  hp: number;
  /** Shaft angle in radians (attachments) or strike animation 0..1 (actuators). */
  anim: number;
}

export interface RobotSnap {
  pos: Vec3;
  quat: Quat;
  parts: PartSnap[];
  energy: number;
  health: number;
  knockedOut: boolean;
  damageDealt: number;
}

export interface DebrisSnap {
  id: number;
  type: string;
  color: string;
  pos: Vec3;
  quat: Quat;
}

export interface SimEvent {
  kind: 'spark' | 'break' | 'fire';
  pos: Vec3;
  power: number;
}

export interface Snapshot {
  time: number;
  robots: RobotSnap[];
  debris: DebrisSnap[];
  events: SimEvent[];
}
