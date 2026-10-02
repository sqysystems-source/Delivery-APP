/* ==========================================================================
 *  Buka Delivery — app/api/orders/recover/route.ts   (milestone 2)
 *
 *  POST /api/orders/recover — «ολοκληρώθηκε η προσπάθεια με αυτό το κλειδί;»
 *
 *  Το καλεί η σελίδα checkout όταν βρει αποθηκευμένο κλειδί προσπάθειας που
 *  δεν ξέρει αν πέτυχε (π.χ. ανανέωση μετά από χαμένη απάντηση), ή πριν
 *  στείλει ΝΕΟ κλειδί ενώ το προηγούμενο είναι αβέβαιο. ΔΕΝ δημιουργεί ποτέ
 *  παραγγελία. Η λογική και ο έλεγχος ιδιοκτησίας ζουν στο
 *  lib/server/checkout-service.ts (handleAttemptRecovery).
 *
 *  Αίτημα:   Authorization: Bearer <Firebase ID token>
 *            { "idempotencyKey": "…" }
 *  Απαντήσεις:
 *    200 { ok: true, outcome: "order_found", order: { …CheckoutSuccess, replayed: true } }
 *    200 { ok: true, outcome: "no_order" }      ← οριστικό: το κλειδί έκλεισε
 *    4xx/5xx { ok: false, code, message }
 * ========================================================================== */

import type { NextRequest } from "next/server";
import {
  MAX_RECOVERY_REQUEST_BYTES,
  handleAttemptRecovery,
  type CheckoutDeps,
  type RecoveryHttpResult,
} from "@/lib/server/checkout-service";
import { createCheckoutDeps } from "@/lib/server/checkout-deps";

export const runtime = "nodejs";
export const maxDuration = 30;

function respond(result: RecoveryHttpResult): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RECOVERY_REQUEST_BYTES) {
    return respond({
      status: 413,
      body: { ok: false, code: "payload_too_large", message: "Το αίτημα είναι πολύ μεγάλο." },
    });
  }

  let deps: CheckoutDeps;
  try {
    deps = createCheckoutDeps();
  } catch (error) {
    console.error("[orders/recover] Σφάλμα αρχικοποίησης Admin SDK:", error);
    return respond({
      status: 500,
      body: {
        ok: false,
        code: "server_misconfigured",
        message: "Δεν ήταν δυνατός ο έλεγχος της προηγούμενης παραγγελίας. Δοκίμασε ξανά σε λίγο.",
      },
    });
  }

  try {
    const rawBody = await request.text();
    return respond(
      await handleAttemptRecovery(deps, {
        authorization: request.headers.get("authorization"),
        rawBody,
      }),
    );
  } catch (error) {
    console.error("[orders/recover] Μη αναμενόμενο σφάλμα:", error);
    return respond({
      status: 500,
      body: {
        ok: false,
        code: "internal_error",
        message: "Δεν ήταν δυνατός ο έλεγχος της προηγούμενης παραγγελίας. Δοκίμασε ξανά σε λίγο.",
      },
    });
  }
}

export function GET(): Response {
  return respond({
    status: 405,
    body: { ok: false, code: "method_not_allowed", message: "Χρησιμοποίησε POST." },
  });
}
