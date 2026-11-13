import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CONFIG } from '@shared/config';
import { validateDesign } from '@shared/validate';
import type { DesignPart, RobotDesign } from '@shared/types';
import { useI18n } from '../i18n';
import { robotStore } from '../store/robots';
import { checkSyntax } from '../runtime/syntax';
import type { LogEntry } from '../runtime/programHost';
import { LangSwitch, navigate, useToast, type ConsoleLine } from '../ui/common';
import { BuildTab, type History } from '../workshop/BuildTab';
import { CodeTab } from '../workshop/CodeTab';
import { TestTab } from '../workshop/TestTab';

type Tab = 'build' | 'code' | 'test';
const MAX_LINES = 300;

export function Workshop({ id, tab }: { id: string; tab: Tab }) {
  const { t } = useI18n();
  const [design, setDesign] = useState<RobotDesign | null>(() => robotStore.get(id)?.design ?? null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [toast, notify] = useToast();
  const history = useRef<History>({ past: [], future: [] });
  const lineNo = useRef(0);
  const pending = useRef<RobotDesign | null>(null);

  // Autosave: shortly after every change, and immediately when leaving.
  const flush = useCallback(() => {
    if (!pending.current) return;
    if (!robotStore.save(id, pending.current)) notify(t('garage.storageFull'), 'error');
    pending.current = null;
  }, [id]);
  const change = useCallback((patch: Partial<RobotDesign>) => {
    setDesign((d) => { if (!d) return d; const next = { ...d, ...patch }; pending.current = next; return next; });
  }, []);
  useEffect(() => {
    if (!pending.current) return;
    const timer = setTimeout(flush, 400);
    return () => clearTimeout(timer);
  }, [design, flush]);
  useEffect(() => {
    addEventListener('pagehide', flush);
    return () => { removeEventListener('pagehide', flush); flush(); };
  }, [flush]);

  const issues = useMemo(() => (design ? validateDesign(design) : []), [design?.parts]);
  const syntax = useMemo(() => (design ? checkSyntax(design.code) : null), [design?.code]);
  const onLogs = useCallback((entries: LogEntry[]) => {
    setLines((old) => [...old, ...entries.map((e) => ({ ...e, n: ++lineNo.current }))].slice(-MAX_LINES));
  }, []);
  const clearConsole = useCallback(() => setLines([]), []);

  if (!design) {
    return (
      <div className="page">
        <div className="empty"><p>{t('ws.notFound')}</p><button className="btn btn--primary" onClick={() => navigate('/garage')}>{t('garage.title')}</button></div>
      </div>
    );
  }

  const go = (to: Tab) => { flush(); navigate(`/robot/${id}/${to}`); };
  const ready = !issues.some((i) => i.level === 'error') && !syntax;

  return (
    <div className="workshop">
      <header className="topbar topbar--workshop">
        <button className="btn btn--ghost topbar__back" onClick={() => { flush(); navigate('/garage'); }} aria-label={t('common.back')}>
          <svg className="flip-rtl" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M11 3 5 9l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <input className="workshop__name" value={design.name} maxLength={CONFIG.build.maxNameLength} aria-label={t('ws.name')}
          onChange={(e) => change({ name: e.target.value })} onBlur={() => { if (!design.name.trim()) change({ name: t('garage.defaultName', { n: 1 }) }); }} />
        <span className={`badge ${ready ? 'badge--ok' : 'badge--draft'}`}>{t(ready ? 'garage.valid' : 'garage.invalid')}</span>
        <nav className="tabs" aria-label="Workshop">
          {(['build', 'code', 'test'] as Tab[]).map((x) => (
            <button key={x} className={tab === x ? 'is-active' : ''} aria-current={tab === x ? 'page' : undefined} onClick={() => go(x)}>{t(`ws.${x}`)}</button>
          ))}
        </nav>
        <LangSwitch />
      </header>

      <div className="workshop__body">
        {tab === 'build' && <BuildTab design={design} issues={issues} history={history} notify={notify} onParts={(parts: DesignPart[]) => change({ parts })} />}
        {tab === 'code' && <CodeTab design={design} syntax={syntax} lines={lines} onCode={(code) => change({ code })} onClearConsole={clearConsole} onRun={() => go('test')} />}
        {tab === 'test' && <TestTab id={id} design={design} issues={issues} syntax={syntax} lines={lines} onLogs={onLogs} onClearConsole={clearConsole} />}
      </div>
      {toast}
    </div>
  );
}
