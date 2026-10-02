/* ==========================================================================
 *  Buka Delivery — lib/shop/opening-hours.ts   (milestone 4)
 *
 *  Ωράριο λειτουργίας: επικύρωση, αξιολόγηση «ανοιχτό τώρα;» και υπολογισμός
 *  της επόμενης αλλαγής. ΙΔΙΟΣ κώδικας σε server (απόφαση) και browser
 *  (καθοδήγηση).
 *
 *  ── ΚΑΝΟΝΕΣ (τεκμηριώνονται και στο CHANGES.md) ─────────────────────────
 *  1. Ζώνη ώρας: Europe/Athens, ανεξάρτητα από browser/server.
 *  2. Διάστημα [open, close): το άνοιγμα ΣΥΜΠΕΡΙΛΑΜΒΑΝΕΤΑΙ, το κλείσιμο ΟΧΙ.
 *     12:00–16:00 → ανοιχτό 12:00:00 … 15:59:59, κλειστό από 16:00:00.
 *  3. close "24:00" ή "00:00" = μεσάνυχτα (τέλος της ημέρας).
 *     "00:00"–"00:00" = όλο το 24ωρο. open == close (άλλη ώρα) = σφάλμα.
 *  4. close < open = βραδινή βάρδια: συνεχίζει την ΕΠΟΜΕΝΗ ημερολογιακή μέρα
 *     μέχρι το close (π.χ. Παρασκευή 18:00–02:00 → Σάββατο ως τις 02:00).
 *     Το διάστημα «ανήκει» στη μέρα που ΞΕΚΙΝΑ.
 *  5. Εξαίρεση ημερομηνίας: ορίζει ΟΛΟ το ημερολογιακό 24ωρο της (00:00–24:00).
 *     Αντικαθιστά το εβδομαδιαίο πρόγραμμα της μέρας ΚΑΙ τη συνέχεια βραδινής
 *     βάρδιας της προηγούμενης μέρας. Οι δικές της βραδινές βάρδιες συνεχίζουν
 *     στην επόμενη μέρα (εκτός αν κι εκείνη έχει εξαίρεση).
 *  6. Χειροκίνητη παύση (`active === false`) υπερισχύει όλων — δες
 *     lib/shop/availability.ts.
 *  7. Αλλαγή ώρας: η αξιολόγηση γίνεται πάνω στην ΕΝΔΕΙΞΗ του ρολογιού της
 *     Αθήνας. Ώρα μέσα στο κενό του Μαρτίου (03:00–03:59) ισχύει από τη στιγμή
 *     που το ρολόι την ξεπερνά (04:00 θερινή)· η επαναλαμβανόμενη ώρα του
 *     Οκτωβρίου αξιολογείται και τις δύο φορές με την ίδια ένδειξη.
 *  8. ΚΑΜΙΑ προγραμματισμένη παραγγελία: ελέγχεται μόνο το «τώρα».
 *
 *  Κακόμορφη ρύθμιση ΔΕΝ «διορθώνεται» σιωπηλά: ο server απορρίπτει την
 *  εγγραφή, και αν κάτι κακόμορφο βρεθεί στη βάση, το κατάστημα θεωρείται
 *  «προσωρινά μη διαθέσιμο» — ποτέ ανοιχτό.
 *
 *  Καθαρό module: κανένα import από Firebase, React ή Next.
 * ========================================================================== */

import type {
  OpeningHoursConfig,
  OpeningHoursException,
  OpeningInterval,
  WeekdayKey,
} from "@/types";
import {
  addDays,
  dayNumberOf,
  firstInstantAtOrAfterWallTime,
  formatMinutes,
  instantsForWallTime,
  isValidDateString,
  offsetTransitionsBetween,
  wallClockAt,
  weekdayOf,
} from "@/lib/shop/timezone";
import { cleanSingleLine } from "@/lib/checkout/validation";

/* ==========================================================================
 *  ΟΡΙΑ
 * ========================================================================== */

export const OPENING_HOURS_LIMITS = {
  /** Διαστήματα ανά ημέρα (εβδομαδιαία ή εξαίρεση) */
  maxIntervalsPerDay: 4,
  /** Εξαιρέσεις ημερομηνιών συνολικά */
  maxExceptions: 40,
  exceptionLabelMax: 60,
  /** Αποδεκτό εύρος ημερομηνιών εξαιρέσεων */
  minDate: "2024-01-01",
  maxDate: "2099-12-31",
  /** Πόσο μπροστά ψάχνουμε την επόμενη αλλαγή/το επόμενο άνοιγμα */
  lookaheadDays: 15,
} as const;

export const WEEKDAY_KEYS: readonly WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: "Δευτέρα",
  tue: "Τρίτη",
  wed: "Τετάρτη",
  thu: "Πέμπτη",
  fri: "Παρασκευή",
  sat: "Σάββατο",
  sun: "Κυριακή",
};

/** Αιτιατική με άρθρο: «τη Δευτέρα», «το Σάββατο» */
const WEEKDAY_ACCUSATIVE: readonly string[] = [
  "τη Δευτέρα",
  "την Τρίτη",
  "την Τετάρτη",
  "την Πέμπτη",
  "την Παρασκευή",
  "το Σάββατο",
  "την Κυριακή",
];

/* ==========================================================================
 *  ΩΡΕΣ
 * ========================================================================== */

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" (00:00…23:59) → λεπτά, ή null */
export function parseOpenTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = TIME.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Όπως το parseOpenTime, αλλά δέχεται και "24:00"· "00:00"/"24:00" → 1440 */
export function parseCloseTime(value: unknown): number | null {
  if (value === "24:00") return 1440;
  const minutes = parseOpenTime(value);
  if (minutes === null) return null;
  return minutes === 0 ? 1440 : minutes;
}

/** Διάστημα σε λεπτά πάνω σε «εκτεταμένο» άξονα: end έως 2879 για βραδινές βάρδιες */
export type ResolvedInterval = { start: number; end: number };

export function resolveInterval(interval: OpeningInterval): ResolvedInterval | null {
  const start = parseOpenTime(interval.open);
  const close = parseCloseTime(interval.close);
  if (start === null || close === null) return null;
  if (close === start) return null; // π.χ. 10:00–10:00: αμφίσημο
  return { start, end: close > start ? close : close + 1440 };
}

export function isOvernight(interval: OpeningInterval): boolean {
  const resolved = resolveInterval(interval);
  return resolved !== null && resolved.end > 1440;
}

/* ==========================================================================
 *  ΕΠΙΚΥΡΩΣΗ
 * ========================================================================== */

export type ShopSettingsError = {
  /** π.χ. "openingHours.weekly.fri.1", "openingHours.exceptions.2.date" */
  path: string;
  message: string;
};

export type OpeningHoursResult =
  | { ok: true; config: OpeningHoursConfig }
  | { ok: false; errors: ShopSettingsError[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function describeInterval(interval: OpeningInterval): string {
  return `${interval.open}–${interval.close}`;
}

function parseIntervals(
  raw: unknown,
  path: string,
  errors: ShopSettingsError[],
): OpeningInterval[] {
  if (!Array.isArray(raw)) {
    errors.push({ path, message: "Μη έγκυρη λίστα διαστημάτων." });
    return [];
  }
  if (raw.length > OPENING_HOURS_LIMITS.maxIntervalsPerDay) {
    errors.push({
      path,
      message: `Έως ${OPENING_HOURS_LIMITS.maxIntervalsPerDay} διαστήματα ανά ημέρα.`,
    });
    return [];
  }

  const intervals: OpeningInterval[] = [];
  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    const entryPath = `${path}.${index}`;
    if (!record || Object.keys(record).some((key) => key !== "open" && key !== "close")) {
      errors.push({ path: entryPath, message: "Μη έγκυρο διάστημα." });
      return;
    }
    if (parseOpenTime(record.open) === null) {
      errors.push({ path: entryPath, message: "Η ώρα ανοίγματος πρέπει να είναι της μορφής ΩΩ:ΛΛ (00:00–23:59)." });
      return;
    }
    if (parseCloseTime(record.close) === null) {
      errors.push({ path: entryPath, message: "Η ώρα κλεισίματος πρέπει να είναι της μορφής ΩΩ:ΛΛ (00:00–24:00)." });
      return;
    }
    const interval = { open: record.open as string, close: record.close as string };
    if (!resolveInterval(interval)) {
      errors.push({
        path: entryPath,
        message: "Η ώρα ανοίγματος και κλεισίματος δεν μπορεί να είναι ίδια. Για όλο το 24ωρο βάλε 00:00–24:00.",
      });
      return;
    }
    intervals.push(interval);
  });

  // Κανονική σειρά: κατά ώρα ανοίγματος
  return intervals.sort(
    (a, b) => (resolveInterval(a) as ResolvedInterval).start - (resolveInterval(b) as ResolvedInterval).start,
  );
}

/** Επικαλύψεις μέσα στην ΙΔΙΑ ημέρα (στον εκτεταμένο άξονα) */
function checkSameDayOverlaps(intervals: OpeningInterval[], path: string, errors: ShopSettingsError[]) {
  const resolved = intervals.map((interval) => ({ interval, range: resolveInterval(interval) as ResolvedInterval }));
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const a = resolved[i].range;
      const b = resolved[j].range;
      if (a.start < b.end && b.start < a.end) {
        errors.push({
          path,
          message: `Τα διαστήματα ${describeInterval(resolved[i].interval)} και ${describeInterval(resolved[j].interval)} επικαλύπτονται.`,
        });
        return;
      }
    }
  }
}

/** Η συνέχεια βραδινών βαρδιών της μέρας `from` μέσα στην επόμενη μέρα */
function carryRanges(intervals: OpeningInterval[]): Array<{ interval: OpeningInterval; end: number }> {
  return intervals
    .map((interval) => ({ interval, range: resolveInterval(interval) }))
    .filter((entry): entry is { interval: OpeningInterval; range: ResolvedInterval } => entry.range !== null && entry.range.end > 1440)
    .map(({ interval, range }) => ({ interval, end: range.end - 1440 }));
}

/** Βραδινή βάρδια που «πέφτει» πάνω σε διάστημα της επόμενης μέρας */
function checkCarryOverlap(
  previous: OpeningInterval[],
  next: OpeningInterval[],
  path: string,
  describeDays: string,
  errors: ShopSettingsError[],
) {
  for (const carry of carryRanges(previous)) {
    for (const interval of next) {
      const range = resolveInterval(interval);
      if (range && range.start < carry.end) {
        errors.push({
          path,
          message: `${describeDays}: η βραδινή βάρδια ${describeInterval(carry.interval)} επικαλύπτεται με το ${describeInterval(interval)} της επόμενης μέρας.`,
        });
        return;
      }
    }
  }
}

function dateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)}/${Number(month)}/${year}`;
}

/**
 * Επικυρώνει ΟΛΗ τη ρύθμιση ωραρίου και επιστρέφει κανονική μορφή
 * (διαστήματα ταξινομημένα, εξαιρέσεις κατά ημερομηνία, καθαρές ετικέτες).
 * Ίδιοι κανόνες για εγγραφή (server endpoint) και ανάγνωση (checkout,
 * βιτρίνα): ό,τι δεν θα γραφόταν, δεν εμπιστευόμαστε ούτε όταν διαβάζεται.
 */
export function validateOpeningHours(raw: unknown): OpeningHoursResult {
  const errors: ShopSettingsError[] = [];
  const root = asRecord(raw);
  if (!root) return { ok: false, errors: [{ path: "openingHours", message: "Μη έγκυρη ρύθμιση ωραρίου." }] };

  const allowedKeys = new Set(["enabled", "weekly", "exceptions"]);
  if (Object.keys(root).some((key) => !allowedKeys.has(key))) {
    errors.push({ path: "openingHours", message: "Άγνωστο πεδίο στη ρύθμιση ωραρίου." });
  }
  if (typeof root.enabled !== "boolean") {
    errors.push({ path: "openingHours.enabled", message: "Μη έγκυρη ενεργοποίηση ωραρίου." });
  }

  /* ---------------------------- Εβδομαδιαίο ---------------------------- */
  const weeklyRaw = asRecord(root.weekly);
  const weekly = {} as Record<WeekdayKey, OpeningInterval[]>;
  if (!weeklyRaw || Object.keys(weeklyRaw).length !== 7 || !WEEKDAY_KEYS.every((key) => key in weeklyRaw)) {
    errors.push({ path: "openingHours.weekly", message: "Το εβδομαδιαίο πρόγραμμα πρέπει να έχει και τις 7 μέρες." });
    for (const key of WEEKDAY_KEYS) weekly[key] = [];
  } else {
    for (const key of WEEKDAY_KEYS) {
      const path = `openingHours.weekly.${key}`;
      weekly[key] = parseIntervals(weeklyRaw[key], path, errors);
      checkSameDayOverlaps(weekly[key], path, errors);
    }
    WEEKDAY_KEYS.forEach((key, index) => {
      const nextKey = WEEKDAY_KEYS[(index + 1) % 7];
      checkCarryOverlap(
        weekly[key],
        weekly[nextKey],
        `openingHours.weekly.${key}`,
        `${WEEKDAY_LABELS[key]} → ${WEEKDAY_LABELS[nextKey]}`,
        errors,
      );
    });
  }

  /* ----------------------------- Εξαιρέσεις ---------------------------- */
  const exceptions: OpeningHoursException[] = [];
  /** Θέση κάθε εξαίρεσης στο ΑΙΤΗΜΑ — για να δείχνουν τα λάθη στη σωστή γραμμή */
  const originalIndex = new Map<OpeningHoursException, number>();
  if (!Array.isArray(root.exceptions)) {
    errors.push({ path: "openingHours.exceptions", message: "Μη έγκυρη λίστα εξαιρέσεων." });
  } else if (root.exceptions.length > OPENING_HOURS_LIMITS.maxExceptions) {
    errors.push({
      path: "openingHours.exceptions",
      message: `Έως ${OPENING_HOURS_LIMITS.maxExceptions} εξαιρέσεις. Σβήσε όσες πέρασαν.`,
    });
  } else {
    const seen = new Set<string>();
    root.exceptions.forEach((entry, index) => {
      const path = `openingHours.exceptions.${index}`;
      const record = asRecord(entry);
      const allowed = new Set(["date", "closed", "intervals", "label"]);
      if (!record || Object.keys(record).some((key) => !allowed.has(key))) {
        errors.push({ path, message: "Μη έγκυρη εξαίρεση." });
        return;
      }
      if (
        !isValidDateString(record.date) ||
        record.date < OPENING_HOURS_LIMITS.minDate ||
        record.date > OPENING_HOURS_LIMITS.maxDate
      ) {
        errors.push({ path: `${path}.date`, message: "Μη έγκυρη ημερομηνία εξαίρεσης." });
        return;
      }
      if (seen.has(record.date)) {
        errors.push({
          path: `${path}.date`,
          message: `Υπάρχει ήδη εξαίρεση για ${dateLabel(record.date)}. Κράτησε μία ανά ημερομηνία.`,
        });
        return;
      }
      seen.add(record.date);

      if (typeof record.closed !== "boolean") {
        errors.push({ path: `${path}.closed`, message: "Μη έγκυρη εξαίρεση." });
        return;
      }

      let label: string | undefined;
      if (record.label !== undefined) {
        if (typeof record.label !== "string") {
          errors.push({ path: `${path}.label`, message: "Μη έγκυρη σημείωση." });
          return;
        }
        const cleaned = cleanSingleLine(record.label);
        if (cleaned.length > OPENING_HOURS_LIMITS.exceptionLabelMax) {
          errors.push({
            path: `${path}.label`,
            message: `Η σημείωση είναι έως ${OPENING_HOURS_LIMITS.exceptionLabelMax} χαρακτήρες.`,
          });
          return;
        }
        if (cleaned) label = cleaned;
      }

      const before = errors.length;
      const intervals = parseIntervals(record.intervals, `${path}.intervals`, errors);
      if (errors.length > before) return;

      if (record.closed && intervals.length > 0) {
        errors.push({ path, message: `${dateLabel(record.date)}: μια «κλειστή» μέρα δεν έχει ωράριο.` });
        return;
      }
      if (!record.closed && intervals.length === 0) {
        errors.push({
          path,
          message: `${dateLabel(record.date)}: πρόσθεσε τουλάχιστον ένα διάστημα ή σημείωσέ την ως κλειστή.`,
        });
        return;
      }
      checkSameDayOverlaps(intervals, path, errors);

      const exception: OpeningHoursException = {
        date: record.date,
        closed: record.closed,
        intervals,
        ...(label ? { label } : {}),
      };
      exceptions.push(exception);
      originalIndex.set(exception, index);
    });

    exceptions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    /* Βραδινή βάρδια εξαίρεσης → επόμενη μέρα ΧΩΡΙΣ εξαίρεση (εβδομαδιαίο) */
    if (errors.length === 0) {
      const byDate = new Map(exceptions.map((exception) => [exception.date, exception]));
      exceptions.forEach((exception) => {
        const nextDate = addDays(exception.date, 1);
        if (byDate.has(nextDate)) {
          checkCarryOverlap(
            exception.intervals,
            byDate.get(nextDate)?.intervals ?? [],
            `openingHours.exceptions.${originalIndex.get(exception)}`,
            dateLabel(exception.date),
            errors,
          );
          return;
        }
        const nextKey = WEEKDAY_KEYS[weekdayOf(nextDate)];
        checkCarryOverlap(
          exception.intervals,
          weekly[nextKey],
          `openingHours.exceptions.${originalIndex.get(exception)}`,
          dateLabel(exception.date),
          errors,
        );
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { enabled: root.enabled as boolean, weekly, exceptions } };
}

/**
 * Ανάγνωση από τη βάση:
 *   absent   — πεδίο απόν/null: κατάστημα χωρίς ωράριο (όπως πριν)
 *   invalid  — κάτι κακόμορφο: ΠΟΤΕ ανοιχτό (ελεγχόμενη «μη διαθεσιμότητα»)
 *   config   — έγκυρη ρύθμιση
 */
export type ParsedOpeningHours =
  | { kind: "absent" }
  | { kind: "invalid"; errors: ShopSettingsError[] }
  | { kind: "config"; config: OpeningHoursConfig };

export function parseOpeningHours(raw: unknown): ParsedOpeningHours {
  if (raw === undefined || raw === null) return { kind: "absent" };
  const result = validateOpeningHours(raw);
  return result.ok ? { kind: "config", config: result.config } : { kind: "invalid", errors: result.errors };
}

export function emptyWeekly(): Record<WeekdayKey, OpeningInterval[]> {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

/* ==========================================================================
 *  ΑΞΙΟΛΟΓΗΣΗ
 * ========================================================================== */

function exceptionFor(config: OpeningHoursConfig, date: string): OpeningHoursException | null {
  return config.exceptions.find((exception) => exception.date === date) ?? null;
}

/** Τα διαστήματα που ΞΕΚΙΝΟΥΝ τη μέρα `date` (εξαίρεση ή εβδομαδιαίο) */
export function intervalsStartingOn(config: OpeningHoursConfig, date: string): OpeningInterval[] {
  const exception = exceptionFor(config, date);
  if (exception) return exception.intervals;
  return config.weekly[WEEKDAY_KEYS[weekdayOf(date)]];
}

/** Ανοιχτό σύμφωνα με το ωράριο στην ένδειξη ρολογιού `date` + `minutes`; */
export function isOpenAtWallClock(config: OpeningHoursConfig, date: string, minutes: number): boolean {
  const covers = (intervals: OpeningInterval[]) =>
    intervals.some((interval) => {
      const range = resolveInterval(interval);
      return range !== null && range.start <= minutes && minutes < range.end;
    });

  /* Κανόνας 5: η εξαίρεση ορίζει όλο το 24ωρο — καμία συνέχεια από χθες */
  const exception = exceptionFor(config, date);
  if (exception) return covers(exception.intervals);

  if (covers(config.weekly[WEEKDAY_KEYS[weekdayOf(date)]])) return true;

  /* Κανόνας 4: συνέχεια βραδινής βάρδιας της προηγούμενης μέρας */
  const yesterday = intervalsStartingOn(config, addDays(date, -1));
  return carryRanges(yesterday).some((carry) => minutes < carry.end);
}

export function isOpenAt(config: OpeningHoursConfig, nowMs: number): boolean {
  const wall = wallClockAt(nowMs);
  return isOpenAtWallClock(config, wall.date, wall.minutes);
}

/**
 * Όλες οι στιγμές στο (fromMs, toMs] όπου η διαθεσιμότητα ΜΠΟΡΕΙ να αλλάξει:
 * όρια διαστημάτων, μεσάνυχτα (αρχή/τέλος εξαιρέσεων) και αλλαγές ώρας.
 */
function candidateBoundaries(config: OpeningHoursConfig, fromMs: number, toMs: number): number[] {
  const firstDate = addDays(wallClockAt(fromMs).date, -1);
  const lastDate = addDays(wallClockAt(toMs).date, 1);
  const candidates = new Set<number>();

  const addWall = (date: string, minutes: number) => {
    for (const instant of instantsForWallTime(date, minutes)) candidates.add(instant);
    const first = firstInstantAtOrAfterWallTime(date, minutes);
    if (first !== null) candidates.add(first);
  };

  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
    addWall(date, 0);
    for (const interval of intervalsStartingOn(config, date)) {
      const range = resolveInterval(interval);
      if (!range) continue;
      addWall(date, range.start);
      if (range.end >= 1440) addWall(addDays(date, 1), range.end - 1440);
      else addWall(date, range.end);
    }
  }
  for (const transition of offsetTransitionsBetween(fromMs, toMs)) candidates.add(transition);

  return [...candidates].filter((instant) => instant > fromMs && instant <= toMs).sort((a, b) => a - b);
}

export type ScheduleState = {
  open: boolean;
  /** Η επόμενη στιγμή που αλλάζει η κατάσταση (null = όχι μέσα στο παράθυρο) */
  nextChangeAt: number | null;
};

/**
 * Κατάσταση τώρα + επόμενη αλλαγή. Ψάχνει σε κομμάτια των 2 ημερών και
 * σταματά στην πρώτη αλλαγή, ώστε η συνηθισμένη περίπτωση να είναι φθηνή.
 */
export function scheduleStateAt(
  config: OpeningHoursConfig,
  nowMs: number,
  lookaheadDays: number = OPENING_HOURS_LIMITS.lookaheadDays,
): ScheduleState {
  const open = isOpenAt(config, nowMs);
  const chunkMs = 2 * 86_400_000;
  const endMs = nowMs + lookaheadDays * 86_400_000;

  for (let from = nowMs; from < endMs; from += chunkMs) {
    const to = Math.min(from + chunkMs, endMs);
    for (const candidate of candidateBoundaries(config, from, to)) {
      if (isOpenAt(config, candidate) !== open) return { open, nextChangeAt: candidate };
    }
  }
  return { open, nextChangeAt: null };
}

/* ==========================================================================
 *  ΚΕΙΜΕΝΑ
 * ========================================================================== */

/** «12:00–16:00» ή «18:00–02:00 (επόμενη μέρα)» */
export function formatInterval(interval: OpeningInterval): string {
  const range = resolveInterval(interval);
  if (!range) return `${interval.open}–${interval.close}`;
  if (range.start === 0 && range.end === 1440) return "Όλο το 24ωρο";
  const close = range.end === 1440 ? "24:00" : formatMinutes(range.end);
  return range.end > 1440
    ? `${formatMinutes(range.start)}–${close} (επόμενη μέρα)`
    : `${formatMinutes(range.start)}–${close}`;
}

export function formatIntervals(intervals: readonly OpeningInterval[]): string {
  return intervals.length === 0 ? "Κλειστό" : intervals.map(formatInterval).join(", ");
}

/**
 * «σήμερα στις 18:00», «αύριο στις 12:00», «την Παρασκευή στις 12:00»,
 * ή «τη Δευτέρα 12/10 στις 12:00» (πάνω από 6 μέρες μπροστά).
 */
export function formatRelativeShopTime(targetMs: number, nowMs: number): string {
  const target = wallClockAt(targetMs);
  const now = wallClockAt(nowMs);
  const days = (dayNumberOf(target.date) as number) - (dayNumberOf(now.date) as number);
  const time = formatMinutes(target.minutes);

  if (days === 0) return `σήμερα στις ${time}`;
  if (days === 1) return `αύριο στις ${time}`;
  const weekday = WEEKDAY_ACCUSATIVE[target.weekday];
  if (days > 1 && days <= 6) return `${weekday} στις ${time}`;
  const [, month, day] = target.date.split("-");
  return `${weekday} ${Number(day)}/${Number(month)} στις ${time}`;
}

/** Επερχόμενες εξαιρέσεις (από σήμερα και για `days` μέρες) — για τη βιτρίνα */
export function upcomingExceptions(
  config: OpeningHoursConfig,
  nowMs: number,
  days = 14,
): OpeningHoursException[] {
  const today = wallClockAt(nowMs).date;
  const last = addDays(today, days);
  return config.exceptions.filter((exception) => exception.date >= today && exception.date <= last);
}

export function formatExceptionDate(date: string): string {
  const weekday = WEEKDAY_LABELS[WEEKDAY_KEYS[weekdayOf(date)]];
  const [year, month, day] = date.split("-");
  return `${weekday} ${Number(day)}/${Number(month)}/${year}`;
}
