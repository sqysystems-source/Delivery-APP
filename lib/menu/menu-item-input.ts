/* ==========================================================================
 *  Buka Delivery — lib/menu/menu-item-input.ts   (milestone 3)
 *
 *  Επικύρωση ΟΛΟΚΛΗΡΟΥ του προϊόντος που αποθηκεύει ο καταστηματάρχης
 *  (βασικά πεδία + ομάδες επιλογών). Κοινή για:
 *    • τη φόρμα (άμεσα ελληνικά μηνύματα)
 *    • τον server του POST /api/admin/menu-items — το ΕΜΠΙΣΤΟ σημείο εγγραφής.
 *      Η επικύρωση της φόρμας είναι ευκολία· αυτή του server είναι προστασία.
 *
 *  Τα όρια βασικών πεδίων είναι ίδια με όσα ήδη εφάρμοζε η φόρμα
 *  (MenuItemModal) πριν το milestone 3.
 *
 *  Καθαρό module: κανένα import από Firebase, React ή Next.
 * ========================================================================== */

import type { MenuOptionGroup } from "@/types";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import { centsToEuros, parseItemPriceCents } from "@/lib/checkout/money";
import { cleanMultiLine, cleanSingleLine, isValidDocumentId } from "@/lib/checkout/validation";
import { validateOptionGroups, type OptionConfigError } from "@/lib/menu/options";

export const MENU_ITEM_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  descriptionMax: 300,
  /* Ίδια όρια με το isValidMenuItem των Rules: ό,τι γράφει ο server πρέπει να
   * περνά και τα Rules, αλλιώς η εναλλαγή διαθεσιμότητας από τον browser
   * (άμεση εγγραφή) θα απορριπτόταν μετά. */
  imageUrlMax: 500,
  categoryIdMax: 80,
  /** Σώμα του POST /api/admin/menu-items */
  maxRequestBytes: 32_768,
} as const;

/** Ό,τι στέλνει η φόρμα — όλα τα πεδία ρητά (καμία «σιωπηλή» προεπιλογή) */
export type MenuItemWriteInput = {
  name: string;
  description: string;
  categoryId: string;
  /** Ευρώ, έως 2 δεκαδικά */
  price: number;
  /** null = χωρίς προσφορά */
  oldPrice: number | null;
  image: string | null;
  popular: boolean;
  available: boolean;
  /** [] = χωρίς επιλογές (το πεδίο σβήνεται από το έγγραφο) */
  optionGroups: MenuOptionGroup[];
};

export type MenuItemFieldName =
  | "name"
  | "description"
  | "categoryId"
  | "price"
  | "oldPrice"
  | "image"
  | "popular"
  | "available"
  | "optionGroups";

export type MenuItemFieldErrors = Partial<Record<MenuItemFieldName, string>>;

export type MenuItemValidation =
  | { ok: true; value: MenuItemWriteInput }
  | { ok: false; fieldErrors: MenuItemFieldErrors; optionErrors: OptionConfigError[] };

/** Τιμή σε ευρώ με το πολύ 2 δεκαδικά, 0…999 → ίδια τιμή στρογγυλή, ή null */
function exactEuros(value: unknown): number | null {
  const cents = parseItemPriceCents(value);
  if (cents === null || typeof value !== "number") return null;
  if (Math.abs(cents / 100 - value) > 1e-9) return null;
  return centsToEuros(cents);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function validateMenuItemInput(raw: unknown): MenuItemValidation {
  const body =
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const errors: MenuItemFieldErrors = {};

  const name = cleanSingleLine(body.name);
  if (typeof body.name !== "string" || name.length < MENU_ITEM_LIMITS.nameMin) {
    errors.name = "Το όνομα θέλει τουλάχιστον 2 χαρακτήρες.";
  } else if (name.length > MENU_ITEM_LIMITS.nameMax || name.length > CHECKOUT_LIMITS.itemNameMax) {
    errors.name = `Το όνομα είναι πολύ μεγάλο (έως ${MENU_ITEM_LIMITS.nameMax} χαρακτήρες).`;
  }

  const description = cleanMultiLine(body.description);
  if (body.description !== undefined && typeof body.description !== "string") {
    errors.description = "Μη έγκυρη περιγραφή.";
  } else if (description.length > MENU_ITEM_LIMITS.descriptionMax) {
    errors.description = `Η περιγραφή είναι πολύ μεγάλη (έως ${MENU_ITEM_LIMITS.descriptionMax} χαρακτήρες).`;
  }

  if (!isValidDocumentId(body.categoryId) || body.categoryId.length > MENU_ITEM_LIMITS.categoryIdMax) {
    errors.categoryId = "Διάλεξε κατηγορία.";
  }

  const price = exactEuros(body.price);
  if (price === null) {
    errors.price = `Δώσε έγκυρη τιμή από 0 έως ${CHECKOUT_LIMITS.maxItemPrice}€ με έως 2 δεκαδικά, π.χ. 3,90`;
  }

  let oldPrice: number | null = null;
  if (body.oldPrice !== null && body.oldPrice !== undefined) {
    oldPrice = exactEuros(body.oldPrice);
    if (oldPrice === null) errors.oldPrice = "Δώσε έγκυρη παλιά τιμή ή άφησέ την κενή.";
    else if (price !== null && oldPrice <= price) {
      errors.oldPrice = "Η παλιά τιμή πρέπει να είναι μεγαλύτερη από τη νέα.";
    }
  }

  let image: string | null = null;
  if (body.image !== null && body.image !== undefined && body.image !== "") {
    image = typeof body.image === "string" ? body.image.trim() : "";
    if (image.length > MENU_ITEM_LIMITS.imageUrlMax) {
      errors.image = `Το URL είναι πολύ μεγάλο (έως ${MENU_ITEM_LIMITS.imageUrlMax} χαρακτήρες).`;
    } else if (!image || !isHttpUrl(image)) {
      errors.image = "Το URL πρέπει να ξεκινά με http:// ή https://";
    }
  }

  if (typeof body.popular !== "boolean") errors.popular = "Μη έγκυρη τιμή «Δημοφιλές».";
  if (typeof body.available !== "boolean") errors.available = "Μη έγκυρη τιμή «Διαθέσιμο».";

  /* Οι επιλογές επικυρώνονται με τους ΙΔΙΟΥΣ κανόνες που διαβάζει το checkout,
   * σε αυστηρή λειτουργία "write" (π.χ. αδύνατη υποχρεωτική ομάδα = σφάλμα). */
  const options = validateOptionGroups(body.optionGroups ?? [], "write");
  if (!options.ok) {
    errors.optionGroups = options.errors[0]?.message ?? "Έλεγξε τις επιλογές του προϊόντος.";
  }

  if (Object.keys(errors).length > 0 || !options.ok || price === null) {
    return { ok: false, fieldErrors: errors, optionErrors: options.ok ? [] : options.errors };
  }

  return {
    ok: true,
    value: {
      name,
      description,
      categoryId: body.categoryId as string,
      price,
      oldPrice,
      image,
      popular: body.popular as boolean,
      available: body.available as boolean,
      optionGroups: options.groups,
    },
  };
}
