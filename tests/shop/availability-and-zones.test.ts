/* ==========================================================================
 *  Διαθεσιμότητα, ΤΚ, ζώνες και φόρμα ρυθμίσεων (milestone 4) — καθαρή
 *  λογική, χωρίς Firebase.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import { evaluateShopAvailability, readManualPause } from "@/lib/shop/availability";
import {
  findZoneByPostalCode,
  parseDeliveryZones,
  readDeliveryTermsSnapshot,
  requiresPostalCode,
  resolveDeliveryTerms,
  validateDeliveryZones,
} from "@/lib/shop/delivery-zones";
import { emptyWeekly } from "@/lib/shop/opening-hours";
import { formatPostalCode, normalizePostalCode, parsePostalCodeList } from "@/lib/shop/postal-code";
import {
  checkZonesDraft,
  defaultOpeningHours,
  isAlwaysClosed,
  newZoneDraft,
  parseEuroInput,
  zoneToDraft,
} from "@/lib/shop/settings-form";
import { instantsForWallTime } from "@/lib/shop/timezone";

const athens = (date: string, time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return instantsForWallTime(date, hours * 60 + minutes)[0];
};

const HOURS = { enabled: true, weekly: { ...emptyWeekly(), mon: [{ open: "12:00", close: "16:00" }] }, exceptions: [] };
const MONDAY_NOON = athens("2026-10-05", "13:00");

/* ==========================================================================
 *  Διαθεσιμότητα
 * ========================================================================== */

describe("διαθεσιμότητα καταστήματος", () => {
  it("χειροκίνητη παύση: μόνο το boolean false", () => {
    expect(readManualPause(undefined)).toBe(false);
    expect(readManualPause(null)).toBe(false);
    expect(readManualPause(true)).toBe(false);
    expect(readManualPause(false)).toBe(true);
    expect(readManualPause("false")).toBe("invalid");
    expect(readManualPause(0)).toBe("invalid");
  });

  it("παλιό κατάστημα (χωρίς active/ωράριο) → ανοιχτό, όπως πριν", () => {
    expect(evaluateShopAvailability({ name: "x" }, MONDAY_NOON)).toMatchObject({ state: "open", scheduled: false, nextChangeAt: null });
  });

  it("παλιό κλειστό κατάστημα (active: false) ΜΕΝΕΙ κλειστό", () => {
    expect(evaluateShopAvailability({ active: false }, MONDAY_NOON).state).toBe("paused");
  });

  it("η παύση υπερισχύει ανοιχτού ωραρίου — και κακόμορφου", () => {
    expect(evaluateShopAvailability({ active: false, openingHours: HOURS }, MONDAY_NOON).state).toBe("paused");
    expect(evaluateShopAvailability({ active: false, openingHours: "χαλασμένο" }, MONDAY_NOON).state).toBe("paused");
  });

  it("κακόμορφο ωράριο ή active → unavailable (ποτέ open)", () => {
    expect(evaluateShopAvailability({ openingHours: { enabled: "ναι" } }, MONDAY_NOON).state).toBe("unavailable");
    expect(evaluateShopAvailability({ active: "true" }, MONDAY_NOON).state).toBe("unavailable");
  });

  it("ωράριο ανοιχτό/κλειστό με επόμενες αλλαγές", () => {
    const open = evaluateShopAvailability({ active: true, openingHours: HOURS }, MONDAY_NOON);
    expect(open).toMatchObject({ state: "open", scheduled: true, closesAt: athens("2026-10-05", "16:00") });
    const closed = evaluateShopAvailability({ openingHours: HOURS }, athens("2026-10-05", "17:00"));
    expect(closed).toMatchObject({ state: "closed", nextOpenAt: athens("2026-10-12", "12:00") });
  });

  it("ενεργό ωράριο χωρίς διαστήματα → κλειστό χωρίς επόμενο άνοιγμα", () => {
    const closed = evaluateShopAvailability({ openingHours: { ...HOURS, weekly: emptyWeekly() } }, MONDAY_NOON);
    expect(closed).toMatchObject({ state: "closed", nextOpenAt: null, nextChangeAt: null });
  });
});

/* ==========================================================================
 *  Ταχυδρομικοί κώδικες
 * ========================================================================== */

describe("ταχυδρομικοί κώδικες", () => {
  it.each([
    ["54622", "54622"],
    ["546 22", "54622"],
    [" 546 22 ", "54622"],
    ["546 22", "54622"],
    ["５４６２２", "54622"],
    ["01234", "01234"],
    ["012 34", "01234"],
  ])("«%s» → %s", (input, expected) => {
    expect(normalizePostalCode(input)).toBe(expected);
  });

  it.each([["5462"], ["546222"], ["546-22"], ["54Α22"], ["ΤΚ 54622"], [""], ["  "]])(
    "απορρίπτει «%s»",
    (input) => {
      expect(normalizePostalCode(input)).toBeNull();
    },
  );

  it("δεν δέχεται αριθμούς (θα έχαναν τα αρχικά μηδενικά)", () => {
    expect(normalizePostalCode(1234)).toBeNull();
    expect(normalizePostalCode(54622)).toBeNull();
  });

  it("μορφοποίηση για εμφάνιση", () => {
    expect(formatPostalCode("54622")).toBe("546 22");
    expect(formatPostalCode("01234")).toBe("012 34");
  });

  it("λίστα ΤΚ από ελεύθερο κείμενο: το κενό ΔΕΝ χωρίζει ΤΚ", () => {
    expect(parsePostalCodeList("546 22, 54623\n55131; 546 22, abc")).toEqual({
      codes: ["54622", "54623", "55131"],
      invalid: ["abc"],
      duplicates: ["54622"],
    });
  });
});

/* ==========================================================================
 *  Ζώνες
 * ========================================================================== */

const ZONE = {
  id: "zc",
  name: "Κέντρο",
  available: true,
  postalCodes: ["54622"],
  deliveryFeeCents: 150,
  minOrderCents: 800,
  freeDeliveryOverCents: 2000,
};

describe("ζώνες παράδοσης", () => {
  it("στη βάση οι ΤΚ πρέπει να είναι ήδη κανονικοί (read)", () => {
    expect(validateDeliveryZones({ enabled: true, zones: [{ ...ZONE, postalCodes: ["546 22"] }] }, "read").ok).toBe(false);
    expect(validateDeliveryZones({ enabled: true, zones: [{ ...ZONE, postalCodes: ["546 22"] }] }, "write").ok).toBe(true);
  });

  it("ένας ΤΚ σε μία ζώνη — και όταν η άλλη είναι ανενεργή", () => {
    const result = validateDeliveryZones(
      { enabled: true, zones: [ZONE, { ...ZONE, id: "zo", name: "Άλλη", available: false }] },
      "write",
    );
    expect(result.ok).toBe(false);
  });

  it("διπλό id ζώνης → σφάλμα", () => {
    expect(validateDeliveryZones({ enabled: true, zones: [ZONE, { ...ZONE, postalCodes: ["54623"] }] }, "write").ok).toBe(false);
  });

  it("όριο ΤΚ ανά ζώνη και συνολικά", () => {
    const many = Array.from({ length: 201 }, (_, index) => String(10000 + index));
    expect(validateDeliveryZones({ enabled: true, zones: [{ ...ZONE, postalCodes: many }] }, "write").ok).toBe(false);
    const zones = Array.from({ length: 6 }, (_, zone) => ({
      ...ZONE,
      id: `z${zone}`,
      postalCodes: Array.from({ length: 200 }, (_, index) => String(10000 + zone * 1000 + index)),
    }));
    expect(validateDeliveryZones({ enabled: true, zones }, "write").ok).toBe(false);
  });

  it("ενεργός περιορισμός χωρίς ζώνες: άκυρος για εγγραφή, «καμία περιοχή» στην ανάγνωση", () => {
    expect(validateDeliveryZones({ enabled: true, zones: [] }, "write").ok).toBe(false);
    expect(resolveDeliveryTerms({ deliveryZones: { enabled: true, zones: [] } }, "54622")).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
  });

  it("εύρεση ζώνης ΤΚ", () => {
    const parsed = parseDeliveryZones({ enabled: true, zones: [ZONE] });
    if (parsed.kind !== "config") throw new Error("invalid");
    expect(findZoneByPostalCode(parsed.config, "54622")?.id).toBe("zc");
    expect(findZoneByPostalCode(parsed.config, "54623")).toBeNull();
  });

  describe("resolveDeliveryTerms", () => {
    const shop = { minOrder: 5, deliveryFee: 1, freeDeliveryOver: null, deliveryZones: { enabled: true, zones: [ZONE] } };

    it("ζώνη του ΤΚ", () => {
      expect(resolveDeliveryTerms(shop, "546 22")).toMatchObject({
        ok: true,
        terms: { deliveryFeeCents: 150, minOrderCents: 800, freeDeliveryOverCents: 2000 },
        snapshot: { mode: "zone", zoneId: "zc", postalCode: "54622" },
      });
    });

    it("χωρίς ΤΚ → postal_code_required", () => {
      expect(resolveDeliveryTerms(shop, null)).toMatchObject({ ok: false, reason: "postal_code_required" });
      expect(requiresPostalCode(shop)).toBe(true);
    });

    it("ζώνες ανενεργές ή απούσες → γενικοί όροι (παλιά συμπεριφορά)", () => {
      for (const deliveryZones of [undefined, null, { enabled: false, zones: [ZONE] }]) {
        const result = resolveDeliveryTerms({ ...shop, deliveryZones }, null);
        expect(result).toMatchObject({ ok: true, terms: { deliveryFeeCents: 100, minOrderCents: 500, freeDeliveryOverCents: null } });
        expect(requiresPostalCode({ ...shop, deliveryZones })).toBe(false);
      }
    });

    it("κακόμορφες ζώνες → zones_config_invalid (ΟΧΙ γενικοί όροι)", () => {
      expect(resolveDeliveryTerms({ ...shop, deliveryZones: { enabled: true } }, "54622")).toMatchObject({
        ok: false,
        reason: "zones_config_invalid",
      });
      expect(requiresPostalCode({ ...shop, deliveryZones: "x" })).toBe(true);
    });
  });

  it("ανάγνωση στιγμιότυπου παραγγελίας: παλιές/κακόμορφες → null", () => {
    expect(readDeliveryTermsSnapshot(undefined)).toBeNull();
    expect(readDeliveryTermsSnapshot({ mode: "zone", zoneId: "zc" })).toBeNull();
    expect(
      readDeliveryTermsSnapshot({
        mode: "zone",
        zoneId: "zc",
        zoneName: "Κέντρο",
        postalCode: "54622",
        deliveryFeeCents: 150,
        minOrderCents: 800,
        freeDeliveryOverCents: null,
      }),
    ).toMatchObject({ mode: "zone", zoneName: "Κέντρο" });
  });
});

/* ==========================================================================
 *  Φόρμα ρυθμίσεων
 * ========================================================================== */

describe("φόρμα ρυθμίσεων καταστηματάρχη", () => {
  it("ποσά σε ευρώ → λεπτά", () => {
    expect(parseEuroInput("2,50")).toBe(250);
    expect(parseEuroInput("2.5")).toBe(250);
    expect(parseEuroInput("3")).toBe(300);
    expect(parseEuroInput("")).toBeNull();
    expect(parseEuroInput("2,505")).toBeNaN();
    expect(parseEuroInput("-1")).toBeNaN();
    expect(parseEuroInput("δύο")).toBeNaN();
  });

  it("νέα ζώνη: ποσά από τους γενικούς όρους του καταστήματος", () => {
    const draft = newZoneDraft({ minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 }, 0, () => "znew");
    expect(draft).toMatchObject({ id: "znew", deliveryFee: "1,50", minOrder: "8,00", freeDeliveryOver: "20,00", available: true });
    expect(newZoneDraft({ minOrder: 0, deliveryFee: 0, freeDeliveryOver: null }, 1, () => "z2").freeDeliveryOver).toBe("");
  });

  it("έλεγχος προχείρου: ρητές τιμές, ΤΚ κανονικοποιημένοι", () => {
    const draft = { ...zoneToDraft(ZONE), postalCodesText: "546 22, 54623" };
    const check = checkZonesDraft(true, [draft]);
    expect(check.config).toEqual({
      enabled: true,
      zones: [{ ...ZONE, postalCodes: ["54622", "54623"] }],
    });
  });

  it("λάθη ανά πεδίο και διπλός ΤΚ σε δύο ζώνες", () => {
    const a = { ...zoneToDraft(ZONE), deliveryFee: "1,555" };
    const b = { ...zoneToDraft({ ...ZONE, id: "zb", name: "Β" }), postalCodesText: "546 22, xyz" };
    const check = checkZonesDraft(true, [a, b]);
    expect(check.config).toBeNull();
    expect(check.fieldErrors.zc?.deliveryFee).toBeTruthy();
    expect(check.fieldErrors.zb?.postalCodes).toContain("xyz");

    const dup = checkZonesDraft(true, [zoneToDraft(ZONE), zoneToDraft({ ...ZONE, id: "zb", name: "Β" })]);
    expect(dup.fieldErrors.zb?.postalCodes).toContain("ανήκει ήδη");
  });

  it("προεπιλεγμένο ωράριο: ανενεργό· «πάντα κλειστό» προειδοποίηση", () => {
    expect(defaultOpeningHours().enabled).toBe(false);
    expect(isAlwaysClosed({ enabled: true, weekly: emptyWeekly(), exceptions: [] })).toBe(true);
    expect(isAlwaysClosed({ ...defaultOpeningHours(), enabled: true })).toBe(false);
  });
});
