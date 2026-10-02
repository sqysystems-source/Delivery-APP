/* ==========================================================================
 *  Buka Delivery — lib/shop/save-shop-settings.ts   (milestone 4, browser)
 *
 *  Στέλνει ωράριο και/ή ζώνες παράδοσης στο POST /api/admin/shop-settings με
 *  το Firebase ID token του καταστηματάρχη. Ο server ελέγχει ότι είναι ο
 *  ΤΡΕΧΩΝ ιδιοκτήτης και επικυρώνει ΟΛΗ τη ρύθμιση ξανά.
 * ========================================================================== */

import { auth } from "@/lib/firebase";
import type { DeliveryZonesConfig, OpeningHoursConfig } from "@/types";
import type { ShopSettingsError } from "@/lib/shop/opening-hours";

export const SHOP_SETTINGS_ENDPOINT = "/api/admin/shop-settings";

export class ShopSettingsSaveError extends Error {
  readonly code: string;
  readonly errors: ShopSettingsError[];

  constructor(options: { code: string; message: string; errors?: ShopSettingsError[] }) {
    super(options.message);
    this.name = "ShopSettingsSaveError";
    this.code = options.code;
    this.errors = options.errors ?? [];
  }
}

export type ShopSettingsPayload = {
  openingHours?: OpeningHoursConfig | null;
  deliveryZones?: DeliveryZonesConfig | null;
};

export type SavedShopSettings = {
  openingHours?: OpeningHoursConfig | null;
  deliveryZones?: DeliveryZonesConfig | null;
};

export async function saveShopSettings(
  shopId: string,
  payload: ShopSettingsPayload,
  options: { fetchImpl?: typeof fetch; getIdToken?: () => Promise<string> } = {},
): Promise<SavedShopSettings> {
  const fetchImpl = options.fetchImpl ?? fetch;

  let token: string;
  try {
    if (options.getIdToken) {
      token = await options.getIdToken();
    } else {
      const user = auth.currentUser;
      if (!user) throw new Error("no user");
      token = await user.getIdToken();
    }
  } catch {
    throw new ShopSettingsSaveError({ code: "unauthenticated", message: "Συνδέσου ξανά για να αποθηκεύσεις." });
  }

  let response: Response;
  try {
    response = await fetchImpl(SHOP_SETTINGS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shopId, ...payload }),
      cache: "no-store",
    });
  } catch {
    throw new ShopSettingsSaveError({
      code: "network_error",
      message: "Δεν υπάρχει σύνδεση. Έλεγξε το internet και δοκίμασε ξανά — οι αλλαγές σου δεν χάθηκαν.",
    });
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (response.ok && body?.ok === true) {
    return {
      ...("openingHours" in body ? { openingHours: body.openingHours as OpeningHoursConfig | null } : {}),
      ...("deliveryZones" in body ? { deliveryZones: body.deliveryZones as DeliveryZonesConfig | null } : {}),
    };
  }

  throw new ShopSettingsSaveError({
    code: typeof body?.code === "string" ? body.code : "invalid_response",
    message:
      typeof body?.message === "string" ? body.message : "Δεν ήταν δυνατή η αποθήκευση. Δοκίμασε ξανά σε λίγο.",
    errors: Array.isArray(body?.errors) ? (body.errors as ShopSettingsError[]) : undefined,
  });
}
