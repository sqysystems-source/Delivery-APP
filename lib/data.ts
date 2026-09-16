/* ==========================================================================
 *  Buka Delivery — lib/data.ts
 *
 *  ΤΟ ΜΟΝΑΔΙΚΟ ΣΗΜΕΙΟ ΕΠΑΦΗΣ ΜΕ ΤΑ ΔΕΔΟΜΕΝΑ.
 *  Κανένα component δεν εισάγει mock arrays — όλα καλούν αυτές τις
 *  συναρτήσεις. Για τη μετάβαση στο Firebase αλλάζει ΜΟΝΟ το σώμα τους.
 *
 *  ── Έκδοση Firebase (για αργότερα) ──────────────────────────────────────
 *  import { db } from "@/lib/firebase";
 *  import {
 *    collection, doc, getDoc, getDocs, addDoc, query, orderBy,
 *    where, serverTimestamp,
 *  } from "firebase/firestore";
 *
 *  export async function fetchShops(): Promise<Shop[]> {
 *    const snap = await getDocs(collection(db, "shops"));
 *    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shop);
 *  }
 *
 *  export async function fetchShopById(shopId: string): Promise<Shop | null> {
 *    const snap = await getDoc(doc(db, "shops", shopId));
 *    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Shop) : null;
 *  }
 *
 *  export async function fetchMenu(shopId: string): Promise<Menu> {
 *    const [catsSnap, itemsSnap] = await Promise.all([
 *      getDocs(query(collection(db, "shops", shopId, "menuCategories"), orderBy("sortOrder"))),
 *      getDocs(collection(db, "shops", shopId, "menuItems")),
 *    ]);
 *    return {
 *      shopId,
 *      categories: catsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as MenuCategory),
 *      items: itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as MenuItem),
 *    };
 *  }
 *
 *  export async function submitOrder(order: NewOrder): Promise<string> {
 *    const ref = await addDoc(collection(db, "orders"), {
 *      ...order,
 *      createdAt: serverTimestamp(),
 *    });
 *    return ref.id;
 *  }
 * ========================================================================== */

import { CUISINES, DELIVERY_ADDRESSES, MENUS, SHOPS } from "@/lib/mock-data";
import type { Cuisine, Menu, NewOrder, Shop } from "@/types";

/** Προσομοίωση καθυστέρησης δικτύου, ώστε τα loading states να είναι αληθινά */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/* --------------------------------------------------------------------------
 *  Reads
 * -------------------------------------------------------------------------- */

/** Όλες οι κατηγορίες κουζίνας για τα pills της αρχικής */
export async function fetchCuisines(): Promise<Cuisine[]> {
  await delay(120);
  return CUISINES;
}

/** Όλα τα καταστήματα */
export async function fetchShops(): Promise<Shop[]> {
  await delay(350);
  return SHOPS;
}

/** Ένα κατάστημα με βάση το id — `null` όταν δεν υπάρχει (→ notFound()) */
export async function fetchShopById(shopId: string): Promise<Shop | null> {
  await delay(250);
  return SHOPS.find((shop) => shop.id === shopId) ?? null;
}

/**
 * Το μενού ενός καταστήματος.
 * Οι κατηγορίες επιστρέφονται ταξινομημένες κατά `sortOrder`.
 */
export async function fetchMenu(shopId: string): Promise<Menu> {
  await delay(450);
  const menu = MENUS[shopId];
  if (!menu) {
    return { shopId, categories: [], items: [] };
  }
  return {
    ...menu,
    categories: [...menu.categories].sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/** Οι αποθηκευμένες διευθύνσεις του χρήστη */
export async function fetchAddresses(): Promise<string[]> {
  await delay(80);
  return DELIVERY_ADDRESSES;
}

/**
 * Ids καταστημάτων για το `generateStaticParams()` του δυναμικού route.
 * Με Firebase: getDocs(collection(db, "shops")) και map στα ids.
 */
export async function fetchShopIds(): Promise<string[]> {
  return SHOPS.map((shop) => shop.id);
}

/* --------------------------------------------------------------------------
 *  Writes
 * -------------------------------------------------------------------------- */

/** Καταχώρηση παραγγελίας — επιστρέφει τον κωδικό παραγγελίας */
export async function submitOrder(order: NewOrder): Promise<string> {
  await delay(1100);
  // eslint-disable-next-line no-console
  console.log("[Buka] Νέα παραγγελία προς αποστολή:", order);
  return `BK-${Math.floor(100000 + Math.random() * 900000)}`;
}
