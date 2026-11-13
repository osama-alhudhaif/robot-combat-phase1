import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n, translateAny, translate, type Key } from '../i18n';
import type { LogEntry } from '../runtime/programHost';

export function navigate(to: string) { location.hash = to; }

export function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export function LangSwitch() {
  const { t, toggle } = useI18n();
  return <button className="btn btn--ghost lang-switch" onClick={toggle}>{t('lang.switch')}</button>;
}

export function TopBar({ title, back, children }: { title?: ReactNode; back?: string; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="topbar">
      {back !== undefined && (
        <button className="btn btn--ghost topbar__back" onClick={() => navigate(back)} aria-label={t('common.back')}>
          <svg className="flip-rtl" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M11 3 5 9l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{t('common.back')}</span>
        </button>
      )}
      {title && <h1 className="topbar__title">{title}</h1>}
      <div className="topbar__grow">{children}</div>
      <LangSwitch />
    </header>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label?: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'is-active' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function useToast(): [ReactNode, (msg: string, kind?: 'info' | 'error') => void] {
  const [toast, setToast] = useState<{ msg: string; kind: string; n: number } | null>(null);
  const timer = useRef(0);
  const show = useCallback((msg: string, kind: 'info' | 'error' = 'info') => {
    clearTimeout(timer.current);
    setToast({ msg, kind, n: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);
  const node = toast ? <div key={toast.n} className={`toast toast--${toast.kind}`} role="status">{toast.msg}</div> : null;
  return [node, show];
}

/** One console line in the current language. Runtime errors keep the original JavaScript text. */
export function formatLog(e: LogEntry): string {
  if (e.code) {
    const params = { ...e.params };
    if (typeof params.kind === 'string') params.kind = translateAny(`kind.${params.kind}`, undefined, params.kind);
    if (typeof params.have === 'string') params.have = translateAny(`sensor.${params.have}`, undefined, params.have);
    return translateAny(`rt.${e.code}`, params, e.code);
  }
  if (e.level !== 'error') return e.text ?? '';
  const where = [e.where ? translate(`err.in.${e.where}` as Key) : '', e.line ? translate('code.line', { line: e.line }) : ''].filter(Boolean).join(', ');
  const repeat = e.count && e.count > 1 ? ` (${translate('rt.repeated', { n: e.count })})` : '';
  return `${translateAny(`err.${e.name}`, undefined, translate('err.Error'))}${where ? ` (${where})` : ''}${repeat}`;
}

export interface ConsoleLine extends LogEntry { n: number }

export function ConsoleView({ lines, onClear }: { lines: ConsoleLine[]; onClear(): void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  return (
    <section className="console">
      <div className="console__head">
        <h3>{t('code.console')}</h3>
        <button className="btn btn--ghost btn--small" onClick={onClear}>{t('code.clear')}</button>
      </div>
      <div className="console__body" ref={ref}>
        {lines.length === 0 && <p className="muted">{t('code.consoleEmpty')}</p>}
        {lines.map((l) => (
          <div key={l.n} className={`console__line console__line--${l.level}`}>
            <span>{formatLog(l)}</span>
            {l.level === 'error' && !l.code && l.text && <code dir="ltr">{l.text}</code>}
          </div>
        ))}
      </div>
    </section>
  );
}
