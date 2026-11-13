import { useState } from 'react';
import { CATEGORY_ORDER, CONFIG, PARTS, PART_LIST } from '@shared/config';
import { useI18n, type Key } from '../i18n';
import { Segmented, TopBar } from '../ui/common';
import { partParams } from '../workshop/partText';

type Tab = 'parts' | 'api' | 'rules';

const API: { title: Key; rows: [string, Key][]; note?: Key }[] = [
  { title: 'guide.api.h.controls', note: 'guide.api.controlsLimit', rows: [
    ['controls.button(name, { key, label })', 'guide.api.button'],
    ['controls.stick(name, { keys, label })', 'guide.api.stick'],
  ] },
  { title: 'guide.api.h.input', rows: [
    ['input.button(name)', 'guide.api.inButton'],
    ['input.pressed(name)', 'guide.api.inPressed'],
    ['input.stick(name)', 'guide.api.inStick'],
  ] },
  { title: 'guide.api.h.motors', rows: [
    ['robot.motor(id).setPower(p)', 'guide.api.setPower'],
    ['robot.motor(id).speed', 'guide.api.speed'],
    ['robot.motor(id).health', 'guide.api.mHealth'],
  ] },
  { title: 'guide.api.h.actuators', rows: [
    ['robot.actuator(id).fire()', 'guide.api.fire'],
    ['robot.actuator(id).ready', 'guide.api.ready'],
    ['robot.actuator(id).health', 'guide.api.mHealth'],
  ] },
  { title: 'guide.api.h.sensors', rows: [
    ['robot.sensor(id).distance', 'guide.api.distance'],
    ['robot.sensor(id).target', 'guide.api.target'],
    ['robot.sensor(id).heading', 'guide.api.heading'],
    ['robot.sensor(id).tilt', 'guide.api.tilt'],
    ['robot.sensor(id).upsideDown', 'guide.api.upsideDown'],
    ['robot.sensor(id).touching', 'guide.api.touching'],
  ] },
  { title: 'guide.api.h.robot', rows: [
    ['robot.battery', 'guide.api.battery'],
    ['robot.health', 'guide.api.health'],
    ['robot.time', 'guide.api.time'],
    ['robot.log(...values)', 'guide.api.log'],
  ] },
];

// Single-idea snippets only. A complete control program is the player's job.
const EXAMPLES: [Key, string][] = [
  ['guide.ex.button', `// in setup
controls.button('go', { key: 'KeyW', label: 'Go' });

// in loop
robot.motor('motor1').setPower(input.button('go') ? 1 : 0);`],
  ['guide.ex.pressed', `// in loop
if (input.pressed('hit')) {
  robot.actuator('hammer1').fire();
}`],
  ['guide.ex.sensor', `// in loop
const d = robot.sensor('distance1').distance;
if (d !== null) robot.log('wall at', d, 'm');`],
];

export function Guide() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('parts');
  const [gx, gy, gz] = CONFIG.build.grid;
  const code = (s: string) => <code dir="ltr">{s}</code>;
  return (
    <div className="page">
      <TopBar title={t('guide.title')} back="/" />
      <main className="guide">
        <Segmented<Tab>
          value={tab} onChange={setTab}
          options={[{ value: 'parts', label: t('guide.tab.parts') }, { value: 'api', label: t('guide.tab.api') }, { value: 'rules', label: t('guide.tab.rules') }]}
        />

        {tab === 'parts' && (
          <>
            <p className="lead">{t('guide.motors')}</p>
            {CATEGORY_ORDER.map((cat) => (
              <section key={cat}>
                <h2>{t(`cat.${cat}` as Key)}</h2>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>{t('guide.col.part')}</th><th>{t('guide.col.weight')}</th><th>{t('guide.col.hp')}</th><th>{t('guide.col.notes')}</th></tr></thead>
                    <tbody>
                      {PART_LIST.filter((p) => p.category === cat).map((p) => (
                        <tr key={p.type}>
                          <th scope="row">{t(`part.${p.type}.name` as Key)}</th>
                          <td><bdi>{p.weight.toFixed(1)} {t('common.kg')}</bdi></td>
                          <td>{p.hp}</td>
                          <td>{t(`part.${p.type}.note` as Key, partParams(p))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            <section>
              <h2>{t('guide.buildRules')}</h2>
              <ul>
                <li>{t('guide.rule.weight', { n: CONFIG.build.maxWeight })}</li>
                <li>{t('guide.rule.size', { x: gx, y: gy, z: gz })}</li>
                <li>{t('guide.rule.parts', { n: CONFIG.build.maxParts })}</li>
                <li>{t('guide.rule.core')}</li>
                <li>{t('guide.rule.battery')}</li>
                <li>{t('guide.rule.connected')}</li>
                <li>{t('guide.rule.shaft')}</li>
              </ul>
            </section>
          </>
        )}

        {tab === 'api' && (
          <>
            <p className="lead">{t('guide.api.intro')}</p>
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr><th scope="row">{code('setup(robot, controls)')}</th><td>{t('guide.api.setup')}</td></tr>
                  <tr><th scope="row">{code('loop(robot, input, dt)')}</th><td>{t('guide.api.loop')}</td></tr>
                </tbody>
              </table>
            </div>
            <p>{t('guide.api.sticky')}</p>
            {API.map((sec) => (
              <section key={sec.title}>
                <h2>{t(sec.title)}</h2>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>{t('guide.col.call')}</th><th>{t('guide.col.desc')}</th></tr></thead>
                    <tbody>{sec.rows.map(([call, desc]) => <tr key={call}><th scope="row">{code(call)}</th><td>{t(desc, { range: PARTS.sensor_distance.sensor!.range! })}</td></tr>)}</tbody>
                  </table>
                </div>
                {sec.note && <p className="muted">{t(sec.note, { sticks: CONFIG.program.maxSticks, buttons: CONFIG.program.maxButtons })}</p>}
              </section>
            ))}
            <section>
              <h2>{t('guide.api.h.limits')}</h2>
              <ul>
                <li>{t('guide.api.rule1')}</li>
                <li>{t('guide.api.rule2')}</li>
                <li>{t('guide.api.rule3')}</li>
                <li>{t('guide.api.rule4', { ms: CONFIG.program.loopBudgetMs })}</li>
                <li>{t('guide.api.rule5')}</li>
                <li>{t('guide.api.rule6')}</li>
              </ul>
            </section>
            <section>
              <h2>{t('guide.api.h.examples')}</h2>
              <p className="muted">{t('guide.ex.note')}</p>
              {EXAMPLES.map(([title, src]) => (
                <figure key={title} className="example">
                  <figcaption>{t(title)}</figcaption>
                  <pre dir="ltr"><code>{src}</code></pre>
                </figure>
              ))}
            </section>
          </>
        )}

        {tab === 'rules' && (
          <>
            <section><h2>{t('guide.rules.arena')}</h2><p>{t('guide.rules.arenaText', { size: CONFIG.arena.size })}</p></section>
            <section>
              <h2>{t('guide.rules.damage')}</h2>
              <ul><li>{t('guide.rules.damage1')}</li><li>{t('guide.rules.damage2')}</li><li>{t('guide.rules.damage3')}</li><li>{t('guide.rules.damage4')}</li></ul>
            </section>
            <section><h2>{t('guide.rules.energy')}</h2><p>{t('guide.rules.energyText')}</p></section>
            <section>
              <h2>{t('guide.rules.win')}</h2>
              <ul><li>{t('guide.rules.ko')}</li><li>{t('guide.rules.countout', { dist: CONFIG.countOut.stillDistance, still: CONFIG.countOut.stillSeconds, count: CONFIG.countOut.countSeconds })}</li><li>{t('guide.rules.decision')}</li></ul>
              <p className="muted">{t('guide.rules.online')}</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
