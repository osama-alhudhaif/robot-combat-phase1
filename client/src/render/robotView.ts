import * as THREE from 'three';
import { expandDesign, type RuntimePart } from '@shared/geometry';
import type { RobotDesign, RobotSnap } from '@shared/types';
import { CONFIG } from '@shared/config';
import { buildPartMesh, disposePart } from './partMeshes';

interface PartView {
  rt: RuntimePart;
  obj: THREE.Group;
  tints: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[];
  lastHp: number;
}

/** A robot drawn from its design and posed from simulation snapshots. */
export class RobotView {
  readonly group = new THREE.Group();
  readonly parts: PartView[];

  constructor(design: RobotDesign) {
    this.parts = expandDesign(design).map((rt) => {
      const obj = buildPartMesh(rt.def.type, rt.color);
      obj.position.set(...rt.pos);
      obj.quaternion.set(...rt.quat);
      const tints: PartView['tints'] = [];
      obj.traverse((o) => {
        o.userData.designIndex = rt.designIndex;
        o.userData.isAttachment = rt.parent >= 0;
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mat?.userData?.tint) tints.push({ mat, base: mat.color.clone() });
      });
      this.group.add(obj);
      return { rt, obj, tints, lastHp: 1 };
    });
  }

  update(snap: RobotSnap) {
    this.group.position.set(...snap.pos);
    this.group.quaternion.set(...snap.quat);
    snap.parts.forEach((s, i) => {
      const p = this.parts[i];
      if (!p) return;
      p.obj.visible = s.hp >= 0;
      if (s.hp < 0) return;
      if (Math.abs(s.hp - p.lastHp) > 0.01) {
        p.lastHp = s.hp;
        const k = 0.3 + 0.7 * s.hp; // parts darken as they lose HP
        for (const t of p.tints) t.mat.color.copy(t.base).multiplyScalar(k);
      }
      const spin = p.obj.userData.spin as THREE.Object3D | undefined;
      if (spin) spin.rotation.z = s.anim;
      const arm = p.obj.userData.arm as THREE.Object3D | undefined;
      if (arm) arm.rotation.x = p.obj.userData.armKind === 'flipper' ? -0.95 * s.anim : -1.9 + 2.15 * s.anim;
      // A motor's shaft angle is carried by its attachment when it has one.
    });
  }

  /** Rest pose for editors and previews. */
  rest() {
    for (const p of this.parts) {
      const arm = p.obj.userData.arm as THREE.Object3D | undefined;
      if (arm && p.obj.userData.armKind === 'hammer') arm.rotation.x = -1.9;
    }
  }

  /** World positions of badly damaged parts, for smoke. */
  smokingParts(snap: RobotSnap, out: THREE.Vector3[]) {
    snap.parts.forEach((s, i) => {
      if (s.hp >= 0 && s.hp < CONFIG.damage.smokeBelow && this.parts[i]) out.push(this.parts[i].obj.getWorldPosition(new THREE.Vector3()));
    });
  }

  dispose() {
    this.parts.forEach((p) => disposePart(p.obj));
  }
}
