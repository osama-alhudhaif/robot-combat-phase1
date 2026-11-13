/**
 * Host side of the isolated program runtime.
 *
 * Player code never runs on the page. Each program gets a hidden iframe with
 * `sandbox="allow-scripts"` (an opaque origin: no cookies, storage or DOM of
 * ours) and a Content Security Policy that blocks every network request. Inside
 * it a Web Worker runs the program, so an endless loop can never freeze the
 * game: the host notices the silence and removes the iframe, which kills it.
 */
import { CONFIG } from '@shared/config';
import type { Commands, ProgramState, RobotDesign } from '@shared/types';
import { PARTS } from '@shared/config';
import workerSource from './programWorker.js?raw';

export interface ControlsDecl {
  sticks: { name: string; keys: (string | null)[]; label: string }[];
  buttons: { name: string; key: string | null; label: string }[];
}

export interface InputFrame {
  buttons: Record<string, boolean>;
  pressed: Record<string, boolean>;
  sticks: Record<string, { x: number; y: number }>;
}

export interface LogEntry {
  level: 'log' | 'warn' | 'error';
  text?: string;
  code?: string;
  params?: Record<string, string | number>;
  name?: string;
  line?: number | null;
  where?: 'load' | 'setup' | 'loop';
  count?: number;
}

export type StopReason = 'hang' | 'budget' | 'load' | 'unsupported';

export interface ProgramEvents {
  onReady(controls: ControlsDecl): void;
  onLogs(entries: LogEntry[]): void;
  onStopped(reason: StopReason): void;
}

export interface ProgramInfo { motors: string[]; actuators: string[]; sensors: { id: string; kind: string }[] }

export function programInfo(design: RobotDesign): ProgramInfo {
  const info: ProgramInfo = { motors: [], actuators: [], sensors: [] };
  for (const p of design.parts) {
    const def = PARTS[p.type];
    if (!p.id || !def) continue;
    if (def.motor) info.motors.push(p.id);
    else if (def.actuator) info.actuators.push(p.id);
    else if (def.sensor) info.sensors.push({ id: p.id, kind: def.sensor.kind });
  }
  return info;
}

const FRAME_HTML = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:">
<script>
let worker = null;
addEventListener('message', (e) => {
  if (e.source !== parent || worker) return;
  const m = e.data;
  if (m.type === 'init') {
    try {
      worker = new Worker(URL.createObjectURL(new Blob([m.workerSource], { type: 'text/javascript' })));
    } catch (err) { parent.postMessage({ type: 'stopped', reason: 'unsupported' }, '*'); return; }
    worker.onerror = () => parent.postMessage({ type: 'stopped', reason: 'unsupported' }, '*');
    delete m.workerSource;
    worker.postMessage(m, [m.port]);
  }
});
parent.postMessage({ type: 'frameReady' }, '*');
<\/script>`;

export class ProgramHost {
  stopped: StopReason | null = null;
  ready = false;

  private frame: HTMLIFrameElement;
  /** Direct line to the worker, so ticks never wait on the hidden iframe's event loop. */
  private channel = new MessageChannel();
  private latest: Commands | null = null;
  private awaiting = false;
  private watchdog = 0;
  private n = 0;
  private strikes: boolean[] = [];
  private loadTimer: number;
  private onMessage = (e: MessageEvent) => this.handle(e);

  constructor(private code: string, private info: ProgramInfo, private events: ProgramEvents) {
    this.frame = document.createElement('iframe');
    this.frame.setAttribute('sandbox', 'allow-scripts');
    this.frame.setAttribute('aria-hidden', 'true');
    this.frame.style.display = 'none';
    this.frame.srcdoc = FRAME_HTML;
    window.addEventListener('message', this.onMessage);
    document.body.appendChild(this.frame);
    // Top-level code or setup() that never returns counts as a hang too.
    this.loadTimer = window.setTimeout(() => { if (!this.ready) this.stop('hang'); }, 3000);
  }

  private handle(e: MessageEvent, fromWorker = false) {
    if ((!fromWorker && e.source !== this.frame.contentWindow) || this.stopped) return;
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'frameReady') {
      this.channel.port1.onmessage = (ev) => this.handle(ev, true);
      this.frame.contentWindow!.postMessage({
        type: 'init', workerSource, code: this.code, info: this.info, port: this.channel.port2,
        limits: { maxSticks: CONFIG.program.maxSticks, maxButtons: CONFIG.program.maxButtons, reservedKeys: CONFIG.program.reservedKeys, maxLogsPerTick: CONFIG.program.maxLogsPerTick },
      }, '*', [this.channel.port2]);
    } else if (m.type === 'ready') {
      this.ready = true;
      clearTimeout(this.loadTimer);
      if (m.logs?.length) this.events.onLogs(m.logs);
      this.events.onReady(m.controls);
    } else if (m.type === 'cmd') {
      this.awaiting = false;
      clearTimeout(this.watchdog);
      this.latest = { motors: m.motors ?? {}, fire: Array.isArray(m.fire) ? m.fire : [] };
      if (m.logs?.length) this.events.onLogs(m.logs);
      this.strikes.push(m.ms > CONFIG.program.loopBudgetMs);
      if (this.strikes.length > CONFIG.program.strikeWindow) this.strikes.shift();
      if (this.strikes.filter(Boolean).length > CONFIG.program.budgetStrikes) this.stop('budget');
    } else if (m.type === 'stopped') {
      if (m.logs?.length) this.events.onLogs(m.logs);
      this.stop(m.reason === 'unsupported' ? 'unsupported' : 'load');
    }
  }

  /** True when the program can take a new tick. While false, hold the input back so no key press is lost. */
  get idle() { return !this.stopped && this.ready && !this.awaiting; }

  /** Sends one tick of state and input. Call at the program tick rate once the program is ready. */
  tick(state: ProgramState, input: InputFrame, dt: number) {
    if (this.stopped || !this.ready || this.awaiting) return; // still busy with the previous tick: do not queue more behind it
    this.awaiting = true;
    const n = ++this.n;
    this.channel.port1.postMessage({ type: 'tick', n, state, input, dt });
    // No answer in time means the program hangs. The second, short timer lets a reply that is
    // already queued behind a slow frame be handled first, so a slow device is not mistaken for a hang.
    clearTimeout(this.watchdog);
    this.watchdog = window.setTimeout(() => {
      this.watchdog = window.setTimeout(() => { if (this.awaiting && this.n === n) this.stop('hang'); }, 150);
    }, CONFIG.program.hangTimeoutMs);
  }

  /** Commands from the most recent finished tick, or null if there are none since the last call. */
  takeCommands(): Commands | null {
    const c = this.latest;
    this.latest = null;
    return c;
  }

  private stop(reason: StopReason) {
    if (this.stopped) return;
    this.stopped = reason;
    this.destroy();
    this.events.onStopped(reason);
  }

  /** Removing the iframe terminates its worker, even one stuck in an endless loop. */
  destroy() {
    clearTimeout(this.loadTimer);
    clearTimeout(this.watchdog);
    window.removeEventListener('message', this.onMessage);
    this.channel.port1.close();
    this.frame.remove();
    if (!this.stopped) this.stopped = 'load';
  }
}
