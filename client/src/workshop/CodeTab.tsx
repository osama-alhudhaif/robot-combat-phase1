import { useEffect, useMemo, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { tags as tg } from '@lezer/highlight';
import type { RobotDesign } from '@shared/types';
import { useI18n } from '../i18n';
import { programInfo, type ProgramInfo } from '../runtime/programHost';
import { checkSyntax, type SyntaxIssue } from '../runtime/syntax';
import { ConsoleView, type ConsoleLine } from '../ui/common';

const theme = EditorView.theme({
  '&': { backgroundColor: '#0B0E12', color: '#E8ECF1', height: '100%', fontSize: '14px' },
  '.cm-content': { fontFamily: '"IBM Plex Mono", ui-monospace, monospace', caretColor: '#FFC400' },
  '.cm-scroller': { fontFamily: '"IBM Plex Mono", ui-monospace, monospace', lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: '#0B0E12', color: '#5B6470', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#161B22' },
  '.cm-activeLineGutter': { backgroundColor: '#161B22', color: '#E8ECF1' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#FFC400' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#22E1FF33' },
  '.cm-matchingBracket': { backgroundColor: '#FFC40033', outline: '1px solid #FFC40088' },
  '.cm-tooltip': { backgroundColor: '#1A1F27', border: '1px solid #343C48', color: '#E8ECF1' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#22E1FF', color: '#0E1116' },
}, { dark: true });

const highlight = HighlightStyle.define([
  { tag: tg.keyword, color: '#FFC400' },
  { tag: [tg.string, tg.special(tg.string)], color: '#9BE28A' },
  { tag: [tg.number, tg.bool, tg.null], color: '#FF9D5C' },
  { tag: tg.comment, color: '#6B7684', fontStyle: 'italic' },
  { tag: [tg.function(tg.variableName), tg.function(tg.propertyName)], color: '#22E1FF' },
  { tag: tg.propertyName, color: '#B9C7FF' },
  { tag: tg.definition(tg.variableName), color: '#E8ECF1' },
  { tag: tg.operator, color: '#A9B4C2' },
]);

const opt = (label: string, type: string, detail?: string, apply?: string) => ({ label, type, detail, apply });
const MEMBERS: Record<string, ReturnType<typeof opt>[]> = {
  robot: [opt('motor', 'method', '(id)', "motor('"), opt('actuator', 'method', '(id)', "actuator('"), opt('sensor', 'method', '(id)', "sensor('"), opt('battery', 'property', '0..1'), opt('health', 'property', '0..1'), opt('time', 'property', 'seconds'), opt('log', 'method', '(...values)', 'log(')],
  input: [opt('button', 'method', '(name)', "button('"), opt('pressed', 'method', '(name)', "pressed('"), opt('stick', 'method', '(name)', "stick('")],
  controls: [opt('button', 'method', '(name, { key, label })', "button('"), opt('stick', 'method', '(name, { keys, label })', "stick('")],
  motor: [opt('setPower', 'method', '(p) -1..1', 'setPower('), opt('speed', 'property', '-1..1'), opt('health', 'property', '0..1')],
  actuator: [opt('fire', 'method', '() → boolean', 'fire()'), opt('ready', 'property', 'boolean'), opt('health', 'property', '0..1')],
  distance: [opt('distance', 'property', 'metres or null')],
  radar: [opt('target', 'property', '{ distance, bearing }')],
  gyro: [opt('heading', 'property', '0..360'), opt('tilt', 'property', 'degrees'), opt('upsideDown', 'property', 'boolean')],
  bumper: [opt('touching', 'property', 'boolean')],
};

/** Autocomplete for the game API and for this robot's own part IDs. */
function gameCompletions(getInfo: () => ProgramInfo) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const info = getInfo();
    let m: RegExpExecArray | null;
    if ((m = /robot\.(motor|actuator|sensor)\(\s*['"]([\w]*)$/.exec(before))) {
      const ids = m[1] === 'motor' ? info.motors : m[1] === 'actuator' ? info.actuators : info.sensors.map((s) => s.id);
      return { from: ctx.pos - m[2].length, options: ids.map((id) => opt(id, 'constant', m![1])), validFor: /^\w*$/ };
    }
    if ((m = /robot\.(motor|actuator|sensor)\(\s*['"]?(\w*)['"]?\s*\)\.(\w*)$/.exec(before))) {
      let options = MEMBERS[m[1]];
      if (m[1] === 'sensor') {
        const kind = info.sensors.find((s) => s.id === m![2])?.kind;
        options = kind ? MEMBERS[kind] : [...MEMBERS.distance, ...MEMBERS.radar, ...MEMBERS.gyro, ...MEMBERS.bumper];
      }
      return { from: ctx.pos - m[3].length, options, validFor: /^\w*$/ };
    }
    if ((m = /\b(robot|input|controls)\.(\w*)$/.exec(before))) return { from: ctx.pos - m[2].length, options: MEMBERS[m[1]], validFor: /^\w*$/ };
    return null;
  };
}

interface Props {
  design: RobotDesign;
  syntax: SyntaxIssue | null;
  lines: ConsoleLine[];
  onCode(code: string): void;
  onClearConsole(): void;
  onRun(): void;
}

export function CodeTab({ design, syntax, lines, onCode, onClearConsole, onRun }: Props) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const info = useMemo(() => programInfo(design), [design.parts]);
  const live = useRef({ info, onCode });
  live.current = { info, onCode };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: design.code,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          javascript(),
          javascriptLanguage.data.of({ autocomplete: gameCompletions(() => live.current.info) }),
          syntaxHighlighting(highlight),
          theme,
          lintGutter(),
          linter((view): Diagnostic[] => {
            const issue = checkSyntax(view.state.doc.toString());
            if (!issue) return [];
            const from = Math.min(issue.pos, view.state.doc.length);
            return [{ from, to: Math.min(from + 1, view.state.doc.length), severity: 'error', message: issue.message }];
          }, { delay: 300 }),
          EditorView.updateListener.of((u) => { if (u.docChanged) live.current.onCode(u.state.doc.toString()); }),
          EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Program' }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, []);

  const insert = (id: string) => {
    const v = view.current;
    if (!v) return;
    v.dispatch(v.state.replaceSelection(id));
    v.focus();
  };

  const group = (title: string, ids: { id: string; hint?: string }[]) => ids.length > 0 && (
    <div className="ids__group">
      <h4>{title}</h4>
      {ids.map((x) => <button key={x.id} className="chip mono" dir="ltr" onClick={() => insert(x.id)}>{x.id}{x.hint && <small>{x.hint}</small>}</button>)}
    </div>
  );
  const empty = !info.motors.length && !info.actuators.length && !info.sensors.length;

  return (
    <div className="code">
      <div className="code__main">
        <div className="code__bar">
          <span className={`code__status ${syntax ? 'is-error' : ''}`}>
            {syntax ? t('code.syntaxError', { line: syntax.line, message: syntax.message }) : t('code.syntaxOk')}
          </span>
          <button className="btn btn--primary" onClick={onRun}>{t('code.run')}</button>
        </div>
        <div className="code__editor" dir="ltr" ref={host} />
      </div>
      <aside className="code__side">
        <section className="ids">
          <h3>{t('code.parts')}</h3>
          {empty ? <p className="muted">{t('code.noIds')}</p> : <p className="muted">{t('code.partsHint')}</p>}
          {group(t('code.motors'), info.motors.map((id) => ({ id })))}
          {group(t('code.actuators'), info.actuators.map((id) => ({ id })))}
          {group(t('code.sensors'), info.sensors.map((s) => ({ id: s.id, hint: s.kind })))}
        </section>
        <ConsoleView lines={lines} onClear={onClearConsole} />
      </aside>
    </div>
  );
}
