"use client";

/* ==========================================================================
 *  Buka Delivery — hooks/useMenuManager.ts
 *
 *  Διαχείριση καταλόγου για τον καταστηματάρχη: ζωντανή λίστα προϊόντων,
 *  εναλλαγή διαθεσιμότητας, δημιουργία, επεξεργασία, διαγραφή.
 *
 *  Όλα τα γραψίματα γίνονται μέσα στο `shops/{shopId}/menuItems`, δηλαδή
 *  στο υποσύνολο που τα Security Rules ελέγχουν με isShopOwner(shopId).
 *  Δεν υπάρχει τρόπος να γράψει κάποιος σε ξένο κατάλογο — ούτε κατά λάθος:
 *  το shopId μπαίνει στη διαδρομή, δεν έρχεται από τη φόρμα.
 *
 *  ── ΠΡΟΣΟΧΗ ΣΤΑ ΠΡΟΑΙΡΕΤΙΚΑ ΠΕΔΙΑ ──────────────────────────────────────
 *  Τα rules ελέγχουν τον τύπο ενός πεδίου ΜΟΝΟ αν αυτό υπάρχει. Άρα, όταν ο
 *  καταστηματάρχης σβήνει την παλιά τιμή ή την εικόνα, ΔΕΝ γράφουμε null
 *  (θα απορριπτόταν: το null δεν είναι number) — διαγράφουμε το πεδίο με
 *  deleteField().
 * ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { MenuCategory, MenuItem } from "@/types";

/* --------------------------------------------------------------------------
 *  Τύποι
 * -------------------------------------------------------------------------- */

/** Τα πεδία που συμπληρώνει ο καταστηματάρχης στη φόρμα */
export type MenuItemInput = {
  name: string;
  description: string;
  categoryId: string;
  price: number;
  /** null ή 0 σημαίνει «χωρίς προσφορά» */
  oldPrice: number | null;
  image: string | null;
  popular: boolean;
  available: boolean;
};

export type UseMenuManager = {
  categories: MenuCategory[];
  items: MenuItem[];
  loading: boolean;
  error: string | null;
  /** Το id του προϊόντος που ενημερώνεται αυτή τη στιγμή */
  busyId: string | null;
  toggleAvailability: (item: MenuItem) => Promise<void>;
  saveItem: (input: MenuItemInput, itemId?: string) => Promise<void>;
  deleteItem: (itemId: string) => Promise<void>;
};

/* --------------------------------------------------------------------------
 *  Μετατροπές document → τύπος
 * -------------------------------------------------------------------------- */

function mapCategory(id: string, data: Record<string, unknown>): MenuCategory {
  return {
    id,
    label: typeof data.label === "string" ? data.label : id,
    emoji: typeof data.emoji === "string" ? data.emoji : "🍽️",
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 999,
  };
}

function mapItem(id: string, shopId: string, data: Record<string, unknown>): MenuItem {
  return {
    id,
    shopId,
    categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
    name: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
    price: typeof data.price === "number" ? data.price : 0,
    oldPrice: typeof data.oldPrice === "number" ? data.oldPrice : undefined,
    image: typeof data.image === "string" ? data.image : undefined,
    popular: data.popular === true,
    /* Προϊόν χωρίς το πεδίο θεωρείται διαθέσιμο — έτσι τα παλιά seeded
     * documents δεν εμφανίζονται ξαφνικά ως εξαντλημένα. */
    available: data.available !== false,
  };
}

/* --------------------------------------------------------------------------
 *  Το hook
 * -------------------------------------------------------------------------- */

export function useMenuManager(shopId: string | null): UseMenuManager {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /* --------------------------- Κατηγορίες ---------------------------- */
  useEffect(() => {
    if (!shopId) return;

    setCategoriesLoaded(false);

    const unsubscribe = onSnapshot(
      query(
        collection(db, "shops", shopId, "menuCategories"),
        orderBy("sortOrder", "asc"),
      ),
      (snapshot) => {
        setCategories(
          snapshot.docs.map((document) =>
            mapCategory(document.id, document.data() as Record<string, unknown>),
          ),
        );
        setCategoriesLoaded(true);
      },
      (caught) => {
        console.error("[menu] Σφάλμα κατηγοριών:", caught);
        setError("Δεν ήταν δυνατή η φόρτωση των κατηγοριών.");
        setCategoriesLoaded(true);
      },
    );

    return unsubscribe;
  }, [shopId]);

  /* ---------------------------- Προϊόντα ----------------------------- */
  useEffect(() => {
    if (!shopId) return;

    setItemsLoaded(false);

    const unsubscribe = onSnapshot(
      collection(db, "shops", shopId, "menuItems"),
      (snapshot) => {
        setItems(
          snapshot.docs.map((document) =>
            mapItem(document.id, shopId, document.data() as Record<string, unknown>),
          ),
        );
        setError(null);
        setItemsLoaded(true);
      },
      (caught) => {
        console.error("[menu] Σφάλμα προϊόντων:", caught);
        setError(
          caught.code === "permission-denied"
            ? "Δεν έχεις δικαίωμα διαχείρισης αυτού του καταλόγου."
            : "Δεν ήταν δυνατή η φόρτωση των προϊόντων.",
        );
        setItemsLoaded(true);
      },
    );

    return unsubscribe;
  }, [shopId]);

  /* ------------------------ Εναλλαγή διαθεσιμότητας ------------------ */
  const toggleAvailability = useCallback(
    async (item: MenuItem) => {
      if (!shopId) return;

      setBusyId(item.id);
      try {
        await updateDoc(doc(db, "shops", shopId, "menuItems", item.id), {
          available: item.available === false,
          updatedAt: serverTimestamp(),
        });
      } catch (caught) {
        console.error("[menu] Αποτυχία αλλαγής διαθεσιμότητας:", caught);
        throw new Error("Δεν ήταν δυνατή η αλλαγή διαθεσιμότητας.");
      } finally {
        setBusyId(null);
      }
    },
    [shopId],
  );

  /* --------------------- Δημιουργία / επεξεργασία -------------------- */
  const saveItem = useCallback(
    async (input: MenuItemInput, itemId?: string) => {
      if (!shopId) throw new Error("Δεν βρέθηκε κατάστημα.");

      setBusyId(itemId ?? "new");

      /* Κοινά πεδία. Το shopId μπαίνει από τη διαδρομή, ΠΟΤΕ από τη φόρμα. */
      const base = {
        shopId,
        categoryId: input.categoryId,
        name: input.name.trim(),
        description: input.description.trim(),
        price: input.price,
        popular: input.popular,
        available: input.available,
        updatedAt: serverTimestamp(),
      };

      const hasOldPrice = input.oldPrice !== null && input.oldPrice > input.price;
      const hasImage = typeof input.image === "string" && input.image.trim().length > 0;

      try {
        if (itemId) {
          /* Ενημέρωση: τα προαιρετικά πεδία που «άδειασαν» διαγράφονται */
          await updateDoc(doc(db, "shops", shopId, "menuItems", itemId), {
            ...base,
            oldPrice: hasOldPrice ? input.oldPrice : deleteField(),
            image: hasImage ? input.image!.trim() : deleteField(),
          });
        } else {
          /* Δημιουργία: τα κενά προαιρετικά απλώς δεν γράφονται */
          await addDoc(collection(db, "shops", shopId, "menuItems"), {
            ...base,
            ...(hasOldPrice ? { oldPrice: input.oldPrice } : {}),
            ...(hasImage ? { image: input.image!.trim() } : {}),
            createdAt: serverTimestamp(),
          });
        }
      } catch (caught) {
        console.error("[menu] Αποτυχία αποθήκευσης προϊόντος:", caught);
        throw new Error(
          "Δεν ήταν δυνατή η αποθήκευση. Έλεγξε τα πεδία και δοκίμασε ξανά.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [shopId],
  );

  /* ---------------------------- Διαγραφή ----------------------------- */
  const deleteItem = useCallback(
    async (itemId: string) => {
      if (!shopId) return;

      setBusyId(itemId);
      try {
        await deleteDoc(doc(db, "shops", shopId, "menuItems", itemId));
      } catch (caught) {
        console.error("[menu] Αποτυχία διαγραφής:", caught);
        throw new Error("Δεν ήταν δυνατή η διαγραφή του προϊόντος.");
      } finally {
        setBusyId(null);
      }
    },
    [shopId],
  );

  /* ----------------------------- Ταξινόμηση -------------------------- */
  const sortedItems = useMemo(() => {
    const order = new Map(categories.map((category, index) => [category.id, index]));

    return [...items].sort((a, b) => {
      const categoryDiff =
        (order.get(a.categoryId) ?? 999) - (order.get(b.categoryId) ?? 999);
      if (categoryDiff !== 0) return categoryDiff;
      return a.name.localeCompare(b.name, "el");
    });
  }, [items, categories]);

  return {
    categories,
    items: sortedItems,
    loading: !shopId || !categoriesLoaded || !itemsLoaded,
    error,
    busyId,
    toggleAvailability,
    saveItem,
    deleteItem,
  };
}
