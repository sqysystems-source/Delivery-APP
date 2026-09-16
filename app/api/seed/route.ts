/* ==========================================================================
 *  Buka Delivery — app/api/seed/route.ts       ⚠️ ΠΡΟΣΩΡΙΝΟ ΑΡΧΕΙΟ ⚠️
 *
 *  Τρέχει το seeding από τον browser, χωρίς terminal.
 *
 *  ΓΙΑΤΙ API ROUTE ΚΑΙ ΟΧΙ ΑΠΕΥΘΕΙΑΣ ΑΠΟ ΤΗ ΣΕΛΙΔΑ:
 *  Τα Security Rules απαγορεύουν εγγραφή στο `shops` από τον browser — και
 *  σωστά. Αυτός ο κώδικας τρέχει στον server της Vercel με το Admin SDK,
 *  το οποίο παρακάμπτει τα rules. Το κλειδί δεν φτάνει ποτέ στον browser.
 *
 *  ── ΤΙ ΠΡΕΠΕΙ ΝΑ ΚΑΝΕΙΣ ΠΡΙΝ ────────────────────────────────────────────
 *
 *  1) package.json → dependencies (μέσω GitHub web UI):
 *       "firebase-admin": "^14.4.0"
 *
 *  2) Vercel → Settings → Environment Variables (δύο νέες):
 *
 *     FIREBASE_SERVICE_ACCOUNT
 *       Άνοιξε το serviceAccountKey.json που κατέβασες από το
 *       Firebase Console (Project settings → Service accounts →
 *       Generate new private key) και κάνε επικόλληση ΟΛΟΚΛΗΡΟ το
 *       περιεχόμενό του ως τιμή. Δεν πειράζεις τίποτα μέσα.
 *
 *     SEED_SECRET
 *       Ένας δικός σου τυχαίος κωδικός, π.χ. 30+ χαρακτήρες. Χωρίς αυτόν
 *       το endpoint αρνείται να τρέξει, ώστε να μη μπορεί ο οποιοσδήποτε
 *       να πειράξει τη βάση σου.
 *
 *     Και τα δύο σε Production + Preview + Development, και μετά Redeploy.
 *
 *  ── ΜΕΤΑ ΤΟ SEEDING ─────────────────────────────────────────────────────
 *  Σβήσε αυτό το αρχείο ΚΑΙ το app/seed/page.tsx, και διέγραψε το
 *  SEED_SECRET από τη Vercel. Το FIREBASE_SERVICE_ACCOUNT κράτησέ το μόνο
 *  αν θα φτιάξεις το server-side API παραγγελιών.
 * ========================================================================== */

import { NextResponse, type NextRequest } from "next/server";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { MENUS, SHOPS } from "@/lib/mock-data";

/* Το firebase-admin χρειάζεται Node runtime — δεν τρέχει σε Edge */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* --------------------------------------------------------------------------
 *  Admin SDK
 * -------------------------------------------------------------------------- */

type ServiceAccountJson = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function getAdminDb(): Firestore {
  const existing = getApps();
  let app: App;

  if (existing.length > 0) {
    app = existing[0];
  } else {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!raw) {
      throw new Error(
        "Λείπει η μεταβλητή FIREBASE_SERVICE_ACCOUNT. Πρόσθεσέ την στη Vercel " +
          "(Settings → Environment Variables) και κάνε Redeploy.",
      );
    }

    let parsed: ServiceAccountJson;
    try {
      parsed = JSON.parse(raw) as ServiceAccountJson;
    } catch {
      throw new Error(
        "Η FIREBASE_SERVICE_ACCOUNT δεν είναι έγκυρο JSON. Επικόλλησε ολόκληρο " +
          "το περιεχόμενο του serviceAccountKey.json, από { μέχρι }.",
      );
    }

    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error(
        "Το JSON του service account δεν έχει project_id / client_email / private_key.",
      );
    }

    app = initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        // Αν το περιβάλλον έχει μετατρέψει τις αλλαγές γραμμής σε \n, τις γυρνάμε πίσω
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      }),
    });
  }

  const firestore = getFirestore(app);
  try {
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch {
    /* Το settings() επιτρέπεται μία φορά ανά instance — σε warm lambda σκάει, το αγνοούμε */
  }
  return firestore;
}

/* --------------------------------------------------------------------------
 *  Ασφάλεια
 * -------------------------------------------------------------------------- */

function checkSecret(request: NextRequest): string | null {
  const expected = process.env.SEED_SECRET;

  if (!expected) {
    return "Δεν έχει οριστεί SEED_SECRET στη Vercel. Για ασφάλεια, το endpoint είναι κλειστό.";
  }

  const provided =
    request.headers.get("x-seed-secret") ??
    new URL(request.url).searchParams.get("secret") ??
    "";

  if (provided !== expected) {
    return "Λάθος κωδικός.";
  }
  return null;
}

/* --------------------------------------------------------------------------
 *  Βοηθητικά
 * -------------------------------------------------------------------------- */

function withoutId<T extends { id: string }>(entity: T): Omit<T, "id"> {
  const { id: _ignored, ...rest } = entity;
  return rest;
}

async function deleteAll(
  firestore: Firestore,
  reference: FirebaseFirestore.CollectionReference,
): Promise<number> {
  const snapshot = await reference.get();
  if (snapshot.empty) return 0;

  let deleted = 0;
  for (let index = 0; index < snapshot.docs.length; index += 400) {
    const batch = firestore.batch();
    snapshot.docs.slice(index, index + 400).forEach((document) => {
      batch.delete(document.ref);
      deleted += 1;
    });
    await batch.commit();
  }
  return deleted;
}

/* ==========================================================================
 *  GET — έλεγχος τρέχουσας κατάστασης βάσης
 * ========================================================================== */

export async function GET(request: NextRequest) {
  const error = checkSecret(request);
  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 401 });
  }

  try {
    const firestore = getAdminDb();
    const shopsSnapshot = await firestore.collection("shops").get();

    const shops = await Promise.all(
      shopsSnapshot.docs.map(async (document) => {
        const [categories, items] = await Promise.all([
          document.ref.collection("menuCategories").count().get(),
          document.ref.collection("menuItems").count().get(),
        ]);

        return {
          id: document.id,
          name: (document.data().name as string) ?? document.id,
          categories: categories.data().count,
          items: items.data().count,
        };
      }),
    );

    const ordersSnapshot = await firestore.collection("orders").count().get();

    return NextResponse.json({
      ok: true,
      shopCount: shopsSnapshot.size,
      orderCount: ordersSnapshot.data().count,
      shops,
    });
  } catch (caught) {
    return NextResponse.json(
      { ok: false, error: caught instanceof Error ? caught.message : String(caught) },
      { status: 500 },
    );
  }
}

/* ==========================================================================
 *  POST — εκτέλεση seeding
 * ========================================================================== */

export async function POST(request: NextRequest) {
  const error = checkSecret(request);
  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 401 });
  }

  const startedAt = Date.now();
  const log: string[] = [];

  try {
    const firestore = getAdminDb();

    const body = (await request.json().catch(() => ({}))) as { wipe?: boolean };
    const wipe = body.wipe === true;

    log.push(
      wipe
        ? "🧹 Λειτουργία --wipe: τα παλιά προϊόντα και οι κατηγορίες διαγράφονται πρώτα."
        : "♻️ Λειτουργία merge: τα υπάρχοντα documents ενημερώνονται.",
    );

    let shopCount = 0;
    let categoryCount = 0;
    let itemCount = 0;

    for (const shop of SHOPS) {
      const shopReference = firestore.collection("shops").doc(shop.id);

      await shopReference.set(
        {
          ...withoutId(shop),
          active: true,
          ownerUid: null,
          updatedAt: new Date(),
        },
        { merge: true },
      );
      shopCount += 1;

      const categoriesReference = shopReference.collection("menuCategories");
      const itemsReference = shopReference.collection("menuItems");

      if (wipe) {
        const removed =
          (await deleteAll(firestore, categoriesReference)) +
          (await deleteAll(firestore, itemsReference));
        if (removed > 0) {
          log.push(`🧹 ${shop.name}: διαγράφηκαν ${removed} παλιά documents`);
        }
      }

      const menu = MENUS[shop.id];
      if (!menu) {
        log.push(`⚠️ ${shop.name}: δεν βρέθηκε μενού — παραλείφθηκε`);
        continue;
      }

      const categoryBatch = firestore.batch();
      for (const category of menu.categories) {
        categoryBatch.set(categoriesReference.doc(category.id), withoutId(category), {
          merge: true,
        });
        categoryCount += 1;
      }
      await categoryBatch.commit();

      for (let index = 0; index < menu.items.length; index += 400) {
        const itemBatch = firestore.batch();
        for (const item of menu.items.slice(index, index + 400)) {
          itemBatch.set(
            itemsReference.doc(item.id),
            { ...withoutId(item), available: item.available ?? true },
            { merge: true },
          );
          itemCount += 1;
        }
        await itemBatch.commit();
      }

      log.push(
        `✅ ${shop.name} — ${menu.categories.length} κατηγορίες, ${menu.items.length} προϊόντα`,
      );
    }

    const verification = await firestore.collection("shops").get();

    return NextResponse.json({
      ok: true,
      shopCount,
      categoryCount,
      itemCount,
      verifiedShops: verification.size,
      durationMs: Date.now() - startedAt,
      log,
    });
  } catch (caught) {
    return NextResponse.json(
      {
        ok: false,
        error: caught instanceof Error ? caught.message : String(caught),
        log,
      },
      { status: 500 },
    );
  }
}
