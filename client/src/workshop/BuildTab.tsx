import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { CATEGORY_ORDER, CONFIG, DEFAULT_COLORS, PARTS, PART_LIST, type PartDef } from '@shared/config';
import { designStats, fits } from '@shared/geometry';
import type { DesignPart, Issue, RobotDesign, Vec3 } from '@shared/types';
import { useI18n, type Key } from '../i18n';
import { Segmented } from '../ui/common';
import { BuilderScene } from './builderScene';
import { candidate, erase, moveSelected, paint, patchPart, place, rotateSelected, type Hit, type OpResult, type Tool } from './editorOps';
import { partParams } from './partText';

export interface History { past: DesignPart[][]; future: DesignPart[][] }

const SWATCHES = ['#FFC400', '#22E1FF', '#FF3B30', '#3D8B5A', '#8A5CF6', '#FF7A1A', '#E8ECF1', '#8A939E', '#5B6470', '#22262C'];
type Panel = 'parts' | 'selected' | 'stats';

interface Props {
  design: RobotDesign;
  issues: Issue[];
  history: MutableRefObject<History>;
  onParts(parts: DesignPart[]): void;
  notify(msg: string, kind?: 'info' | 'error'): void;
}

export function BuildTab({ design, issues, history, onParts, notify }: Props) {
  const { t, lang } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<BuilderScene | null>(null);
  const [tool, setTool] = useState<Tool>('place');
  const [partType, setPartType] = useState('control_core');
  const [color, setColor] = useState<string | null>(null); // null: each part's default colour
  const [mirror, setMirror] = useState(false);
  const [spin, setSpin] = useState(0);
  const [tilt, setTilt] = useState(0);
  const [selected, setSelected] = useState(-1);
  const [hover, setHover] = useState<Hit | null>(null);
  const [panel, setPanel] = useState<Panel>('parts');
  const [, bump] = useState(0);
  const touch = useMemo(() => matchMedia('(pointer: coarse)').matches, []);

  const parts = design.parts;
  const stats = useMemo(() => designStats(design), [design]);
  const sel = selected >= 0 && selected < parts.length ? parts[selected] : null;

  const commit = (next: DesignPart[]) => {
    history.current.past.push(parts);
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = [];
    onParts(next);
  };
  const apply = (result: OpResult, keepSelection = false) => {
    if ('error' in result) { notify(t(`build.${result.error}` as Key), 'error'); return false; }
    if (result.parts !== parts) commit(result.parts);
    if (!keepSelection) setSelected(-1);
    return true;
  };
  const undo = () => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(parts);
    setSelected(-1);
    onParts(prev);
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(parts);
    setSelected(-1);
    onParts(next);
  };

  const onTap = (hit: Hit | null) => {
    if (!hit) { if (tool === 'select') setSelected(-1); return; }
    if (tool === 'place') apply(place(parts, partType, hit, spin, tilt, mirror, color ?? undefined));
    else if (tool === 'erase') apply(erase(parts, hit, mirror));
    else if (tool === 'paint') apply(paint(parts, hit, color ?? '#FFC400', mirror));
    else { setSelected(hit.designIndex); if (hit.designIndex >= 0) setPanel('selected'); }
  };

  // The scene is created once; it reaches the latest handlers through this ref.
  const live = useRef({ onTap, setHover });
  live.current = { onTap, setHover };

  useEffect(() => {
    const s = new BuilderScene(canvas.current!, { onTap: (h) => live.current.onTap(h), onHover: (h) => live.current.setHover(h) });
    scene.current = s;
    return () => { s.dispose(); scene.current = null; };
  }, []);
  useEffect(() => { scene.current?.setDesign(design, selected); }, [design.parts, selected]);
  useEffect(() => { scene.current?.setMirror(mirror); }, [mirror]);
  useEffect(() => { document.fonts.ready.then(() => scene.current?.setFrontLabel(t('build.front'))); }, [lang]);

  // Ghost preview under the mouse while placing.
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const def = PARTS[partType];
    if (tool !== 'place' || !hover) return s.setGhost(null, true);
    if (def.attaches) {
      const motor = hover.designIndex >= 0 ? parts[hover.designIndex] : null;
      if (!motor || !PARTS[motor.type].motor) return s.setGhost(null, true);
      return s.setGhost({ ...motor, type: partType, attachment: undefined, id: undefined }, !motor.attachment);
    }
    const ghost = candidate(parts, partType, hover, spin, tilt);
    s.setGhost(ghost, !!ghost && fits(parts, ghost));
  }, [hover, tool, partType, spin, tilt, parts]);

  const rotate = (axis: 0 | 1 | 2) => {
    if (tool === 'select' && sel) apply(rotateSelected(parts, selected, axis), true);
    else if (axis === 1) setSpin((s) => (s + 1) % 4);
    else setTilt((s) => (s + 1) % 4);
  };
  const removeSelected = () => { if (sel) { commit(parts.filter((_, i) => i !== selected)); setSelected(-1); } };

  const keys = useRef({ rotate, undo, redo, removeSelected });
  keys.current = { rotate, undo, redo, removeSelected };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      const k = keys.current;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? k.redo() : k.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); k.redo(); }
      else if (e.code === 'KeyR') k.rotate(1);
      else if (e.code === 'KeyT') k.rotate(0);
      else if (e.code === 'Delete' || e.code === 'Backspace') k.removeSelected();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  const pickPart = (type: string) => { setPartType(type); setTool('place'); setSpin(0); setTilt(0); };
  const picked = PARTS[partType];
  const name = (def: PartDef) => t(`part.${def.type}.name` as Key);
  const move = (d: Vec3) => apply(moveSelected(parts, selected, d), true);
  const errors = issues.filter((i) => i.level === 'error');
  const over = stats.weight > CONFIG.build.maxWeight;

  return (
    <div className="build">
      <div className="build__view">
        <canvas ref={canvas} className="build__canvas" />
        <div className="build__toolbar">
          <Segmented<Tool>
            value={tool} onChange={(v) => { setTool(v); if (v !== 'select') setSelected(-1); }}
            options={(['place', 'select', 'paint', 'erase'] as Tool[]).map((v) => ({ value: v, label: t(`build.tools.${v}` as Key) }))}
          />
          <div className="build__actions">
            <button className="btn btn--small" onClick={() => rotate(1)} title="R">{t('build.rotate')}</button>
            <button className="btn btn--small" onClick={() => rotate(0)} title="T">{t('build.tilt')}</button>
            {tool === 'select' && sel && <button className="btn btn--small" onClick={() => rotate(2)}>{t('build.roll')}</button>}
            <button className={`btn btn--small ${mirror ? 'is-active' : ''}`} aria-pressed={mirror} onClick={() => setMirror(!mirror)}>{t('build.mirror')}</button>
            <button className="btn btn--small" onClick={undo} disabled={!history.current.past.length}>{t('build.undo')}</button>
            <button className="btn btn--small" onClick={redo} disabled={!history.current.future.length}>{t('build.redo')}</button>
            <button className="btn btn--small btn--danger" disabled={!parts.length} onClick={() => { if (confirm(t('build.confirmClear'))) { commit([]); setSelected(-1); bump((n) => n + 1); } }}>{t('build.clear')}</button>
          </div>
        </div>
        <div className={`build__meter ${over ? 'is-over' : ''}`}>
          <bdi>{stats.weight} / {CONFIG.build.maxWeight} {t('common.kg')}</bdi>
          <bdi>{stats.partCount} / {CONFIG.build.maxParts}</bdi>
          <span className={`badge ${errors.length ? 'badge--draft' : 'badge--ok'}`}>{errors.length ? errors.length : '✓'}</span>
        </div>
      </div>

      <div className="build__tabs">
        <Segmented<Panel>
          value={panel} onChange={setPanel}
          options={[{ value: 'parts', label: t('build.panel.parts') }, { value: 'selected', label: t('build.panel.selected') }, { value: 'stats', label: t('build.panel.stats') }]}
        />
      </div>

      <aside className={`build__palette ${panel === 'parts' ? 'is-active' : ''}`}>
        <div className="palette__detail">
          <strong>{name(picked)}</strong>
          <span className="muted"><bdi>{picked.weight.toFixed(1)} {t('common.kg')}</bdi> · <bdi>{picked.hp} {t('build.stat.hp')}</bdi></span>
          <p>{t(`part.${picked.type}.note` as Key, partParams(picked))}</p>
          <p className="muted">{picked.attaches ? t('build.attachHint') : t(touch ? 'build.pickPartTouch' : 'build.pickPart')}</p>
        </div>
        {CATEGORY_ORDER.map((cat) => (
          <section key={cat} className="palette__group">
            <h3>{t(`cat.${cat}` as Key)}</h3>
            <div className="palette__items">
              {PART_LIST.filter((p) => p.category === cat).map((p) => (
                <button key={p.type} className={`palette__item ${tool === 'place' && partType === p.type ? 'is-active' : ''}`} onClick={() => pickPart(p.type)}>
                  <span className="palette__swatch" style={{ background: DEFAULT_COLORS[p.category] }} />
                  <span className="palette__name">{name(p)}</span>
                  <small><bdi>{p.weight.toFixed(1)} {t('common.kg')}</bdi> · <bdi>{p.hp} {t('build.stat.hp')}</bdi></small>
                </button>
              ))}
            </div>
          </section>
        ))}
      </aside>

      <aside className={`build__side ${panel !== 'parts' ? 'is-active' : ''}`}>
        <section className={`side__block ${panel === 'selected' ? 'is-active' : ''}`} data-panel="selected">
          <h3>{t('build.colour')}</h3>
          <div className="swatches">
            <button className={`swatch swatch--auto ${color === null ? 'is-active' : ''}`} onClick={() => setColor(null)} aria-label="auto">A</button>
            {SWATCHES.map((c) => (
              <button key={c} className={`swatch ${color === c ? 'is-active' : ''}`} style={{ background: c }} aria-label={c} onClick={() => { setColor(c); if (sel && tool === 'select') commit(patchPart(parts, selected, { color: c })); }} />
            ))}
            <input type="color" value={color ?? '#FFC400'} aria-label={t('build.colour')} onChange={(e) => { const c = e.target.value.toUpperCase(); setColor(c); if (sel && tool === 'select') onParts(patchPart(parts, selected, { color: c })); }} />
          </div>
          <button className="btn btn--small" disabled={!parts.length || color === null} onClick={() => commit(parts.map((p) => ({ ...p, color: color!, attachmentColor: p.attachment ? color! : undefined })))}>{t('build.paintAll')}</button>

          <h3>{t('build.panel.selected')}</h3>
          {!sel && <p className="muted">{t('build.noSelection')}</p>}
          {sel && (
            <div className="inspector">
              <strong>{name(PARTS[sel.type])}</strong>
              {PARTS[sel.type].idPrefix && (
                <label className="field">
                  <span>{t('build.id')}</span>
                  <input dir="ltr" className="mono" value={sel.id ?? ''} maxLength={CONFIG.build.maxIdLength} spellCheck={false} autoCapitalize="off"
                    onChange={(e) => onParts(patchPart(parts, selected, { id: e.target.value.replace(/[^A-Za-z0-9_]/g, '') }))} />
                  <small>{t('build.idHint')}</small>
                </label>
              )}
              {PARTS[sel.type].motor && (
                <p>
                  {t('build.attachment')}: <strong>{sel.attachment ? name(PARTS[sel.attachment]) : t('build.attachmentNone')}</strong>
                  {sel.attachment && <button className="btn btn--small" onClick={() => commit(patchPart(parts, selected, { attachment: undefined, attachmentColor: undefined }))}>{t('build.removeAttachment')}</button>}
                </p>
              )}
              <div className="inspector__row">
                <button className="btn btn--small" onClick={() => rotate(1)}>{t('build.rotate')}</button>
                <button className="btn btn--small" onClick={() => rotate(0)}>{t('build.tilt')}</button>
                <button className="btn btn--small" onClick={() => rotate(2)}>{t('build.roll')}</button>
              </div>
              <span className="muted">{t('build.move')}</span>
              <div className="inspector__move">
                <button className="btn btn--small" onClick={() => move([1, 0, 0])}>{t('build.axis.left')}</button>
                <button className="btn btn--small" onClick={() => move([-1, 0, 0])}>{t('build.axis.right')}</button>
                <button className="btn btn--small" onClick={() => move([0, 1, 0])}>{t('build.axis.up')}</button>
                <button className="btn btn--small" onClick={() => move([0, -1, 0])}>{t('build.axis.down')}</button>
                <button className="btn btn--small" onClick={() => move([0, 0, 1])}>{t('build.axis.fwd')}</button>
                <button className="btn btn--small" onClick={() => move([0, 0, -1])}>{t('build.axis.back')}</button>
              </div>
              <button className="btn btn--small btn--danger" onClick={removeSelected}>{t('build.removePart')}</button>
            </div>
          )}
        </section>

        <section className={`side__block ${panel === 'stats' ? 'is-active' : ''}`} data-panel="stats">
          <h3>{t('build.panel.stats')}</h3>
          <dl className="stats">
            <div className={over ? 'is-over' : ''}>
              <dt>{t('build.stat.weight')}</dt>
              <dd><bdi>{stats.weight} / {CONFIG.build.maxWeight} {t('common.kg')}</bdi></dd>
              <div className="bar"><i style={{ inlineSize: `${Math.min(100, (stats.weight / CONFIG.build.maxWeight) * 100)}%` }} /></div>
            </div>
            <div className={stats.partCount > CONFIG.build.maxParts ? 'is-over' : ''}>
              <dt>{t('build.stat.parts')}</dt>
              <dd><bdi>{stats.partCount} / {CONFIG.build.maxParts}</bdi></dd>
              <div className="bar"><i style={{ inlineSize: `${Math.min(100, (stats.partCount / CONFIG.build.maxParts) * 100)}%` }} /></div>
            </div>
            <div><dt>{t('build.stat.battery')}</dt><dd><bdi>{stats.battery.toLocaleString('en-US')} E</bdi></dd></div>
            <div>
              <dt>{t('build.stat.drain')}</dt>
              <dd><bdi>{stats.drain} E/s</bdi>{stats.drain > 0 && stats.battery > 0 && <small className="muted"> {t('build.stat.runtime', { s: Math.round(stats.battery / stats.drain) })}</small>}</dd>
            </div>
          </dl>
          <h3>{t('build.issues')}</h3>
          {issues.length === 0 && <p className="ok-line">{t('build.allGood')}</p>}
          <ul className="issues">
            {issues.map((i, n) => <li key={n} className={`issues__item issues__item--${i.level}`}>{t(`issue.${i.code}` as Key, i.params)}</li>)}
          </ul>
        </section>
      </aside>
    </div>
  );
}
