/* ==========================================================================
 *  Buka Delivery — lib/menu/save-menu-item.ts   (milestone 3, πλευρά browser)
 *
 *  Στέλνει το προϊόν του καταλόγου στο POST /api/admin/menu-items με το
 *  Firebase ID token του καταστηματάρχη. Ο server ελέγχει ότι είναι ο
 *  ΤΡΕΧΩΝ ιδιοκτήτης του καταστήματος και επικυρώνει τα πάντα ξανά.
 * ========================================================================== */

import { auth } from "@/lib/firebase";
import type { MenuItemFieldErrors, MenuItemWriteInput } from "@/lib/menu/menu-item-input";
import type { OptionConfigError } from "@/lib/menu/options";

export const MENU_ITEMS_ENDPOINT = "/api/admin/menu-items";

export class MenuItemSaveError extends Error {
  readonly code: string;
  readonly fieldErrors?: MenuItemFieldErrors;
  readonly optionErrors?: OptionConfigError[];

  constructor(options: {
    code: string;
    message: string;
    fieldErrors?: MenuItemFieldErrors;
    optionErrors?: OptionConfigError[];
  }) {
    super(options.message);
    this.name = "MenuItemSaveError";
    this.code = options.code;
    this.fieldErrors = options.fieldErrors;
    this.optionErrors = options.optionErrors;
  }
}

export async function saveMenuItem(
  shopId: string,
  item: MenuItemWriteInput,
  itemId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ itemId: string; created: boolean }> {
  const user = auth.currentUser;
  if (!user) {
    throw new MenuItemSaveError({ code: "unauthenticated", message: "Συνδέσου ξανά για να αποθηκεύσεις." });
  }

  let token: string;
  try {
    token = await user.getIdToken();
  } catch {
    throw new MenuItemSaveError({ code: "unauthenticated", message: "Συνδέσου ξανά για να αποθηκεύσεις." });
  }

  let response: Response;
  try {
    response = await fetchImpl(MENU_ITEMS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shopId, ...(itemId ? { itemId } : {}), item }),
      cache: "no-store",
    });
  } catch {
    throw new MenuItemSaveError({
      code: "network_error",
      message: "Δεν υπάρχει σύνδεση. Έλεγξε το internet και δοκίμασε ξανά.",
    });
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (response.ok && body?.ok === true && typeof body.itemId === "string") {
    return { itemId: body.itemId, created: body.created === true };
  }

  throw new MenuItemSaveError({
    code: typeof body?.code === "string" ? body.code : "invalid_response",
    message:
      typeof body?.message === "string"
        ? body.message
        : "Δεν ήταν δυνατή η αποθήκευση. Δοκίμασε ξανά σε λίγο.",
    fieldErrors:
      typeof body?.fieldErrors === "object" && body.fieldErrors !== null
        ? (body.fieldErrors as MenuItemFieldErrors)
        : undefined,
    optionErrors: Array.isArray(body?.optionErrors) ? (body.optionErrors as OptionConfigError[]) : undefined,
  });
}
