import type { PartDef } from '@shared/config';

/** Numbers for a part's description, read from the catalog so the text follows any rebalancing. */
export function partParams(def: PartDef): Record<string, string | number> {
  return {
    armor: Math.round((def.armor ?? 0) * 100),
    torque: def.motor?.torque ?? 0,
    rpm: def.motor?.rpm ?? 0,
    drain: def.motor?.drain ?? 0,
    mult: def.spin?.damageMult.toFixed(1) ?? 0,
    dps: def.spin?.dps ?? 0,
    cooldown: def.actuator?.cooldown.toFixed(1) ?? 0,
    energy: def.actuator?.energy ?? 0,
    damage: def.actuator?.damage ?? 0,
    range: def.sensor?.range ?? 0,
    battery: (def.battery ?? 0).toLocaleString('en-US'),
  };
}
