/** 0:03.25 style clock for audio positions. */
export function clock(ms: number, decimals = 2): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = (total - m * 60).toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, '0');
  return `${m}:${s}`;
}

const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl
  ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  : null;

/** "3 minutes ago" for ISO timestamps; falls back to a locale date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  if (!rtf || Number.isNaN(diff)) return new Date(iso).toLocaleString();
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month']];
  let value = diff;
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), 'year');
}

export function initials(name: string): string {
  return name.replace(/\(.*\)/, '').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

/** Stable pleasant colour per name, for avatars. */
export function avatarColor(name: string): string {
  const palette = ['#6366f1', '#0ea5e9', '#14b8a6', '#f97316', '#ec4899', '#8b5cf6', '#22c55e'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
