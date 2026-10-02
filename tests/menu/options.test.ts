/* ==========================================================================
 *  Milestone 3 — μοντέλο επιλογών: επικύρωση ρύθμισης, κανονική μορφή,
 *  επίλυση επιλογών, τιμολόγηση σε λεπτά, στιγμιότυπα.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import {
  OPTION_LIMITS,
  canonicalizeSelections,
  cartLineKey,
  formatOptionLines,
  isConfigurationOrderable,
  parseOptionSnapshot,
  parsePriceDeltaCents,
  readOptionSnapshotForDisplay,
  resolveSelections,
  selectionStateErrors,
  stateFromSelections,
  validateOptionGroups,
} from "@/lib/menu/options";
import type { MenuOptionGroup } from "@/types";
import { pizzaGroups } from "../fixtures/menu-options";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function withGroup(mutate: (groups: MenuOptionGroup[]) => void): unknown {
  const groups = clone(pizzaGroups());
  mutate(groups);
  return groups;
}

function pathsOf(result: ReturnType<typeof validateOptionGroups>): string[] {
  return result.ok ? [] : result.errors.map((error) => error.path);
}

/* ========================================================================== */

describe("ρύθμιση επιλογών — έγκυρη", () => {
  it("δέχεται μέγεθος (single), έξτρα (multiple) και αφαιρέσεις (remove)", () => {
    const result = validateOptionGroups(pizzaGroups(), "write");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.groups.map((group) => group.kind)).toEqual(["single", "multiple", "remove"]);
  });

  it("χωρίς πεδίο (παλιά προϊόντα) = καμία ομάδα, χωρίς μετάπτωση", () => {
    expect(validateOptionGroups(undefined, "read")).toEqual({ ok: true, groups: [] });
    expect(validateOptionGroups(null, "write")).toEqual({ ok: true, groups: [] });
  });

  it("καθαρίζει ετικέτες και στρογγυλές τιμές σε λεπτά", () => {
    const result = validateOptionGroups(
      withGroup((groups) => {
        groups[0].label = "  Μέγεθος‮ ";
      }),
      "write",
    );
    expect(result.ok && result.groups[0].label).toBe("Μέγεθος");
  });

  it("απόν `available` σε επιλογή = διαθέσιμη", () => {
    const raw = withGroup((groups) => {
      delete (groups[1].choices[0] as Partial<{ available: boolean }>).available;
    });
    const result = validateOptionGroups(raw, "read");
    expect(result.ok && result.groups[1].choices[0].available).toBe(true);
  });
});

describe("ρύθμιση επιλογών — απορρίψεις", () => {
  it.each([
    ["διπλό id ομάδας", (g: MenuOptionGroup[]) => { g[1].id = "size"; }, "groups.1.id"],
    ["διπλό id επιλογής σε άλλη ομάδα", (g: MenuOptionGroup[]) => { g[1].choices[0].id = "s"; }, "groups.1.choices.0.id"],
    ["id με «/»", (g: MenuOptionGroup[]) => { g[0].id = "a/b"; }, "groups.0.id"],
    ["κενή ετικέτα ομάδας", (g: MenuOptionGroup[]) => { g[0].label = "   "; }, "groups.0.label"],
    ["ετικέτα > 40", (g: MenuOptionGroup[]) => { g[0].choices[0].label = "α".repeat(41); }, "groups.0.choices.0.label"],
    ["ίδια ετικέτα στην ομάδα (τόνοι/πεζά)", (g: MenuOptionGroup[]) => { g[0].choices[1].label = "ΜΙΚΡΉ"; }, "groups.0.choices.1.label"],
    ["αρνητική προσαύξηση", (g: MenuOptionGroup[]) => { g[1].choices[0].priceDelta = -0.5; }, "groups.1.choices.0.priceDelta"],
    ["3 δεκαδικά", (g: MenuOptionGroup[]) => { g[1].choices[0].priceDelta = 0.505; }, "groups.1.choices.0.priceDelta"],
    ["NaN", (g: MenuOptionGroup[]) => { g[1].choices[0].priceDelta = Number.NaN; }, "groups.1.choices.0.priceDelta"],
    ["πάνω από το ταβάνι", (g: MenuOptionGroup[]) => { g[1].choices[0].priceDelta = 100.01; }, "groups.1.choices.0.priceDelta"],
    ["χρεωμένη αφαίρεση", (g: MenuOptionGroup[]) => { g[2].choices[0].priceDelta = 0.2; }, "groups.2.choices.0.priceDelta"],
    ["single με max 2", (g: MenuOptionGroup[]) => { g[0].maxSelect = 2; }, "groups.0.minSelect"],
    ["υποχρεωτικό single με min 0", (g: MenuOptionGroup[]) => { g[0].minSelect = 0; }, "groups.0.minSelect"],
    ["multiple: max > πλήθος", (g: MenuOptionGroup[]) => { g[1].maxSelect = 4; }, "groups.1.maxSelect"],
    ["multiple: max 0", (g: MenuOptionGroup[]) => { g[1].maxSelect = 0; }, "groups.1.maxSelect"],
    ["προαιρετικό με min 1", (g: MenuOptionGroup[]) => { g[1].minSelect = 1; }, "groups.1.minSelect"],
    ["υποχρεωτικό με min > max", (g: MenuOptionGroup[]) => { g[1].required = true; g[1].minSelect = 3; g[1].maxSelect = 2; }, "groups.1.minSelect"],
    ["remove υποχρεωτικό", (g: MenuOptionGroup[]) => { g[2].required = true; }, "groups.2.required"],
    ["ομάδα χωρίς επιλογές", (g: MenuOptionGroup[]) => { g[1].choices = []; }, "groups.1.choices"],
    ["άγνωστο είδος", (g: MenuOptionGroup[]) => { (g[1] as { kind: string }).kind = "radio"; }, "groups.1.kind"],
    ["μη ακέραιο όριο", (g: MenuOptionGroup[]) => { g[1].maxSelect = 1.5; }, "groups.1.minSelect"],
  ])("%s", (_name, mutate, path) => {
    const result = validateOptionGroups(withGroup(mutate), "write");
    expect(result.ok).toBe(false);
    expect(pathsOf(result)).toContain(path);
  });

  it("αδύνατη υποχρεωτική ομάδα: απορρίπτεται στην εγγραφή, όχι στην ανάγνωση", () => {
    const raw = withGroup((groups) => {
      groups[0].choices.forEach((choice) => (choice.available = false));
    });
    expect(pathsOf(validateOptionGroups(raw, "write"))).toContain("groups.0.choices");

    const read = validateOptionGroups(raw, "read");
    expect(read.ok).toBe(true);
    if (read.ok) expect(isConfigurationOrderable(read.groups)).toBe(false);
  });

  it("υποχρεωτικό multiple με min 2 χρειάζεται 2 διαθέσιμες", () => {
    const raw = withGroup((groups) => {
      groups[1].required = true;
      groups[1].minSelect = 3; // 2 διαθέσιμες μόνο
    });
    expect(pathsOf(validateOptionGroups(raw, "write"))).toContain("groups.1.choices");
  });

  it("όρια πλήθους: ομάδες, επιλογές ανά ομάδα, σύνολο", () => {
    const many = Array.from({ length: OPTION_LIMITS.maxGroups + 1 }, (_, index) => ({
      ...pizzaGroups()[2],
      id: `g${index}`,
      choices: [{ id: `c${index}`, label: "x", priceDelta: 0, available: true }],
      maxSelect: 1,
    }));
    expect(validateOptionGroups(many, "write").ok).toBe(false);

    const wide = withGroup((groups) => {
      groups[1].choices = Array.from({ length: OPTION_LIMITS.maxChoicesPerGroup + 1 }, (_, index) => ({
        id: `w${index}`,
        label: `Υλικό ${index}`,
        priceDelta: 0,
        available: true,
      }));
    });
    expect(pathsOf(validateOptionGroups(wide, "write"))).toContain("groups.1.choices");

    const total = Array.from({ length: 3 }, (_, groupIndex) => ({
      id: `t${groupIndex}`,
      label: `Ομάδα ${groupIndex}`,
      kind: "remove",
      required: false,
      minSelect: 0,
      maxSelect: 11,
      choices: Array.from({ length: 11 }, (_, index) => ({
        id: `t${groupIndex}c${index}`,
        label: `Υλικό ${index}`,
        priceDelta: 0,
        available: true,
      })),
    }));
    expect(pathsOf(validateOptionGroups(total, "write"))).toContain("groups");
  });

  it.each([["όχι λίστα", { a: 1 }], ["string", "x"], ["λίστα με null", [null]]])("κακόμορφη ρίζα: %s", (_n, raw) => {
    expect(validateOptionGroups(raw, "read").ok).toBe(false);
  });
});

describe("προσαυξήσεις — ακέραια λεπτά", () => {
  it.each([
    [0, 0],
    [0.1, 10],
    [0.29, 29],
    [1.15, 115],
    [100, 10_000],
  ])("%s€ → %s λεπτά", (euros, cents) => {
    expect(parsePriceDeltaCents(euros)).toBe(cents);
  });

  it.each([[-0.01], [100.01], [0.005], [Infinity], ["0.5"], [null]])("άκυρο: %s", (value) => {
    expect(parsePriceDeltaCents(value)).toBeNull();
  });
});

/* ========================================================================== */

describe("κανονική μορφή επιλογών", () => {
  it("η σειρά ομάδων/επιλογών δεν αλλάζει την ταυτότητα", () => {
    const a = canonicalizeSelections([
      { groupId: "extras", choiceIds: ["bacon", "cheese"] },
      { groupId: "size", choiceIds: ["l"] },
    ]);
    const b = canonicalizeSelections([
      { groupId: "size", choiceIds: ["l"] },
      { groupId: "extras", choiceIds: ["cheese", "bacon"] },
    ]);
    expect(a).toEqual(b);
    expect(a.ok && cartLineKey("pizza", a.selections)).toBe("pizza|extras:bacon,cheese;size:l");
  });

  it("άδειες ομάδες παραλείπονται· χωρίς επιλογές το κλειδί είναι το itemId", () => {
    const result = canonicalizeSelections([{ groupId: "extras", choiceIds: [] }]);
    expect(result).toEqual({ ok: true, selections: [] });
    expect(cartLineKey("pizza", [])).toBe("pizza");
  });

  it.each([
    ["διπλή ομάδα", [{ groupId: "a", choiceIds: ["x"] }, { groupId: "a", choiceIds: ["y"] }]],
    ["διπλή επιλογή", [{ groupId: "a", choiceIds: ["x", "x"] }]],
    ["ίδια επιλογή σε δύο ομάδες", [{ groupId: "a", choiceIds: ["x"] }, { groupId: "b", choiceIds: ["x"] }]],
    ["άκυρο id", [{ groupId: "a/b", choiceIds: ["x"] }]],
    ["μη λίστα choiceIds", [{ groupId: "a", choiceIds: "x" }]],
    ["όχι λίστα", { groupId: "a" }],
    ["id > 24", [{ groupId: "a".repeat(25), choiceIds: ["x"] }]],
  ])("απορρίπτει: %s", (_name, raw) => {
    expect(canonicalizeSelections(raw).ok).toBe(false);
  });

  it("όριο επιλογών ανά γραμμή", () => {
    const raw = Array.from({ length: 3 }, (_, groupIndex) => ({
      groupId: `g${groupIndex}`,
      choiceIds: Array.from({ length: 11 }, (_, index) => `g${groupIndex}c${index}`),
    }));
    expect(canonicalizeSelections(raw).ok).toBe(false);
  });
});

/* ========================================================================== */

describe("επίλυση επιλογών + τιμή", () => {
  const groups = pizzaGroups();

  it("μέγεθος + έξτρα + αφαίρεση: 5 + 1 + 0,50 = 6,50 ανά τεμάχιο", () => {
    const result = resolveSelections(groups, [
      { groupId: "size", choiceIds: ["l"] },
      { groupId: "extras", choiceIds: ["cheese"] },
      { groupId: "without", choiceIds: ["onion"] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(500 + result.extraCents).toBe(650);
    expect(result.options.map((option) => [option.groupLabel, option.label, option.priceDeltaCents])).toEqual([
      ["Μέγεθος", "Μεγάλη", 100],
      ["Έξτρα", "Τυρί", 50],
      ["Αφαίρεση υλικών", "κρεμμύδι", 0],
    ]);
  });

  it("δωρεάν αφαιρέσεις δεν αλλάζουν την τιμή", () => {
    const result = resolveSelections(groups, [
      { groupId: "size", choiceIds: ["s"] },
      { groupId: "without", choiceIds: ["onion", "tomato"] },
    ]);
    expect(result.ok && result.extraCents).toBe(0);
  });

  it("η υποχρεωτική επιλογή ΔΕΝ επιλέγεται σιωπηλά", () => {
    const result = resolveSelections(groups, []);
    expect(result).toMatchObject({ ok: false, problem: { reason: "too_few", groupId: "size" } });
  });

  it("δύο μεγέθη σε single → too_many", () => {
    expect(resolveSelections(groups, [{ groupId: "size", choiceIds: ["l", "s"] }])).toMatchObject({
      ok: false,
      problem: { reason: "too_many", groupId: "size" },
    });
  });

  it("άγνωστη ομάδα / επιλογή άλλης ομάδας → unknown_*", () => {
    expect(resolveSelections(groups, [{ groupId: "ghost", choiceIds: ["x"] }])).toMatchObject({
      ok: false,
      problem: { reason: "unknown_group" },
    });
    expect(resolveSelections(groups, [{ groupId: "size", choiceIds: ["cheese"] }])).toMatchObject({
      ok: false,
      problem: { reason: "unknown_choice" },
    });
  });

  it("μη διαθέσιμη επιλογή → unavailable", () => {
    expect(
      resolveSelections(groups, [
        { groupId: "size", choiceIds: ["l"] },
        { groupId: "extras", choiceIds: ["mush"] },
      ]),
    ).toMatchObject({ ok: false, problem: { reason: "unavailable", choiceLabel: "Μανιτάρια" } });
  });

  it("η σειρά του στιγμιότυπου ακολουθεί τον κατάλογο, όχι την αίτηση", () => {
    const result = resolveSelections(groups, [
      { groupId: "without", choiceIds: ["tomato"] },
      { groupId: "extras", choiceIds: ["bacon", "cheese"] },
      { groupId: "size", choiceIds: ["s"] },
    ]);
    expect(result.ok && result.options.map((option) => option.choiceId)).toEqual(["s", "cheese", "bacon", "tomato"]);
  });
});

/* ========================================================================== */

describe("στιγμιότυπα και περιγραφή", () => {
  const options = [
    { groupId: "size", groupLabel: "Μέγεθος", kind: "single" as const, choiceId: "l", label: "Μεγάλη", priceDelta: 1, priceDeltaCents: 100 },
    { groupId: "extras", groupLabel: "Έξτρα", kind: "multiple" as const, choiceId: "cheese", label: "Τυρί", priceDelta: 0.5, priceDeltaCents: 50 },
    { groupId: "extras", groupLabel: "Έξτρα", kind: "multiple" as const, choiceId: "bacon", label: "Μπέικον", priceDelta: 0.8, priceDeltaCents: 80 },
    { groupId: "without", groupLabel: "Αφαίρεση υλικών", kind: "remove" as const, choiceId: "onion", label: "κρεμμύδι", priceDelta: 0, priceDeltaCents: 0 },
  ];

  it("ελληνική περιγραφή ανά ομάδα", () => {
    expect(formatOptionLines(options)).toEqual([
      "Μέγεθος: Μεγάλη (+1,00€)",
      "Έξτρα: Τυρί (+0,50€), Μπέικον (+0,80€)",
      "Χωρίς: κρεμμύδι",
    ]);
  });

  it("αυστηρή ανάγνωση: δέχεται έγκυρο, απορρίπτει πειραγμένο", () => {
    expect(parseOptionSnapshot(options)).toEqual(options);
    expect(parseOptionSnapshot([{ ...options[0], priceDeltaCents: 1 }])).toBeNull(); // ασυνέπεια ευρώ/λεπτών
    expect(parseOptionSnapshot([options[1], options[1]])).toBeNull(); // διπλή
    expect(parseOptionSnapshot([options[0], { ...options[0], choiceId: "s" }])).toBeNull(); // 2 σε single
    expect(parseOptionSnapshot([{ ...options[3], priceDelta: 0.5, priceDeltaCents: 50 }])).toBeNull(); // χρεωμένη αφαίρεση
    expect(parseOptionSnapshot([{ ...options[0], label: "" }])).toBeNull();
    expect(parseOptionSnapshot("x")).toBeNull();
  });

  it("ανεκτική ανάγνωση για ιστορικές οθόνες: ποτέ δεν σπάει", () => {
    expect(readOptionSnapshotForDisplay(undefined)).toEqual([]);
    expect(readOptionSnapshotForDisplay([null, 3, { label: "Τυρί", priceDelta: 0.5 }])).toEqual([
      expect.objectContaining({ label: "Τυρί", priceDeltaCents: 50 }),
    ]);
  });
});

describe("κατάσταση διαλόγου", () => {
  const groups = pizzaGroups();

  it("μηνύματα ανά ομάδα: λείπει υποχρεωτικό", () => {
    expect(selectionStateErrors(groups, {})).toEqual({ size: "Διάλεξε μία επιλογή για να συνεχίσεις." });
    expect(selectionStateErrors(groups, { size: ["l"] })).toEqual({});
  });

  it("επεξεργασία: κρατά μόνο ό,τι υπάρχει και είναι διαθέσιμο, μετρά τα υπόλοιπα", () => {
    const result = stateFromSelections(groups, [
      { groupId: "size", choiceIds: ["xl"] }, // μη διαθέσιμο
      { groupId: "extras", choiceIds: ["cheese", "gone"] }, // ένα δεν υπάρχει
      { groupId: "removed-group", choiceIds: ["a"] },
    ]);
    expect(result.state).toEqual({ extras: ["cheese"] });
    expect(result.dropped).toBe(3);
  });
});
