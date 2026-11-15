import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../shared/api';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

interface Options<P> {
  payload: P;
  initialVersion: number;
  enabled: boolean;
  debounceMs?: number;
  save: (expectedVersion: number, payload: P) => Promise<{ version: number }>;
}

/**
 * Debounced autosave with optimistic concurrency.
 * - saves are serialized (never two in flight), and always send the latest known version
 * - HTTP 409 STALE_VERSION => state "conflict": autosave stops until the user reloads (no silent overwrite)
 * - any other failure => state "error"; `saveNow` retries
 */
export function useAutosave<P>({ payload, initialVersion, enabled, debounceMs = 800, save }: Options<P>) {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(payload);
  latest.current = payload;
  const saved = useRef(payload); // last payload known to be persisted
  const version = useRef(initialVersion);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const blocked = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
    if (inFlight.current) await inFlight.current;
    if (blocked.current) return false;
    if (latest.current === saved.current) return true;

    const sent = latest.current;
    setState('saving');
    setError(null);
    const attempt = (async () => {
      try {
        const res = await saveRef.current(version.current, sent);
        version.current = res.version;
        saved.current = sent;
        setState(latest.current === sent ? 'saved' : 'dirty');
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.isStale) {
          blocked.current = true;
          setState('conflict');
        } else {
          setState('error');
          setError(e instanceof Error ? e.message : 'Save failed');
        }
        return false;
      }
    })();
    inFlight.current = attempt;
    const ok = await attempt;
    if (inFlight.current === attempt) inFlight.current = null;
    return ok;
  }, []);

  useEffect(() => {
    if (!enabled || blocked.current) return;
    if (payload === saved.current) {
      setState((s) => (s === 'dirty' ? 'saved' : s));
      return;
    }
    setState((s) => (s === 'saving' ? s : 'dirty'));
    timer.current = setTimeout(() => { void saveNow(); }, debounceMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [payload, enabled, debounceMs, saveNow]);

  // Best-effort flush when leaving the page with unsaved edits.
  useEffect(() => () => {
    if (!blocked.current && latest.current !== saved.current) void saveNow();
  }, [saveNow]);

  return { state, error, saveNow, getVersion: () => version.current };
}
