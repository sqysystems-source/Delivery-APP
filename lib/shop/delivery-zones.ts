/* ==========================================================================
 *  Buka Delivery — lib/shop/delivery-zones.ts   (milestone 4)
 *
 *  Ζώνες παράδοσης με βάση ελληνικούς ταχυδρομικούς κώδικες.
 *
 *  ── ΤΙ ΕΙΝΑΙ (ΚΑΙ ΤΙ ΔΕΝ ΕΙΝΑΙ) ─────────────────────────────────────────
 *  Η συμμετοχή του ΤΚ σε ζώνη είναι ο ΜΟΝΟΣ έλεγχος περιοχής εξυπηρέτησης.
 *  ΔΕΝ επαληθεύει ότι η οδός ανήκει στον ΤΚ, ούτε τη θέση του πελάτη, ούτε
 *  απόσταση. Δεν υπάρχουν χάρτες, geocoding ή GPS.
 *
 *  ── ΚΑΝΟΝΕΣ ─────────────────────────────────────────────────────────────
 *  • Κάθε ζώνη: σταθερό id, όνομα, διαθεσιμότητα, ρητή λίστα ΤΚ, μεταφορικά,
 *    ελάχιστο υποσύνολο προϊόντων και προαιρετικό όριο δωρεάν μεταφορικών —
 *    όλα σε ΑΚΕΡΑΙΑ λεπτά.
 *  • Ένας ΤΚ ανήκει σε ΤΟ ΠΟΛΥ μία ζώνη (και όταν η ζώνη είναι ανενεργή).
 *  • Περιορισμός ανενεργός ή καμία ρύθμιση → ισχύουν τα γενικά μεταφορικά /
 *    ελάχιστη του καταστήματος, όπως πριν το milestone 4.
 *  • Κακόμορφη ρύθμιση → ποτέ σιωπηλή επιστροφή στα γενικά μεταφορικά:
 *    ελεγχόμενο σφάλμα ρύθμισης.
 *
 *  Καθαρό module: κανένα import από Firebase, React ή Next.
 * ========================================================================== */

import type { DeliveryTermsSnapshot, DeliveryZone, DeliveryZonesConfig } from "@/types";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import { centsToEuros, parseShopTerms, type ShopTermsCents } from "@/lib/checkout/money";
import { formatDeliveryFee, formatPrice } from "@/lib/format";
import { cleanSingleLine } from "@/lib/checkout/validation";
import { isNormalizedPostalCode, normalizePostalCode } from "@/lib/shop/postal-code";
import type { ShopSettingsError } from "@/lib/shop/opening-hours";

/* ==========================================================================
 *  ΟΡΙΑ
 * ========================================================================== */

export const DELIVERY_ZONE_LIMITS = {
  maxZones: 20,
  maxPostalCodesPerZone: 200,
  maxPostalCodesTotal: 1_000,
  nameMax: 40,
  /** Μήκος id ζώνης ([A-Za-z0-9_-]) */
  idMax: 24,
  /** Ίδια ταβάνια με τους γενικούς όρους του καταστήματος (CHECKOUT_LIMITS) */
  maxDeliveryFeeCents: CHECKOUT_LIMITS.maxDeliveryFee * 100,
  maxMinOrderCents: CHECKOUT_LIMITS.maxMinOrder * 100,
  maxFreeDeliveryOverCents: CHECKOUT_LIMITS.maxFreeDeliveryOver * 100,
} as const;

const ZONE_ID = /^[A-Za-z0-9_-]+$/;

export function isValidZoneId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= DELIVERY_ZONE_LIMITS.idMax &&
    ZONE_ID.test(value)
  );
}

/** Νέο σταθερό id ζώνης (π.χ. «z7k2m9x4qa»). Δεν αλλάζει ποτέ μετά τη δημιουργία. */
export function generateZoneId(): string {
  const cryptoApi = globalThis.crypto;
  const bytes = new Uint8Array(9);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  return "z" + Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

/* ==========================================================================
 *  ΕΠΙΚΥΡΩΣΗ
 * ========================================================================== */

export type DeliveryZonesResult =
  | { ok: true; config: DeliveryZonesConfig }
  | { ok: false; errors: ShopSettingsError[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isCents(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

const ZONE_KEYS = new Set([
  "id",
  "name",
  "available",
  "postalCodes",
  "deliveryFeeCents",
  "minOrderCents",
  "freeDeliveryOverCents",
]);

/**
 * Επικυρώνει ΟΛΗ τη ρύθμιση ζωνών και επιστρέφει κανονική μορφή (ΤΚ
 * κανονικοποιημένοι και ταξινομημένοι, καθαρά ονόματα).
 *
 *   "write": ό,τι πάει να αποθηκευτεί (server endpoint). Επιπλέον απαιτεί
 *            τουλάχιστον μία ζώνη όταν ο περιορισμός είναι ενεργός.
 *   "read":  ό,τι διαβάζεται (checkout, βιτρίνα). Ενεργός περιορισμός χωρίς
 *            ζώνες σημαίνει «κανένας ΤΚ δεν εξυπηρετείται» — όχι γενικά μεταφορικά.
 */
export function validateDeliveryZones(raw: unknown, mode: "write" | "read"): DeliveryZonesResult {
  const errors: ShopSettingsError[] = [];
  const root = asRecord(raw);
  if (!root) return { ok: false, errors: [{ path: "deliveryZones", message: "Μη έγκυρη ρύθμιση ζωνών." }] };

  if (Object.keys(root).some((key) => key !== "enabled" && key !== "zones")) {
    errors.push({ path: "deliveryZones", message: "Άγνωστο πεδίο στη ρύθμιση ζωνών." });
  }
  if (typeof root.enabled !== "boolean") {
    errors.push({ path: "deliveryZones.enabled", message: "Μη έγκυρη ενεργοποίηση ζωνών." });
  }
  if (!Array.isArray(root.zones)) {
    errors.push({ path: "deliveryZones.zones", message: "Μη έγκυρη λίστα ζωνών." });
    return { ok: false, errors };
  }
  if (root.zones.length > DELIVERY_ZONE_LIMITS.maxZones) {
    errors.push({
      path: "deliveryZones.zones",
      message: `Έως ${DELIVERY_ZONE_LIMITS.maxZones} ζώνες.`,
    });
    return { ok: false, errors };
  }
  if (mode === "write" && root.enabled === true && root.zones.length === 0) {
    errors.push({
      path: "deliveryZones.zones",
      message: "Πρόσθεσε τουλάχιστον μία ζώνη ή απενεργοποίησε τον περιορισμό ΤΚ.",
    });
  }

  const zones: DeliveryZone[] = [];
  const seenIds = new Set<string>();
  /** ΤΚ → όνομα ζώνης όπου εμφανίστηκε πρώτα */
  const owner = new Map<string, string>();
  let totalCodes = 0;

  root.zones.forEach((entry, index) => {
    const path = `deliveryZones.zones.${index}`;
    const zone = asRecord(entry);
    if (!zone || Object.keys(zone).some((key) => !ZONE_KEYS.has(key))) {
      errors.push({ path, message: "Μη έγκυρη ζώνη." });
      return;
    }

    if (!isValidZoneId(zone.id)) {
      errors.push({ path: `${path}.id`, message: "Μη έγκυρο αναγνωριστικό ζώνης." });
      return;
    }
    if (seenIds.has(zone.id)) {
      errors.push({ path: `${path}.id`, message: "Δύο ζώνες έχουν το ίδιο αναγνωριστικό." });
      return;
    }
    seenIds.add(zone.id);

    const name = typeof zone.name === "string" ? cleanSingleLine(zone.name) : "";
    if (!name) {
      errors.push({ path: `${path}.name`, message: "Δώσε όνομα στη ζώνη (π.χ. «Κέντρο»)." });
    } else if (name.length > DELIVERY_ZONE_LIMITS.nameMax) {
      errors.push({ path: `${path}.name`, message: `Το όνομα είναι έως ${DELIVERY_ZONE_LIMITS.nameMax} χαρακτήρες.` });
    }

    if (typeof zone.available !== "boolean") {
      errors.push({ path: `${path}.available`, message: "Μη έγκυρη διαθεσιμότητα ζώνης." });
    }

    if (!isCents(zone.deliveryFeeCents, DELIVERY_ZONE_LIMITS.maxDeliveryFeeCents)) {
      errors.push({
        path: `${path}.deliveryFeeCents`,
        message: `Τα μεταφορικά είναι από 0€ έως ${DELIVERY_ZONE_LIMITS.maxDeliveryFeeCents / 100}€.`,
      });
    }
    if (!isCents(zone.minOrderCents, DELIVERY_ZONE_LIMITS.maxMinOrderCents)) {
      errors.push({
        path: `${path}.minOrderCents`,
        message: `Η ελάχιστη παραγγελία είναι από 0€ έως ${DELIVERY_ZONE_LIMITS.maxMinOrderCents / 100}€.`,
      });
    }
    const free = zone.freeDeliveryOverCents;
    if (
      free !== null &&
      !(isCents(free, DELIVERY_ZONE_LIMITS.maxFreeDeliveryOverCents) && free > 0)
    ) {
      errors.push({
        path: `${path}.freeDeliveryOverCents`,
        message: `Το όριο δωρεάν μεταφορικών είναι από 0,01€ έως ${DELIVERY_ZONE_LIMITS.maxFreeDeliveryOverCents / 100}€ — ή κενό.`,
      });
    }

    const postalCodes: string[] = [];
    if (!Array.isArray(zone.postalCodes)) {
      errors.push({ path: `${path}.postalCodes`, message: "Μη έγκυρη λίστα ΤΚ." });
    } else if (zone.postalCodes.length === 0) {
      errors.push({ path: `${path}.postalCodes`, message: "Πρόσθεσε τουλάχιστον έναν ΤΚ στη ζώνη." });
    } else if (zone.postalCodes.length > DELIVERY_ZONE_LIMITS.maxPostalCodesPerZone) {
      errors.push({
        path: `${path}.postalCodes`,
        message: `Έως ${DELIVERY_ZONE_LIMITS.maxPostalCodesPerZone} ΤΚ ανά ζώνη.`,
      });
    } else {
      const zoneLabel = name || `ζώνη ${index + 1}`;
      for (const rawCode of zone.postalCodes) {
        /* Στη βάση ο ΤΚ πρέπει να είναι ΗΔΗ κανονικός· στην εγγραφή τον
         * κανονικοποιούμε (π.χ. «546 22») αλλά απορρίπτουμε ό,τι είναι κακόμορφο. */
        const code = mode === "write" ? normalizePostalCode(rawCode) : isNormalizedPostalCode(rawCode) ? rawCode : null;
        if (!code) {
          errors.push({
            path: `${path}.postalCodes`,
            message: `«${typeof rawCode === "string" ? rawCode.slice(0, 20) : "?"}» δεν είναι έγκυρος ΤΚ (5 ψηφία, π.χ. 546 22).`,
          });
          break;
        }
        if (postalCodes.includes(code)) {
          errors.push({ path: `${path}.postalCodes`, message: `Ο ΤΚ ${code} γράφτηκε δύο φορές στη ζώνη «${zoneLabel}».` });
          break;
        }
        const previous = owner.get(code);
        if (previous !== undefined) {
          errors.push({
            path: `${path}.postalCodes`,
            message: `Ο ΤΚ ${code} ανήκει ήδη στη ζώνη «${previous}». Κάθε ΤΚ μπαίνει σε μία μόνο ζώνη.`,
          });
          break;
        }
        owner.set(code, zoneLabel);
        postalCodes.push(code);
      }
      totalCodes += postalCodes.length;
    }

    zones.push({
      id: zone.id,
      name,
      available: zone.available === true,
      postalCodes: [...postalCodes].sort(),
      deliveryFeeCents: zone.deliveryFeeCents as number,
      minOrderCents: zone.minOrderCents as number,
      freeDeliveryOverCents: (free as number | null) ?? null,
    });
  });

  if (totalCodes > DELIVERY_ZONE_LIMITS.maxPostalCodesTotal) {
    errors.push({
      path: "deliveryZones.zones",
      message: `Έως ${DELIVERY_ZONE_LIMITS.maxPostalCodesTotal} ΤΚ σε όλες τις ζώνες μαζί.`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { enabled: root.enabled as boolean, zones } };
}

export type ParsedDeliveryZones =
  | { kind: "absent" }
  | { kind: "invalid"; errors: ShopSettingsError[] }
  | { kind: "config"; config: DeliveryZonesConfig };

export function parseDeliveryZones(raw: unknown): ParsedDeliveryZones {
  if (raw === undefined || raw === null) return { kind: "absent" };
  const result = validateDeliveryZones(raw, "read");
  return result.ok ? { kind: "config", config: result.config } : { kind: "invalid", errors: result.errors };
}

/* ==========================================================================
 *  ΕΠΙΛΥΣΗ ΤΚ → ΟΡΟΙ ΠΑΡΑΔΟΣΗΣ
 * ========================================================================== */

export function zoneTerms(zone: DeliveryZone): ShopTermsCents {
  return {
    minOrderCents: zone.minOrderCents,
    deliveryFeeCents: zone.deliveryFeeCents,
    freeDeliveryOverCents: zone.freeDeliveryOverCents,
  };
}

export function findZoneByPostalCode(config: DeliveryZonesConfig, postalCode: string): DeliveryZone | null {
  return config.zones.find((zone) => zone.postalCodes.includes(postalCode)) ?? null;
}

export type DeliveryTermsResolution =
  | { ok: true; terms: ShopTermsCents; snapshot: DeliveryTermsSnapshot }
  | {
      ok: false;
      reason:
        | "zones_config_invalid"
        | "shop_terms_invalid"
        | "postal_code_required"
        | "postal_code_invalid"
        | "unsupported"
        | "zone_unavailable";
      /** Για zone_unavailable: ποια ζώνη */
      zone?: DeliveryZone;
      /** Για shop_terms_invalid: ποιο πεδίο */
      field?: string;
    };

/** true όταν το κατάστημα ζητά ΤΚ (ενεργές ζώνες ή κακόμορφη ρύθμιση ζωνών) */
export function requiresPostalCode(shop: Record<string, unknown>): boolean {
  const parsed = parseDeliveryZones(shop.deliveryZones);
  return parsed.kind === "invalid" || (parsed.kind === "config" && parsed.config.enabled);
}

/**
 * Ποιοι όροι παράδοσης ισχύουν για αυτό το κατάστημα και αυτόν τον ΤΚ —
 * ΙΔΙΑ συνάρτηση σε server (απόφαση) και browser (καθοδήγηση).
 *
 *   ζώνες απούσες/ανενεργές → γενικοί όροι του καταστήματος (όπως πριν)
 *   ζώνες ενεργές           → ο ΤΚ πρέπει να ανήκει σε ΔΙΑΘΕΣΙΜΗ ζώνη
 *   κακόμορφη ρύθμιση       → σφάλμα (ποτέ σιωπηλά γενικοί όροι)
 */
export function resolveDeliveryTerms(
  shop: Record<string, unknown>,
  rawPostalCode: string | null | undefined,
): DeliveryTermsResolution {
  const parsed = parseDeliveryZones(shop.deliveryZones);
  if (parsed.kind === "invalid") return { ok: false, reason: "zones_config_invalid" };

  const postalCode =
    rawPostalCode === undefined || rawPostalCode === null || rawPostalCode === ""
      ? null
      : normalizePostalCode(rawPostalCode);
  if (rawPostalCode && postalCode === null) return { ok: false, reason: "postal_code_invalid" };

  if (parsed.kind === "absent" || !parsed.config.enabled) {
    const legacy = parseShopTerms({
      minOrder: shop.minOrder,
      deliveryFee: shop.deliveryFee,
      freeDeliveryOver: shop.freeDeliveryOver,
    });
    if (!legacy.ok) return { ok: false, reason: "shop_terms_invalid", field: legacy.field };
    return {
      ok: true,
      terms: legacy.terms,
      snapshot: {
        mode: "shop_default",
        postalCode,
        deliveryFeeCents: legacy.terms.deliveryFeeCents,
        minOrderCents: legacy.terms.minOrderCents,
        freeDeliveryOverCents: legacy.terms.freeDeliveryOverCents,
      },
    };
  }

  if (!postalCode) return { ok: false, reason: "postal_code_required" };

  const zone = findZoneByPostalCode(parsed.config, postalCode);
  if (!zone) return { ok: false, reason: "unsupported" };
  if (!zone.available) return { ok: false, reason: "zone_unavailable", zone };

  return {
    ok: true,
    terms: zoneTerms(zone),
    snapshot: {
      mode: "zone",
      zoneId: zone.id,
      zoneName: zone.name,
      postalCode,
      deliveryFeeCents: zone.deliveryFeeCents,
      minOrderCents: zone.minOrderCents,
      freeDeliveryOverCents: zone.freeDeliveryOverCents,
    },
  };
}

/** Ελληνικό μήνυμα για τον πελάτη — ΙΔΙΟ σε φόρμα και απάντηση server */
export function describeDeliveryProblem(
  reason: Exclude<DeliveryTermsResolution, { ok: true }>["reason"],
  postalCode: string | null,
): string {
  switch (reason) {
    case "postal_code_required":
      return "Συμπλήρωσε τον ταχυδρομικό κώδικα — το κατάστημα εξυπηρετεί συγκεκριμένες περιοχές.";
    case "postal_code_invalid":
      return "Ο ταχυδρομικός κώδικας πρέπει να έχει 5 ψηφία (π.χ. 546 22).";
    case "unsupported":
      return postalCode
        ? `Το κατάστημα δεν εξυπηρετεί τον ΤΚ ${postalCode}. Δεν μπορεί να γίνει παραγγελία για παράδοση σε αυτή την περιοχή.`
        : "Το κατάστημα δεν εξυπηρετεί αυτόν τον ΤΚ.";
    case "zone_unavailable":
      return postalCode
        ? `Η περιοχή του ΤΚ ${postalCode} δεν εξυπηρετείται προσωρινά από το κατάστημα. Δοκίμασε αργότερα.`
        : "Η περιοχή σου δεν εξυπηρετείται προσωρινά από το κατάστημα.";
    case "zones_config_invalid":
    case "shop_terms_invalid":
      return "Το κατάστημα έχει πρόβλημα στις ρυθμίσεις παράδοσης και δεν δέχεται παραγγελίες αυτή τη στιγμή.";
  }
}

/** Σύνοψη ζωνών για τη βιτρίνα: το φθηνότερο μεταφορικό/ελάχιστη από τις διαθέσιμες */
export function summarizeZones(config: DeliveryZonesConfig): {
  availableZones: DeliveryZone[];
  minDeliveryFeeCents: number | null;
  minMinOrderCents: number | null;
} {
  const availableZones = config.zones.filter((zone) => zone.available);
  if (availableZones.length === 0) {
    return { availableZones, minDeliveryFeeCents: null, minMinOrderCents: null };
  }
  return {
    availableZones,
    minDeliveryFeeCents: Math.min(...availableZones.map((zone) => zone.deliveryFeeCents)),
    minMinOrderCents: Math.min(...availableZones.map((zone) => zone.minOrderCents)),
  };
}

/* ==========================================================================
 *  ΑΝΑΓΝΩΣΗ ΣΤΙΓΜΙΟΤΥΠΟΥ (παραγγελίες, απαντήσεις server)
 * ========================================================================== */

/**
 * Αμυντική ανάγνωση του `deliveryTerms` μιας παραγγελίας / του `delivery`
 * μιας απάντησης. Κακόμορφο ή απόν → null (οι οθόνες δείχνουν τα συνήθη
 * πεδία της παραγγελίας, όπως στις παλαιότερες παραγγελίες).
 */
export function readDeliveryTermsSnapshot(raw: unknown): DeliveryTermsSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const cents = (entry: unknown) => typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0;

  if (!cents(value.deliveryFeeCents) || !cents(value.minOrderCents)) return null;
  if (value.freeDeliveryOverCents !== null && !cents(value.freeDeliveryOverCents)) return null;
  const common = {
    deliveryFeeCents: value.deliveryFeeCents as number,
    minOrderCents: value.minOrderCents as number,
    freeDeliveryOverCents: (value.freeDeliveryOverCents as number | null) ?? null,
  };

  if (value.mode === "zone") {
    if (!isValidZoneId(value.zoneId) || !isNormalizedPostalCode(value.postalCode)) return null;
    const zoneName = typeof value.zoneName === "string" ? cleanSingleLine(value.zoneName).slice(0, DELIVERY_ZONE_LIMITS.nameMax) : "";
    return { mode: "zone", zoneId: value.zoneId, zoneName: zoneName || value.zoneId, postalCode: value.postalCode, ...common };
  }
  if (value.mode === "shop_default") {
    const postalCode = isNormalizedPostalCode(value.postalCode) ? value.postalCode : null;
    return { mode: "shop_default", postalCode, ...common };
  }
  return null;
}

/** «Μεταφορικά 1,50€ · ελάχιστη 8,00€ · δωρεάν μεταφορικά από 20,00€» */
export function formatZoneTerms(terms: {
  deliveryFeeCents: number;
  minOrderCents: number;
  freeDeliveryOverCents: number | null;
}): string {
  const parts = [
    `Μεταφορικά ${formatDeliveryFee(centsToEuros(terms.deliveryFeeCents))}`,
    `ελάχιστη ${formatPrice(centsToEuros(terms.minOrderCents))}`,
  ];
  if (terms.freeDeliveryOverCents !== null && terms.deliveryFeeCents > 0) {
    parts.push(`δωρεάν μεταφορικά από ${formatPrice(centsToEuros(terms.freeDeliveryOverCents))}`);
  }
  return parts.join(" · ");
}
