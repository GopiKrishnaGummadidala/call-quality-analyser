import '@testing-library/jest-dom/vitest';

/*
 * Newer Node versions define their own (disabled) global localStorage/sessionStorage, which stops jsdom from
 * installing its implementation. Provide a minimal in-memory Storage when that happens.
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  let usable = false;
  try { usable = typeof window[name]?.getItem === 'function'; } catch { usable = false; }
  if (!usable) Object.defineProperty(window, name, { value: new MemoryStorage(), configurable: true, writable: true });
}
