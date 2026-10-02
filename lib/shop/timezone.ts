/* ==========================================================================
 *  Buka Delivery — lib/shop/timezone.ts   (milestone 4)
 *
 *  Ώρα καταστήματος = ΠΑΝΤΑ Europe/Athens, ανεξάρτητα από τη ζώνη ώρας του
 *  browser ή του server (Vercel τρέχει σε UTC). Όλοι οι υπολογισμοί ωραρίου
 *  περνούν από εδώ.
 *
 *  ── ΠΩΣ ΔΟΥΛΕΥΕΙ ────────────────────────────────────────────────────────
 *  • «Στιγμή» (instant) = milliseconds από την εποχή Unix (Date.now()).
 *  • «Ένδειξη ρολογιού» (wall clock) = ημερομηνία YYYY-MM-DD + λεπτά της
 *    ημέρας (0…1439) όπως τα δείχνει ένα ρολόι στην Αθήνα.
 *  • Στιγμή → ρολόι: Intl.DateTimeFormat με timeZone "Europe/Athens" (η βάση
 *    ζωνών ώρας IANA του browser/Node ξέρει τις αλλαγές ώρας).
 *  • Ρολόι → στιγμή(ές): δοκιμάζουμε τις πιθανές μετατοπίσεις (UTC+2/UTC+3)
 *    και κρατάμε όσες δίνουν ακριβώς την ίδια ένδειξη:
 *      – κανονικά: 1 στιγμή
 *      – αλλαγή ώρας Μαρτίου (03:00 → 04:00): η 03:xx ΔΕΝ υπάρχει → 0
 *      – αλλαγή ώρας Οκτωβρίου (04:00 → 03:00): η 03:xx συμβαίνει 2 φορές → 2
 *
 *  Καθαρό module: κανένα import από Firebase, React ή Next.
 * ========================================================================== */

export const SHOP_TIME_ZONE = "Europe/Athens";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type WallClock = {
  /** "YYYY-MM-DD" */
  date: string;
  /** Λεπτά από τα μεσάνυχτα, 0…1439 */
  minutes: number;
  /** 0 = Δευτέρα … 6 = Κυριακή */
  weekday: number;
};

let cachedFormatter: Intl.DateTimeFormat | null = null;

function formatter(): Intl.DateTimeFormat {
  if (!cachedFormatter) {
    cachedFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: SHOP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  }
  return cachedFormatter;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** "YYYY-MM-DD" → αριθμός ημέρας (UTC) ή null αν δεν είναι πραγματική ημερομηνία */
export function dayNumberOf(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null; // π.χ. 2026-02-30
  }
  return Math.round(ms / DAY_MS);
}

export function dateFromDayNumber(dayNumber: number): string {
  const value = new Date(dayNumber * DAY_MS);
  return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

export function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && dayNumberOf(value) !== null;
}

export function addDays(date: string, days: number): string {
  const dayNumber = dayNumberOf(date);
  if (dayNumber === null) throw new Error(`Μη έγκυρη ημερομηνία: ${date}`);
  return dateFromDayNumber(dayNumber + days);
}

/** 0 = Δευτέρα … 6 = Κυριακή */
export function weekdayOf(date: string): number {
  const dayNumber = dayNumberOf(date);
  if (dayNumber === null) throw new Error(`Μη έγκυρη ημερομηνία: ${date}`);
  // 1970-01-01 ήταν Πέμπτη (3 με αρχή τη Δευτέρα)
  return (((dayNumber + 3) % 7) + 7) % 7;
}

/** Η ένδειξη του ρολογιού της Αθήνας τη στιγμή `ms` */
export function wallClockAt(ms: number): WallClock {
  const parts = formatter().formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? NaN);

  // Παλιές μηχανές μπορεί να δώσουν «24» για τα μεσάνυχτα παρά το h23
  const hour = value("hour") % 24;
  const date = `${pad(value("year"), 4)}-${pad(value("month"))}-${pad(value("day"))}`;
  return { date, minutes: hour * 60 + value("minute"), weekday: weekdayOf(date) };
}

/** Μετατόπιση της Αθήνας από UTC σε λεπτά τη στιγμή `ms` (120 ή 180) */
export function offsetMinutesAt(ms: number): number {
  const floored = Math.floor(ms / MINUTE_MS) * MINUTE_MS;
  const wall = wallClockAt(floored);
  const dayNumber = dayNumberOf(wall.date) as number;
  const asUtc = dayNumber * DAY_MS + wall.minutes * MINUTE_MS;
  return Math.round((asUtc - floored) / MINUTE_MS);
}

/** Συγκρίσιμο κλειδί ένδειξης ρολογιού (λεπτά από την εποχή, «σαν UTC») */
function wallKey(date: string, minutes: number): number {
  return (dayNumberOf(date) as number) * 1440 + minutes;
}

function wallKeyAt(ms: number): number {
  const wall = wallClockAt(ms);
  return wallKey(wall.date, wall.minutes);
}

/**
 * Όλες οι στιγμές κατά τις οποίες το ρολόι της Αθήνας δείχνει ακριβώς
 * `date` + `minutes` — ταξινομημένες. 0 στοιχεία μέσα στο «κενό» της
 * αλλαγής ώρας του Μαρτίου, 2 στην επαναλαμβανόμενη ώρα του Οκτωβρίου.
 * Το `minutes` μπορεί να είναι 1440 (= 00:00 της επόμενης μέρας).
 */
export function instantsForWallTime(date: string, minutes: number): number[] {
  const dayNumber = dayNumberOf(date);
  if (dayNumber === null) return [];
  const target = dayNumber * 1440 + minutes;
  const asUtc = target * MINUTE_MS;

  const offsets = new Set([
    offsetMinutesAt(asUtc - DAY_MS / 2),
    offsetMinutesAt(asUtc),
    offsetMinutesAt(asUtc + DAY_MS / 2),
  ]);

  const result = new Set<number>();
  for (const offset of offsets) {
    const candidate = asUtc - offset * MINUTE_MS;
    if (wallKeyAt(candidate) === target) result.add(candidate);
  }
  return [...result].sort((a, b) => a - b);
}

/**
 * Η πρώτη στιγμή κατά την οποία το ρολόι δείχνει `date` + `minutes` ή
 * αργότερα. Για ώρα που δεν υπάρχει (κενό Μαρτίου) επιστρέφει τη στιγμή της
 * αλλαγής ώρας — π.χ. «άνοιγμα 03:30» ισχύει από τις 04:00 θερινής ώρας.
 */
export function firstInstantAtOrAfterWallTime(date: string, minutes: number): number | null {
  const exact = instantsForWallTime(date, minutes);
  if (exact.length > 0) return exact[0];

  const dayNumber = dayNumberOf(date);
  if (dayNumber === null) return null;
  const target = dayNumber * 1440 + minutes;
  const asUtc = target * MINUTE_MS;

  // Δυαδική αναζήτηση σε ακέραια λεπτά ανάμεσα στις δύο πιθανές μετατοπίσεις
  let low = Math.floor((asUtc - 14 * 60 * MINUTE_MS) / MINUTE_MS);
  let high = Math.ceil((asUtc + 14 * 60 * MINUTE_MS) / MINUTE_MS);
  if (wallKeyAt(high * MINUTE_MS) < target) return null;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (wallKeyAt(middle * MINUTE_MS) >= target) high = middle;
    else low = middle + 1;
  }
  return low * MINUTE_MS;
}

/**
 * Στιγμές αλλαγής ώρας (μετατόπισης) μέσα στο [fromMs, toMs]. Εκεί το ρολόι
 * «πηδά», οπότε και η διαθεσιμότητα μπορεί να αλλάξει χωρίς όριο ωραρίου.
 */
export function offsetTransitionsBetween(fromMs: number, toMs: number): number[] {
  const result: number[] = [];
  const step = 6 * 60 * MINUTE_MS;
  let cursor = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS;
  let previousOffset = offsetMinutesAt(cursor);

  while (cursor < toMs) {
    const next = Math.min(cursor + step, toMs);
    const nextOffset = offsetMinutesAt(next);
    if (nextOffset !== previousOffset) {
      let low = cursor / MINUTE_MS;
      let high = next / MINUTE_MS;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (offsetMinutesAt(middle * MINUTE_MS) === previousOffset) low = middle;
        else high = middle;
      }
      result.push(high * MINUTE_MS);
    }
    previousOffset = nextOffset;
    cursor = next;
  }
  return result;
}

/** "HH:MM" για λεπτά 0…1440 */
export function formatMinutes(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}
