/* ==========================================================================
 *  Buka Delivery — lib/shop/settings-form.ts   (milestone 4)
 *
 *  Μοντέλο φόρμας για τις ρυθμίσεις ωραρίου/ζωνών του καταστηματάρχη:
 *  πρόχειρα (drafts) όπως τα πληκτρολογεί ο χρήστης ↔ ρυθμίσεις όπως τις
 *  αποθηκεύει ο server. Καθαρό module (χωρίς React), ώστε να δοκιμάζεται.
 *
 *  Τα μηνύματα λάθους είναι τα ΙΔΙΑ με του server (ίδιοι validators), ώστε ο
 *  καταστηματάρχης να βλέπει inline ό,τι θα απέρριπτε ο server.
 * ========================================================================== */

import type { DeliveryZonesConfig, OpeningHoursConfig, Shop } from "@/types";
import { toCents } from "@/lib/checkout/money";
import {
  DELIVERY_ZONE_LIMITS,
  generateZoneId,
  validateDeliveryZones,
} from "@/lib/shop/delivery-zones";
import { WEEKDAY_KEYS, validateOpeningHours, type ShopSettingsError } from "@/lib/shop/opening-hours";
import { formatPostalCode, parsePostalCodeList } from "@/lib/shop/postal-code";

/* ==========================================================================
 *  ΩΡΑΡΙΟ
 * ========================================================================== */

/** Προεπιλογή για κατάστημα χωρίς ωράριο: 12:00–23:00 κάθε μέρα, ΑΝΕΝΕΡΓΟ */
export function defaultOpeningHours(): OpeningHoursConfig {
  const weekly = Object.fromEntries(
    WEEKDAY_KEYS.map((key) => [key, [{ open: "12:00", close: "23:00" }]]),
  ) as OpeningHoursConfig["weekly"];
  return { enabled: false, weekly, exceptions: [] };
}

/** Λάθη ομαδοποιημένα ανά διαδρομή (π.χ. "openingHours.weekly.fri") */
export function errorsByPrefix(errors: readonly ShopSettingsError[], prefix: string): string[] {
  return errors
    .filter((error) => error.path === prefix || error.path.startsWith(`${prefix}.`))
    .map((error) => error.message);
}

export function checkOpeningHoursDraft(draft: OpeningHoursConfig): ShopSettingsError[] {
  const result = validateOpeningHours(draft);
  return result.ok ? [] : result.errors;
}

/** Ενεργό ωράριο χωρίς κανένα διάστημα = πάντα κλειστό — προειδοποίηση, όχι σφάλμα */
export function isAlwaysClosed(draft: OpeningHoursConfig): boolean {
  return (
    draft.enabled &&
    WEEKDAY_KEYS.every((key) => draft.weekly[key].length === 0) &&
    draft.exceptions.every((exception) => exception.closed)
  );
}

/* ==========================================================================
 *  ΠΟΣΑ (ευρώ ως κείμενο → λεπτά)
 * ========================================================================== */

/** «2,50» / «2.5» / «3» → λεπτά· κενό → null· οτιδήποτε άλλο → NaN */
export function parseEuroInput(text: string): number | null {
  const trimmed = text.trim().replace(/\s+/g, "");
  if (!trimmed) return null;
  if (!/^\d{1,4}([.,]\d{1,2})?$/.test(trimmed)) return Number.NaN;
  return toCents(Number(trimmed.replace(",", ".")));
}

export function formatEuroInput(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/* ==========================================================================
 *  ΖΩΝΕΣ
 * ========================================================================== */

export type ZoneDraft = {
  id: string;
  name: string;
  available: boolean;
  /** Ελεύθερο κείμενο: ΤΚ χωρισμένοι με κόμμα ή αλλαγή γραμμής */
  postalCodesText: string;
  deliveryFee: string;
  minOrder: string;
  /** Κενό = χωρίς δωρεάν μεταφορικά */
  freeDeliveryOver: string;
};

export type ZoneDraftField = "name" | "postalCodes" | "deliveryFee" | "minOrder" | "freeDeliveryOver";

export function zoneToDraft(zone: DeliveryZonesConfig["zones"][number]): ZoneDraft {
  return {
    id: zone.id,
    name: zone.name,
    available: zone.available,
    postalCodesText: zone.postalCodes.map(formatPostalCode).join(", "),
    deliveryFee: formatEuroInput(zone.deliveryFeeCents),
    minOrder: formatEuroInput(zone.minOrderCents),
    freeDeliveryOver: formatEuroInput(zone.freeDeliveryOverCents),
  };
}

/** Νέα ζώνη: τα ποσά ξεκινούν από τους ΓΕΝΙΚΟΥΣ όρους του καταστήματος */
export function newZoneDraft(
  shop: Pick<Shop, "minOrder" | "deliveryFee" | "freeDeliveryOver">,
  index: number,
  generateId: () => string = generateZoneId,
): ZoneDraft {
  const euros = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? formatEuroInput(toCents(value)) : "";
  return {
    id: generateId(),
    name: `Ζώνη ${index + 1}`,
    available: true,
    postalCodesText: "",
    deliveryFee: euros(shop.deliveryFee) || "0,00",
    minOrder: euros(shop.minOrder) || "0,00",
    freeDeliveryOver: shop.freeDeliveryOver === null ? "" : euros(shop.freeDeliveryOver),
  };
}

export type ZonesDraftCheck = {
  /** Η ρύθμιση που θα σταλεί (null αν η φόρμα έχει λάθη πεδίων) */
  config: DeliveryZonesConfig | null;
  /** Λάθη ανά ζώνη (id) και πεδίο */
  fieldErrors: Record<string, Partial<Record<ZoneDraftField, string>>>;
  /** Λάθη για όλη τη ρύθμιση (π.χ. «καμία ζώνη») */
  generalErrors: string[];
};

const MONEY_ERRORS: Record<"deliveryFee" | "minOrder" | "freeDeliveryOver", string> = {
  deliveryFee: `Γράψε ποσό από 0 έως ${DELIVERY_ZONE_LIMITS.maxDeliveryFeeCents / 100}€ (π.χ. 1,50).`,
  minOrder: `Γράψε ποσό από 0 έως ${DELIVERY_ZONE_LIMITS.maxMinOrderCents / 100}€ (π.χ. 8,00).`,
  freeDeliveryOver: `Γράψε ποσό έως ${DELIVERY_ZONE_LIMITS.maxFreeDeliveryOverCents / 100}€ ή άφησέ το κενό.`,
};

/**
 * Πρόχειρο → ρύθμιση + λάθη. Πρώτα τα λάθη ΠΕΔΙΩΝ (ποσά, ΤΚ), μετά ο ίδιος
 * validator με τον server (μοναδικότητα ΤΚ σε ΟΛΕΣ τις ζώνες, όρια).
 */
export function checkZonesDraft(enabled: boolean, drafts: readonly ZoneDraft[]): ZonesDraftCheck {
  const fieldErrors: ZonesDraftCheck["fieldErrors"] = {};
  const setError = (id: string, field: ZoneDraftField, message: string) => {
    fieldErrors[id] = { ...fieldErrors[id], [field]: fieldErrors[id]?.[field] ?? message };
  };

  const zones = drafts.map((draft) => {
    const codes = parsePostalCodeList(draft.postalCodesText);
    if (codes.invalid.length > 0) {
      setError(
        draft.id,
        "postalCodes",
        `Μη έγκυροι ΤΚ: ${codes.invalid.slice(0, 5).join(", ")}. Κάθε ΤΚ έχει 5 ψηφία (π.χ. 546 22).`,
      );
    } else if (codes.duplicates.length > 0) {
      setError(draft.id, "postalCodes", `Γράφτηκαν δύο φορές: ${codes.duplicates.join(", ")}.`);
    }

    const fee = parseEuroInput(draft.deliveryFee);
    const min = parseEuroInput(draft.minOrder);
    const free = parseEuroInput(draft.freeDeliveryOver);
    if (fee === null || Number.isNaN(fee) || fee > DELIVERY_ZONE_LIMITS.maxDeliveryFeeCents) {
      setError(draft.id, "deliveryFee", MONEY_ERRORS.deliveryFee);
    }
    if (min === null || Number.isNaN(min) || min > DELIVERY_ZONE_LIMITS.maxMinOrderCents) {
      setError(draft.id, "minOrder", MONEY_ERRORS.minOrder);
    }
    if (free !== null && (Number.isNaN(free) || free <= 0 || free > DELIVERY_ZONE_LIMITS.maxFreeDeliveryOverCents)) {
      setError(draft.id, "freeDeliveryOver", MONEY_ERRORS.freeDeliveryOver);
    }

    return {
      id: draft.id,
      name: draft.name,
      available: draft.available,
      postalCodes: codes.codes,
      deliveryFeeCents: fee === null || Number.isNaN(fee) ? -1 : fee,
      minOrderCents: min === null || Number.isNaN(min) ? -1 : min,
      freeDeliveryOverCents: free === null ? null : Number.isNaN(free) ? -1 : free,
    };
  });

  const generalErrors: string[] = [];
  const result = validateDeliveryZones({ enabled, zones }, "write");
  if (!result.ok) {
    for (const error of result.errors) {
      const match = /^deliveryZones\.zones\.(\d+)\.(\w+)/.exec(error.path);
      const draft = match ? drafts[Number(match[1])] : undefined;
      const field = match?.[2];
      if (draft && field === "name") setError(draft.id, "name", error.message);
      else if (draft && field === "postalCodes") setError(draft.id, "postalCodes", error.message);
      else if (draft && field === "deliveryFeeCents") setError(draft.id, "deliveryFee", MONEY_ERRORS.deliveryFee);
      else if (draft && field === "minOrderCents") setError(draft.id, "minOrder", MONEY_ERRORS.minOrder);
      else if (draft && field === "freeDeliveryOverCents") {
        setError(draft.id, "freeDeliveryOver", MONEY_ERRORS.freeDeliveryOver);
      } else if (!generalErrors.includes(error.message)) generalErrors.push(error.message);
    }
  }

  const hasErrors = Object.keys(fieldErrors).length > 0 || generalErrors.length > 0;
  return { config: hasErrors || !result.ok ? null : result.config, fieldErrors, generalErrors };
}

/** Λάθη του server (path) → λάθη πεδίων της φόρμας ζωνών */
export function mapServerZoneErrors(
  errors: readonly ShopSettingsError[],
  drafts: readonly ZoneDraft[],
): Pick<ZonesDraftCheck, "fieldErrors" | "generalErrors"> {
  const fieldErrors: ZonesDraftCheck["fieldErrors"] = {};
  const generalErrors: string[] = [];
  const fieldOf: Record<string, ZoneDraftField> = {
    name: "name",
    postalCodes: "postalCodes",
    deliveryFeeCents: "deliveryFee",
    minOrderCents: "minOrder",
    freeDeliveryOverCents: "freeDeliveryOver",
  };
  for (const error of errors) {
    const match = /^deliveryZones\.zones\.(\d+)\.(\w+)/.exec(error.path);
    const draft = match ? drafts[Number(match[1])] : undefined;
    const field = match ? fieldOf[match[2]] : undefined;
    if (draft && field) fieldErrors[draft.id] = { ...fieldErrors[draft.id], [field]: error.message };
    else generalErrors.push(error.message);
  }
  return { fieldErrors, generalErrors };
}
