/* ==========================================================================
 *  Buka Delivery — app/api/orders/route.ts
 *
 *  Δημιουργία παραγγελίας στον server. ΜΟΝΙΜΟ αρχείο.
 *
 *  ── ΤΟ ΒΑΣΙΚΟ ΑΞΙΩΜΑ ────────────────────────────────────────────────────
 *  Ο browser ΔΕΝ στέλνει τιμές. Στέλνει μόνο «ποιο κατάστημα, ποια
 *  προϊόντα, πόσα τεμάχια, πού». Κάθε ευρώ υπολογίζεται εδώ, διαβάζοντας
 *  τις πραγματικές τιμές από το Firestore. Ό,τι τιμή κι αν σκαρφιστεί
 *  κάποιος στο DevTools, αγνοείται — δεν υπάρχει καν πεδίο να τη βάλει.
 *
 *  ── ΤΙ ΕΛΕΓΧΕΤΑΙ ────────────────────────────────────────────────────────
 *   1. Ταυτότητα χρήστη μέσω Firebase ID token (και anonymous είναι δεκτό)
 *   2. Σχήμα και όρια του αιτήματος
 *   3. Ότι το κατάστημα υπάρχει και είναι ενεργό
 *   4. Ότι κάθε προϊόν υπάρχει ΣΤΟ ΣΥΓΚΕΚΡΙΜΕΝΟ κατάστημα και είναι διαθέσιμο
 *   5. Υπολογισμός σε λεπτά του ευρώ (ακέραιοι — μηδέν σφάλματα δεκαδικών)
 *   6. Ελάχιστη παραγγελία και μεταφορικά με τους όρους του καταστήματος
 *   7. Rate limit ανά χρήστη
 *
 *  ── ΠΡΟΫΠΟΘΕΣΕΙΣ ────────────────────────────────────────────────────────
 *  • package.json → "firebase-admin": "^14.4.0"
 *  • Vercel env → FIREBASE_SERVICE_ACCOUNT  (το ίδιο που έχεις ήδη)
 *  • Composite index: orders → userId (ASC) + createdAt (DESC).
 *    Την πρώτη φορά που θα χρειαστεί, το Firestore τυπώνει στα logs της
 *    Vercel έτοιμο link για δημιουργία με ένα κλικ.
 * ========================================================================== */

import { NextResponse, type NextRequest } from "next/server";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/* --------------------------------------------------------------------------
 *  Όρια ασφαλείας
 * -------------------------------------------------------------------------- */

const LIMITS = {
  maxLines: 40,
  maxQuantityPerLine: 20,
  maxTotalItems: 100,
  maxOrderTotalCents: 50_000, // 500,00€
  maxAddressLength: 200,
  maxNotesLength: 300,
  rateLimitWindowSeconds: 60,
  rateLimitMaxOrders: 5,
} as const;

/* --------------------------------------------------------------------------
 *  Admin SDK (singleton — το lambda της Vercel επαναχρησιμοποιείται)
 * -------------------------------------------------------------------------- */

type ServiceAccountJson = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function getAdminApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("Λείπει η μεταβλητή περιβάλλοντος FIREBASE_SERVICE_ACCOUNT.");
  }

  const parsed = JSON.parse(raw) as ServiceAccountJson;

  return initializeApp({
    credential: cert({
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    }),
  });
}

function getDb(): Firestore {
  return getFirestore(getAdminApp());
}

/* --------------------------------------------------------------------------
 *  Χρήμα: όλα σε λεπτά, ως ακέραιοι
 *
 *  Το 0.1 + 0.2 στη JavaScript δίνει 0.30000000000000004. Σε λογιστικά
 *  μεγέθη αυτό είναι απαράδεκτο, οπότε δουλεύουμε σε λεπτά και γυρνάμε σε
 *  ευρώ μόνο στο τέλος.
 * -------------------------------------------------------------------------- */

const toCents = (euros: number): number => Math.round(euros * 100);
const toEuros = (cents: number): number => Math.round(cents) / 100;

/* --------------------------------------------------------------------------
 *  Επικύρωση εισερχομένων
 * -------------------------------------------------------------------------- */

type LineInput = { itemId: string; quantity: number };

type OrderInput = {
  shopId: string;
  address: string;
  notes?: string;
  lines: LineInput[];
};

type ValidationResult =
  | { ok: true; value: OrderInput }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validateBody(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Μη έγκυρο αίτημα." };
  }

  const body = raw as Record<string, unknown>;

  if (!isNonEmptyString(body.shopId, 200)) {
    return { ok: false, error: "Λείπει το κατάστημα." };
  }

  if (!isNonEmptyString(body.address, LIMITS.maxAddressLength)) {
    return { ok: false, error: "Η διεύθυνση παράδοσης δεν είναι έγκυρη." };
  }

  if (
    body.notes !== undefined &&
    (typeof body.notes !== "string" || body.notes.length > LIMITS.maxNotesLength)
  ) {
    return { ok: false, error: "Το σχόλιο είναι πολύ μεγάλο." };
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return { ok: false, error: "Το καλάθι είναι άδειο." };
  }

  if (body.lines.length > LIMITS.maxLines) {
    return { ok: false, error: "Πάρα πολλά διαφορετικά προϊόντα στο καλάθι." };
  }

  const lines: LineInput[] = [];
  let totalItems = 0;

  for (const entry of body.lines) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: "Μη έγκυρη γραμμή παραγγελίας." };
    }

    const line = entry as Record<string, unknown>;

    if (!isNonEmptyString(line.itemId, 200)) {
      return { ok: false, error: "Μη έγκυρο προϊόν στο καλάθι." };
    }

    const quantity = line.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > LIMITS.maxQuantityPerLine
    ) {
      return {
        ok: false,
        error: `Μη έγκυρη ποσότητα (επιτρέπονται 1 έως ${LIMITS.maxQuantityPerLine} τεμάχια ανά προϊόν).`,
      };
    }

    totalItems += quantity;
    lines.push({ itemId: line.itemId, quantity });
  }

  if (totalItems > LIMITS.maxTotalItems) {
    return { ok: false, error: "Η παραγγελία έχει πάρα πολλά τεμάχια." };
  }

  return {
    ok: true,
    value: {
      shopId: body.shopId,
      address: body.address.trim(),
      notes: typeof body.notes === "string" ? body.notes.trim() : undefined,
      lines,
    },
  };
}

/** Ενοποιεί διπλές γραμμές του ίδιου προϊόντος */
function mergeDuplicateLines(lines: LineInput[]): LineInput[] {
  const merged = new Map<string, number>();
  for (const line of lines) {
    merged.set(line.itemId, (merged.get(line.itemId) ?? 0) + line.quantity);
  }
  return Array.from(merged, ([itemId, quantity]) => ({ itemId, quantity }));
}

/* --------------------------------------------------------------------------
 *  Ταυτοποίηση
 * -------------------------------------------------------------------------- */

async function resolveUid(request: NextRequest): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(match[1]);
    return decoded.uid;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
 *  Απαντήσεις
 * -------------------------------------------------------------------------- */

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

/* ==========================================================================
 *  POST /api/orders
 * ========================================================================== */

export async function POST(request: NextRequest) {
  /* ------------------------------ 1. Auth ------------------------------- */
  let uid: string | null;
  try {
    uid = await resolveUid(request);
  } catch (caught) {
    console.error("[orders] Σφάλμα αρχικοποίησης Admin SDK:", caught);
    return fail("Προσωρινό πρόβλημα διακομιστή. Δοκίμασε ξανά.", 500);
  }

  if (!uid) {
    return fail("Απαιτείται ταυτοποίηση. Ανανέωσε τη σελίδα και δοκίμασε ξανά.", 401);
  }

  /* --------------------------- 2. Επικύρωση ----------------------------- */
  const parsed = validateBody(await request.json().catch(() => null));
  if (!parsed.ok) {
    return fail(parsed.error, 400);
  }

  const input = parsed.value;
  const lines = mergeDuplicateLines(input.lines);

  try {
    const db = getDb();

    /* ------------------------ 3. Rate limiting ------------------------- */
    const cutoff = Timestamp.fromMillis(
      Date.now() - LIMITS.rateLimitWindowSeconds * 1000,
    );

    const recent = await db
      .collection("orders")
      .where("userId", "==", uid)
      .where("createdAt", ">", cutoff)
      .orderBy("createdAt", "desc")
      .limit(LIMITS.rateLimitMaxOrders + 1)
      .get();

    if (recent.size >= LIMITS.rateLimitMaxOrders) {
      return fail("Πολλές παραγγελίες σε σύντομο διάστημα. Περίμενε ένα λεπτό.", 429);
    }

    /* --------------------------- 4. Κατάστημα -------------------------- */
    const shopSnapshot = await db.collection("shops").doc(input.shopId).get();

    if (!shopSnapshot.exists) {
      return fail("Το κατάστημα δεν βρέθηκε.", 404);
    }

    const shop = shopSnapshot.data() as {
      name?: string;
      active?: boolean;
      minOrder?: number;
      deliveryFee?: number;
      freeDeliveryOver?: number | null;
      etaMinutes?: [number, number];
      ownerUid?: string | null;
    };

    if (shop.active === false) {
      return fail("Το κατάστημα είναι προσωρινά κλειστό.", 409);
    }

    /* ---------------------------- 5. Προϊόντα -------------------------- */
    const itemRefs = lines.map((line) =>
      shopSnapshot.ref.collection("menuItems").doc(line.itemId),
    );

    const itemSnapshots = await db.getAll(...itemRefs);

    const verifiedLines: Array<{
      itemId: string;
      name: string;
      unitPrice: number;
      quantity: number;
      lineTotal: number;
    }> = [];

    let subtotalCents = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const snapshot = itemSnapshots[index];

      if (!snapshot.exists) {
        return fail(
          "Κάποιο προϊόν δεν υπάρχει πια στον κατάλογο. Ανανέωσε το καλάθι σου.",
          409,
        );
      }

      const item = snapshot.data() as {
        name?: string;
        price?: number;
        available?: boolean;
      };

      if (item.available === false) {
        return fail(`Το προϊόν «${item.name ?? snapshot.id}» εξαντλήθηκε.`, 409);
      }

      if (typeof item.price !== "number" || !Number.isFinite(item.price) || item.price < 0) {
        console.error(`[orders] Άκυρη τιμή στο προϊόν ${snapshot.ref.path}`);
        return fail("Πρόβλημα με τον κατάλογο του καταστήματος.", 500);
      }

      // ΕΔΩ είναι το κρίσιμο σημείο: η τιμή έρχεται από τη ΒΑΣΗ, όχι από τον client
      const unitPriceCents = toCents(item.price);
      const lineTotalCents = unitPriceCents * line.quantity;
      subtotalCents += lineTotalCents;

      verifiedLines.push({
        itemId: snapshot.id,
        name: item.name ?? snapshot.id,
        unitPrice: toEuros(unitPriceCents),
        quantity: line.quantity,
        lineTotal: toEuros(lineTotalCents),
      });
    }

    /* ------------------------ 6. Οικονομικά ---------------------------- */
    const minOrderCents = toCents(shop.minOrder ?? 0);
    if (subtotalCents < minOrderCents) {
      return fail(
        `Η ελάχιστη παραγγελία για αυτό το κατάστημα είναι ${toEuros(minOrderCents).toFixed(2).replace(".", ",")}€.`,
        400,
      );
    }

    const baseDeliveryCents = toCents(shop.deliveryFee ?? 0);
    const freeOver = shop.freeDeliveryOver;
    const qualifiesForFreeDelivery =
      typeof freeOver === "number" && subtotalCents >= toCents(freeOver);

    const deliveryFeeCents = qualifiesForFreeDelivery ? 0 : baseDeliveryCents;
    const totalCents = subtotalCents + deliveryFeeCents;

    if (totalCents > LIMITS.maxOrderTotalCents) {
      return fail(
        "Η παραγγελία ξεπερνά το επιτρεπτό όριο. Επικοινώνησε μαζί μας για μεγάλες παραγγελίες.",
        400,
      );
    }

    /* -------------------------- 7. Εγγραφή ----------------------------- */
    const orderRef = await db.collection("orders").add({
      shopId: input.shopId,
      shopName: shop.name ?? input.shopId,
      /* Αποθηκεύουμε τον ιδιοκτήτη ΜΕΣΑ στην παραγγελία (denormalization).
       * Χωρίς αυτό, τα Security Rules θα έκαναν ένα get() στο κατάστημα για
       * ΚΑΘΕ παραγγελία που φορτώνει το ταμπλό — 50 παραγγελίες, 50 επιπλέον
       * reads σε κάθε άνοιγμα. Με αυτό, ο έλεγχος είναι απλή σύγκριση. */
      ownerUid: shop.ownerUid ?? null,
      address: input.address,
      lines: verifiedLines,
      subtotal: toEuros(subtotalCents),
      deliveryFee: toEuros(deliveryFeeCents),
      total: toEuros(totalCents),
      status: "pending",
      userId: uid,
      etaMinutes: shop.etaMinutes ?? null,
      createdAt: FieldValue.serverTimestamp(),
      source: "web",
      ...(input.notes ? { notes: input.notes } : {}),
    });

    const code = `BK-${orderRef.id.slice(0, 6).toUpperCase()}`;

    return NextResponse.json({
      ok: true,
      orderId: orderRef.id,
      code,
      subtotal: toEuros(subtotalCents),
      deliveryFee: toEuros(deliveryFeeCents),
      total: toEuros(totalCents),
    });
  } catch (caught) {
    // Τα εσωτερικά σφάλματα μένουν στα logs — ο πελάτης δεν βλέπει ποτέ stack trace
    console.error("[orders] Αποτυχία δημιουργίας παραγγελίας:", caught);
    return fail("Δεν ήταν δυνατή η καταχώρηση της παραγγελίας. Δοκίμασε ξανά.", 500);
  }
}

/* --------------------------------------------------------------------------
 *  Οτιδήποτε άλλο εκτός POST
 * -------------------------------------------------------------------------- */

export async function GET() {
  return fail("Χρησιμοποίησε POST για να καταχωρήσεις παραγγελία.", 405);
}
