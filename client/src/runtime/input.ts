import type { ControlsDecl, InputFrame } from './programHost';

/** Turns keyboard keys and on-screen controls into the input a program declared in setup(). */
export class InputManager {
  private decl: ControlsDecl = { sticks: [], buttons: [] };
  private keys = new Set<string>();
  private bound = new Set<string>();
  private touchButtons = new Set<string>();
  private touchSticks = new Map<string, { x: number; y: number }>();
  private prev = new Set<string>();

  private onDown = (e: KeyboardEvent) => {
    if (!this.bound.has(e.code)) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    e.preventDefault();
    this.keys.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => { this.keys.clear(); this.touchButtons.clear(); this.touchSticks.clear(); };

  attach() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }

  setDecl(decl: ControlsDecl) {
    this.decl = decl;
    this.bound = new Set([...decl.buttons.map((b) => b.key), ...decl.sticks.flatMap((s) => s.keys)].filter((k): k is string => !!k));
    this.onBlur();
    this.prev.clear();
  }

  setTouchButton(name: string, down: boolean) { if (down) this.touchButtons.add(name); else this.touchButtons.delete(name); }
  setTouchStick(name: string, x: number, y: number) { this.touchSticks.set(name, { x, y }); }

  /** Input for one program tick. `pressed` is true only on the tick a button went down. */
  frame(): InputFrame {
    const out: InputFrame = { buttons: {}, pressed: {}, sticks: {} };
    const down = new Set<string>();
    for (const b of this.decl.buttons) {
      const held = this.touchButtons.has(b.name) || (!!b.key && this.keys.has(b.key));
      out.buttons[b.name] = held;
      out.pressed[b.name] = held && !this.prev.has(b.name);
      if (held) down.add(b.name);
    }
    this.prev = down;
    for (const s of this.decl.sticks) {
      const k = (i: number) => (s.keys[i] && this.keys.has(s.keys[i]!) ? 1 : 0);
      const t = this.touchSticks.get(s.name);
      const x = k(3) - k(2), y = k(0) - k(1);
      out.sticks[s.name] = t && (t.x || t.y) ? { x: t.x, y: t.y } : { x, y };
    }
    return out;
  }
}
