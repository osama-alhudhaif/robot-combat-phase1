import { useI18n } from '../i18n';
import { updateSettings, useSettings, type Quality } from '../store/settings';
import { LangSwitch, Segmented, navigate } from '../ui/common';

export function Home() {
  const { t } = useI18n();
  const settings = useSettings();
  return (
    <main className="home">
      <div className="home__lang"><LangSwitch /></div>
      <header className="home__hero">
        <h1>{t('app.title')}</h1>
        <p>{t('app.tagline')}</p>
        <div className="hazard" aria-hidden="true" />
      </header>

      <section className="home__body">
        <label className="field home__name">
          <span>{t('home.name')}</span>
          <input
            type="text" value={settings.name} minLength={2} maxLength={16} autoComplete="nickname"
            placeholder={t('home.namePlaceholder')} onChange={(e) => updateSettings({ name: e.target.value.slice(0, 16) })}
          />
          <small>{t('home.nameHint')}</small>
        </label>

        <nav className="home__menu">
          <button className="menu-card menu-card--primary" onClick={() => navigate('/garage')}>
            <strong>{t('home.garage')}</strong>
            <span>{t('home.garageDesc')}</span>
          </button>
          <button className="menu-card" disabled>
            <strong>{t('home.createRoom')}</strong>
            <span>{t('home.roomsDesc')}</span>
            <em className="tag">{t('common.soon')}</em>
          </button>
          <button className="menu-card" disabled>
            <strong>{t('home.joinRoom')}</strong>
            <span>{t('home.roomsDesc')}</span>
            <em className="tag">{t('common.soon')}</em>
          </button>
          <button className="menu-card" onClick={() => navigate('/guide')}>
            <strong>{t('home.guide')}</strong>
            <span>{t('home.guideDesc')}</span>
          </button>
        </nav>

        <div className="home__foot">
          <p className="home__loop">{t('home.loop')}</p>
          <div className="home__quality">
            <span>{t('home.settings')}</span>
            <Segmented<Quality>
              value={settings.quality} label={t('home.settings')} onChange={(quality) => updateSettings({ quality })}
              options={[{ value: 'low', label: t('quality.low') }, { value: 'medium', label: t('quality.medium') }, { value: 'high', label: t('quality.high') }]}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
