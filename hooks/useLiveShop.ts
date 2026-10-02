"use client";

/* ==========================================================================
 *  Buka Delivery — hooks/useLiveShop.ts   (milestone 4)
 *
 *  Ζωντανό έγγραφο καταστήματος (ένας onSnapshot listener). Επιστρέφει και
 *  τη στιγμή που ΛΗΦΘΗΚΕ κάθε snapshot (`receivedAt`), ώστε η αξιολόγηση
 *  διαθεσιμότητας να μη γίνεται ποτέ με «παλιό» ρολόι μετά από αλλαγή
 *  ρύθμισης, και έναν μετρητή εκδόσεων (`version`) για το checkout.
 *
 *  Καθαρισμός: ο listener κλείνει όταν αλλάζει το shopId ή φεύγει το
 *  component. Snapshot από προηγούμενο shopId δεν εμφανίζεται ποτέ (η
 *  κατάσταση φέρει το shopId της).
 *
 *  Αν δεν έρθει τίποτα μέσα σε `timeoutMs` (π.χ. κακή σύνδεση), η κατάσταση
 *  γίνεται "error": το checkout δεν μένει κλειδωμένο επ' αόριστον — αφήνει
 *  τον server να αποφασίσει.
 * ========================================================================== */

import { useEffect, useState } from "react";
import { subscribeShopDocument, type SubscribeShop } from "@/lib/shop/subscribe-shop";

export type LiveShopStatus = "loading" | "ready" | "missing" | "error";

export type LiveShop = {
  status: LiveShopStatus;
  data: Record<string, unknown> | null;
  /** Date.now() τη στιγμή που ήρθε το τελευταίο snapshot (0 πριν από αυτό) */
  receivedAt: number;
  /** Αυξάνεται σε κάθε snapshot — «έκδοση» της ρύθμισης που βλέπει ο browser */
  version: number;
};

type Stored = LiveShop & { shopId: string | null };

const LOADING: LiveShop = { status: "loading", data: null, receivedAt: 0, version: 0 };

const DEFAULT_TIMEOUT_MS = 10_000;

export function useLiveShop(
  shopId: string | null,
  subscribe: SubscribeShop = subscribeShopDocument,
  clock: () => number = Date.now,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): LiveShop {
  const [stored, setStored] = useState<Stored>({ ...LOADING, shopId: null });

  useEffect(() => {
    if (!shopId) return;
    let active = true;
    let answered = false;

    /* Καμία απάντηση για πολύ → «δεν ξέρουμε» (error), όχι αιώνιο «φόρτωση» */
    const timer = setTimeout(() => {
      if (!active || answered) return;
      setStored((previous) =>
        previous.shopId === shopId
          ? previous
          : { shopId, status: "error", data: null, receivedAt: clock(), version: 0 },
      );
    }, timeoutMs);

    const unsubscribe = subscribe(
      shopId,
      (data) => {
        if (!active) return;
        answered = true;
        clearTimeout(timer);
        setStored((previous) => ({
          shopId,
          status: data ? "ready" : "missing",
          data,
          receivedAt: clock(),
          version: (previous.shopId === shopId ? previous.version : 0) + 1,
        }));
      },
      (error) => {
        if (!active) return;
        answered = true;
        clearTimeout(timer);
        console.error("[shop] Αποτυχία ζωντανής ανάγνωσης καταστήματος:", error);
        setStored((previous) => ({
          shopId,
          status: "error",
          data: previous.shopId === shopId ? previous.data : null,
          receivedAt: clock(),
          version: previous.shopId === shopId ? previous.version : 0,
        }));
      },
    );

    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [shopId, subscribe, clock, timeoutMs]);

  if (!shopId || stored.shopId !== shopId) return LOADING;
  return { status: stored.status, data: stored.data, receivedAt: stored.receivedAt, version: stored.version };
}
