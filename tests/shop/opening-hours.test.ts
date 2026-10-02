/* ==========================================================================
 *  Ωράριο λειτουργίας (milestone 4) — καθαρή λογική, χωρίς Firebase.
 *
 *  Όλες οι στιγμές δηλώνονται ως ένδειξη ρολογιού ΑΘΗΝΑΣ (athens(...)) ή
 *  ρητά σε UTC, ώστε τα tests να μην εξαρτώνται από τη ζώνη ώρας του
 *  μηχανήματος που τα τρέχει.
 *
 *  Αλλαγές ώρας 2026 (Europe/Athens):
 *    • Κυρ. 29/3 03:00 EET → 04:00 EEST  (01:00 UTC) — η 03:xx δεν υπάρχει
 *    • Κυρ. 25/10 04:00 EEST → 03:00 EET (01:00 UTC) — η 03:xx συμβαίνει δύο φορές
 * ========================================================================== */

import { afterEach, describe, expect, it } from "vitest";
import type { OpeningHoursConfig, OpeningInterval, WeekdayKey } from "@/types";
import {
  emptyWeekly,
  formatInterval,
  formatRelativeShopTime,
  isOpenAt,
  parseOpeningHours,
  scheduleStateAt,
  validateOpeningHours,
} from "@/lib/shop/opening-hours";
import {
  firstInstantAtOrAfterWallTime,
  instantsForWallTime,
  offsetMinutesAt,
  wallClockAt,
  weekdayOf,
} from "@/lib/shop/timezone";

/* ------------------------------ Βοηθητικά ------------------------------- */

function athens(date: string, time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  const instants = instantsForWallTime(date, hours * 60 + minutes);
  if (instants.length === 0) throw new Error(`Η ώρα ${date} ${time} δεν υπάρχει στην Αθήνα`);
  return instants[0];
}

const iv = (open: string, close: string): OpeningInterval => ({ open, close });

function config(
  weekly: Partial<Record<WeekdayKey, OpeningInterval[]>>,
  exceptions: OpeningHoursConfig["exceptions"] = [],
): OpeningHoursConfig {
  return { enabled: true, weekly: { ...emptyWeekly(), ...weekly }, exceptions };
}

/* 2026-10-05 = Δευτέρα … 2026-10-11 = Κυριακή */
const MON = "2026-10-05";
const FRI = "2026-10-09";
const SAT = "2026-10-10";
const SUN = "2026-10-11";
const NEXT_MON = "2026-10-12";

/* ==========================================================================
 *  Ζώνη ώρας
 * ========================================================================== */

describe("ζώνη ώρας Europe/Athens", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("οι ημέρες της εβδομάδας υπολογίζονται σωστά", () => {
    expect(weekdayOf(MON)).toBe(0);
    expect(weekdayOf(SAT)).toBe(5);
    expect(weekdayOf(SUN)).toBe(6);
    expect(weekdayOf("2024-02-29")).toBe(3); // Πέμπτη
  });

  it("θερινή ώρα (UTC+3) και χειμερινή (UTC+2)", () => {
    expect(offsetMinutesAt(Date.UTC(2026, 6, 1, 12))).toBe(180);
    expect(offsetMinutesAt(Date.UTC(2026, 0, 15, 12))).toBe(120);
    expect(athens("2026-07-01", "12:00")).toBe(Date.UTC(2026, 6, 1, 9));
    expect(athens("2026-01-15", "12:00")).toBe(Date.UTC(2026, 0, 15, 10));
  });

  it("ανεξάρτητο από τη ζώνη ώρας του server/browser", () => {
    const cfg = config({ mon: [iv("12:00", "16:00")] });
    const instant = Date.UTC(2026, 9, 5, 9, 0); // 12:00 Αθήνας
    for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "Europe/Athens"]) {
      process.env.TZ = tz;
      expect(wallClockAt(instant)).toMatchObject({ date: MON, minutes: 12 * 60, weekday: 0 });
      expect(isOpenAt(cfg, instant)).toBe(true);
      expect(isOpenAt(cfg, instant - 1)).toBe(false);
    }
  });

  it("κενό Μαρτίου: η 03:30 δεν υπάρχει, το επόμενο υπαρκτό είναι 04:00 θερινή", () => {
    expect(instantsForWallTime("2026-03-29", 3 * 60 + 30)).toEqual([]);
    expect(firstInstantAtOrAfterWallTime("2026-03-29", 3 * 60 + 30)).toBe(Date.UTC(2026, 2, 29, 1, 0));
  });

  it("επανάληψη Οκτωβρίου: η 03:30 συμβαίνει δύο φορές", () => {
    expect(instantsForWallTime("2026-10-25", 3 * 60 + 30)).toEqual([
      Date.UTC(2026, 9, 25, 0, 30),
      Date.UTC(2026, 9, 25, 1, 30),
    ]);
  });
});

/* ==========================================================================
 *  Όρια διαστημάτων
 * ========================================================================== */

describe("όρια: άνοιγμα συμπεριλαμβάνεται, κλείσιμο όχι", () => {
  const cfg = config({ mon: [iv("12:00", "16:00")] });

  it.each([
    ["11:59", false],
    ["12:00", true],
    ["15:59", true],
    ["16:00", false],
  ])("Δευτέρα %s → %s", (time, open) => {
    expect(isOpenAt(cfg, athens(MON, time))).toBe(open);
  });

  it("ένα χιλιοστό πριν το άνοιγμα: κλειστό· ένα πριν το κλείσιμο: ανοιχτό", () => {
    expect(isOpenAt(cfg, athens(MON, "12:00") - 1)).toBe(false);
    expect(isOpenAt(cfg, athens(MON, "16:00") - 1)).toBe(true);
  });

  it("πολλά διαστήματα την ίδια μέρα και η επόμενη αλλαγή", () => {
    const split = config({ mon: [iv("12:00", "16:00"), iv("18:00", "23:00")] });
    expect(isOpenAt(split, athens(MON, "17:00"))).toBe(false);
    expect(isOpenAt(split, athens(MON, "18:00"))).toBe(true);
    expect(scheduleStateAt(split, athens(MON, "13:00"))).toEqual({ open: true, nextChangeAt: athens(MON, "16:00") });
    expect(scheduleStateAt(split, athens(MON, "16:30"))).toEqual({ open: false, nextChangeAt: athens(MON, "18:00") });
  });

  it("διαστήματα που αγγίζονται (16:00–18:00, 18:00–20:00) = συνεχόμενο άνοιγμα", () => {
    const touching = config({ mon: [iv("16:00", "18:00"), iv("18:00", "20:00")] });
    expect(isOpenAt(touching, athens(MON, "18:00"))).toBe(true);
    expect(scheduleStateAt(touching, athens(MON, "17:00")).nextChangeAt).toBe(athens(MON, "20:00"));
  });

  it("00:00–24:00 και 00:00–00:00 = όλο το 24ωρο", () => {
    for (const close of ["24:00", "00:00"]) {
      const allDay = config({ mon: [iv("00:00", close)] });
      expect(isOpenAt(allDay, athens(MON, "00:00"))).toBe(true);
      expect(isOpenAt(allDay, athens(MON, "23:59"))).toBe(true);
      expect(isOpenAt(allDay, athens("2026-10-06", "00:00"))).toBe(false);
    }
  });
});

/* ==========================================================================
 *  Βραδινές βάρδιες
 * ========================================================================== */

describe("βραδινές βάρδιες (close < open)", () => {
  const cfg = config({ fri: [iv("18:00", "02:00")] });

  it("Παρασκευή 18:00 → Σάββατο 02:00", () => {
    expect(isOpenAt(cfg, athens(FRI, "17:59"))).toBe(false);
    expect(isOpenAt(cfg, athens(FRI, "18:00"))).toBe(true);
    expect(isOpenAt(cfg, athens(FRI, "23:59"))).toBe(true);
    expect(isOpenAt(cfg, athens(SAT, "00:00"))).toBe(true);
    expect(isOpenAt(cfg, athens(SAT, "01:59"))).toBe(true);
    expect(isOpenAt(cfg, athens(SAT, "02:00"))).toBe(false);
  });

  it("η επόμενη αλλαγή περνά τα μεσάνυχτα", () => {
    expect(scheduleStateAt(cfg, athens(FRI, "20:00")).nextChangeAt).toBe(athens(SAT, "02:00"));
  });

  it("Κυριακή βράδυ → Δευτέρα (κύκλος εβδομάδας)", () => {
    const sunday = config({ sun: [iv("20:00", "01:00")] });
    expect(isOpenAt(sunday, athens(NEXT_MON, "00:30"))).toBe(true);
    expect(isOpenAt(sunday, athens(NEXT_MON, "01:00"))).toBe(false);
  });

  it("συνέχεια βάρδιας + δικό της πρόγραμμα την επόμενη μέρα", () => {
    const both = config({ fri: [iv("18:00", "02:00")], sat: [iv("12:00", "16:00")] });
    expect(isOpenAt(both, athens(SAT, "01:00"))).toBe(true);
    expect(isOpenAt(both, athens(SAT, "11:00"))).toBe(false);
    expect(isOpenAt(both, athens(SAT, "12:00"))).toBe(true);
  });
});

/* ==========================================================================
 *  Αλλαγές ώρας
 * ========================================================================== */

describe("αλλαγές ώρας (DST)", () => {
  it("Μάρτιος: άνοιγμα 03:30 (ανύπαρκτη ώρα) ισχύει από τις 04:00 θερινή", () => {
    const cfg = config({ sun: [iv("03:30", "05:00")] });
    const jump = Date.UTC(2026, 2, 29, 1, 0); // 03:00 EET → 04:00 EEST
    expect(isOpenAt(cfg, jump - 1)).toBe(false); // 02:59:59 EET
    expect(isOpenAt(cfg, jump)).toBe(true); // 04:00 EEST
    expect(scheduleStateAt(cfg, Date.UTC(2026, 2, 29, 0, 30)).nextChangeAt).toBe(jump);
    expect(scheduleStateAt(cfg, jump).nextChangeAt).toBe(Date.UTC(2026, 2, 29, 2, 0)); // 05:00 EEST
  });

  it("Μάρτιος: κανονικό ωράριο εκείνη τη μέρα ακολουθεί τη θερινή ώρα", () => {
    const cfg = config({ sun: [iv("12:00", "16:00")] });
    expect(scheduleStateAt(cfg, athens("2026-03-28", "20:00")).nextChangeAt).toBe(Date.UTC(2026, 2, 29, 9, 0));
  });

  it("Οκτώβριος: κανονικό ωράριο εκείνη τη μέρα ακολουθεί τη χειμερινή ώρα", () => {
    const cfg = config({ sun: [iv("12:00", "16:00")] });
    expect(scheduleStateAt(cfg, athens("2026-10-24", "20:00")).nextChangeAt).toBe(Date.UTC(2026, 9, 25, 10, 0));
  });

  it("Οκτώβριος: βραδινή βάρδια ως τις 02:00 δεν επηρεάζεται από την αλλαγή στις 04:00", () => {
    const cfg = config({ sat: [iv("20:00", "02:00")] });
    expect(isOpenAt(cfg, Date.UTC(2026, 9, 24, 22, 59))).toBe(true); // 01:59 EEST Κυρ.
    expect(isOpenAt(cfg, Date.UTC(2026, 9, 24, 23, 0))).toBe(false); // 02:00 EEST
  });

  it("Οκτώβριος: η επαναλαμβανόμενη ώρα αξιολογείται με την ένδειξη του ρολογιού", () => {
    const cfg = config({ sun: [iv("03:30", "04:00")] });
    const first = Date.UTC(2026, 9, 25, 0, 30); // 03:30 EEST
    const back = Date.UTC(2026, 9, 25, 1, 0); // 04:00 EEST → 03:00 EET
    const second = Date.UTC(2026, 9, 25, 1, 30); // 03:30 EET
    expect(isOpenAt(cfg, first)).toBe(true);
    expect(isOpenAt(cfg, back)).toBe(false);
    expect(isOpenAt(cfg, second)).toBe(true);
    expect(scheduleStateAt(cfg, first).nextChangeAt).toBe(back);
    expect(scheduleStateAt(cfg, back).nextChangeAt).toBe(second);
  });
});

/* ==========================================================================
 *  Εξαιρέσεις ημερομηνιών
 * ========================================================================== */

describe("εξαιρέσεις ημερομηνιών", () => {
  const weekly = { fri: [iv("18:00", "02:00")], sat: [iv("12:00", "23:00")] };

  it("κλειστό όλη μέρα: αντικαθιστά το εβδομαδιαίο ΚΑΙ τη συνέχεια της Παρασκευής", () => {
    const cfg = config(weekly, [{ date: SAT, closed: true, intervals: [] }]);
    expect(isOpenAt(cfg, athens(FRI, "23:00"))).toBe(true); // η Παρασκευή μένει
    expect(isOpenAt(cfg, athens(SAT, "01:00"))).toBe(false); // συνέχεια κόβεται
    expect(isOpenAt(cfg, athens(SAT, "13:00"))).toBe(false);
    expect(scheduleStateAt(cfg, athens(FRI, "20:00")).nextChangeAt).toBe(athens(SAT, "00:00"));
  });

  it("ειδικό ωράριο: ισχύει μόνο αυτό τη συγκεκριμένη μέρα", () => {
    const cfg = config(weekly, [{ date: SAT, closed: false, intervals: [iv("10:00", "14:00")] }]);
    expect(isOpenAt(cfg, athens(SAT, "01:00"))).toBe(false);
    expect(isOpenAt(cfg, athens(SAT, "10:00"))).toBe(true);
    expect(isOpenAt(cfg, athens(SAT, "15:00"))).toBe(false);
    expect(isOpenAt(cfg, athens("2026-10-17", "15:00"))).toBe(true); // επόμενο Σάββατο: εβδομαδιαίο
  });

  it("η εξαίρεση μπορεί να κρατήσει ρητά τη συνέχεια (00:00–02:00)", () => {
    const cfg = config(weekly, [{ date: SAT, closed: false, intervals: [iv("00:00", "02:00")] }]);
    expect(isOpenAt(cfg, athens(SAT, "01:00"))).toBe(true);
    expect(isOpenAt(cfg, athens(SAT, "13:00"))).toBe(false);
  });

  it("βραδινή βάρδια ΜΙΑΣ εξαίρεσης συνεχίζει στην επόμενη μέρα", () => {
    const cfg = config({ thu: [iv("12:00", "16:00")] }, [
      { date: "2026-10-08", closed: false, intervals: [iv("20:00", "03:00")] },
    ]);
    expect(isOpenAt(cfg, athens(FRI, "02:30"))).toBe(true);
    expect(isOpenAt(cfg, athens(FRI, "03:00"))).toBe(false);
  });

  it("επόμενο άνοιγμα μετά από κλειστή εξαίρεση", () => {
    const cfg = config({ mon: [iv("12:00", "16:00")], tue: [iv("12:00", "16:00")] }, [
      { date: MON, closed: true, intervals: [], label: "Αργία" },
    ]);
    const state = scheduleStateAt(cfg, athens(MON, "13:00"));
    expect(state).toEqual({ open: false, nextChangeAt: athens("2026-10-06", "12:00") });
  });
});

/* ==========================================================================
 *  Επικύρωση
 * ========================================================================== */

function raw(overrides: Record<string, unknown> = {}) {
  return { enabled: true, weekly: emptyWeekly(), exceptions: [], ...overrides };
}

describe("επικύρωση ρύθμισης ωραρίου", () => {
  it("έγκυρη ρύθμιση → κανονική μορφή (ταξινόμηση διαστημάτων και εξαιρέσεων)", () => {
    const result = validateOpeningHours(
      raw({
        weekly: { ...emptyWeekly(), mon: [iv("18:00", "23:00"), iv("12:00", "16:00")] },
        exceptions: [
          { date: "2026-12-26", closed: true, intervals: [] },
          { date: "2026-12-25", closed: true, intervals: [], label: "  Χριστούγεννα  " },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.weekly.mon.map((interval) => interval.open)).toEqual(["12:00", "18:00"]);
    expect(result.config.exceptions.map((exception) => exception.date)).toEqual(["2026-12-25", "2026-12-26"]);
    expect(result.config.exceptions[0].label).toBe("Χριστούγεννα");
  });

  it.each([
    ["ώρα εκτός ορίων", { mon: [iv("25:00", "26:00")] }],
    ["κακή μορφή ώρας", { mon: [iv("9:00", "12:00")] }],
    ["ίδιο άνοιγμα/κλείσιμο", { mon: [iv("10:00", "10:00")] }],
    ["24:00 ως άνοιγμα", { mon: [iv("24:00", "02:00")] }],
    ["επικάλυψη ίδιας μέρας", { mon: [iv("12:00", "16:00"), iv("15:00", "18:00")] }],
    ["επικάλυψη με βραδινή βάρδια της ίδιας μέρας", { mon: [iv("18:00", "02:00"), iv("20:00", "22:00")] }],
    ["βραδινή βάρδια πάνω στην επόμενη μέρα", { fri: [iv("18:00", "03:00")], sat: [iv("02:00", "05:00")] }],
    ["Κυριακή → Δευτέρα επικάλυψη", { sun: [iv("22:00", "04:00")], mon: [iv("03:00", "05:00")] }],
    ["πάρα πολλά διαστήματα", { mon: [iv("01:00", "02:00"), iv("03:00", "04:00"), iv("05:00", "06:00"), iv("07:00", "08:00"), iv("09:00", "10:00")] }],
  ])("απορρίπτει: %s", (_label, weekly) => {
    const result = validateOpeningHours(raw({ weekly: { ...emptyWeekly(), ...weekly } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toMatch(/[Α-Ωα-ω]/);
  });

  it("απορρίπτει διπλή εξαίρεση για την ίδια ημερομηνία", () => {
    const result = validateOpeningHours(
      raw({
        exceptions: [
          { date: "2026-12-25", closed: true, intervals: [] },
          { date: "2026-12-25", closed: false, intervals: [iv("10:00", "12:00")] },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ path: "openingHours.exceptions.1.date" });
  });

  it.each([
    ["ανύπαρκτη ημερομηνία", { date: "2026-02-30", closed: true, intervals: [] }],
    ["κλειστή με ωράριο", { date: "2026-12-25", closed: true, intervals: [iv("10:00", "12:00")] }],
    ["ανοιχτή χωρίς ωράριο", { date: "2026-12-25", closed: false, intervals: [] }],
    ["άγνωστο πεδίο", { date: "2026-12-25", closed: true, intervals: [], hack: 1 }],
    ["πολύ μεγάλη σημείωση", { date: "2026-12-25", closed: true, intervals: [], label: "x".repeat(61) }],
  ])("απορρίπτει εξαίρεση: %s", (_label, exception) => {
    expect(validateOpeningHours(raw({ exceptions: [exception] })).ok).toBe(false);
  });

  it("βραδινή βάρδια εξαίρεσης πάνω στο εβδομαδιαίο της επόμενης μέρας → σφάλμα", () => {
    const result = validateOpeningHours(
      raw({
        weekly: { ...emptyWeekly(), sat: [iv("01:00", "05:00")] },
        exceptions: [{ date: FRI, closed: false, intervals: [iv("20:00", "02:00")] }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("όριο πλήθους εξαιρέσεων", () => {
    const exceptions = Array.from({ length: 41 }, (_, index) => ({
      date: `2027-01-${String((index % 28) + 1).padStart(2, "0")}`,
      closed: true,
      intervals: [],
    }));
    expect(validateOpeningHours(raw({ exceptions })).ok).toBe(false);
  });

  it.each([
    ["χωρίς enabled", { weekly: emptyWeekly(), exceptions: [] }],
    ["λείπει μέρα", raw({ weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] } })],
    ["άγνωστη μέρα", raw({ weekly: { ...emptyWeekly(), xyz: [] } })],
    ["string", "όλη μέρα"],
    ["άγνωστο πεδίο ρίζας", raw({ timezone: "UTC" })],
  ])("κακόμορφη ρύθμιση (%s) → invalid, ποτέ «ανοιχτό»", (_label, value) => {
    expect(parseOpeningHours(value).kind).toBe("invalid");
  });

  it("απόν/null πεδίο = χωρίς ωράριο (παλιά συμπεριφορά)", () => {
    expect(parseOpeningHours(undefined).kind).toBe("absent");
    expect(parseOpeningHours(null).kind).toBe("absent");
  });
});

/* ==========================================================================
 *  Κείμενα
 * ========================================================================== */

describe("κείμενα ωραρίου", () => {
  it("μορφοποίηση διαστημάτων", () => {
    expect(formatInterval(iv("12:00", "16:00"))).toBe("12:00–16:00");
    expect(formatInterval(iv("18:00", "02:00"))).toBe("18:00–02:00 (επόμενη μέρα)");
    expect(formatInterval(iv("00:00", "24:00"))).toBe("Όλο το 24ωρο");
    expect(formatInterval(iv("12:00", "00:00"))).toBe("12:00–24:00");
  });

  it("σχετικός χρόνος σε ώρα Αθήνας", () => {
    const now = athens(MON, "10:00");
    expect(formatRelativeShopTime(athens(MON, "18:00"), now)).toBe("σήμερα στις 18:00");
    expect(formatRelativeShopTime(athens("2026-10-06", "12:00"), now)).toBe("αύριο στις 12:00");
    expect(formatRelativeShopTime(athens(FRI, "12:00"), now)).toBe("την Παρασκευή στις 12:00");
    expect(formatRelativeShopTime(athens(SAT, "12:00"), now)).toBe("το Σάββατο στις 12:00");
    expect(formatRelativeShopTime(athens(NEXT_MON, "12:00"), now)).toBe("τη Δευτέρα 12/10 στις 12:00");
  });
});
