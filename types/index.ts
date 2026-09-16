/* ==========================================================================
 *  Buka Delivery — types/index.ts
 *
 *  Κεντρικοί τύποι της εφαρμογής. Κάθε τύπος αντιστοιχεί 1:1 με ένα
 *  Firestore document, ώστε η μετάβαση στο Firebase να μην απαιτεί
 *  αλλαγές στα components.
 *
 *  Firestore σχήμα:
 *    cuisines/{cuisineId}
 *    shops/{shopId}
 *    shops/{shopId}/menuCategories/{categoryId}
 *    shops/{shopId}/menuItems/{itemId}
 *    orders/{orderId}
 * ========================================================================== */

/* --------------------------------------------------------------------------
 *  Κοινά
 * -------------------------------------------------------------------------- */

/** Χρωματικός τόνος για τα badges των καταστημάτων */
export type TagTone = "green" | "orange" | "purple";

/** Ετικέτα καταστήματος, π.χ. «Δωρεάν Delivery» */
export type ShopTag = {
  label: string;
  tone: TagTone;
};

/* --------------------------------------------------------------------------
 *  Κατηγορίες κουζίνας (αρχική σελίδα)
 *  collection: `cuisines`
 * -------------------------------------------------------------------------- */

export type Cuisine = {
  id: string;
  label: string;
  emoji: string;
};

/* --------------------------------------------------------------------------
 *  Κατάστημα
 *  collection: `shops`  (doc id === shop.id)
 * -------------------------------------------------------------------------- */

export type Shop = {
  id: string;
  name: string;
  /** Περιγραφή κουζίνας για εμφάνιση, π.χ. «Σουβλάκι • Ψητά • Μεζέδες» */
  cuisineLabel: string;
  /** Ids κατηγοριών για φιλτράρισμα — Firestore: array-contains query */
  cuisineIds: string[];
  rating: number;
  reviews: number;
  /** Εύρος χρόνου παράδοσης σε λεπτά: [από, έως] */
  etaMinutes: [number, number];
  /** Ελάχιστη παραγγελία σε ευρώ */
  minOrder: number;
  /** Κόστος μεταφορικών σε ευρώ (0 = δωρεάν πάντα) */
  deliveryFee: number;
  /** Ποσό πάνω από το οποίο τα μεταφορικά μηδενίζονται (null = ποτέ) */
  freeDeliveryOver: number | null;
  image: string;
  /** Tailwind gradient classes για placeholder/φόντο εικόνας */
  gradient: string;
  address: string;
  tag?: ShopTag;
};

/* --------------------------------------------------------------------------
 *  Μενού
 *  subcollections: `shops/{shopId}/menuCategories`, `shops/{shopId}/menuItems`
 * -------------------------------------------------------------------------- */

export type MenuCategory = {
  id: string;
  label: string;
  emoji: string;
  /** Σειρά εμφάνισης — Firestore: orderBy("sortOrder") */
  sortOrder: number;
};

export type MenuItem = {
  id: string;
  shopId: string;
  categoryId: string;
  name: string;
  description: string;
  /** Τρέχουσα τιμή σε ευρώ */
  price: number;
  /** Αρχική τιμή, όταν το προϊόν είναι σε προσφορά */
  oldPrice?: number;
  image?: string;
  popular?: boolean;
  /** false όταν το προϊόν έχει εξαντληθεί */
  available?: boolean;
};

/** Πλήρες μενού καταστήματος, όπως το επιστρέφει το data layer */
export type Menu = {
  shopId: string;
  categories: MenuCategory[];
  items: MenuItem[];
};

/* --------------------------------------------------------------------------
 *  Καλάθι
 * -------------------------------------------------------------------------- */

/** Γραμμή καλαθιού — κρατάει snapshot της τιμής τη στιγμή της προσθήκης */
export type CartLine = {
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
};

/**
 * Τα στοιχεία του καταστήματος που χρειάζεται το καλάθι για να υπολογίσει
 * σύνολα, χωρίς να ξαναφορτώσει ολόκληρο το Shop document.
 */
export type CartShopRef = {
  id: string;
  name: string;
  minOrder: number;
  deliveryFee: number;
  freeDeliveryOver: number | null;
};

/** Ένα καλάθι ανά κατάστημα κάθε φορά */
export type CartState = {
  shop: CartShopRef | null;
  lines: CartLine[];
};

/** Υπολογισμένα σύνολα καλαθιού */
export type CartTotals = {
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  minOrder: number;
  /** Πόσα ευρώ λείπουν για την ελάχιστη παραγγελία (0 όταν καλυφθεί) */
  missingForMinOrder: number;
  canCheckout: boolean;
};

/* --------------------------------------------------------------------------
 *  Παραγγελίες
 *  collection: `orders`
 * -------------------------------------------------------------------------- */

export type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "delivering"
  | "completed"
  | "cancelled";

/** Payload που στέλνεται στο Firestore κατά την ολοκλήρωση */
export type NewOrder = {
  shopId: string;
  shopName: string;
  address: string;
  lines: CartLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** ISO string — στο Firebase γίνεται serverTimestamp() */
  createdAt: string;
  status: OrderStatus;
  /** Συμπληρώνεται μετά τη σύνδεση χρήστη */
  userId?: string;
  notes?: string;
};

/** Παραγγελία όπως διαβάζεται πίσω από τη βάση */
export type Order = NewOrder & {
  id: string;
};

/* --------------------------------------------------------------------------
 *  UI helpers
 * -------------------------------------------------------------------------- */

/** Κατάσταση αποστολής παραγγελίας */
export type OrderState = "idle" | "sending" | "done" | "error";

/** Προϊόν που περιμένει επιβεβαίωση, όταν το καλάθι έχει άλλο κατάστημα */
export type PendingCartItem = {
  item: MenuItem;
  shop: Shop;
};
