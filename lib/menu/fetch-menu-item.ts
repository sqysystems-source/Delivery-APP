/* ==========================================================================
 *  Buka Delivery — lib/menu/fetch-menu-item.ts   (milestone 3)
 *
 *  Ένα προϊόν του καταλόγου, ΟΠΩΣ ΕΙΝΑΙ ΤΩΡΑ — για την «Επεξεργασία επιλογών»
 *  μιας γραμμής καλαθιού (το καλάθι κρατά μόνο στιγμιότυπο). Δημόσια
 *  ανάγνωση, ίδια με αυτή του καταλόγου στη σελίδα καταστήματος.
 *
 *  Καμία κλήση Firestore σε επίπεδο module: τίποτα δεν τρέχει μέχρι να
 *  κληθεί η συνάρτηση.
 * ========================================================================== */

import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { MenuItem } from "@/types";

/** `null` όταν το προϊόν δεν υπάρχει πια στον κατάλογο */
export async function fetchMenuItem(shopId: string, itemId: string): Promise<MenuItem | null> {
  if (!shopId || !itemId) return null;
  const snapshot = await getDoc(doc(db, "shops", shopId, "menuItems", itemId));
  if (!snapshot.exists()) return null;
  return { ...(snapshot.data() as Omit<MenuItem, "id">), id: snapshot.id, shopId };
}
