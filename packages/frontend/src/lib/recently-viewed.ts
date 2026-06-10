export type RecentEntityType = "invoice" | "quote" | "customer" | "product";

export interface RecentEntity {
  type: RecentEntityType;
  id: string;
  label: string;
  sublabel?: string;
  visitedAt: number;
}

const STORAGE_KEY = "inkvoice-recently-viewed";
const MAX_ITEMS = 10;
const CHANGE_EVENT = "inkvoice:recently-viewed-changed";

function read(): RecentEntity[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentEntity =>
        e && typeof e.id === "string" && typeof e.type === "string" && typeof e.label === "string",
    );
  } catch {
    return [];
  }
}

function write(entries: RecentEntity[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // ignore
  }
}

export function getRecentlyViewed(): RecentEntity[] {
  return read();
}

export function pushRecentlyViewed(entry: Omit<RecentEntity, "visitedAt">): void {
  const current = read();
  const filtered = current.filter((e) => !(e.type === entry.type && e.id === entry.id));
  filtered.unshift({ ...entry, visitedAt: Date.now() });
  write(filtered.slice(0, MAX_ITEMS));
}

export function clearRecentlyViewed(): void {
  write([]);
}

export function subscribeRecentlyViewed(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
