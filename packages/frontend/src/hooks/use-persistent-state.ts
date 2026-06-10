import { useCallback, useEffect, useRef, useState } from "react";

const CHANGE_EVENT = "inkvoice:persistent-state-changed";

interface ChangeDetail {
  key: string;
}

function emitChange(key: string): void {
  window.dispatchEvent(new CustomEvent<ChangeDetail>(CHANGE_EVENT, { detail: { key } }));
}

export function usePersistentState<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === null) return initialValue;
      return JSON.parse(stored) as T;
    } catch {
      return initialValue;
    }
  });

  // Track whether the latest write was self-initiated, so we don't loop on our own event.
  const writeFromHere = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore quota / privacy errors
    }
    if (writeFromHere.current) {
      writeFromHere.current = false;
      emitChange(key);
    }
  }, [key, state]);

  // Cross-instance sync: listen for changes from other usePersistentState consumers
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ChangeDetail>).detail;
      if (!detail || detail.key !== key) return;
      try {
        const stored = localStorage.getItem(key);
        if (stored === null) return;
        const parsed = JSON.parse(stored) as T;
        setState(parsed);
      } catch {
        // ignore
      }
    };
    const storageHandler = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return;
      try {
        setState(JSON.parse(e.newValue) as T);
      } catch {
        // ignore
      }
    };
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [key]);

  const update = useCallback((value: T | ((prev: T) => T)) => {
    writeFromHere.current = true;
    setState(value);
  }, []);

  return [state, update];
}
