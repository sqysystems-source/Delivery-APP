/* ==========================================================================
 *  Buka Delivery — scripts/seed.ts
 *
 *  Ανεβάζει τα δεδομένα του lib/mock-data.ts στο Firestore.
 *  Τρέχει σε Node με το Admin SDK, ΟΧΙ στον browser — το Admin SDK
 *  παρακάμπτει τα Security Rules, γι' αυτό και δεν πλησιάζει ποτέ το
 *  client bundle.
 *
 *  ── Εγκατάσταση ─────────────────────────────────────────────────────────
 *    npm i -D firebase-admin tsx
 *
 *  ── Κλειδί πρόσβασης ────────────────────────────────────────────────────
 *    Firebase Console → Project settings → Service accounts
 *      → «Generate new private key» → αποθήκευσέ το ως serviceAccountKey.json
 *      στη ρίζα του project.
 *
 *    ΠΡΟΣΘΕΣΕ ΤΟ ΑΜΕΣΩΣ ΣΤΟ .gitignore:
 *      serviceAccountKey.json
 *
 *    Αυτό το αρχείο δίνει πλήρη δικαιώματα στη βάση σου. Αν διαρρεύσει σε
 *    public repo, ο καθένας μπορεί να διαβάσει και να σβήσει τα πάντα.
 *
 *  ── Εκτέλεση ────────────────────────────────────────────────────────────
 *    npx tsx scripts/seed.ts            # γράφει/ενημερώνει (merge)
 *    npx tsx scripts/seed.ts --wipe     # σβήνει πρώτα τα παλιά menu docs
 *
 *  Πρόσθεσέ το και στο package.json:
 *    "scripts": { "seed": "tsx scripts/seed.ts" }
 * ========================================================================== */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cert, getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import {
  getFirestore,
  type CollectionReference,
  type Firestore,
} from "firebase-admin/firestore";

import { MENUS, SHOPS } from "../lib/mock-data";

/* --------------------------------------------------------------------------
 *  Αρχικοποίηση Admin SDK
 * -------------------------------------------------------------------------- */

const SERVICE_ACCOUNT_PATH = resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? "serviceAccountKey.json",
);

function initAdmin(): Firestore {
  if (getApps().length === 0) {
    if (existsSync(SERVICE_ACCOUNT_PATH)) {
      // Το cert() δέχεται απευθείας τη διαδρομή του αρχείου· το διαβάζουμε
      // μόνο για να τυπώσουμε σε ποιο project συνδεθήκαμε
      const { project_id: projectId } = JSON.parse(
        readFileSync(SERVICE_ACCOUNT_PATH, "utf8"),
      ) as { project_id: string };

      initializeApp({ credential: cert(SERVICE_ACCOUNT_PATH) });
      console.log(`🔑 Σύνδεση στο project: ${projectId}`);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: applicationDefault() });
      console.log("🔑 Σύνδεση μέσω GOOGLE_APPLICATION_CREDENTIALS");
    } else {
      console.error(
        `\n❌ Δεν βρέθηκε κλειδί.\n` +
          `   Περίμενα αρχείο στο: ${SERVICE_ACCOUNT_PATH}\n` +
          `   Κατέβασέ το από: Firebase Console → Project settings → Service accounts\n`,
      );
      process.exit(1);
    }
  }

  const firestore = getFirestore();
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}

/* --------------------------------------------------------------------------
 *  Βοηθητικά
 * -------------------------------------------------------------------------- */

const WIPE = process.argv.includes("--wipe");

/** Αφαιρεί το `id` πριν το γράψιμο — ζει ήδη στο path του document */
function withoutId<T extends { id: string }>(entity: T): Omit<T, "id"> {
  const { id: _ignored, ...rest } = entity;
  return rest;
}

/** Διαγράφει όλα τα documents ενός collection σε παρτίδες των 400 */
async function deleteCollection(
  firestore: Firestore,
  reference: CollectionReference,
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

/* --------------------------------------------------------------------------
 *  Seed
 * -------------------------------------------------------------------------- */

async function seed(): Promise<void> {
  const firestore = initAdmin();

  console.log(
    `\n🌱 Έναρξη seeding${WIPE ? " (με --wipe: τα παλιά menu docs θα σβηστούν)" : ""}\n`,
  );

  let shopCount = 0;
  let categoryCount = 0;
  let itemCount = 0;

  for (const shop of SHOPS) {
    const shopReference = firestore.collection("shops").doc(shop.id);

    /* ------------------------------ Κατάστημα ------------------------------ */
    await shopReference.set(
      {
        ...withoutId(shop),
        // Χρήσιμα πεδία για το B2B κομμάτι — δες και τα Security Rules
        active: true,
        ownerUid: null, // συμπληρώνεται όταν ο καταστηματάρχης αποκτήσει λογαριασμό
        updatedAt: new Date(),
      },
      { merge: true },
    );
    shopCount += 1;

    const categoriesReference = shopReference.collection("menuCategories");
    const itemsReference = shopReference.collection("menuItems");

    if (WIPE) {
      const removedCategories = await deleteCollection(firestore, categoriesReference);
      const removedItems = await deleteCollection(firestore, itemsReference);
      if (removedCategories + removedItems > 0) {
        console.log(
          `   🧹 ${shop.name}: διαγράφηκαν ${removedCategories} κατηγορίες, ${removedItems} προϊόντα`,
        );
      }
    }

    const menu = MENUS[shop.id];
    if (!menu) {
      console.warn(`   ⚠️  Δεν βρέθηκε μενού για «${shop.name}» — παραλείπεται`);
      continue;
    }

    /* ------------------------------ Κατηγορίες ----------------------------- */
    const categoryBatch = firestore.batch();
    for (const category of menu.categories) {
      categoryBatch.set(categoriesReference.doc(category.id), withoutId(category), {
        merge: true,
      });
      categoryCount += 1;
    }
    await categoryBatch.commit();

    /* ------------------------------- Προϊόντα ------------------------------ */
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

    console.log(
      `   ✅ ${shop.name} — ${menu.categories.length} κατηγορίες, ${menu.items.length} προϊόντα`,
    );
  }

  /* -------------------------------- Έλεγχος ------------------------------- */
  const verification = await firestore.collection("shops").get();

  console.log(
    `\n🎉 Ολοκληρώθηκε!\n` +
      `   Καταστήματα: ${shopCount}\n` +
      `   Κατηγορίες:  ${categoryCount}\n` +
      `   Προϊόντα:    ${itemCount}\n` +
      `   Επαλήθευση:  ${verification.size} documents στο collection «shops»\n`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("\n❌ Το seeding απέτυχε:\n", error);
    process.exit(1);
  });
