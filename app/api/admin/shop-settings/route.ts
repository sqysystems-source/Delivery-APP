/* ==========================================================================
 *  Buka Delivery — app/api/admin/shop-settings/route.ts   (milestone 4)
 *
 *  POST /api/admin/shop-settings — ωράριο λειτουργίας και ζώνες παράδοσης
 *  ενός καταστήματος. Λεπτό «καλώδιο» προς το
 *  lib/server/shop-settings-service.ts, όπου γίνονται ταυτοποίηση, έλεγχος
 *  ΤΡΕΧΟΝΤΟΣ ιδιοκτήτη, πλήρης επικύρωση και ατομική εγγραφή.
 *
 *    200 { ok: true, openingHours?, deliveryZones? }   η αποθηκευμένη μορφή
 *    4xx/5xx { ok: false, code, message, errors? }
 * ========================================================================== */

import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  SHOP_SETTINGS_LIMITS,
  handleShopSettingsWrite,
  shopSettingsMethodNotAllowed,
  shopSettingsServerMisconfigured,
  type ShopSettingsDeps,
  type ShopSettingsHttpResult,
} from "@/lib/server/shop-settings-service";
import { createFirestoreShopSettingsStore } from "@/lib/server/firestore-shop-settings-store";
import { getAdminAuth, getAdminDb } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function respond(result: ShopSettingsHttpResult): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > SHOP_SETTINGS_LIMITS.maxRequestBytes) {
    return respond({
      status: 413,
      body: { ok: false, code: "payload_too_large", message: "Το αίτημα είναι πολύ μεγάλο." },
    });
  }

  let deps: ShopSettingsDeps;
  try {
    const auth = getAdminAuth();
    const db = getAdminDb();
    deps = {
      store: createFirestoreShopSettingsStore(db),
      verifyIdToken: (token) => auth.verifyIdToken(token),
      serverTimestamp: () => FieldValue.serverTimestamp(),
      logger: console,
    };
  } catch (error) {
    console.error("[shop-settings] Σφάλμα αρχικοποίησης Admin SDK:", error);
    return respond(shopSettingsServerMisconfigured());
  }

  try {
    const rawBody = await request.text();
    return respond(
      await handleShopSettingsWrite(deps, {
        authorization: request.headers.get("authorization"),
        rawBody,
      }),
    );
  } catch (error) {
    console.error("[shop-settings] Μη αναμενόμενο σφάλμα:", error);
    return respond({
      status: 500,
      body: { ok: false, code: "internal_error", message: "Δεν ήταν δυνατή η αποθήκευση. Δοκίμασε ξανά σε λίγο." },
    });
  }
}

export function GET(): Response {
  return respond(shopSettingsMethodNotAllowed());
}
