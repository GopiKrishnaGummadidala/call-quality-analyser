import { useEffect, useRef } from 'react';

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  /** Fires even while focus is in an input/textarea/select. Default: false. */
  allowWhileTyping?: boolean;
  handler: (e: KeyboardEvent) => void;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

export function matches(e: KeyboardEvent, s: Shortcut): boolean {
  return e.key.toLowerCase() === s.key.toLowerCase() && (e.ctrlKey || e.metaKey) === !!s.ctrl && !e.altKey;
}

export function useShortcuts(shortcuts: Shortcut[], enabled = true): void {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);
      for (const s of ref.current) {
        if (!matches(e, s)) continue;
        if (typing && !s.allowWhileTyping) continue;
        e.preventDefault();
        s.handler(e);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
