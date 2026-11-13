import { useSyncExternalStore } from 'react';

export type Quality = 'low' | 'medium' | 'high';
export interface Settings { name: string; quality: Quality }

const KEY = 'rc.settings';
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const coarse = matchMedia('(pointer: coarse)').matches;
    return {
      name: typeof raw.name === 'string' ? raw.name : '',
      quality: ['low', 'medium', 'high'].includes(raw.quality) ? raw.quality : coarse ? 'low' : 'medium',
    };
  } catch { return { name: '', quality: 'medium' }; }
}

let settings = load();

export function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  localStorage.setItem(KEY, JSON.stringify(settings));
  listeners.forEach((l) => l());
}

export const getSettings = () => settings;

export function useSettings(): Settings {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => settings);
}
