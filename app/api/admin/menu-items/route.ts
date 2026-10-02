/* ==========================================================================
 *  Buka Delivery — app/api/admin/menu-items/route.ts   (milestone 3)
 *
 *  POST /api/admin/menu-items — δημιουργία/ενημέρωση προϊόντος καταλόγου
 *  (μαζί με τις ομάδες επιλογών του). Λεπτό «καλώδιο» προς το
 *  lib/server/menu-item-service.ts, όπου γίνονται ταυτοποίηση, έλεγχος
 *  ΤΡΕΧΟΝΤΟΣ ιδιοκτήτη, επικύρωση και ατομική εγγραφή.
 *
 *    201 { ok: true, itemId, created: true }    νέο προϊόν
 *    200 { ok: true, itemId, created: false }   ενημέρωση
 *    4xx/5xx { ok: false, code, message, fieldErrors?, optionErrors? }
 * ========================================================================== */

import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  handleMenuItemWrite,
  menuItemMethodNotAllowed,
  menuItemServerMisconfigured,
  type MenuItemDeps,
  type MenuItemHttpResult,
} from "@/lib/server/menu-item-service";
import { createFirestoreMenuStore } from "@/lib/server/firestore-menu-store";
import { getAdminAuth, getAdminDb } from "@/lib/server/firebase-admin";
import { MENU_ITEM_LIMITS } from "@/lib/menu/menu-item-input";

export const runtime = "nodejs";
export const maxDuration = 30;

function respond(result: MenuItemHttpResult): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MENU_ITEM_LIMITS.maxRequestBytes) {
    return respond({
      status: 413,
      body: { ok: false, code: "payload_too_large", message: "Το αίτημα είναι πολύ μεγάλο." },
    });
  }

  let deps: MenuItemDeps;
  try {
    const auth = getAdminAuth();
    const db = getAdminDb();
    deps = {
      store: createFirestoreMenuStore(db),
      verifyIdToken: (token) => auth.verifyIdToken(token),
      serverTimestamp: () => FieldValue.serverTimestamp(),
      logger: console,
    };
  } catch (error) {
    console.error("[menu-items] Σφάλμα αρχικοποίησης Admin SDK:", error);
    return respond(menuItemServerMisconfigured());
  }

  try {
    const rawBody = await request.text();
    return respond(
      await handleMenuItemWrite(deps, {
        authorization: request.headers.get("authorization"),
        rawBody,
      }),
    );
  } catch (error) {
    console.error("[menu-items] Μη αναμενόμενο σφάλμα:", error);
    return respond({
      status: 500,
      body: { ok: false, code: "internal_error", message: "Δεν ήταν δυνατή η αποθήκευση. Δοκίμασε ξανά σε λίγο." },
    });
  }
}

export function GET(): Response {
  return respond(menuItemMethodNotAllowed());
}
