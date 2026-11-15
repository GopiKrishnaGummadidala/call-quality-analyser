import { useCallback, useState } from 'react';

const KEY = 'cqa.submissions';

function read(): number[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as number[]; } catch { return []; }
}

/** Simple tasks/hour indicator based on submissions made in this browser session. */
export function recordSubmission(now = Date.now()): void {
  try { sessionStorage.setItem(KEY, JSON.stringify([...read(), now])); } catch { /* ignore */ }
}

export function tasksPerHour(stamps: number[], now = Date.now()): number | null {
  if (stamps.length < 2) return null;
  const hours = (now - stamps[0]) / 3_600_000;
  return hours > 0 ? Math.round((stamps.length / Math.max(hours, 1 / 60)) * 10) / 10 : null;
}

export function useThroughput() {
  const [stamps, setStamps] = useState<number[]>(read);
  const refresh = useCallback(() => setStamps(read()), []);
  return { submitted: stamps.length, perHour: tasksPerHour(stamps), refresh };
}
