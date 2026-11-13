import { useSyncExternalStore } from 'react';
import en, { type Key } from './en';
import ar from './ar';

export type Lang = 'en' | 'ar';
export type { Key };
const tables: Record<Lang, Record<Key, string>> = { en, ar };
const STORE_KEY = 'rc.lang';

function initial(): Lang {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved === 'en' || saved === 'ar') return saved;
  return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

let lang: Lang = initial();
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = tables[lang]['app.title'];
}
apply();

export function setLang(next: Lang) {
  lang = next;
  localStorage.setItem(STORE_KEY, next);
  apply();
  listeners.forEach((l) => l());
}

export const getLang = () => lang;

export type Params = Record<string, string | number>;

export function translate(key: Key, params?: Params): string {
  let s: string = tables[lang][key] ?? tables.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Looks a dynamic key up, falling back to a default when it does not exist. */
export function translateAny(key: string, params?: Params, fallback?: string): string {
  return key in en ? translate(key as Key, params) : (fallback ?? key);
}

export function useI18n() {
  const current = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => lang);
  return { lang: current, t: translate, tAny: translateAny, toggle: () => setLang(current === 'ar' ? 'en' : 'ar') };
}
