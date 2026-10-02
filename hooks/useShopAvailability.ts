"use client";

/* ==========================================================================
 *  Buka Delivery — hooks/useShopAvailability.ts   (milestone 4)
 *
 *  Διαθεσιμότητα καταστήματος που ΜΕΝΕΙ ΑΛΗΘΙΝΗ όσο η σελίδα είναι ανοιχτή:
 *
 *    • Ένα χρονόμετρο (setTimeout) για την ΕΠΟΜΕΝΗ αλλαγή του ωραρίου —
 *      όχι polling, όχι επαναλαμβανόμενο interval, καμία ανάγνωση Firestore.
 *    • Όταν η καρτέλα ξαναγίνεται ορατή (visibilitychange / focus /
 *      pageshow) η ώρα ανανεώνεται: οι browsers «παγώνουν» χρονόμετρα σε
 *      κρυφές καρτέλες, οπότε δεν τα εμπιστευόμαστε μόνα τους.
 *    • Νέα ρύθμιση (snapshot) → νέα αξιολόγηση με ώρα ΤΟΥΛΑΧΙΣΤΟΝ τη στιγμή
 *      λήψης (`observedAt`), ποτέ με παλιό ρολόι.
 *    • Όλα τα χρονόμετρα/listeners καθαρίζονται στο unmount και σε κάθε
 *      αλλαγή της επόμενης στιγμής αλλαγής.
 *
 *  Ο browser μόνο ΚΑΘΟΔΗΓΕΙ· την τελική απόφαση την παίρνει ο server.
 * ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { evaluateShopAvailability, type ShopAvailability } from "@/lib/shop/availability";

/** setTimeout δέχεται έως 2^31−1 ms (~24,8 μέρες) */
const MAX_TIMEOUT_MS = 2_147_483_647;
/** Μικρό περιθώριο ώστε το χρονόμετρο να μην «ξυπνήσει» λίγο πριν το όριο */
const TIMER_SLACK_MS = 25;

export function useShopAvailability(
  shop: Record<string, unknown> | null,
  observedAt: number,
  clock: () => number = Date.now,
): { availability: ShopAvailability | null; now: number } {
  /** Η τελευταία ώρα που «είδε» το hook (χρονόμετρο ή επιστροφή στην καρτέλα) */
  const [clockMs, setClockMs] = useState(0);
  const now = Math.max(clockMs, observedAt);

  const availability = useMemo(
    () => (shop && now > 0 ? evaluateShopAvailability(shop, now) : null),
    [shop, now],
  );
  const nextChangeAt = availability?.nextChangeAt ?? null;

  /* Χρονόμετρο για το επόμενο όριο ωραρίου */
  useEffect(() => {
    if (nextChangeAt === null) return;
    const delay = Math.min(Math.max(0, nextChangeAt - clock()) + TIMER_SLACK_MS, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      // Αν ξύπνησε λίγο νωρίς, το όριο θεωρείται ότι έφτασε — αλλιώς θα κολλούσε
      setClockMs(Math.max(clock(), nextChangeAt));
    }, delay);
    return () => clearTimeout(timer);
  }, [nextChangeAt, clock]);

  /* Επιστροφή στην καρτέλα → φρέσκια ώρα */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setClockMs(clock());
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [clock]);

  return { availability, now };
}
