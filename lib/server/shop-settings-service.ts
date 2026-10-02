/* ==========================================================================
 *  Buka Delivery — lib/server/shop-settings-service.ts   (milestone 4)
 *
 *  Η λογική του POST /api/admin/shop-settings: αποθήκευση ωραρίου
 *  λειτουργίας και ζωνών παράδοσης ενός καταστήματος.
 *
 *  ── ΓΙΑΤΙ ΜΕΣΩ SERVER ───────────────────────────────────────────────────
 *  Ωράριο (7 μέρες × διαστήματα, εξαιρέσεις, επικαλύψεις, βραδινές βάρδιες)
 *  και ζώνες (λίστες ΤΚ, μοναδικότητα ΤΚ σε ΟΛΕΣ τις ζώνες, ποσά) είναι
 *  εμφωλευμένες λίστες με κανόνες για ΟΛΗ τη ρύθμιση. Τα Firestore Rules δεν
 *  έχουν βρόχους, οπότε:
 *    • `openingHours` και `deliveryZones` γράφονται ΜΟΝΟ από εδώ (Admin SDK)
 *    • τα Rules αρνούνται σε κάθε browser (και σε admin από browser) να τα
 *      δημιουργήσει/αλλάξει/σβήσει
 *    • η χειροκίνητη παύση (`active`) μένει άμεση εγγραφή του ιδιοκτήτη,
 *      όπως πριν (τα Rules ελέγχουν ότι είναι boolean)
 *
 *  ── ΕΞΟΥΣΙΟΔΟΤΗΣΗ ───────────────────────────────────────────────────────
 *  Ταυτότητα ΜΟΝΟ από το επαληθευμένο Firebase ID token. Μέσα στην ΙΔΙΑ
 *  συναλλαγή με την εγγραφή διαβάζεται το shops/{shopId} και απαιτείται
 *  ownerUid === uid — ο ΤΡΕΧΩΝ ιδιοκτήτης τη στιγμή της εγγραφής. Το Admin
 *  SDK παρακάμπτει τα Rules, γι' αυτό ο έλεγχος γίνεται ρητά εδώ.
 *
 *  ── ΣΧΗΜΑ ───────────────────────────────────────────────────────────────
 *  Ενημερώνονται ΜΟΝΟ τα πεδία που στάλθηκαν (+ updatedAt). Όλα τα άλλα
 *  πεδία του καταστήματος (όνομα, εικόνα, active, ownerUid, οικονομικοί
 *  όροι…) μένουν άθικτα. `null` σε ενότητα = διαγραφή της ρύθμισης (επιστροφή
 *  στη συμπεριφορά πριν το milestone 4).
 * ========================================================================== */

import "server-only";

import type { DeliveryZonesConfig, OpeningHoursConfig } from "@/types";
import { isValidDocumentId } from "@/lib/checkout/validation";
import { validateDeliveryZones } from "@/lib/shop/delivery-zones";
import { validateOpeningHours, type ShopSettingsError } from "@/lib/shop/opening-hours";

/* ==========================================================================
 *  ΣΥΜΒΟΛΑΙΑ
 * ========================================================================== */

export const SHOP_SETTINGS_LIMITS = {
  /** Όλο το σώμα του αιτήματος (UTF-8 bytes) */
  maxRequestBytes: 64 * 1024,
} as const;

export type ShopSettingsErrorCode =
  | "invalid_json"
  | "payload_too_large"
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "shop_not_found"
  | "internal_error"
  | "server_misconfigured"
  | "method_not_allowed";

export type ShopSettingsResponseBody =
  | {
      ok: true;
      /** Η ρύθμιση ΟΠΩΣ αποθηκεύτηκε (κανονική μορφή)· null = διαγράφηκε· απόν = δεν άλλαξε */
      openingHours?: OpeningHoursConfig | null;
      deliveryZones?: DeliveryZonesConfig | null;
    }
  | {
      ok: false;
      code: ShopSettingsErrorCode;
      message: string;
      errors?: ShopSettingsError[];
    };

export type ShopSettingsHttpResult = { status: number; body: ShopSettingsResponseBody };

/** Ειδική τιμή «σβήσε το πεδίο» — ο adapter την αντιστοιχίζει σε FieldValue.delete() */
export const SETTINGS_DELETE_FIELD = Symbol("settingsDeleteField");

export interface ShopSettingsTransaction {
  getShop(shopId: string): Promise<Record<string, unknown> | null>;
  /** update (όχι set): μόνο τα δοσμένα πεδία· SETTINGS_DELETE_FIELD σβήνει */
  updateShop(shopId: string, data: Record<string, unknown>): void;
}

export interface ShopSettingsStore {
  runTransaction<T>(fn: (tx: ShopSettingsTransaction) => Promise<T>): Promise<T>;
}

export type ShopSettingsDeps = {
  store: ShopSettingsStore;
  verifyIdToken(token: string): Promise<{ uid: string }>;
  serverTimestamp(): unknown;
  logger?: { error: (...args: unknown[]) => void };
};

const MESSAGES: Record<ShopSettingsErrorCode, string> = {
  invalid_json: "Μη έγκυρο αίτημα.",
  payload_too_large: "Οι ρυθμίσεις είναι πολύ μεγάλες για αποθήκευση. Μείωσε εξαιρέσεις ή ΤΚ.",
  validation_failed: "Έλεγξε τα σημειωμένα πεδία.",
  unauthenticated: "Η σύνδεσή σου έληξε. Συνδέσου ξανά και δοκίμασε πάλι.",
  forbidden: "Δεν έχεις δικαίωμα να αλλάξεις τις ρυθμίσεις αυτού του καταστήματος.",
  shop_not_found: "Το κατάστημα δεν βρέθηκε.",
  internal_error: "Δεν ήταν δυνατή η αποθήκευση. Δοκίμασε ξανά σε λίγο.",
  server_misconfigured: "Δεν ήταν δυνατή η αποθήκευση. Δοκίμασε ξανά σε λίγο.",
  method_not_allowed: "Χρησιμοποίησε POST.",
};

function failure(
  status: number,
  code: ShopSettingsErrorCode,
  extra: { message?: string; errors?: ShopSettingsError[] } = {},
): ShopSettingsHttpResult {
  return {
    status,
    body: {
      ok: false,
      code,
      message: extra.message ?? MESSAGES[code],
      ...(extra.errors && extra.errors.length > 0 ? { errors: extra.errors } : {}),
    },
  };
}

export const shopSettingsMethodNotAllowed = () => failure(405, "method_not_allowed");
export const shopSettingsServerMisconfigured = () => failure(500, "server_misconfigured");

async function authenticate(deps: ShopSettingsDeps, authorization: string | null): Promise<string | null> {
  const match = authorization?.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
  if (!match) return null;
  try {
    const decoded = await deps.verifyIdToken(match[1]);
    return typeof decoded.uid === "string" && decoded.uid.length > 0 ? decoded.uid : null;
  } catch {
    return null;
  }
}

/* ==========================================================================
 *  ΚΥΡΙΑ ΣΥΝΑΡΤΗΣΗ
 *
 *  Σώμα: { shopId, openingHours?: OpeningHoursConfig | null,
 *                  deliveryZones?: DeliveryZonesConfig | null }
 *  Τουλάχιστον μία ενότητα. Άγνωστα πεδία → απόρριψη (όχι σιωπηλή αγνόηση,
 *  ώστε ένας browser να μην «νομίζει» ότι αποθήκευσε κάτι άλλο).
 * ========================================================================== */

type Outcome =
  | { kind: "rejected"; result: ShopSettingsHttpResult }
  | { kind: "saved" };

export async function handleShopSettingsWrite(
  deps: ShopSettingsDeps,
  input: { authorization: string | null; rawBody: string },
): Promise<ShopSettingsHttpResult> {
  if (new TextEncoder().encode(input.rawBody).length > SHOP_SETTINGS_LIMITS.maxRequestBytes) {
    return failure(413, "payload_too_large");
  }

  const uid = await authenticate(deps, input.authorization);
  if (!uid) return failure(401, "unauthenticated");

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return failure(400, "invalid_json");
  }
  const body =
    typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (!body) return failure(400, "invalid_json");

  if (!isValidDocumentId(body.shopId)) {
    return failure(400, "validation_failed", { message: "Μη έγκυρο κατάστημα." });
  }
  const shopId = body.shopId;

  const allowed = new Set(["shopId", "openingHours", "deliveryZones"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return failure(400, "validation_failed", { message: "Το αίτημα περιέχει πεδία που δεν αλλάζουν από εδώ." });
  }
  if (!("openingHours" in body) && !("deliveryZones" in body)) {
    return failure(400, "validation_failed", { message: "Δεν στάλθηκε καμία ρύθμιση για αποθήκευση." });
  }

  /* ---------------------- Επικύρωση ΟΛΗΣ της ρύθμισης --------------------- */
  const errors: ShopSettingsError[] = [];
  let openingHours: OpeningHoursConfig | null | undefined;
  let deliveryZones: DeliveryZonesConfig | null | undefined;

  if ("openingHours" in body) {
    if (body.openingHours === null) {
      openingHours = null;
    } else {
      const result = validateOpeningHours(body.openingHours);
      if (result.ok) openingHours = result.config;
      else errors.push(...result.errors);
    }
  }
  if ("deliveryZones" in body) {
    if (body.deliveryZones === null) {
      deliveryZones = null;
    } else {
      const result = validateDeliveryZones(body.deliveryZones, "write");
      if (result.ok) deliveryZones = result.config;
      else errors.push(...result.errors);
    }
  }
  if (errors.length > 0) return failure(400, "validation_failed", { errors: errors.slice(0, 50) });

  try {
    const outcome = await deps.store.runTransaction<Outcome>(async (tx) => {
      /* Ο ΤΡΕΧΩΝ ιδιοκτήτης, διαβασμένος μέσα στη συναλλαγή της εγγραφής */
      const shop = await tx.getShop(shopId);
      if (!shop) return { kind: "rejected", result: failure(404, "shop_not_found") };
      if (typeof shop.ownerUid !== "string" || shop.ownerUid !== uid) {
        return { kind: "rejected", result: failure(403, "forbidden") };
      }

      const update: Record<string, unknown> = { updatedAt: deps.serverTimestamp() };
      if (openingHours !== undefined) update.openingHours = openingHours ?? SETTINGS_DELETE_FIELD;
      if (deliveryZones !== undefined) update.deliveryZones = deliveryZones ?? SETTINGS_DELETE_FIELD;
      tx.updateShop(shopId, update);
      return { kind: "saved" };
    });

    if (outcome.kind === "rejected") return outcome.result;
    return {
      status: 200,
      body: {
        ok: true,
        ...(openingHours !== undefined ? { openingHours } : {}),
        ...(deliveryZones !== undefined ? { deliveryZones } : {}),
      },
    };
  } catch (error) {
    deps.logger?.error("[shop-settings] Αποτυχία αποθήκευσης ρυθμίσεων:", error);
    return failure(500, "internal_error");
  }
}
