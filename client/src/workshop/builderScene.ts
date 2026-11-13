/** The 3D editor viewport: grid, robot, ghost preview, picking and camera. No editing logic lives here. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CONFIG } from '@shared/config';
import type { DesignPart, RobotDesign, Vec3 } from '@shared/types';
import { RobotView } from '../render/robotView';
import { worldToCellUnits, type Hit } from './editorOps';

const S = CONFIG.cellSize;

function labelSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  g.font = '700 84px "IBM Plex Sans Arabic", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#FFC400';
  g.fillText(text, 256, 70);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sprite.scale.set(0.5, 0.125, 1);
  return sprite;
}

export class BuilderScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.02, 30);
  private controls: OrbitControls;
  private robot: RobotView | null = null;
  private ghost: RobotView | null = null;
  private ghostKey = '';
  private ground: THREE.Mesh;
  private selection = new THREE.Box3Helper(new THREE.Box3(), 0xffc400);
  private mirrorLine: THREE.Line;
  private frontLabel: THREE.Sprite | null = null;
  private raycaster = new THREE.Raycaster();
  private raf = 0;
  private down: { x: number; y: number; t: number; id: number } | null = null;
  private pointers = new Set<number>();
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, private handlers: { onTap(hit: Hit | null): void; onHover(hit: Hit | null): void }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.background = new THREE.Color('#0E1116');

    const [gx, gy, gz] = CONFIG.build.grid;
    const w = gx * S, h = gy * S, d = gz * S;
    const grid = new THREE.GridHelper(w, gx, 0x3a4350, 0x252b34);
    grid.position.y = 0.0005;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: '#171C23', roughness: 0.9 }));
    this.ground.rotation.x = -Math.PI / 2;
    const bounds = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color: 0x22e1ff, transparent: true, opacity: 0.16 }),
    );
    bounds.position.y = h / 2;

    // The fixed FRONT arrow: the robot spawns facing its opponent along it.
    const shape = new THREE.Shape();
    shape.moveTo(-0.05, 0); shape.lineTo(0.05, 0); shape.lineTo(0.05, 0.14); shape.lineTo(0.11, 0.14);
    shape.lineTo(0, 0.28); shape.lineTo(-0.11, 0.14); shape.lineTo(-0.05, 0.14); shape.closePath();
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xffc400, side: THREE.DoubleSide }));
    arrow.rotation.x = Math.PI / 2;
    arrow.position.set(0, 0.001, d / 2 + 0.06);

    this.mirrorLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.002, -d / 2), new THREE.Vector3(0, 0.002, d / 2)]),
      new THREE.LineDashedMaterial({ color: 0x22e1ff, dashSize: 0.04, gapSize: 0.03 }),
    );
    this.mirrorLine.computeLineDistances();
    this.mirrorLine.visible = false;
    this.selection.visible = false;

    this.scene.add(this.ground, grid, bounds, arrow, this.mirrorLine, this.selection);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1e24, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(-1.5, 3, -2);
    this.scene.add(sun);

    this.camera.position.set(-1.25, 1.15, -1.45);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.25, 0);
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.93;
    this.controls.enableDamping = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('contextmenu', this.noMenu);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  private noMenu = (e: Event) => e.preventDefault();
  private onPointerDown = (e: PointerEvent) => {
    this.pointers.add(e.pointerId);
    this.down = this.pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId } : null;
  };
  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    const d = this.down;
    this.down = null;
    if (!d || d.id !== e.pointerId || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8 && performance.now() - d.t < 600) this.handlers.onTap(this.pick(e));
  };
  private onPointerCancel = (e: PointerEvent) => { this.pointers.delete(e.pointerId); this.down = null; };
  private onPointerMove = (e: PointerEvent) => { if (e.pointerType === 'mouse' && e.buttons === 0) this.handlers.onHover(this.pick(e)); };
  private onLeave = () => this.handlers.onHover(null);

  private pick(e: PointerEvent): Hit | null {
    const r = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const targets: THREE.Object3D[] = [this.ground];
    if (this.robot) targets.push(this.robot.group);
    const hit = this.raycaster.intersectObjects(targets, true).find((h) => h.face && (h.object as THREE.Mesh).isMesh);
    if (!hit || !hit.face) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
    const k = a.indexOf(Math.max(...a));
    const normal: Vec3 = [0, 0, 0];
    normal[k] = Math.sign(n.getComponent(k)) || 1;
    const isGround = hit.object === this.ground;
    if (isGround && normal[1] < 0) return null; // looking at the grid from underneath
    return {
      designIndex: isGround ? -1 : hit.object.userData.designIndex ?? -1,
      isAttachment: !isGround && !!hit.object.userData.isAttachment,
      point: worldToCellUnits(hit.point.x, isGround ? 0 : hit.point.y, hit.point.z),
      normal,
    };
  }

  setDesign(design: RobotDesign, selected: number) {
    if (this.robot) { this.scene.remove(this.robot.group); this.robot.dispose(); }
    this.robot = new RobotView(design);
    this.robot.rest();
    this.scene.add(this.robot.group);
    this.robot.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.robot.parts.forEach((p) => { if (p.rt.designIndex === selected) box.expandByObject(p.obj); });
    this.selection.visible = !box.isEmpty();
    if (this.selection.visible) this.selection.box.copy(box.expandByScalar(0.004));
  }

  setGhost(part: DesignPart | null, valid: boolean) {
    const key = part ? JSON.stringify([part.type, part.position, part.rotation, part.attachment, valid]) : '';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    if (this.ghost) { this.scene.remove(this.ghost.group); this.ghost.dispose(); this.ghost = null; }
    if (!part) return;
    this.ghost = new RobotView({ formatVersion: 1, name: '', code: '', parts: [part] });
    this.ghost.rest();
    const mat = new THREE.MeshBasicMaterial({ color: valid ? 0x22e1ff : 0xff3b30, transparent: true, opacity: 0.45, depthWrite: false });
    this.ghost.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat; else if ((o as THREE.LineSegments).isLineSegments) o.visible = false; });
    this.scene.add(this.ghost.group);
  }

  setMirror(on: boolean) { this.mirrorLine.visible = on; }

  setFrontLabel(text: string) {
    if (this.frontLabel) this.scene.remove(this.frontLabel);
    this.frontLabel = labelSprite(text);
    this.frontLabel.position.set(0, 0.06, (CONFIG.build.grid[2] * S) / 2 + 0.42);
    this.scene.add(this.frontLabel);
  }

  private resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 55 : 40;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('contextmenu', this.noMenu);
    this.robot?.dispose();
    this.ghost?.dispose();
    this.renderer.dispose();
  }
}
