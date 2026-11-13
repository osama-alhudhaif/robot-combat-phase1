import { useMemo, useRef } from 'react';
import { designStats } from '@shared/geometry';
import { isValid, parseRobotFile, serializeRobot } from '@shared/validate';
import { CONFIG } from '@shared/config';
import { useI18n, type Key } from '../i18n';
import { robotStore, useRobots, type SavedRobot } from '../store/robots';
import { robotThumbnail } from '../render/thumbnail';
import { checkSyntax } from '../runtime/syntax';
import { TopBar, navigate, useToast } from '../ui/common';

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, '_') || 'robot'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Card({ robot, onMessage }: { robot: SavedRobot; onMessage(msg: string, kind?: 'info' | 'error'): void }) {
  const { t } = useI18n();
  const { design } = robot;
  const stats = useMemo(() => designStats(design), [design]);
  const valid = useMemo(() => isValid(design) && !checkSyntax(design.code), [design]);
  const thumb = useMemo(() => robotThumbnail(design), [design]);
  const open = () => navigate(`/robot/${robot.id}`);
  return (
    <article className="robot-card">
      <button className="robot-card__preview" onClick={open} aria-label={`${t('garage.edit')}: ${design.name}`}>
        {thumb && <img src={thumb} alt="" />}
      </button>
      <div className="robot-card__info">
        <h2>{design.name}</h2>
        <span className={`badge ${valid ? 'badge--ok' : 'badge--draft'}`}>{t(valid ? 'garage.valid' : 'garage.invalid')}</span>
        <p className="muted">
          <bdi>{stats.weight} / {CONFIG.build.maxWeight} {t('common.kg')}</bdi>
          <bdi>{t('garage.parts', { n: stats.partCount })}</bdi>
        </p>
      </div>
      <div className="robot-card__actions">
        <button className="btn btn--primary" onClick={open}>{t('garage.edit')}</button>
        <button className="btn" onClick={() => { if (!robotStore.add({ ...design, name: t('garage.copyName', { name: design.name }).slice(0, CONFIG.build.maxNameLength) })) onMessage(t('garage.storageFull'), 'error'); }}>{t('garage.duplicate')}</button>
        <button className="btn" onClick={() => download(design.name, serializeRobot(design))}>{t('garage.export')}</button>
        <button className="btn btn--danger" onClick={() => { if (confirm(t('garage.confirmDelete', { name: design.name }))) robotStore.remove(robot.id); }}>{t('common.delete')}</button>
      </div>
    </article>
  );
}

export function Garage() {
  const { t } = useI18n();
  const robots = useRobots();
  const [toast, show] = useToast();
  const file = useRef<HTMLInputElement>(null);

  const create = () => {
    const robot = robotStore.create(t('garage.defaultName', { n: robots.length + 1 }));
    if (robot) navigate(`/robot/${robot.id}`); else show(t('garage.storageFull'), 'error');
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const result = parseRobotFile(await f.text());
    if (!result.ok) return show(t('garage.importFailed', { reason: t(`import.${result.code}` as Key, result.params) }), 'error');
    if (!robotStore.add(result.design)) return show(t('garage.storageFull'), 'error');
    show(t('garage.imported', { name: result.design.name }));
  };

  return (
    <div className="page">
      <TopBar title={t('garage.title')} back="/">
        <div className="topbar__actions">
          <button className="btn" onClick={() => file.current?.click()}>{t('garage.import')}</button>
          <button className="btn btn--primary" onClick={create}>{t('garage.new')}</button>
        </div>
      </TopBar>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <main className="garage">
        {robots.length === 0 && (
          <div className="empty">
            <p>{t('garage.empty')}</p>
            <button className="btn btn--primary" onClick={create}>{t('garage.new')}</button>
          </div>
        )}
        {robots.map((r) => <Card key={r.id} robot={r} onMessage={show} />)}
      </main>
      {toast}
    </div>
  );
}
