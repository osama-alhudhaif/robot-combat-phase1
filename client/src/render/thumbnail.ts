import * as THREE from 'three';
import type { RobotDesign } from '@shared/types';
import { RobotView } from './robotView';

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

/** Renders a robot once to an image. Garage cards use this so many previews cost one WebGL context. */
export function robotThumbnail(design: RobotDesign, w = 360, h = 240): string {
  const key = JSON.stringify(design.parts);
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(w, h, false);
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20242a, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1.5, 3, 2);
    scene.add(sun);
    const view = new RobotView(design);
    view.rest();
    scene.add(view.group);
    const bounds = new THREE.Box3().setFromObject(view.group);
    const centre = design.parts.length ? bounds.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0.1, 0);
    const radius = design.parts.length ? Math.max(0.2, bounds.getSize(new THREE.Vector3()).length() / 2) : 0.5;
    const camera = new THREE.PerspectiveCamera(32, w / h, 0.05, 20);
    camera.position.copy(centre).add(new THREE.Vector3(-1, 0.8, 1.3).normalize().multiplyScalar(radius / Math.sin((16 * Math.PI) / 180) * 0.95));
    camera.lookAt(centre);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    view.dispose();
    if (cache.size > 60) cache.clear();
    cache.set(key, url);
    return url;
  } catch {
    return '';
  }
}
