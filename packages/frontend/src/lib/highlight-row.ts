const STORAGE_KEY = "inkvoice-highlight-row";

interface Pending {
  scope: string;
  id: string;
  expiresAt: number;
}

export function markRowHighlight(scope: string, id: string, ttlMs = 8000): void {
  try {
    const payload: Pending = { scope, id, expiresAt: Date.now() + ttlMs };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function consumeRowHighlight(scope: string): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pending;
    if (parsed.scope !== scope) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    if (Date.now() > parsed.expiresAt) return null;
    return parsed.id;
  } catch {
    return null;
  }
}
