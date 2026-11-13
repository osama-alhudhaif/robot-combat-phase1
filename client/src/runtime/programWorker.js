/*
 * Runs one player's control program. This file is loaded as text and started
 * as a Web Worker inside a sandboxed iframe, so the program has no access to
 * the page, to storage or to the network. It talks to the game only through
 * messages: state and input come in, commands and log lines go out.
 */
'use strict';
(() => {
  // Replies go straight to the game over a private port handed in at start-up.
  let port = null;
  const post = (m) => port.postMessage(m);
  const now = () => performance.now();

  // Defence in depth on top of the sandbox and its Content Security Policy.
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport', 'RTCPeerConnection']) {
    try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); } catch (e) { /* not present */ }
  }

  let info = { motors: [], actuators: [], sensors: [] };
  let limits = {};
  let state = null;
  let frame = { buttons: {}, pressed: {}, sticks: {} };
  let fns = { setup: null, loop: null };
  let lineOffset = 0;
  let inSetup = false;
  let tickNo = 0;
  let logs = [];
  let fired = [];
  const motorPower = {};
  const decl = { sticks: [], buttons: [] };
  const warned = new Set();
  const errorSeen = new Map();

  function text(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
    if (v instanceof Error) return v.name + ': ' + v.message;
    try { const s = JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isInteger(x) ? Math.round(x * 1000) / 1000 : x)); return s === undefined ? String(v) : s; } catch (e) { return String(v); }
  }
  function push(entry) { if (logs.length < limits.maxLogsPerTick) logs.push(entry); }
  function warnOnce(key, code, params) { if (!warned.has(key)) { warned.add(key); push({ level: 'warn', code, params }); } }

  function stackLine(e) {
    const m = /(?:<anonymous>|Function|eval[^\s:)]*):(\d+):(\d+)/.exec(String((e && e.stack) || ''));
    return m ? Number(m[1]) : null;
  }
  function reportError(e, where) {
    const raw = stackLine(e);
    const line = raw === null ? (e && typeof e.lineNumber === 'number' ? e.lineNumber - lineOffset : null) : raw - lineOffset;
    const name = (e && e.name) || 'Error';
    const message = e instanceof Error ? e.message : text(e);
    const key = where + '|' + name + '|' + message + '|' + line;
    const seen = errorSeen.get(key) || { count: 0, last: -1e9 };
    seen.count++;
    errorSeen.set(key, seen);
    // The same error every tick would flood the console: show it at most once a second.
    if (tickNo - seen.last >= 30) {
      seen.last = tickNo;
      push({ level: 'error', name, text: name + ': ' + message, line: line && line > 0 ? line : null, where, count: seen.count });
    }
  }

  // ------------------------------------------------------------ robot API
  const cache = { motor: new Map(), actuator: new Map(), sensor: new Map() };
  const NO_MOTOR = Object.freeze({ setPower() {}, speed: 0, health: 0 });
  const NO_ACTUATOR = Object.freeze({ fire() { return false; }, ready: false, health: 0 });
  const NO_SENSOR = Object.freeze({ distance: null, target: null, heading: null, tilt: null, upsideDown: null, touching: null });
  const SENSOR_PROPS = { distance: ['distance'], radar: ['target'], gyro: ['heading', 'tilt', 'upsideDown'], bumper: ['touching'] };

  function motor(id) {
    let h = cache.motor.get(id);
    if (h) return h;
    if (!info.motors.includes(id)) { warnOnce('m:' + id, 'unknownId', { kind: 'motor', id: text(id) }); return NO_MOTOR; }
    h = Object.freeze({
      setPower(p) { p = Number(p); motorPower[id] = Number.isFinite(p) ? Math.max(-1, Math.min(1, p)) : 0; },
      get speed() { return state && state.motors[id] ? state.motors[id].speed : 0; },
      get health() { return state && state.motors[id] ? state.motors[id].health : 0; },
    });
    cache.motor.set(id, h);
    return h;
  }

  function actuator(id) {
    let h = cache.actuator.get(id);
    if (h) return h;
    if (!info.actuators.includes(id)) { warnOnce('a:' + id, 'unknownId', { kind: 'actuator', id: text(id) }); return NO_ACTUATOR; }
    const ready = () => !!(state && state.actuators[id] && state.actuators[id].ready) && !fired.includes(id);
    h = Object.freeze({
      fire() { if (inSetup || !ready()) return false; fired.push(id); return true; },
      get ready() { return ready(); },
      get health() { return state && state.actuators[id] ? state.actuators[id].health : 0; },
    });
    cache.actuator.set(id, h);
    return h;
  }

  function sensor(id) {
    let h = cache.sensor.get(id);
    if (h) return h;
    const meta = info.sensors.find((s) => s.id === id);
    if (!meta) { warnOnce('s:' + id, 'unknownId', { kind: 'sensor', id: text(id) }); return NO_SENSOR; }
    h = {};
    for (const kind of Object.keys(SENSOR_PROPS)) for (const prop of SENSOR_PROPS[kind]) {
      Object.defineProperty(h, prop, {
        enumerable: true,
        get() {
          if (kind !== meta.kind) { warnOnce('p:' + id + prop, 'wrongSensor', { id, have: meta.kind, prop }); return null; }
          const r = state && state.sensors[id];
          if (!r || r.kind !== kind) return null; // not read yet, or the sensor is destroyed
          const v = r[prop];
          return v && typeof v === 'object' ? Object.assign({}, v) : v;
        },
      });
    }
    Object.freeze(h);
    cache.sensor.set(id, h);
    return h;
  }

  const robot = Object.freeze({
    motor, actuator, sensor,
    get battery() { return state ? state.battery : 1; },
    get health() { return state ? state.health : 1; },
    get time() { return state ? state.time : 0; },
    log(...values) { push({ level: 'log', text: values.map(text).join(' ') }); },
  });

  // ------------------------------------------------------------- controls
  function declared(name) { return decl.sticks.some((s) => s.name === name) || decl.buttons.some((b) => b.name === name); }
  function checkKey(name, key) {
    if (typeof key !== 'string' || !key) return null;
    if (limits.reservedKeys.includes(key)) { push({ level: 'warn', code: 'reservedKey', params: { key, name } }); return null; }
    return key;
  }
  const controls = Object.freeze({
    button(name, opts) {
      if (!inSetup) return warnOnce('late', 'lateControl', {});
      if (typeof name !== 'string' || !name) return push({ level: 'warn', code: 'badControl', params: { name: text(name) } });
      if (declared(name)) return push({ level: 'warn', code: 'dupControl', params: { name } });
      if (decl.buttons.length >= limits.maxButtons) return push({ level: 'warn', code: 'tooManyButtons', params: { n: limits.maxButtons, name } });
      opts = opts || {};
      decl.buttons.push({ name, key: checkKey(name, opts.key), label: String(opts.label === undefined ? name : opts.label).slice(0, 12) });
    },
    stick(name, opts) {
      if (!inSetup) return warnOnce('late', 'lateControl', {});
      if (typeof name !== 'string' || !name) return push({ level: 'warn', code: 'badControl', params: { name: text(name) } });
      if (declared(name)) return push({ level: 'warn', code: 'dupControl', params: { name } });
      if (decl.sticks.length >= limits.maxSticks) return push({ level: 'warn', code: 'tooManySticks', params: { n: limits.maxSticks, name } });
      opts = opts || {};
      const keys = Array.isArray(opts.keys) && opts.keys.length === 4 ? opts.keys.map((k) => checkKey(name, k)) : [null, null, null, null];
      if (opts.keys !== undefined && !(Array.isArray(opts.keys) && opts.keys.length === 4)) push({ level: 'warn', code: 'badControl', params: { name } });
      decl.sticks.push({ name, keys, label: String(opts.label === undefined ? name : opts.label).slice(0, 12) });
    },
  });

  function known(name) { if (declared(name)) return true; warnOnce('c:' + name, 'undeclared', { name: text(name) }); return false; }
  const input = Object.freeze({
    button(name) { return known(name) && !!frame.buttons[name]; },
    pressed(name) { return known(name) && !!frame.pressed[name]; },
    stick(name) { const s = known(name) && frame.sticks[name]; return s ? { x: s.x, y: s.y } : { x: 0, y: 0 }; },
  });

  // ------------------------------------------------------------ lifecycle
  function start(msg) {
    info = msg.info;
    limits = msg.limits;
    try { new Function('throw new Error("calibrate")')(); } catch (e) { const l = stackLine(e); lineOffset = l ? l - 1 : 0; }
    try {
      fns = new Function(msg.code + '\n;return { setup: typeof setup === "function" ? setup : null, loop: typeof loop === "function" ? loop : null };')();
    } catch (e) {
      reportError(e, 'load');
      post({ type: 'stopped', reason: 'load', logs });
      return;
    }
    if (!fns.setup) push({ level: 'warn', code: 'noSetup' });
    if (!fns.loop) push({ level: 'warn', code: 'noLoop' });
    if (fns.setup) {
      inSetup = true;
      try { fns.setup(robot, controls); } catch (e) { reportError(e, 'setup'); }
      inSetup = false;
    }
    post({ type: 'ready', controls: decl, logs });
    logs = [];
  }

  function tick(msg) {
    state = msg.state;
    frame = msg.input;
    tickNo = msg.n;
    fired = [];
    const t0 = now();
    if (fns.loop) {
      try { fns.loop(robot, input, msg.dt); } catch (e) { reportError(e, 'loop'); }
    }
    post({ type: 'cmd', n: msg.n, ms: now() - t0, motors: Object.assign({}, motorPower), fire: fired, logs });
    logs = [];
  }

  self.onmessage = (e) => {
    const msg = e.data;
    if (port || !msg || msg.type !== 'init' || !msg.port) return;
    port = msg.port;
    port.onmessage = (ev) => { if (ev.data && ev.data.type === 'tick') tick(ev.data); };
    self.onmessage = null;
    start(msg);
  };
})();
