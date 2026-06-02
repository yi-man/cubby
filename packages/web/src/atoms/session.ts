import type { Session } from '@cubby/core';
import { atom } from 'jotai';

export const sessionsAtom = atom<Session[]>([]);
export const currentSessionIdAtom = atom<string | null>(null);
export const currentSessionAtom = atom((get) => {
  const id = get(currentSessionIdAtom);
  if (!id) return null;
  return get(sessionsAtom).find((s) => s.id === id) ?? null;
});
