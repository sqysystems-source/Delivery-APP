/* ==========================================================================
 *  Buka Delivery — lib/browser-store.ts
 *
 *  Μικρό «external store» πάνω στο localStorage για useSyncExternalStore:
 *    • ασφαλές σε SSR, private mode και μπλοκαρισμένο storage (try/catch)
 *    • κάθε ανάγνωση περνά από parser — κακόμορφα δεδομένα = προεπιλογή
 *    • σταθερή αναφορά όσο το raw string δεν αλλάζει (απαίτηση του
 *      useSyncExternalStore)
 *    • ενημερώνει και τις άλλες καρτέλες μέσω του `storage` event
 *
 *  ΠΟΤΕ δεν αποθηκεύει προσωπικά στοιχεία: το ποιο σχήμα γράφεται το
 *  ορίζουν οι καλούντες (checkout-attempt.ts, orders/last-order.ts).
 * ========================================================================== */

export type BrowserStore<T> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  /** Γράφει (ή σβήνει με null) και ειδοποιεί όσους ακούν */
  write: (next: T | null) => void;
};

function safeGet(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* Γεμάτο ή μπλοκαρισμένο storage — η λειτουργία συνεχίζει χωρίς αυτό */
  }
}

export function createBrowserStore<T>(options: {
  key: string;
  parse: (raw: string | null) => T;
  serialize: (value: T) => string | null;
  empty: T;
}): BrowserStore<T> {
  const { key, parse, serialize, empty } = options;
  const listeners = new Set<() => void>();
  let cachedRaw: string | null | undefined;
  let cachedValue: T = empty;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === key) notify();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== "undefined") {
        window.addEventListener("storage", handleStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") {
          window.removeEventListener("storage", handleStorage);
        }
      };
    },

    getSnapshot() {
      const raw = safeGet(key);
      if (raw !== cachedRaw) {
        cachedRaw = raw;
        cachedValue = parse(raw);
      }
      return cachedValue;
    },

    getServerSnapshot() {
      return empty;
    },

    write(next) {
      const raw = next === null ? null : serialize(next);
      safeSet(key, raw);
      notify();
    },
  };
}
