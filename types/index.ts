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
 *    checkoutRequests/{requestId}   (μόνο server — idempotency)
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
  /**
   * Milestone 3: ομάδες επιλογών (μέγεθος, έξτρα, αφαιρέσεις). Απόν ή κενό =
   * προϊόν χωρίς επιλογές, ακριβώς όπως πριν. Γράφεται ΜΟΝΟ από τον server
   * (POST /api/admin/menu-items)· διαβάζεται πάντα μέσω
   * validateOptionGroups (lib/menu/options.ts), ποτέ «ως έχει».
   */
  optionGroups?: MenuOptionGroup[];
};

/* --------------------------------------------------------------------------
 *  Επιλογές προϊόντος (milestone 3) — δες lib/menu/options.ts
 * -------------------------------------------------------------------------- */

/**
 *   single   → ακριβώς μία (υποχρεωτικό) ή έως μία (προαιρετικό) — π.χ. μέγεθος
 *   multiple → minSelect…maxSelect — π.χ. έξτρα υλικά
 *   remove   → «Χωρίς …», πάντα δωρεάν και προαιρετικό
 */
export type MenuOptionKind = "single" | "multiple" | "remove";

export type MenuOptionChoice = {
  /** Σταθερό id — δεν αλλάζει σε μετονομασία/αναδιάταξη */
  id: string;
  label: string;
  /** Προσαύξηση ανά τεμάχιο σε ευρώ (≥ 0, έως 2 δεκαδικά)· 0 στις αφαιρέσεις */
  priceDelta: number;
  available: boolean;
};

export type MenuOptionGroup = {
  /** Σταθερό id — δεν αλλάζει σε μετονομασία/αναδιάταξη */
  id: string;
  label: string;
  kind: MenuOptionKind;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  choices: MenuOptionChoice[];
};

/** Τι διάλεξε ο πελάτης σε μία ομάδα — ΜΟΝΟ ids */
export type OptionSelection = {
  groupId: string;
  choiceIds: string[];
};

/**
 * Στιγμιότυπο μίας επιλεγμένης επιλογής. Στο καλάθι είναι μόνο για προβολή·
 * στην παραγγελία είναι το ΑΜΕΤΑΒΛΗΤΟ αρχείο του τι πουλήθηκε και πόσο.
 */
export type OrderLineOption = {
  groupId: string;
  groupLabel: string;
  kind: MenuOptionKind;
  choiceId: string;
  label: string;
  priceDelta: number;
  priceDeltaCents: number;
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

/**
 * Γραμμή καλαθιού — κρατάει snapshot της τιμής τη στιγμή της προσθήκης.
 *
 * Milestone 3: η ΤΑΥΤΟΤΗΤΑ μιας γραμμής είναι itemId + κανονικές επιλογές
 * (lineKeyOf στο lib/menu/options.ts), όχι μόνο το itemId. Γραμμές χωρίς
 * επιλογές δεν έχουν τα πεδία basePrice/options — ίδιο σχήμα με πριν.
 */
export type CartLine = {
  itemId: string;
  name: string;
  /**
   * Τιμή μονάδας σε ευρώ (βάση + επιλογές), όπως φαινόταν όταν μπήκε στο
   * καλάθι. ΜΟΝΟ για εμφάνιση: ο server δεν τη διαβάζει ποτέ.
   */
  unitPrice: number;
  quantity: number;
  /** Βασική τιμή χωρίς επιλογές (μόνο όταν υπάρχουν επιλογές) */
  basePrice?: number;
  /** Επιλεγμένες επιλογές — από εδώ προκύπτουν τα ids που στέλνονται */
  options?: OrderLineOption[];
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

/**
 * Υπολογισμένα σύνολα καλαθιού. Τα ποσά σε ευρώ είναι για εμφάνιση· τα
 * αντίστοιχα *Cents υπολογίζονται με την ΙΔΙΑ συνάρτηση που χρησιμοποιεί ο
 * server, ώστε το `expectedTotalCents` του checkout να συγκρίνεται δίκαια.
 */
export type CartTotals = {
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  minOrder: number;
  /** Πόσα ευρώ λείπουν για την ελάχιστη παραγγελία (0 όταν καλυφθεί) */
  missingForMinOrder: number;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  minOrderCents: number;
  missingForMinOrderCents: number;
  /** Το σύνολο ξεπερνά το ανώτατο όριο παραγγελίας (500€) */
  exceedsMaxOrder: boolean;
  canCheckout: boolean;
};

/**
 * Διεύθυνση που διάλεξε ο πελάτης από τις αποθηκευμένες του (Navbar).
 * Η `label` («Σπίτι») είναι ΜΟΝΟ για εμφάνιση — τα δεδομένα παράδοσης είναι
 * τα `street` / `city`. Το `sourceUid` δένει την επιλογή με τον χρήστη που
 * την έκανε, ώστε να μη «διαρρεύσει» σε άλλον μετά από αλλαγή λογαριασμού.
 */
export type SelectedDeliveryAddress = {
  sourceId: string;
  sourceUid: string;
  label: string;
  street: string;
  city: string;
  instructions?: string;
};

/* --------------------------------------------------------------------------
 *  Checkout — αίτημα προς POST /api/orders
 *
 *  Περιέχει ΜΟΝΟ ό,τι πληκτρολογεί ή επιλέγει ο πελάτης, συν ids/ποσότητες.
 *  Καμία τιμή, κανένα όνομα προϊόντος/καταστήματος, κανένα userId/ownerUid,
 *  καμία κατάσταση, καμία ώρα: όλα αυτά τα ορίζει ο server.
 * -------------------------------------------------------------------------- */

export type PaymentMethod = "cash_on_delivery";

export type CheckoutCustomer = {
  fullName: string;
  /** Όπως το έγραψε ο πελάτης· ο server το κανονικοποιεί σε E.164 (+30…) */
  phone: string;
};

export type CheckoutDelivery = {
  street: string;
  city: string;
  floor?: string;
  doorbell?: string;
  instructions?: string;
};

export type CheckoutLineInput = {
  itemId: string;
  quantity: number;
  /**
   * Milestone 3: ΜΟΝΟ ids ομάδων/επιλογών. Ονόματα, τιμές και διαθεσιμότητα
   * τα διαβάζει ο server από τον κατάλογο. Απόν = χωρίς επιλογές.
   */
  selections?: OptionSelection[];
};

export type CheckoutRequest = {
  /** Ένα ανά λογική προσπάθεια checkout· ίδιο σε κάθε ασφαλή επανάληψη */
  idempotencyKey: string;
  shopId: string;
  customer: CheckoutCustomer;
  delivery: CheckoutDelivery;
  notes?: string;
  paymentMethod: PaymentMethod;
  lines: CheckoutLineInput[];
  /**
   * Το σύνολο (σε λεπτά) που ΕΙΔΕ ο πελάτης πριν πατήσει επιβεβαίωση.
   * Μόνο για σύγκριση: αν διαφέρει από τον υπολογισμό του server, δεν
   * δημιουργείται παραγγελία. Δεν χρησιμοποιείται ποτέ ως τιμή.
   */
  expectedTotalCents: number;
};

/* --------------------------------------------------------------------------
 *  Checkout — απαντήσεις του server
 * -------------------------------------------------------------------------- */

/**
 * Γραμμή με τιμές που υπολόγισε ο server από το menuItems.
 * Milestone 3: όταν ο πελάτης διάλεξε επιλογές, προστίθενται η βασική τιμή
 * και το στιγμιότυπο των επιλογών (unitPrice = basePrice + Σ priceDelta).
 */
export type VerifiedOrderLine = {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  unitPriceCents: number;
  lineTotalCents: number;
  basePrice?: number;
  basePriceCents?: number;
  options?: OrderLineOption[];
};

/** Οι οικονομικοί όροι του καταστήματος τη στιγμή του υπολογισμού */
export type CheckoutShopTerms = {
  minOrder: number;
  deliveryFee: number;
  freeDeliveryOver: number | null;
};

/** Εξουσιοδοτημένος υπολογισμός ποσού — από τον server */
export type CheckoutQuote = {
  shopId: string;
  shopName: string;
  lines: VerifiedOrderLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  shopTerms: CheckoutShopTerms;
};

/** Επιτυχής καταχώρηση — ίδια απάντηση και σε κάθε επανάληψη του ίδιου κλειδιού */
export type CheckoutSuccess = CheckoutQuote & {
  ok: true;
  orderId: string;
  code: string;
  /** Η παραγγελία ΠΕΡΙΜΕΝΕΙ αποδοχή από το κατάστημα */
  status: "pending";
  paymentMethod: PaymentMethod;
  /** Η διεύθυνση όπως αποθηκεύτηκε (συμβατό πεδίο `address`) */
  address: string;
  /** true όταν η απάντηση είναι επανάληψη αποθηκευμένου αποτελέσματος */
  replayed: boolean;
};

export type CheckoutErrorCode =
  | "invalid_json"
  | "payload_too_large"
  | "validation_failed"
  | "unauthenticated"
  | "rate_limited"
  | "shop_not_found"
  | "shop_closed"
  | "item_not_found"
  | "item_unavailable"
  /** Milestone 3: επιλογή που δεν είναι πια διαθέσιμη — ο πελάτης επεξεργάζεται τη γραμμή */
  | "option_unavailable"
  /** Milestone 3: οι επιλογές της γραμμής δεν ταιριάζουν πια στον κατάλογο */
  | "options_changed"
  | "below_minimum_order"
  | "order_too_large"
  | "price_changed"
  | "idempotency_key_reused"
  /** Το κλειδί έκλεισε μέσω /api/orders/recover — καμία παραγγελία (milestone 2) */
  | "checkout_attempt_closed"
  | "shop_config_invalid"
  | "menu_config_invalid"
  | "server_misconfigured"
  | "internal_error"
  | "method_not_allowed"
  /* Μόνο στον client — ο server δεν τα επιστρέφει ποτέ */
  | "network_error"
  | "invalid_response"
  | "auth_failed";

/** Ονόματα πεδίων που μπορεί να αναφέρει ο server σε validation_failed */
export type CheckoutFieldName =
  | "fullName"
  | "phone"
  | "street"
  | "city"
  | "floor"
  | "doorbell"
  | "instructions"
  | "notes"
  | "lines"
  | "shopId"
  | "paymentMethod"
  | "idempotencyKey"
  | "expectedTotalCents";

export type CheckoutFieldErrors = Partial<Record<CheckoutFieldName, string>>;

export type CheckoutErrorBody = {
  ok: false;
  code: CheckoutErrorCode;
  /** Ασφαλές, ελληνικό μήνυμα για τον πελάτη */
  message: string;
  fieldErrors?: CheckoutFieldErrors;
  /** price_changed / below_minimum_order / order_too_large: οι σωστές τιμές */
  quote?: CheckoutQuote;
  /** item_not_found / item_unavailable / option_*: ποιο προϊόν */
  itemId?: string;
  /** option_unavailable / options_changed: ποια ΓΡΑΜΜΗ (itemId + κανονικές επιλογές) */
  lineKey?: string;
  /** idempotency_key_reused: η παραγγελία που ήδη υπάρχει με αυτό το κλειδί */
  existingOrder?: { orderId: string; code: string };
};

export type CheckoutResponseBody = CheckoutSuccess | CheckoutErrorBody;

/* --------------------------------------------------------------------------
 *  Ανάκτηση προσπάθειας — POST /api/orders/recover   (milestone 2)
 *
 *  Αίτημα: { idempotencyKey } + Bearer token. Ο server απαντά για τον uid του
 *  token ΜΟΝΟ. Το "no_order" είναι οριστικό: το κλειδί κλείνει και κανένα
 *  καθυστερημένο αίτημα με αυτό δεν δημιουργεί παραγγελία.
 * -------------------------------------------------------------------------- */

export type CheckoutRecoveryResult =
  | { ok: true; outcome: "order_found"; order: CheckoutSuccess }
  | { ok: true; outcome: "no_order" };

export type CheckoutRecoveryResponseBody = CheckoutRecoveryResult | CheckoutErrorBody;

/* --------------------------------------------------------------------------
 *  Παραγγελίες όπως αποθηκεύονται
 *  collection: `orders` — γράφεται ΜΟΝΟ από τον server (Admin SDK)
 * -------------------------------------------------------------------------- */

export type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "delivering"
  | "completed"
  | "cancelled";

/**
 * Λόγος ακύρωσης — τον γράφει το ταμπλό μαζί με το status "cancelled"
 * (milestone 2). Οι παλαιότερες ακυρωμένες παραγγελίες δεν τον έχουν.
 *   rejected_by_shop  → ακυρώθηκε ΠΡΙΝ την αποδοχή (απόρριψη)
 *   cancelled_by_shop → ακυρώθηκε ΜΕΤΑ την αποδοχή
 */
export type OrderCancelReason = "rejected_by_shop" | "cancelled_by_shop";

export type StoredOrderLine = {
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** Από το schemaVersion 2 και μετά */
  unitPriceCents?: number;
  lineTotalCents?: number;
  /** Milestone 3 — μόνο σε γραμμές με επιλογές */
  basePrice?: number;
  basePriceCents?: number;
  options?: OrderLineOption[];
};

/** Δομικά συμβατό με το Timestamp του client ΚΑΙ του Admin SDK */
export type OrderTimestamp = { toDate(): Date };

/**
 * Παραγγελία όπως βρίσκεται στο Firestore.
 *
 * Τα `customer`, `delivery`, `paymentMethod` και τα *Cents υπάρχουν από το
 * schemaVersion 2. Οι παλαιότερες παραγγελίες έχουν μόνο το `address` —
 * γι' αυτό είναι προαιρετικά και κάθε αναγνώστης πρέπει να έχει fallback.
 */
export type StoredOrder = {
  shopId: string;
  shopName: string;
  ownerUid: string | null;
  userId: string;
  status: OrderStatus;
  /** Συμβατότητα: «Οδός, Πόλη», παράγεται στον server από το `delivery` */
  address: string;
  lines: StoredOrderLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  subtotalCents?: number;
  deliveryFeeCents?: number;
  totalCents?: number;
  customer?: CheckoutCustomer;
  delivery?: CheckoutDelivery;
  paymentMethod?: PaymentMethod;
  notes?: string;
  etaMinutes?: [number, number] | null;
  source?: "web";
  schemaVersion?: number;
  createdAt: OrderTimestamp | null;
  updatedAt?: OrderTimestamp | null;
  cancelReason?: OrderCancelReason;
};

/** Παραγγελία όπως διαβάζεται πίσω από τη βάση */
export type Order = StoredOrder & {
  id: string;
};

/* --------------------------------------------------------------------------
 *  UI helpers
 * -------------------------------------------------------------------------- */

/** Προϊόν που περιμένει επιβεβαίωση, όταν το καλάθι έχει άλλο κατάστημα */
export type PendingCartItem = {
  item: MenuItem;
  shop: Shop;
  /** Milestone 3: η γραμμή όπως τη διαμόρφωσε ο πελάτης (επιλογές + ποσότητα) */
  line?: CartLine;
};
