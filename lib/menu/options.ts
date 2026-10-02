/* ==========================================================================
 *  Buka Delivery — lib/menu/options.ts   (milestone 3)
 *
 *  Επιλογές προϊόντος: μέγεθος, έξτρα υλικά, αφαιρέσεις υλικών.
 *
 *  ΕΝΑ module για ΟΛΕΣ τις πλευρές, ώστε να μη διαφωνούν ποτέ:
 *    • φόρμα καταστηματάρχη      → validateOptionGroups(…, "write")
 *    • server εγγραφής καταλόγου → validateOptionGroups(…, "write")
 *    • βιτρίνα / διάλογος πελάτη → validateOptionGroups(…, "read") + resolveSelections
 *    • server checkout           → validateOptionGroups(…, "read") + resolveSelections
 *    • καλάθι / idempotency      → canonicalizeSelections + cartLineKey
 *
 *  ── ΜΟΝΤΕΛΟ (πεδίο `optionGroups` στο shops/{shopId}/menuItems/{itemId}) ──
 *    optionGroups: [{
 *      id, label,
 *      kind: "single" | "multiple" | "remove",
 *      required, minSelect, maxSelect,
 *      choices: [{ id, label, priceDelta, available }]
 *    }]
 *
 *    single   → ακριβώς ένα (υποχρεωτικό) ή έως ένα (προαιρετικό) — radio
 *    multiple → από minSelect έως maxSelect — checkboxes
 *    remove   → «Χωρίς …»: δωρεάν, προαιρετικό, όσα θέλει ο πελάτης
 *
 *  Τιμές: το `priceDelta` είναι σε ΕΥΡΩ, όπως το `price` του προϊόντος (η
 *  υπάρχουσα μονάδα αποθήκευσης), με έως 2 δεκαδικά, ≥ 0. Κάθε υπολογισμός
 *  γίνεται σε ακέραια λεπτά (lib/checkout/money.ts). Κάθε επιλογή χρεώνεται
 *  ΑΝΑ ΤΕΜΑΧΙΟ: μονάδα = βάση + Σ(επιλογών), γραμμή = μονάδα × ποσότητα.
 *
 *  Ταυτότητα: οι ομάδες και οι επιλογές αναγνωρίζονται ΜΟΝΟ από σταθερά ids —
 *  ποτέ από ετικέτα ή θέση. Μετονομασία ή αλλαγή σειράς δεν αλλάζει τίποτα
 *  στα καλάθια, στα αποτυπώματα idempotency ή στις αποθηκευμένες παραγγελίες.
 *
 *  Προϊόντα ΧΩΡΙΣ `optionGroups` δουλεύουν ακριβώς όπως πριν (καμία μετάπτωση).
 *
 *  Καθαρό module: κανένα import από Firebase, React ή Next.
 * ========================================================================== */

import type {
  MenuOptionChoice,
  MenuOptionGroup,
  MenuOptionKind,
  OptionSelection,
  OrderLineOption,
} from "@/types";
import { centsToEuros, isSafeCents, toCents } from "@/lib/checkout/money";
import { cleanSingleLine, normalizeForComparison } from "@/lib/checkout/validation";
import { formatPrice } from "@/lib/format";

/* ==========================================================================
 *  ΟΡΙΑ  (τεκμηριώνονται και στο CHANGES.md)
 * ========================================================================== */

export const OPTION_LIMITS = {
  /** Ομάδες ανά προϊόν (μαζί με την ομάδα αφαιρέσεων) */
  maxGroups: 8,
  /** Επιλογές ανά ομάδα */
  maxChoicesPerGroup: 12,
  /** Επιλογές ανά προϊόν, σε όλες τις ομάδες μαζί */
  maxChoicesTotal: 30,
  /** Επιλεγμένες επιλογές ανά γραμμή καλαθιού/αιτήματος */
  maxSelectionsPerLine: 30,
  /** Μήκος ids ομάδων/επιλογών ([A-Za-z0-9_-]) */
  idMax: 24,
  groupLabelMax: 40,
  choiceLabelMax: 40,
  /** Ανώτατη προσαύξηση μίας επιλογής, σε ευρώ */
  maxPriceDelta: 100,
  /** Μέγεθος JSON του optionGroups ενός προϊόντος (bytes UTF-8) */
  maxConfigBytes: 12_000,
} as const;

export const OPTION_KINDS: readonly MenuOptionKind[] = ["single", "multiple", "remove"];

export const OPTION_KIND_LABELS: Record<MenuOptionKind, string> = {
  single: "Μία επιλογή (π.χ. μέγεθος)",
  multiple: "Πολλές επιλογές (π.χ. έξτρα)",
  remove: "Αφαίρεση υλικών (δωρεάν)",
};

const OPTION_ID = /^[A-Za-z0-9_-]+$/;

export function isValidOptionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= OPTION_LIMITS.idMax &&
    OPTION_ID.test(value)
  );
}

/** Νέο σταθερό id (π.χ. «g7k2m9x4qa»). Το id δεν αλλάζει ποτέ μετά τη δημιουργία. */
export function generateOptionId(prefix: "g" | "c"): string {
  const cryptoApi = globalThis.crypto;
  const bytes = new Uint8Array(8);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return prefix + Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

/* ==========================================================================
 *  ΕΠΙΚΥΡΩΣΗ ΡΥΘΜΙΣΗΣ
 *
 *  "write": ό,τι πάει να αποθηκευτεί. Αυστηρό — περιλαμβάνει και τον έλεγχο
 *           «αδύνατη υποχρεωτική ομάδα» (λιγότερες διαθέσιμες επιλογές από το
 *           ελάχιστο) και το όριο bytes.
 *  "read":  ό,τι διαβάζεται από τη βάση (βιτρίνα, checkout). Ίδιοι κανόνες
 *           σχήματος/τιμών, ΑΛΛΑ μια υποχρεωτική ομάδα χωρίς αρκετές
 *           διαθέσιμες επιλογές δεν είναι σφάλμα ρύθμισης: σημαίνει «αυτή τη
 *           στιγμή δεν παραγγέλνεται» (isConfigurationOrderable).
 * ========================================================================== */

export type OptionConfigError = {
  /** π.χ. "groups", "groups.1.label", "groups.0.choices.2.priceDelta" */
  path: string;
  message: string;
};

export type OptionConfigResult =
  | { ok: true; groups: MenuOptionGroup[] }
  | { ok: false; errors: OptionConfigError[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Προσαύξηση σε ευρώ → λεπτά, ή null αν δεν είναι έγκυρη:
 * αριθμός, πεπερασμένος, 0 … maxPriceDelta, το πολύ 2 δεκαδικά.
 */
export function parsePriceDeltaCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > OPTION_LIMITS.maxPriceDelta) return null;
  const cents = toCents(value);
  if (!isSafeCents(cents)) return null;
  // Περισσότερα από 2 δεκαδικά (π.χ. 0.505) → άκυρο, όχι σιωπηλή στρογγυλοποίηση
  if (Math.abs(cents / 100 - value) > 1e-9) return null;
  return cents;
}

export function validateOptionGroups(
  raw: unknown,
  mode: "write" | "read",
): OptionConfigResult {
  /* Χωρίς επιλογές = το παλιό σχήμα. */
  if (raw === undefined || raw === null) return { ok: true, groups: [] };

  const errors: OptionConfigError[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  if (!Array.isArray(raw)) {
    return { ok: false, errors: [{ path: "groups", message: "Μη έγκυρη μορφή επιλογών." }] };
  }
  if (raw.length > OPTION_LIMITS.maxGroups) {
    return {
      ok: false,
      errors: [{ path: "groups", message: `Έως ${OPTION_LIMITS.maxGroups} ομάδες επιλογών ανά προϊόν.` }],
    };
  }

  const groupIds = new Set<string>();
  const choiceIds = new Set<string>();
  let totalChoices = 0;
  const groups: MenuOptionGroup[] = [];

  raw.forEach((entry, groupIndex) => {
    const at = (suffix: string) => `groups.${groupIndex}${suffix ? `.${suffix}` : ""}`;
    const group = asRecord(entry);
    if (!group) {
      fail(at(""), "Μη έγκυρη ομάδα επιλογών.");
      return;
    }

    /* ------------------------------ id ------------------------------ */
    if (!isValidOptionId(group.id)) {
      fail(at("id"), "Μη έγκυρο αναγνωριστικό ομάδας.");
    } else if (groupIds.has(group.id)) {
      fail(at("id"), "Διπλό αναγνωριστικό ομάδας.");
    } else {
      groupIds.add(group.id);
    }

    /* ---------------------------- ετικέτα ---------------------------- */
    const label = cleanSingleLine(group.label);
    if (!label) fail(at("label"), "Γράψε τίτλο ομάδας (π.χ. «Μέγεθος»).");
    else if (label.length > OPTION_LIMITS.groupLabelMax) {
      fail(at("label"), `Ο τίτλος ομάδας έχει έως ${OPTION_LIMITS.groupLabelMax} χαρακτήρες.`);
    }

    /* ----------------------------- είδος ----------------------------- */
    const kind = group.kind;
    if (!OPTION_KINDS.includes(kind as MenuOptionKind)) {
      fail(at("kind"), "Διάλεξε είδος ομάδας.");
      return;
    }

    /* ---------------------------- επιλογές --------------------------- */
    if (!Array.isArray(group.choices) || group.choices.length === 0) {
      fail(at("choices"), "Πρόσθεσε τουλάχιστον μία επιλογή στην ομάδα.");
      return;
    }
    if (group.choices.length > OPTION_LIMITS.maxChoicesPerGroup) {
      fail(at("choices"), `Έως ${OPTION_LIMITS.maxChoicesPerGroup} επιλογές ανά ομάδα.`);
      return;
    }
    totalChoices += group.choices.length;

    const labelsInGroup = new Set<string>();
    const choices: MenuOptionChoice[] = [];

    group.choices.forEach((choiceEntry: unknown, choiceIndex: number) => {
      const cat = (suffix: string) => at(`choices.${choiceIndex}.${suffix}`);
      const choice = asRecord(choiceEntry);
      if (!choice) {
        fail(at(`choices.${choiceIndex}`), "Μη έγκυρη επιλογή.");
        return;
      }

      if (!isValidOptionId(choice.id)) {
        fail(cat("id"), "Μη έγκυρο αναγνωριστικό επιλογής.");
      } else if (choiceIds.has(choice.id)) {
        fail(cat("id"), "Διπλό αναγνωριστικό επιλογής.");
      } else {
        choiceIds.add(choice.id);
      }

      const choiceLabel = cleanSingleLine(choice.label);
      if (!choiceLabel) {
        fail(cat("label"), kind === "remove" ? "Γράψε το υλικό (π.χ. «κρεμμύδι»)." : "Γράψε όνομα επιλογής.");
      } else if (choiceLabel.length > OPTION_LIMITS.choiceLabelMax) {
        fail(cat("label"), `Έως ${OPTION_LIMITS.choiceLabelMax} χαρακτήρες.`);
      } else {
        const normalized = normalizeForComparison(choiceLabel);
        if (labelsInGroup.has(normalized)) fail(cat("label"), "Υπάρχει ήδη επιλογή με αυτό το όνομα στην ομάδα.");
        labelsInGroup.add(normalized);
      }

      const priceDelta = choice.priceDelta === undefined && kind === "remove" ? 0 : choice.priceDelta;
      const cents = parsePriceDeltaCents(priceDelta);
      if (cents === null) {
        fail(
          cat("priceDelta"),
          `Δώσε έγκυρη προσαύξηση από 0 έως ${formatPrice(OPTION_LIMITS.maxPriceDelta)} (π.χ. 0,50).`,
        );
      } else if (kind === "remove" && cents !== 0) {
        fail(cat("priceDelta"), "Οι αφαιρέσεις υλικών είναι πάντα δωρεάν.");
      }

      /* Απόν πεδίο = διαθέσιμη (όπως το `available` του προϊόντος) */
      const available = choice.available === undefined ? true : choice.available;
      if (typeof available !== "boolean") fail(cat("available"), "Μη έγκυρη διαθεσιμότητα.");

      choices.push({
        id: typeof choice.id === "string" ? choice.id : "",
        label: choiceLabel,
        priceDelta: cents === null ? 0 : centsToEuros(cents),
        available: available !== false,
      });
    });

    /* ---------------------- υποχρεωτικό / όρια ----------------------- */
    const required = group.required;
    const minSelect = group.minSelect;
    const maxSelect = group.maxSelect;

    if (typeof required !== "boolean") {
      fail(at("required"), "Μη έγκυρη ρύθμιση «υποχρεωτικό».");
      return;
    }
    if (!isInteger(minSelect) || !isInteger(maxSelect)) {
      fail(at("minSelect"), "Δώσε ακέραιο ελάχιστο και μέγιστο αριθμό επιλογών.");
      return;
    }

    switch (kind as MenuOptionKind) {
      case "single":
        if (maxSelect !== 1 || minSelect !== (required ? 1 : 0)) {
          fail(at("minSelect"), "Στη «μία επιλογή» διαλέγεται ακριβώς μία (υποχρεωτικό) ή έως μία.");
        }
        break;
      case "multiple":
        if (maxSelect < 1 || maxSelect > choices.length) {
          fail(at("maxSelect"), `Το μέγιστο πρέπει να είναι από 1 έως ${choices.length} (όσες οι επιλογές).`);
        } else if (required && (minSelect < 1 || minSelect > maxSelect)) {
          fail(at("minSelect"), "Σε υποχρεωτική ομάδα το ελάχιστο είναι από 1 έως το μέγιστο.");
        } else if (!required && minSelect !== 0) {
          fail(at("minSelect"), "Σε προαιρετική ομάδα το ελάχιστο είναι 0. Αλλιώς σημείωσέ την ως υποχρεωτική.");
        }
        break;
      case "remove":
        if (required || minSelect !== 0 || maxSelect !== choices.length) {
          fail(at("required"), "Η αφαίρεση υλικών είναι πάντα προαιρετική, χωρίς όριο.");
        }
        break;
    }

    /* Αδύνατη υποχρεωτική ομάδα: ο πελάτης δεν θα μπορούσε ποτέ να παραγγείλει */
    if (mode === "write" && required) {
      const availableCount = choices.filter((choice) => choice.available).length;
      if (availableCount < minSelect) {
        fail(
          at("choices"),
          minSelect === 1
            ? "Η υποχρεωτική ομάδα χρειάζεται τουλάχιστον μία διαθέσιμη επιλογή."
            : `Η υποχρεωτική ομάδα χρειάζεται τουλάχιστον ${minSelect} διαθέσιμες επιλογές.`,
        );
      }
    }

    groups.push({
      id: typeof group.id === "string" ? group.id : "",
      label,
      kind: kind as MenuOptionKind,
      required,
      minSelect,
      maxSelect,
      choices,
    });
  });

  if (totalChoices > OPTION_LIMITS.maxChoicesTotal) {
    fail("groups", `Έως ${OPTION_LIMITS.maxChoicesTotal} επιλογές συνολικά ανά προϊόν.`);
  }

  if (errors.length > 0) return { ok: false, errors };

  if (mode === "write") {
    const bytes = new TextEncoder().encode(JSON.stringify(groups)).length;
    if (bytes > OPTION_LIMITS.maxConfigBytes) {
      return {
        ok: false,
        errors: [{ path: "groups", message: "Οι επιλογές είναι πολύ μεγάλες. Μείωσε ομάδες ή κείμενα." }],
      };
    }
  }

  return { ok: true, groups };
}

/** Μπορεί να παραγγελθεί ΤΩΡΑ; (κάθε υποχρεωτική ομάδα έχει αρκετές διαθέσιμες επιλογές) */
export function isConfigurationOrderable(groups: readonly MenuOptionGroup[]): boolean {
  return groups.every(
    (group) => group.choices.filter((choice) => choice.available).length >= group.minSelect,
  );
}

/* ==========================================================================
 *  ΕΠΙΛΟΓΕΣ ΤΟΥ ΠΕΛΑΤΗ — κανονική μορφή
 *
 *  Η κανονική μορφή είναι ΜΟΝΑΔΙΚΗ για ίδιες επιλογές, ανεξάρτητα από τη
 *  σειρά: ομάδες ταξινομημένες κατά id, επιλογές ταξινομημένες κατά id, χωρίς
 *  άδειες ομάδες. Πάνω της στηρίζονται: η ταυτότητα γραμμής καλαθιού, το
 *  αποτύπωμα idempotency του browser και το requestHash του server.
 * ========================================================================== */

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type SelectionsResult =
  | { ok: true; selections: OptionSelection[] }
  | { ok: false; error: string };

/**
 * Αυστηρή επικύρωση ΚΑΙ κανονικοποίηση. Διπλότυπα (ίδια ομάδα δύο φορές,
 * ίδια επιλογή δύο φορές) ΑΠΟΡΡΙΠΤΟΝΤΑΙ — δεν «διορθώνονται» σιωπηλά.
 */
export function canonicalizeSelections(raw: unknown): SelectionsResult {
  if (raw === undefined || raw === null) return { ok: true, selections: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Μη έγκυρες επιλογές προϊόντος." };
  if (raw.length > OPTION_LIMITS.maxGroups) {
    return { ok: false, error: "Πάρα πολλές ομάδες επιλογών." };
  }

  const seenGroups = new Set<string>();
  const seenChoices = new Set<string>();
  const selections: OptionSelection[] = [];
  let total = 0;

  for (const entry of raw) {
    const selection = asRecord(entry);
    if (!selection || !isValidOptionId(selection.groupId) || !Array.isArray(selection.choiceIds)) {
      return { ok: false, error: "Μη έγκυρες επιλογές προϊόντος." };
    }
    if (seenGroups.has(selection.groupId)) {
      return { ok: false, error: "Διπλή ομάδα επιλογών στο ίδιο προϊόν." };
    }
    seenGroups.add(selection.groupId);

    if (selection.choiceIds.length > OPTION_LIMITS.maxChoicesPerGroup) {
      return { ok: false, error: "Πάρα πολλές επιλογές σε μία ομάδα." };
    }

    const choiceIds: string[] = [];
    for (const choiceId of selection.choiceIds) {
      if (!isValidOptionId(choiceId)) return { ok: false, error: "Μη έγκυρη επιλογή προϊόντος." };
      if (seenChoices.has(choiceId)) return { ok: false, error: "Διπλή επιλογή στο ίδιο προϊόν." };
      seenChoices.add(choiceId);
      choiceIds.push(choiceId);
    }

    total += choiceIds.length;
    if (total > OPTION_LIMITS.maxSelectionsPerLine) {
      return { ok: false, error: "Πάρα πολλές επιλογές σε ένα προϊόν." };
    }

    if (choiceIds.length > 0) {
      selections.push({ groupId: selection.groupId, choiceIds: choiceIds.sort(byCodeUnit) });
    }
  }

  selections.sort((a, b) => byCodeUnit(a.groupId, b.groupId));
  return { ok: true, selections };
}

/**
 * Ταυτότητα γραμμής: ίδιο προϊόν + ίδιες (κανονικές) επιλογές = ίδια γραμμή.
 * Χωρίς επιλογές → απλώς το itemId (ίδιο με πριν το milestone 3).
 * Τα ids περιέχουν μόνο [A-Za-z0-9_-], οπότε τα | : ; , είναι ασφαλή διαχωριστικά.
 */
export function cartLineKey(itemId: string, selections: readonly OptionSelection[] = []): string {
  if (selections.length === 0) return itemId;
  return `${itemId}|${selections
    .map((selection) => `${selection.groupId}:${selection.choiceIds.join(",")}`)
    .join(";")}`;
}

/** Κανονικές επιλογές από ένα στιγμιότυπο επιλογών (καλάθι ή παραγγελία) */
export function selectionsFromOptions(options: readonly Pick<OrderLineOption, "groupId" | "choiceId">[]): OptionSelection[] {
  const byGroup = new Map<string, string[]>();
  for (const option of options) {
    const list = byGroup.get(option.groupId) ?? [];
    list.push(option.choiceId);
    byGroup.set(option.groupId, list);
  }
  return [...byGroup]
    .map(([groupId, choiceIds]) => ({ groupId, choiceIds: [...choiceIds].sort(byCodeUnit) }))
    .sort((a, b) => byCodeUnit(a.groupId, b.groupId));
}

/** Ταυτότητα γραμμής από itemId + στιγμιότυπο επιλογών */
export function lineKeyOf(line: { itemId: string; options?: readonly Pick<OrderLineOption, "groupId" | "choiceId">[] }): string {
  return cartLineKey(line.itemId, line.options ? selectionsFromOptions(line.options) : []);
}

/* ==========================================================================
 *  ΕΠΙΛΥΣΗ ΕΠΙΛΟΓΩΝ ΠΑΝΩ ΣΤΗΝ ΤΡΕΧΟΥΣΑ ΡΥΘΜΙΣΗ
 *
 *  Χρησιμοποιείται ΚΑΙ από τον διάλογο του πελάτη (για live τιμή/έλεγχο) ΚΑΙ
 *  από τον server (εξουσιοδοτημένα). Ετικέτες και τιμές προέρχονται ΜΟΝΟ από
 *  τη ρύθμιση — από τον πελάτη έρχονται μόνο ids.
 * ========================================================================== */

export type SelectionProblem =
  | { reason: "unknown_group"; groupId: string }
  | { reason: "unknown_choice"; groupId: string; choiceId: string; groupLabel: string }
  | { reason: "unavailable"; groupId: string; choiceId: string; groupLabel: string; choiceLabel: string }
  | { reason: "too_few"; groupId: string; groupLabel: string; min: number; selected: number }
  | { reason: "too_many"; groupId: string; groupLabel: string; max: number; selected: number };

export type ResolvedSelections =
  | { ok: true; options: OrderLineOption[]; extraCents: number }
  | { ok: false; problem: SelectionProblem };

export function resolveSelections(
  groups: readonly MenuOptionGroup[],
  selections: readonly OptionSelection[],
): ResolvedSelections {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const selectedByGroup = new Map<string, Set<string>>();

  /* 1. Κάθε επιλεγμένο id ανήκει στο ΣΥΓΚΕΚΡΙΜΕΝΟ προϊόν και στη ΣΥΓΚΕΚΡΙΜΕΝΗ ομάδα */
  for (const selection of selections) {
    const group = groupsById.get(selection.groupId);
    if (!group) return { ok: false, problem: { reason: "unknown_group", groupId: selection.groupId } };

    const choicesById = new Map(group.choices.map((choice) => [choice.id, choice]));
    for (const choiceId of selection.choiceIds) {
      const choice = choicesById.get(choiceId);
      if (!choice) {
        return {
          ok: false,
          problem: { reason: "unknown_choice", groupId: group.id, choiceId, groupLabel: group.label },
        };
      }
      if (!choice.available) {
        return {
          ok: false,
          problem: {
            reason: "unavailable",
            groupId: group.id,
            choiceId,
            groupLabel: group.label,
            choiceLabel: choice.label,
          },
        };
      }
    }
    selectedByGroup.set(group.id, new Set(selection.choiceIds));
  }

  /* 2. Όρια ανά ομάδα (με τη σειρά του καταλόγου) + στιγμιότυπο */
  const options: OrderLineOption[] = [];
  let extraCents = 0;

  for (const group of groups) {
    const selected = selectedByGroup.get(group.id) ?? new Set<string>();
    if (selected.size < group.minSelect) {
      return {
        ok: false,
        problem: { reason: "too_few", groupId: group.id, groupLabel: group.label, min: group.minSelect, selected: selected.size },
      };
    }
    if (selected.size > group.maxSelect) {
      return {
        ok: false,
        problem: { reason: "too_many", groupId: group.id, groupLabel: group.label, max: group.maxSelect, selected: selected.size },
      };
    }

    for (const choice of group.choices) {
      if (!selected.has(choice.id)) continue;
      const priceDeltaCents = group.kind === "remove" ? 0 : toCents(choice.priceDelta);
      extraCents += priceDeltaCents;
      options.push({
        groupId: group.id,
        groupLabel: group.label,
        kind: group.kind,
        choiceId: choice.id,
        label: choice.label,
        priceDelta: centsToEuros(priceDeltaCents),
        priceDeltaCents,
      });
    }
  }

  if (!isSafeCents(extraCents)) {
    return { ok: false, problem: { reason: "too_many", groupId: "", groupLabel: "", max: 0, selected: 0 } };
  }

  return { ok: true, options, extraCents };
}

/** Ελληνικό μήνυμα για τον πελάτη — ποτέ τεχνικά ids */
export function describeSelectionProblem(problem: SelectionProblem, itemName: string): string {
  switch (problem.reason) {
    case "unavailable":
      return `Η επιλογή «${problem.choiceLabel}» για «${itemName}» δεν είναι διαθέσιμη αυτή τη στιγμή. Επεξεργάσου το προϊόν στο καλάθι και διάλεξε κάτι άλλο.`;
    case "too_few":
      return `Το «${itemName}» χρειάζεται επιλογή στο «${problem.groupLabel}». Επεξεργάσου το προϊόν στο καλάθι.`;
    case "too_many":
    case "unknown_group":
    case "unknown_choice":
      return `Οι επιλογές για «${itemName}» άλλαξαν στον κατάλογο. Επεξεργάσου το προϊόν στο καλάθι και επιβεβαίωσε ξανά.`;
  }
}

/* ==========================================================================
 *  ΣΤΙΓΜΙΟΤΥΠΟ ΕΠΙΛΟΓΩΝ (καλάθι / αποθηκευμένη παραγγελία) — ανάγνωση
 * ========================================================================== */

/**
 * Αυστηρή ανάγνωση στιγμιότυπου επιλογών (localStorage καλαθιού, απάντηση
 * server). null = κακόμορφο. Επιστρέφει πάντα καθαρισμένα κείμενα.
 */
export function parseOptionSnapshot(raw: unknown): OrderLineOption[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > OPTION_LIMITS.maxSelectionsPerLine) return null;

  const seen = new Set<string>();
  const kindOfGroup = new Map<string, MenuOptionKind>();
  const countOfGroup = new Map<string, number>();
  const options: OrderLineOption[] = [];

  for (const entry of raw) {
    const option = asRecord(entry);
    if (!option) return null;
    if (!isValidOptionId(option.groupId) || !isValidOptionId(option.choiceId)) return null;
    if (seen.has(option.choiceId)) return null;
    seen.add(option.choiceId);

    if (!OPTION_KINDS.includes(option.kind as MenuOptionKind)) return null;
    const kind = option.kind as MenuOptionKind;
    const previousKind = kindOfGroup.get(option.groupId);
    if (previousKind && previousKind !== kind) return null;
    kindOfGroup.set(option.groupId, kind);
    const count = (countOfGroup.get(option.groupId) ?? 0) + 1;
    if (kind === "single" && count > 1) return null;
    countOfGroup.set(option.groupId, count);

    const groupLabel = cleanSingleLine(option.groupLabel);
    const label = cleanSingleLine(option.label);
    if (!groupLabel || groupLabel.length > OPTION_LIMITS.groupLabelMax) return null;
    if (!label || label.length > OPTION_LIMITS.choiceLabelMax) return null;

    const cents = parsePriceDeltaCents(option.priceDelta);
    if (cents === null) return null;
    if (option.priceDeltaCents !== undefined && option.priceDeltaCents !== cents) return null;
    if (kind === "remove" && cents !== 0) return null;

    options.push({
      groupId: option.groupId,
      groupLabel,
      kind,
      choiceId: option.choiceId,
      label,
      priceDelta: centsToEuros(cents),
      priceDeltaCents: cents,
    });
  }
  return options;
}

/**
 * Ανεκτική ανάγνωση για ΠΡΟΒΟΛΗ ιστορικών παραγγελιών: ό,τι δεν διαβάζεται
 * παραλείπεται, ποτέ δεν «σπάει» η οθόνη. (Τα ποσά της γραμμής προέρχονται
 * από τα δικά της πεδία, όχι από εδώ.)
 */
export function readOptionSnapshotForDisplay(raw: unknown): OrderLineOption[] {
  if (!Array.isArray(raw)) return [];
  const options: OrderLineOption[] = [];
  for (const entry of raw.slice(0, OPTION_LIMITS.maxSelectionsPerLine)) {
    const option = asRecord(entry);
    if (!option) continue;
    const label = cleanSingleLine(option.label);
    if (!label) continue;
    const kind = OPTION_KINDS.includes(option.kind as MenuOptionKind)
      ? (option.kind as MenuOptionKind)
      : "multiple";
    const cents =
      typeof option.priceDeltaCents === "number" && isSafeCents(option.priceDeltaCents)
        ? option.priceDeltaCents
        : parsePriceDeltaCents(option.priceDelta) ?? 0;
    options.push({
      groupId: typeof option.groupId === "string" ? option.groupId : "",
      groupLabel: cleanSingleLine(option.groupLabel),
      kind,
      choiceId: typeof option.choiceId === "string" ? option.choiceId : "",
      label: label.slice(0, OPTION_LIMITS.choiceLabelMax),
      priceDelta: centsToEuros(cents),
      priceDeltaCents: cents,
    });
  }
  return options;
}

/* ==========================================================================
 *  ΠΕΡΙΓΡΑΦΗ ΓΙΑ ΠΡΟΒΟΛΗ
 *    «Μέγεθος: Μεγάλη (+1,00€)»
 *    «Έξτρα: Τυρί (+0,50€), Μπέικον (+0,80€)»
 *    «Χωρίς: κρεμμύδι, ντομάτα»
 * ========================================================================== */

export function formatOptionLines(options: readonly OrderLineOption[]): string[] {
  const groups: Array<{ key: string; kind: MenuOptionKind; label: string; parts: string[] }> = [];

  for (const option of options) {
    const key = `${option.groupId}\u0000${option.groupLabel}`;
    let group = groups.find((entry) => entry.key === key);
    if (!group) {
      group = { key, kind: option.kind, label: option.groupLabel, parts: [] };
      groups.push(group);
    }
    group.parts.push(
      option.priceDeltaCents > 0
        ? `${option.label} (+${formatPrice(centsToEuros(option.priceDeltaCents))})`
        : option.label,
    );
  }

  return groups.map((group) =>
    group.kind === "remove"
      ? `Χωρίς: ${group.parts.join(", ")}`
      : `${group.label || "Επιλογή"}: ${group.parts.join(", ")}`,
  );
}

/** Οδηγία για την ομάδα στον διάλογο του πελάτη */
export function describeGroupRule(group: MenuOptionGroup): string {
  if (group.kind === "remove") return "Προαιρετικό · δωρεάν";
  if (group.kind === "single") return group.required ? "Υποχρεωτικό · διάλεξε 1" : "Προαιρετικό · έως 1";
  if (group.required) {
    return group.minSelect === group.maxSelect
      ? `Υποχρεωτικό · διάλεξε ${group.minSelect}`
      : `Υποχρεωτικό · διάλεξε ${group.minSelect} έως ${group.maxSelect}`;
  }
  return `Προαιρετικό · έως ${group.maxSelect}`;
}

/* ==========================================================================
 *  ΚΑΤΑΣΤΑΣΗ ΦΟΡΜΑΣ ΤΟΥ ΔΙΑΛΟΓΟΥ (groupId → ids)
 * ========================================================================== */

/** Inline μηνύματα ανά ομάδα για τον διάλογο του πελάτη (κενό = όλα σωστά) */
export function selectionStateErrors(
  groups: readonly MenuOptionGroup[],
  state: Readonly<Record<string, readonly string[]>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const group of groups) {
    const available = new Set(group.choices.filter((choice) => choice.available).map((choice) => choice.id));
    const selected = (state[group.id] ?? []).filter((id) => group.choices.some((choice) => choice.id === id));
    if (selected.some((id) => !available.has(id))) {
      errors[group.id] = "Κάποια επιλογή δεν είναι πια διαθέσιμη — διάλεξε κάτι άλλο.";
    } else if (selected.length < group.minSelect) {
      errors[group.id] =
        group.kind === "single" || group.minSelect === 1
          ? "Διάλεξε μία επιλογή για να συνεχίσεις."
          : `Διάλεξε τουλάχιστον ${group.minSelect} επιλογές.`;
    } else if (selected.length > group.maxSelect) {
      errors[group.id] = `Διάλεξε έως ${group.maxSelect}.`;
    }
  }
  return errors;
}

/** Κατάσταση φόρμας → ids προς αποστολή (μόνο υπαρκτές ομάδες/επιλογές) */
export function selectionsFromState(
  groups: readonly MenuOptionGroup[],
  state: Readonly<Record<string, readonly string[]>>,
): OptionSelection[] {
  const raw = groups
    .map((group) => ({
      groupId: group.id,
      choiceIds: group.choices
        .filter((choice) => (state[group.id] ?? []).includes(choice.id))
        .map((choice) => choice.id),
    }))
    .filter((selection) => selection.choiceIds.length > 0);
  const canonical = canonicalizeSelections(raw);
  return canonical.ok ? canonical.selections : [];
}

/**
 * Αρχική κατάσταση για «Επεξεργασία επιλογών»: κρατά ΜΟΝΟ ό,τι υπάρχει
 * ακόμη και είναι διαθέσιμο. Επιστρέφει και πόσα από τα παλιά χάθηκαν, ώστε
 * ο διάλογος να το πει ρητά στον πελάτη (δεν τα πετάμε σιωπηλά).
 */
export function stateFromSelections(
  groups: readonly MenuOptionGroup[],
  selections: readonly OptionSelection[],
): { state: Record<string, string[]>; dropped: number } {
  const state: Record<string, string[]> = {};
  let dropped = 0;
  for (const selection of selections) {
    const group = groups.find((entry) => entry.id === selection.groupId);
    if (!group) {
      dropped += selection.choiceIds.length;
      continue;
    }
    const kept: string[] = [];
    for (const choiceId of selection.choiceIds) {
      const choice = group.choices.find((entry) => entry.id === choiceId);
      if (choice && choice.available && kept.length < group.maxSelect) kept.push(choiceId);
      else dropped += 1;
    }
    if (kept.length > 0) state[group.id] = kept;
  }
  return { state, dropped };
}

/** Τιμή μονάδας (λεπτά) για τη ζωντανή ένδειξη — μετρά μόνο διαθέσιμες, υπαρκτές επιλογές */
export function previewUnitCents(
  baseCents: number,
  groups: readonly MenuOptionGroup[],
  state: Readonly<Record<string, readonly string[]>>,
): number {
  let total = baseCents;
  for (const group of groups) {
    if (group.kind === "remove") continue;
    for (const choice of group.choices) {
      if (choice.available && (state[group.id] ?? []).includes(choice.id)) total += toCents(choice.priceDelta);
    }
  }
  return total;
}
