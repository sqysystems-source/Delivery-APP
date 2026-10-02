/* ==========================================================================
 *  Buka Delivery — lib/shop/availability.ts   (milestone 4)
 *
 *  «Δέχεται παραγγελίες το κατάστημα ΤΩΡΑ;» — ΙΔΙΑ συνάρτηση στον server
 *  (τελική απόφαση, με ώρα server) και στον browser (καθοδήγηση/εμφάνιση).
 *
 *  ── ΠΡΟΤΕΡΑΙΟΤΗΤΑ ───────────────────────────────────────────────────────
 *   1. `active === false` (χειροκίνητη παύση «Προσωρινά δεν δεχόμαστε
 *      παραγγελίες»)                         → paused        («Προσωρινά μη διαθέσιμο»)
 *   2. κακόμορφο `active` ή `openingHours`    → unavailable   («Προσωρινά μη διαθέσιμο»)
 *   3. χωρίς ωράριο / ωράριο ανενεργό         → open          (όπως πριν το milestone 4)
 *   4. ωράριο ενεργό                          → open | closed  («Ανοιχτό» / «Κλειστό»)
 *
 *  ── ΤΟ ΠΕΔΙΟ `active` (ΥΠΑΡΧΟΝ) ─────────────────────────────────────────
 *  Πριν: ο διακόπτης «Άνοιγμα/Κλείσιμο καταστήματος» έγραφε `active`, και
 *  το /api/orders απέρριπτε όταν `active === false`. Τώρα το ΙΔΙΟ πεδίο είναι
 *  η χειροκίνητη παύση: ένα κατάστημα που ήταν κλειστό (`false`) μένει
 *  κλειστό — η αναβάθμιση δεν ανοίγει κανένα κατάστημα. Απόν/true/null =
 *  καμία παύση (η παλιά συμπεριφορά: null/απόν θεωρούνταν ανοιχτά).
 *  Οτιδήποτε άλλο (π.χ. το κείμενο "false") → unavailable, όχι ανοιχτό.
 *
 *  Καθαρό module: κανένα import από Firebase, React ή Next.
 * ========================================================================== */

import {
  OPENING_HOURS_LIMITS,
  formatRelativeShopTime,
  parseOpeningHours,
  scheduleStateAt,
} from "@/lib/shop/opening-hours";
import type { OpeningHoursConfig } from "@/types";

export type AvailabilityState = "open" | "closed" | "paused" | "unavailable";

export type ShopAvailability = {
  state: AvailabilityState;
  /** Εφαρμόζεται ωράριο (ενεργό και έγκυρο) */
  scheduled: boolean;
  /** Το ενεργό ωράριο (μόνο για εμφάνιση) */
  schedule: OpeningHoursConfig | null;
  /**
   * Η επόμενη στιγμή που η κατάσταση αλλάζει ΛΟΓΩ ΩΡΑΣ (για χρονόμετρα UI).
   * null = καμία προγραμματισμένη αλλαγή (παύση, χωρίς ωράριο, ή εκτός παραθύρου).
   */
  nextChangeAt: number | null;
  /** closed: πότε ανοίγει (μόνο όταν υπολογίζεται αξιόπιστα) */
  nextOpenAt: number | null;
  /** open με ωράριο: πότε κλείνει */
  closesAt: number | null;
};

function base(state: AvailabilityState): ShopAvailability {
  return { state, scheduled: false, schedule: null, nextChangeAt: null, nextOpenAt: null, closesAt: null };
}

/** Η χειροκίνητη παύση: true | false | "invalid" */
export function readManualPause(active: unknown): boolean | "invalid" {
  if (active === undefined || active === null || active === true) return false;
  if (active === false) return true;
  return "invalid";
}

export function evaluateShopAvailability(
  shop: Record<string, unknown>,
  nowMs: number,
): ShopAvailability {
  const pause = readManualPause(shop.active);
  if (pause === true) return base("paused");

  const hours = parseOpeningHours(shop.openingHours);
  if (pause === "invalid" || hours.kind === "invalid") return base("unavailable");

  if (hours.kind === "absent" || !hours.config.enabled) return base("open");

  const schedule = scheduleStateAt(hours.config, nowMs, OPENING_HOURS_LIMITS.lookaheadDays);
  return {
    state: schedule.open ? "open" : "closed",
    scheduled: true,
    schedule: hours.config,
    nextChangeAt: schedule.nextChangeAt,
    nextOpenAt: schedule.open ? null : schedule.nextChangeAt,
    closesAt: schedule.open ? schedule.nextChangeAt : null,
  };
}

/* ==========================================================================
 *  ΚΕΙΜΕΝΑ
 * ========================================================================== */

export const AVAILABILITY_LABELS: Record<AvailabilityState, string> = {
  open: "Ανοιχτό",
  closed: "Κλειστό",
  paused: "Προσωρινά μη διαθέσιμο",
  unavailable: "Προσωρινά μη διαθέσιμο",
};

/** Μία πρόταση με λεπτομέρεια για τον πελάτη */
export function describeAvailability(availability: ShopAvailability, nowMs: number): string {
  switch (availability.state) {
    case "open":
      return availability.closesAt !== null
        ? `Δέχεται παραγγελίες — κλείνει ${formatRelativeShopTime(availability.closesAt, nowMs)}.`
        : "Δέχεται παραγγελίες.";
    case "closed":
      return availability.nextOpenAt !== null
        ? `Ανοίγει ${formatRelativeShopTime(availability.nextOpenAt, nowMs)}.`
        : "Δεν υπάρχει προγραμματισμένο άνοιγμα τις επόμενες δύο εβδομάδες.";
    case "paused":
      return "Το κατάστημα δεν δέχεται παραγγελίες αυτή τη στιγμή.";
    case "unavailable":
      return "Το κατάστημα δεν δέχεται παραγγελίες αυτή τη στιγμή λόγω προβλήματος στις ρυθμίσεις του.";
  }
}

/** Μήνυμα απόρριψης παραγγελίας (server και checkout) */
export function describeOrderBlock(availability: ShopAvailability, nowMs: number): string {
  switch (availability.state) {
    case "closed":
      return availability.nextOpenAt !== null
        ? `Το κατάστημα είναι κλειστό και δέχεται παραγγελίες ξανά ${formatRelativeShopTime(availability.nextOpenAt, nowMs)}. Το καλάθι σου μένει ως έχει.`
        : "Το κατάστημα είναι κλειστό αυτή τη στιγμή. Το καλάθι σου μένει ως έχει.";
    case "paused":
      return "Το κατάστημα δεν δέχεται προσωρινά παραγγελίες. Το καλάθι σου μένει ως έχει — δοκίμασε ξανά αργότερα.";
    case "unavailable":
      return "Το κατάστημα έχει πρόβλημα στις ρυθμίσεις του και δεν δέχεται παραγγελίες αυτή τη στιγμή. Το καλάθι σου μένει ως έχει.";
    case "open":
      return "";
  }
}
