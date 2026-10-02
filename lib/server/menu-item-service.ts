/* ==========================================================================
 *  Buka Delivery — lib/server/menu-item-service.ts   (milestone 3)
 *
 *  Η λογική του POST /api/admin/menu-items: δημιουργία/ενημέρωση προϊόντος
 *  του καταλόγου ΜΑΖΙ με τις ομάδες επιλογών του.
 *
 *  ── ΓΙΑΤΙ ΜΕΣΩ SERVER ───────────────────────────────────────────────────
 *  Οι ομάδες επιλογών είναι εμφωλευμένες λίστες (ομάδες → επιλογές) με
 *  κανόνες που αφορούν ΟΛΗ τη λίστα (μοναδικά ids, min ≤ max ≤ πλήθος,
 *  αδύνατες υποχρεωτικές ομάδες, όρια bytes). Τα Firestore Rules δεν έχουν
 *  βρόχους, οπότε δεν μπορούν να τα ελέγξουν αξιόπιστα. Έτσι:
 *    • το `optionGroups` γράφεται ΜΟΝΟ από εδώ (Admin SDK)
 *    • τα Rules αρνούνται σε κάθε client να γράψει/αλλάξει το `optionGroups`
 *    • η εναλλαγή διαθεσιμότητας και η διαγραφή μένουν άμεσες εγγραφές του
 *      client, όπως πριν, με τα υπάρχοντα Rules
 *
 *  ── ΕΞΟΥΣΙΟΔΟΤΗΣΗ ───────────────────────────────────────────────────────
 *  Ταυτότητα ΜΟΝΟ από το επαληθευμένο Firebase ID token. Μέσα στην ΙΔΙΑ
 *  συναλλαγή με την εγγραφή διαβάζεται το shops/{shopId} και απαιτείται
 *  ownerUid === uid — δηλαδή ο ΤΡΕΧΩΝ ιδιοκτήτης τη στιγμή της εγγραφής.
 *  Επειδή το Admin SDK παρακάμπτει τα Rules, ο έλεγχος γίνεται ρητά εδώ.
 *  Το shopId/itemId μπαίνουν μόνο στη διαδρομή (επικυρωμένα ids), άρα δεν
 *  αγγίζεται ποτέ κατάλογος άλλου καταστήματος.
 *
 *  ── ΣΧΗΜΑ ───────────────────────────────────────────────────────────────
 *  Γράφονται μόνο τα γνωστά πεδία· η ενημέρωση είναι merge, οπότε άλλα
 *  υπάρχοντα πεδία (createdAt κ.λπ.) μένουν. Κενές επιλογές → το πεδίο
 *  `optionGroups` ΣΒΗΝΕΤΑΙ (το προϊόν ξαναγίνεται «απλό», όπως πριν).
 * ========================================================================== */

import "server-only";

import { isValidDocumentId } from "@/lib/checkout/validation";
import {
  MENU_ITEM_LIMITS,
  validateMenuItemInput,
  type MenuItemFieldErrors,
} from "@/lib/menu/menu-item-input";
import type { OptionConfigError } from "@/lib/menu/options";

/* ==========================================================================
 *  ΣΥΜΒΟΛΑΙΑ
 * ========================================================================== */

export type MenuItemErrorCode =
  | "invalid_json"
  | "payload_too_large"
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "shop_not_found"
  | "item_not_found"
  | "internal_error"
  | "server_misconfigured"
  | "method_not_allowed";

export type MenuItemResponseBody =
  | { ok: true; itemId: string; created: boolean }
  | {
      ok: false;
      code: MenuItemErrorCode;
      message: string;
      fieldErrors?: MenuItemFieldErrors;
      optionErrors?: OptionConfigError[];
    };

export type MenuItemHttpResult = { status: number; body: MenuItemResponseBody };

/** Ειδική τιμή «σβήσε αυτό το πεδίο» — την αντιστοιχίζει ο adapter σε FieldValue.delete() */
export const DELETE_FIELD = Symbol("deleteField");

export interface MenuWriteTransaction {
  getShop(shopId: string): Promise<Record<string, unknown> | null>;
  getCategory(shopId: string, categoryId: string): Promise<Record<string, unknown> | null>;
  getItem(shopId: string, itemId: string): Promise<Record<string, unknown> | null>;
  /** semantics «create» — αποτυγχάνει αν υπάρχει */
  createItem(shopId: string, itemId: string, data: Record<string, unknown>): void;
  /** merge· τιμές DELETE_FIELD σβήνουν το πεδίο */
  updateItem(shopId: string, itemId: string, data: Record<string, unknown>): void;
}

export interface MenuWriteStore {
  newItemId(shopId: string): string;
  runTransaction<T>(fn: (tx: MenuWriteTransaction) => Promise<T>): Promise<T>;
}

export type MenuItemDeps = {
  store: MenuWriteStore;
  verifyIdToken(token: string): Promise<{ uid: string }>;
  serverTimestamp(): unknown;
  logger?: { error: (...args: unknown[]) => void };
};

const MESSAGES: Record<MenuItemErrorCode, string> = {
  invalid_json: "Μη έγκυρο αίτημα.",
  payload_too_large: "Το προϊόν είναι πολύ μεγάλο για αποθήκευση. Μείωσε επιλογές ή κείμενα.",
  validation_failed: "Έλεγξε τα πεδία του προϊόντος.",
  unauthenticated: "Η σύνδεσή σου έληξε. Συνδέσου ξανά και δοκίμασε πάλι.",
  forbidden: "Δεν έχεις δικαίωμα διαχείρισης αυτού του καταλόγου.",
  shop_not_found: "Το κατάστημα δεν βρέθηκε.",
  item_not_found: "Το προϊόν δεν υπάρχει πια — ίσως διαγράφηκε από άλλη συσκευή.",
  internal_error: "Δεν ήταν δυνατή η αποθήκευση. Δοκίμασε ξανά σε λίγο.",
  server_misconfigured: "Δεν ήταν δυνατή η αποθήκευση. Δοκίμασε ξανά σε λίγο.",
  method_not_allowed: "Χρησιμοποίησε POST.",
};

function failure(
  status: number,
  code: MenuItemErrorCode,
  extra: { fieldErrors?: MenuItemFieldErrors; optionErrors?: OptionConfigError[]; message?: string } = {},
): MenuItemHttpResult {
  return {
    status,
    body: {
      ok: false,
      code,
      message: extra.message ?? MESSAGES[code],
      ...(extra.fieldErrors ? { fieldErrors: extra.fieldErrors } : {}),
      ...(extra.optionErrors && extra.optionErrors.length > 0 ? { optionErrors: extra.optionErrors } : {}),
    },
  };
}

export const menuItemMethodNotAllowed = () => failure(405, "method_not_allowed");
export const menuItemServerMisconfigured = () => failure(500, "server_misconfigured");

async function authenticate(deps: MenuItemDeps, authorization: string | null): Promise<string | null> {
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
 *  Σώμα: { shopId, itemId?, item: MenuItemWriteInput }
 *    itemId απόν → δημιουργία· παρόν → ενημέρωση υπάρχοντος προϊόντος.
 * ========================================================================== */

type Outcome =
  | { kind: "rejected"; result: MenuItemHttpResult }
  | { kind: "saved"; itemId: string; created: boolean };

export async function handleMenuItemWrite(
  deps: MenuItemDeps,
  input: { authorization: string | null; rawBody: string },
): Promise<MenuItemHttpResult> {
  if (new TextEncoder().encode(input.rawBody).length > MENU_ITEM_LIMITS.maxRequestBytes) {
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

  if (!isValidDocumentId(body.shopId)) return failure(400, "validation_failed", { message: "Μη έγκυρο κατάστημα." });
  if (body.itemId !== undefined && body.itemId !== null && !isValidDocumentId(body.itemId)) {
    return failure(400, "validation_failed", { message: "Μη έγκυρο προϊόν." });
  }
  const shopId = body.shopId;
  const existingItemId = typeof body.itemId === "string" ? body.itemId : null;

  const validation = validateMenuItemInput(body.item);
  if (!validation.ok) {
    return failure(400, "validation_failed", {
      fieldErrors: validation.fieldErrors,
      optionErrors: validation.optionErrors,
    });
  }
  const item = validation.value;

  try {
    const outcome = await deps.store.runTransaction<Outcome>(async (tx) => {
      /* Ο ΤΡΕΧΩΝ ιδιοκτήτης, διαβασμένος μέσα στη συναλλαγή της εγγραφής */
      const shop = await tx.getShop(shopId);
      if (!shop) return { kind: "rejected", result: failure(404, "shop_not_found") };
      if (typeof shop.ownerUid !== "string" || shop.ownerUid !== uid) {
        return { kind: "rejected", result: failure(403, "forbidden") };
      }

      const category = await tx.getCategory(shopId, item.categoryId);
      if (!category) {
        return {
          kind: "rejected",
          result: failure(400, "validation_failed", {
            fieldErrors: { categoryId: "Η κατηγορία δεν υπάρχει πια. Διάλεξε άλλη." },
          }),
        };
      }

      if (existingItemId) {
        const existing = await tx.getItem(shopId, existingItemId);
        if (!existing) return { kind: "rejected", result: failure(404, "item_not_found") };
      }

      const now = deps.serverTimestamp();
      const base: Record<string, unknown> = {
        shopId,
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        price: item.price,
        popular: item.popular,
        available: item.available,
        updatedAt: now,
      };

      if (existingItemId) {
        tx.updateItem(shopId, existingItemId, {
          ...base,
          oldPrice: item.oldPrice ?? DELETE_FIELD,
          image: item.image ?? DELETE_FIELD,
          optionGroups: item.optionGroups.length > 0 ? item.optionGroups : DELETE_FIELD,
        });
        return { kind: "saved", itemId: existingItemId, created: false };
      }

      const itemId = deps.store.newItemId(shopId);
      tx.createItem(shopId, itemId, {
        ...base,
        ...(item.oldPrice !== null ? { oldPrice: item.oldPrice } : {}),
        ...(item.image !== null ? { image: item.image } : {}),
        ...(item.optionGroups.length > 0 ? { optionGroups: item.optionGroups } : {}),
        createdAt: now,
      });
      return { kind: "saved", itemId, created: true };
    });

    if (outcome.kind === "rejected") return outcome.result;
    return {
      status: outcome.created ? 201 : 200,
      body: { ok: true, itemId: outcome.itemId, created: outcome.created },
    };
  } catch (error) {
    deps.logger?.error("[menu-items] Αποτυχία αποθήκευσης προϊόντος:", error);
    return failure(500, "internal_error");
  }
}
