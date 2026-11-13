import { useEffect, useMemo, useRef, useState } from 'react';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG, PLAYER_COLORS } from '@shared/config';
import { dummyDesign, driveDummy, type DummyMode } from '@shared/dummy';
import { Simulation } from '@shared/sim/simulation';
import type { Issue, RobotDesign } from '@shared/types';
import { useI18n, type Key } from '../i18n';
import { ArenaView, type CameraMode } from '../render/arenaView';
import { InputManager } from '../runtime/input';
import { ProgramHost, programInfo, type ControlsDecl, type LogEntry, type StopReason } from '../runtime/programHost';
import type { SyntaxIssue } from '../runtime/syntax';
import { getSettings } from '../store/settings';
import { ConsoleView, Segmented, navigate, type ConsoleLine } from '../ui/common';
import { TouchControls } from './TouchControls';

let rapierReady: Promise<void> | null = null;
const initRapier = () => (rapierReady ??= RAPIER.init());

const STEP = 1 / CONFIG.physics.stepsPerSecond;
const STEPS_PER_TICK = Math.round(CONFIG.physics.stepsPerSecond / CONFIG.program.ticksPerSecond);

interface Props {
  id: string;
  design: RobotDesign;
  issues: Issue[];
  syntax: SyntaxIssue | null;
  lines: ConsoleLine[];
  onLogs(entries: LogEntry[]): void;
  onClearConsole(): void;
}

export function TestTab(props: Props) {
  const { t } = useI18n();
  const errors = props.issues.filter((i) => i.level === 'error');
  if (errors.length || props.syntax) {
    return (
      <div className="blocked">
        <div className="hazard" aria-hidden="true" />
        <h2>{t('test.blocked')}</h2>
        <ul className="issues">
          {errors.map((i, n) => <li key={n} className="issues__item issues__item--error">{t(`issue.${i.code}` as Key, i.params)}</li>)}
          {props.syntax && <li className="issues__item issues__item--error">{t('issue.syntax', { line: props.syntax.line, message: props.syntax.message })}</li>}
        </ul>
        <div className="blocked__actions">
          {errors.length > 0 && <button className="btn btn--primary" onClick={() => navigate(`/robot/${props.id}/build`)}>{t('test.fixInBuild')}</button>}
          {props.syntax && <button className="btn btn--primary" onClick={() => navigate(`/robot/${props.id}/code`)}>{t('test.fixInCode')}</button>}
        </div>
      </div>
    );
  }
  return <Arena {...props} />;
}

interface Hud { phase: 'loading' | 'countdown' | 'fight' | 'over'; count: number; health: number; energy: number; target: number; time: number; result: '' | 'targetDown' | 'youDown' }

function Arena({ design, lines, onLogs, onClearConsole }: Props) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);
  const [mode, setMode] = useState<DummyMode>('still');
  const [cam, setCam] = useState<CameraMode>('follow');
  const [hud, setHud] = useState<Hud>({ phase: 'loading', count: 0, health: 1, energy: 1, target: 1, time: 0, result: '' });
  const [decl, setDecl] = useState<ControlsDecl | null>(null);
  const [stopped, setStopped] = useState<StopReason | null>(null);
  const [showConsole, setShowConsole] = useState(false);
  const input = useMemo(() => new InputManager(), []);
  const touch = useMemo(() => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window, []);
  const live = useRef({ mode, cam, onLogs });
  live.current = { mode, cam, onLogs };
  // The design is captured when a run starts: a program cannot be edited mid-round.
  const frozen = useRef(design);

  useEffect(() => {
    frozen.current = design;
    const d = frozen.current;
    let disposed = false, raf = 0;
    let sim: Simulation | null = null, view: ArenaView | null = null, host: ProgramHost | null = null, ro: ResizeObserver | null = null;
    setDecl(null);
    setStopped(null);
    setHud((h) => ({ ...h, phase: 'loading', result: '' }));
    input.attach();

    initRapier().then(() => {
      if (disposed) return;
      const designs = [d, dummyDesign()];
      const s = sim = new Simulation(RAPIER, designs);
      if (import.meta.env.DEV) (window as any).__rcSim = s; // for automated checks in development
      const v = view = new ArenaView(canvas.current!, designs, getSettings().quality);
      ro = new ResizeObserver(() => v.resize());
      ro.observe(canvas.current!);
      const h = host = new ProgramHost(d.code, programInfo(d), {
        onReady: (c) => { input.setDecl(c); setDecl(c); },
        onLogs: (e) => live.current.onLogs(e),
        onStopped: (reason) => { s.clearCommands(0); setStopped(reason); },
      });

      let last = performance.now(), acc = 0, steps = 0, countdown = CONFIG.arena.countdownSeconds, over = false, hudClock = 0;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (!h.ready && !h.stopped) return; // keep the page idle until the program has loaded
        if (countdown > 0 && h.ready) { countdown -= dt; if (countdown <= 0 && !over) s.active = true; }
        acc += dt;
        while (acc >= STEP) {
          acc -= STEP;
          if (s.active && steps % STEPS_PER_TICK === 0) {
            const cmd = h.takeCommands();
            if (cmd && !h.stopped) s.setCommands(0, cmd);
            if (h.idle) h.tick(s.programState(0), input.frame(), STEP * STEPS_PER_TICK);
            driveDummy(s, 1, live.current.mode);
          }
          s.step();
          steps++;
        }
        const snap = s.snapshot();
        if (!over && (snap.robots[0].knockedOut || snap.robots[1].knockedOut)) {
          over = true;
          s.active = false; // the round is over: no more commands or damage, debris keeps falling
          setHud((x) => ({ ...x, phase: 'over', result: snap.robots[1].knockedOut ? 'targetDown' : 'youDown', health: snap.robots[0].health, target: snap.robots[1].health }));
        }
        v.cameraMode = live.current.cam;
        v.render(snap, dt);
        hudClock += dt;
        if (hudClock > 0.1 && !over) {
          hudClock = 0;
          setHud({
            phase: countdown > 0 ? 'countdown' : 'fight', count: Math.ceil(countdown),
            health: snap.robots[0].health, energy: snap.robots[0].energy, target: snap.robots[1].health, time: s.roundTime, result: '',
          });
        }
      };
      raf = requestAnimationFrame(frame);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      input.detach();
      ro?.disconnect();
      host?.destroy();
      view?.dispose();
      sim?.free();
    };
  }, [run]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.code === 'KeyV' && !(e.target as HTMLElement).isContentEditable) setCam((c) => (c === 'follow' ? 'overhead' : 'follow')); };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const clock = `${Math.floor(hud.time / 60)}:${String(Math.floor(hud.time % 60)).padStart(2, '0')}`;
  const noControls = decl && decl.sticks.length + decl.buttons.length === 0;

  return (
    <div className="arena">
      <canvas ref={canvas} className="arena__canvas" />

      <div className="hud">
        <div className="hud__bar hud__bar--you">
          <span className="hud__dot" style={{ background: PLAYER_COLORS[0] }} />
          <div className="hud__meter">
            <div className="hud__label"><span>{design.name}</span><bdi>{pct(hud.health)}</bdi></div>
            <div className="bar bar--health"><i style={{ inlineSize: pct(hud.health) }} /></div>
            <div className="hud__label hud__label--small"><span>{t('test.battery')}</span><bdi>{pct(hud.energy)}</bdi></div>
            <div className="bar bar--energy"><i style={{ inlineSize: pct(hud.energy) }} /></div>
          </div>
        </div>
        <div className="hud__clock"><bdi>{clock}</bdi></div>
        <div className="hud__bar hud__bar--target">
          <span className="hud__dot" style={{ background: PLAYER_COLORS[1] }} />
          <div className="hud__meter">
            <div className="hud__label"><span>{t('test.targetName')}</span><bdi>{pct(hud.target)}</bdi></div>
            <div className="bar bar--health"><i style={{ inlineSize: pct(hud.target) }} /></div>
          </div>
        </div>
      </div>

      <div className="arena__tools">
        <button className="btn btn--small btn--primary" onClick={() => setRun((n) => n + 1)}>{t('test.restart')}</button>
        <Segmented<DummyMode> value={mode} onChange={setMode} label={t('test.target')}
          options={[{ value: 'still', label: t('test.target.still') }, { value: 'moving', label: t('test.target.moving') }]} />
        <Segmented<CameraMode> value={cam} onChange={setCam} label={t('test.camera')}
          options={[{ value: 'follow', label: t('test.camera.follow') }, { value: 'overhead', label: t('test.camera.overhead') }]} />
        <button className={`btn btn--small ${showConsole ? 'is-active' : ''}`} onClick={() => setShowConsole(!showConsole)}>
          {t('test.console')}{lines.some((l) => l.level === 'error') && <i className="dot dot--danger" />}
        </button>
      </div>

      <div className={`chip arena__program ${stopped ? 'is-stopped' : ''}`}>{t(stopped ? 'test.program.stopped' : 'test.program.running')}</div>

      {hud.phase === 'loading' && <div className="arena__center"><p>{t('test.loading')}</p></div>}
      {hud.phase === 'countdown' && <div className="arena__center"><span className="countdown" key={hud.count}>{hud.count}</span></div>}
      {hud.phase === 'over' && (
        <div className="arena__center">
          <div className="result">
            <h2>{t(hud.result === 'youDown' ? 'test.youDown' : 'test.targetDown')}</h2>
            <p>{t('test.roundOver')}</p>
            <button className="btn btn--primary" onClick={() => setRun((n) => n + 1)}>{t('test.restart')}</button>
          </div>
        </div>
      )}
      {stopped && hud.phase !== 'over' && (
        <div className="arena__notice" role="alert">
          <strong>{t(`stop.${stopped}` as Key, { ms: CONFIG.program.loopBudgetMs })}</strong>
          <span>{t('stop.fix')}</span>
        </div>
      )}
      {!stopped && noControls && hud.phase === 'fight' && <div className="arena__notice">{t('test.program.noControls')}</div>}

      {decl && !touch && decl.sticks.length + decl.buttons.length > 0 && (
        <div className="keys" dir="ltr">
          {decl.sticks.map((s) => <span key={s.name}><b>{s.label}</b> {s.keys.map((k) => (k ?? '–').replace(/^Key|^Arrow/, '')).join(' ')}</span>)}
          {decl.buttons.map((b) => <span key={b.name}><b>{b.label}</b> {(b.key ?? '–').replace(/^Key/, '')}</span>)}
          <span><b>{t('test.camera')}</b> V</span>
        </div>
      )}
      {decl && touch && hud.phase !== 'over' && <TouchControls decl={decl} input={input} />}

      {showConsole && <div className="arena__console"><ConsoleView lines={lines} onClear={onClearConsole} /></div>}
    </div>
  );
}
