"use client";

/* ==========================================================================
 *  Buka Delivery — hooks/useOnlineStatus.ts   (milestone 2)
 *
 *  navigator.onLine ως external store. Στον server/πριν το hydration
 *  θεωρούμε «online», ώστε να μην αναβοσβήνει μήνυμα σύνδεσης.
 * ========================================================================== */

import { useSyncExternalStore } from "react";

function subscribe(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
