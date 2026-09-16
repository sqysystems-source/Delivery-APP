/* ==========================================================================
 *  Buka Delivery — lib/data.ts  (έκδοση Firestore)
 *
 *  ΤΟ ΜΟΝΑΔΙΚΟ ΣΗΜΕΙΟ ΕΠΑΦΗΣ ΜΕ ΤΑ ΔΕΔΟΜΕΝΑ.
 *  Κανένα component δεν άλλαξε σε αυτό το βήμα — μόνο τα σώματα των
 *  συναρτήσεων εδώ μέσα. Οι υπογραφές έμειναν ολόιδιες.
 *
 *  Δομή στο Firestore:
 *    shops/{shopId}
 *    shops/{shopId}/menuCategories/{categoryId}
 *    shops/{shopId}/menuItems/{itemId}
 *    orders/{orderId}
 *
 *  ΣΗΜΕΙΩΣΗ ΚΟΣΤΟΥΣ: κάθε κλήση fetchShops() είναι N document reads. Στο
 *  δωρεάν πλάνο (50k reads/ημέρα) είσαι άνετα εντάξει, αλλά όταν μεγαλώσει
 *  η κίνηση, μετακίνησε τα reads σε Server Components με `revalidate`, ώστε
 *  να μοιράζονται μεταξύ επισκεπτών αντί να γίνονται ανά browser.
 * ========================================================================== */

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type WithFieldValue,
} from "firebase/firestore";
import { db, ensureSignedIn } from "@/lib/firebase";
import { CUISINES, DELIVERY_ADDRESSES } from "@/lib/mock-data";
import type {
  Cuisine,
  Menu,
  MenuCategory,
  MenuItem,
  NewOrder,
  Order,
  Shop,
} from "@/types";

/* --------------------------------------------------------------------------
 *  Converters
 *
 *  Προσθέτουν αυτόματα το doc.id ως `id` και δίνουν τύπο στα queries, ώστε
 *  να μη σκορπάνε `as Shop` σε όλο το αρχείο.
 * -------------------------------------------------------------------------- */

function converter<T extends { id: string }>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data: WithFieldValue<T>): DocumentData {
      // Το id ζει στο path του document, δεν το διπλογράφουμε μέσα στο doc
      const { id: _ignored, ...rest } = data as WithFieldValue<T> & { id?: string };
      return rest as DocumentData;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot): T {
      return { ...(snapshot.data() as Omit<T, "id">), id: snapshot.id } as T;
    },
  };
}

const shopsCollection = collection(db, "shops").withConverter(converter<Shop>());

const menuCategoriesCollection = (shopId: string) =>
  collection(db, "shops", shopId, "menuCategories").withConverter(
    converter<MenuCategory>(),
  );

const menuItemsCollection = (shopId: string) =>
  collection(db, "shops", shopId, "menuItems").withConverter(converter<MenuItem>());

const ordersCollection = collection(db, "orders").withConverter(converter<Order>());

/* ==========================================================================
 *  READS
 * ========================================================================== */

/**
 * Κατηγορίες κουζίνας.
 *
 * Μένουν σκόπιμα τοπικές: είναι σταθερά της διεπαφής (8 τιμές με emoji),
 * αλλάζουν με deploy και όχι με δεδομένα. Έτσι γλιτώνεις 8 reads σε κάθε
 * φόρτωση της αρχικής. Αν κάποτε τις θες δυναμικές, φτιάξε collection
 * `cuisines` με πεδίο sortOrder και αντικατέστησε το σώμα.
 */
export async function fetchCuisines(): Promise<Cuisine[]> {
  return CUISINES;
}

/** Όλα τα ενεργά καταστήματα, με τα καλύτερα σε βαθμολογία πρώτα */
export async function fetchShops(): Promise<Shop[]> {
  const snapshot = await getDocs(query(shopsCollection, orderBy("rating", "desc")));
  return snapshot.docs.map((document) => document.data());
}

/**
 * Καταστήματα μιας κατηγορίας κουζίνας.
 * Χρησιμοποιεί array-contains πάνω στο `cuisineIds`.
 *
 * ΠΡΟΣΟΧΗ: ο συνδυασμός where + orderBy σε διαφορετικό πεδίο απαιτεί
 * composite index. Την πρώτη φορά που θα τρέξει, το Firestore θα σου
 * τυπώσει στην κονσόλα έτοιμο link για να το δημιουργήσεις με ένα κλικ.
 */
export async function fetchShopsByCuisine(cuisineId: string): Promise<Shop[]> {
  if (cuisineId === "all") return fetchShops();

  const snapshot = await getDocs(
    query(
      shopsCollection,
      where("cuisineIds", "array-contains", cuisineId),
      orderBy("rating", "desc"),
    ),
  );
  return snapshot.docs.map((document) => document.data());
}

/** Ένα κατάστημα με βάση το id — `null` όταν δεν υπάρχει (→ notFound()) */
export async function fetchShopById(shopId: string): Promise<Shop | null> {
  if (!shopId) return null;

  const snapshot = await getDoc(doc(shopsCollection, shopId));
  return snapshot.exists() ? snapshot.data() : null;
}

/**
 * Το πλήρες μενού ενός καταστήματος.
 * Οι δύο subcollections διαβάζονται παράλληλα — μία σειριακή αλυσίδα θα
 * διπλασίαζε τον χρόνο αναμονής.
 */
export async function fetchMenu(shopId: string): Promise<Menu> {
  if (!shopId) return { shopId, categories: [], items: [] };

  const [categoriesSnapshot, itemsSnapshot] = await Promise.all([
    getDocs(query(menuCategoriesCollection(shopId), orderBy("sortOrder", "asc"))),
    getDocs(menuItemsCollection(shopId)),
  ]);

  return {
    shopId,
    categories: categoriesSnapshot.docs.map((document) => document.data()),
    items: itemsSnapshot.docs.map((document) => document.data()),
  };
}

/**
 * Οι διευθύνσεις του χρήστη.
 * Παραμένουν τοπικές μέχρι να μπει κανονική σύνδεση χρήστη· τότε γίνονται
 * getDocs(collection(db, "users", uid, "addresses")).
 */
export async function fetchAddresses(): Promise<string[]> {
  return DELIVERY_ADDRESSES;
}

/** Ids καταστημάτων για generateStaticParams() σε server rendering */
export async function fetchShopIds(): Promise<string[]> {
  const snapshot = await getDocs(shopsCollection);
  return snapshot.docs.map((document) => document.id);
}

/** Το ιστορικό παραγγελιών του τρέχοντος χρήστη */
export async function fetchMyOrders(max = 20): Promise<Order[]> {
  const uid = await ensureSignedIn();

  const snapshot = await getDocs(
    query(
      ordersCollection,
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(max),
    ),
  );
  return snapshot.docs.map((document) => document.data());
}

/* ==========================================================================
 *  WRITES
 * ========================================================================== */

/**
 * Καταχώρηση παραγγελίας. Επιστρέφει τον κωδικό που βλέπει ο πελάτης.
 *
 * - `createdAt` γράφεται με serverTimestamp(): η ώρα του server, όχι του
 *   κινητού του πελάτη (που μπορεί να είναι λάθος ρυθμισμένο).
 * - `userId` μπαίνει από το ίδιο το SDK και ελέγχεται στα rules.
 * - Ο κωδικός παράγεται από το doc id, οπότε δεν χρειάζεται δεύτερο write.
 */
export async function submitOrder(order: NewOrder): Promise<string> {
  const uid = await ensureSignedIn();

  // Το createdAt του client δεν το εμπιστευόμαστε — το κρατάμε μόνο ως ένδειξη
  const { createdAt: clientCreatedAt, ...rest } = order;

  const reference = await addDoc(collection(db, "orders"), {
    ...rest,
    userId: uid,
    status: "pending",
    clientCreatedAt,
    createdAt: serverTimestamp(),
  });

  return `BK-${reference.id.slice(0, 6).toUpperCase()}`;
}
