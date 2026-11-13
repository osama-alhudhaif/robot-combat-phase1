import { useRef, useState } from 'react';
import type { ControlsDecl } from '../runtime/programHost';
import type { InputManager } from '../runtime/input';

function Stick({ name, label, input }: { name: string; label: string; input: InputManager }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const max = r.width / 2;
    let x = (e.clientX - (r.left + max)) / max, y = (e.clientY - (r.top + max)) / max;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    setKnob({ x, y });
    input.setTouchStick(name, x, -y); // screen y points down; stick y points up
  };
  const release = () => { setKnob({ x: 0, y: 0 }); input.setTouchStick(name, 0, 0); };
  return (
    <div className="stick" ref={base}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) update(e); }}
      onPointerUp={release} onPointerCancel={release}>
      <span className="stick__label">{label}</span>
      <i className="stick__knob" style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }} />
    </div>
  );
}

/** On-screen sticks and buttons, drawn from what the program declared in setup(). */
export function TouchControls({ decl, input }: { decl: ControlsDecl; input: InputManager }) {
  return (
    <div className="touch" dir="ltr">
      <div className="touch__sticks">
        {decl.sticks.map((s) => <Stick key={s.name} name={s.name} label={s.label} input={input} />)}
      </div>
      <div className="touch__buttons">
        {decl.buttons.map((b) => (
          <button key={b.name} className="touch__button"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); input.setTouchButton(b.name, true); }}
            onPointerUp={() => input.setTouchButton(b.name, false)}
            onPointerCancel={() => input.setTouchButton(b.name, false)}
            onContextMenu={(e) => e.preventDefault()}>
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
