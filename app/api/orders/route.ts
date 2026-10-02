/* ==========================================================================
 *  Buka Delivery — app/api/orders/route.ts
 *
 *  POST /api/orders — δημιουργία παραγγελίας. Λεπτό «καλώδιο»: συνδέει το
 *  Firebase Admin SDK με τη λογική του lib/server/checkout-service.ts, όπου
 *  γίνονται επικύρωση, τιμολόγηση, idempotency και καταχώρηση.
 *
 *  Απαντήσεις (JSON):
 *    201  νέα παραγγελία                      { ok: true, orderId, code, lines, … }
 *    200  επανάληψη ίδιου κλειδιού            { ok: true, …, replayed: true }
 *    4xx/5xx                                  { ok: false, code, message, … }
 *
 *  Next.js 16: το `runtime` είναι ήδη "nodejs" από προεπιλογή — το δηλώνουμε
 *  ρητά επειδή το firebase-admin ΔΕΝ τρέχει στο Edge. Τα POST handlers δεν
 *  αποθηκεύονται ποτέ στην cache, οπότε δεν χρειάζεται `dynamic`.
 * ========================================================================== */

import type { NextRequest } from "next/server";
import {
  handleCheckoutRequest,
  methodNotAllowed,
  serverMisconfigured,
  type CheckoutDeps,
  type CheckoutHttpResult,
} from "@/lib/server/checkout-service";
import { createCheckoutDeps } from "@/lib/server/checkout-deps";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";

export const runtime = "nodejs";
export const maxDuration = 30;

function respond(result: CheckoutHttpResult): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  /* Γρήγορη απόρριψη πολύ μεγάλων σωμάτων πριν τα διαβάσουμε */
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > CHECKOUT_LIMITS.maxRequestBytes) {
    return respond({
      status: 413,
      body: { ok: false, code: "payload_too_large", message: "Το αίτημα είναι πολύ μεγάλο." },
    });
  }

  let deps: CheckoutDeps;
  try {
    deps = createCheckoutDeps();
  } catch (error) {
    console.error("[orders] Σφάλμα αρχικοποίησης Admin SDK:", error);
    return respond(serverMisconfigured());
  }

  try {
    const rawBody = await request.text();
    const result = await handleCheckoutRequest(deps, {
      authorization: request.headers.get("authorization"),
      rawBody,
    });
    return respond(result);
  } catch (error) {
    console.error("[orders] Μη αναμενόμενο σφάλμα:", error);
    return respond({
      status: 500,
      body: {
        ok: false,
        code: "internal_error",
        message: "Δεν ήταν δυνατή η καταχώρηση της παραγγελίας. Δοκίμασε ξανά σε λίγο.",
      },
    });
  }
}

export function GET(): Response {
  return respond(methodNotAllowed());
}
