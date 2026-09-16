"use client";

/* ==========================================================================
 *  Buka Delivery — app/page.tsx
 *  Next.js App Router + TypeScript + Tailwind CSS
 *
 *  ΣΗΜΕΙΩΣΗ ΟΝΟΜΑΤΟΔΟΣΙΑΣ:
 *  Το κύριο component ονομάζεται `HomePage`. Όσα εικονίδια της lucide-react
 *  θα μπορούσαν να συγκρουστούν με ονόματα components/τύπων εισάγονται με
 *  alias (`Home as HomeIcon`, `Store as StoreIcon`, `Search as SearchIcon`).
 * ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import {
  MapPin,
  Search as SearchIcon,
  Star,
  Clock,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  Bike,
  ShieldCheck,
  Percent,
  Timer,
  Store as StoreIcon,
  Heart,
  User,
  Home as HomeIcon,
  Sparkles,
  Check,
  Loader2,
  Flame,
  Info,
  PartyPopper,
  X,
} from "lucide-react";

/* ==========================================================================
 *  1. ΤΥΠΟΙ  (Firebase-ready — αντιστοιχούν 1:1 με Firestore documents)
 * ========================================================================== */

/** Κατηγορία κουζίνας στην αρχική (collection: `cuisines`) */
export type Cuisine = {
  id: string;
  label: string;
  emoji: string;
};

/** Κατάστημα (collection: `shops`, doc id = shop.id) */
export type Shop = {
  id: string;
  name: string;
  cuisineLabel: string;
  cuisineIds: string[];
  rating: number;
  reviews: number;
  etaMinutes: [number, number];
  minOrder: number;
  deliveryFee: number;
  freeDeliveryOver: number | null;
  image: string;
  gradient: string;
  address: string;
  tag?: { label: string; tone: "green" | "orange" | "purple" };
};

/** Κατηγορία μενού (subcollection: `shops/{shopId}/menuCategories`) */
export type MenuCategory = {
  id: string;
  label: string;
  emoji: string;
};

/** Προϊόν μενού (subcollection: `shops/{shopId}/menuItems`) */
export type MenuItem = {
  id: string;
  shopId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  /** Αρχική τιμή, όταν το προϊόν είναι σε προσφορά */
  oldPrice?: number;
  image?: string;
  popular?: boolean;
};

/** Πλήρες μενού καταστήματος, όπως επιστρέφεται από το data layer */
export type Menu = {
  shopId: string;
  categories: MenuCategory[];
  items: MenuItem[];
};

/** Γραμμή καλαθιού */
export type CartLine = {
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
};

/** Κατάσταση καλαθιού — ένα καλάθι ανά κατάστημα */
export type CartState = {
  shopId: string | null;
  shopName: string | null;
  lines: CartLine[];
};

/** Payload παραγγελίας (collection: `orders`) */
export type NewOrder = {
  shopId: string;
  shopName: string;
  address: string;
  lines: CartLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  status: "pending";
};

type View = "home" | "shop";

/* ==========================================================================
 *  2. MOCK ΔΕΔΟΜΕΝΑ
 *  Μοναδικό σημείο αλήθειας για τώρα. Όταν μπει το Firebase, τα arrays
 *  παρακάτω διαγράφονται και μένουν μόνο οι συναρτήσεις της ενότητας 3.
 * ========================================================================== */

const DELIVERY_ADDRESSES = [
  "Κεντρική Πλατεία",
  "Οδός Ερμού 45",
  "Πανεπιστημιούπολη",
  "Παραλιακή Λεωφόρος 12",
];

const CUISINES: Cuisine[] = [
  { id: "all", label: "Όλα", emoji: "🍽️" },
  { id: "souvlaki", label: "Σουβλάκι", emoji: "🥙" },
  { id: "pizza", label: "Πίτσα", emoji: "🍕" },
  { id: "burger", label: "Burger", emoji: "🍔" },
  { id: "coffee", label: "Καφές", emoji: "☕" },
  { id: "sweets", label: "Γλυκά", emoji: "🍰" },
  { id: "greek", label: "Μαγειρευτά", emoji: "🍲" },
  { id: "healthy", label: "Υγιεινά", emoji: "🥗" },
];

const SHOPS: Shop[] = [
  {
    id: "obelistirio-giannis",
    name: "Οβελιστήριο ο Γιάννης",
    cuisineLabel: "Σουβλάκι • Ψητά • Μεζέδες",
    cuisineIds: ["souvlaki", "greek"],
    rating: 4.8,
    reviews: 1240,
    etaMinutes: [25, 35],
    minOrder: 5,
    deliveryFee: 0,
    freeDeliveryOver: null,
    image:
      "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?auto=format&fit=crop&w=1000&q=80",
    gradient: "from-amber-200 to-orange-300",
    address: "Κεντρική Πλατεία 4",
    tag: { label: "Δωρεάν Delivery", tone: "green" },
  },
  {
    id: "pizza-roma",
    name: "Pizza Roma",
    cuisineLabel: "Πίτσα • Ιταλικά • Ζυμαρικά",
    cuisineIds: ["pizza"],
    rating: 4.6,
    reviews: 863,
    etaMinutes: [30, 40],
    minOrder: 8,
    deliveryFee: 1.5,
    freeDeliveryOver: 20,
    image:
      "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1000&q=80",
    gradient: "from-red-200 to-orange-300",
    address: "Ερμού 45",
    tag: { label: "1+1 Δώρο", tone: "orange" },
  },
  {
    id: "burger-project",
    name: "The Burger Project",
    cuisineLabel: "Burger • Smash • Finger Food",
    cuisineIds: ["burger"],
    rating: 4.9,
    reviews: 2105,
    etaMinutes: [20, 30],
    minOrder: 7.5,
    deliveryFee: 1.2,
    freeDeliveryOver: 18,
    image:
      "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1000&q=80",
    gradient: "from-yellow-200 to-amber-300",
    address: "Βενιζέλου 18",
    tag: { label: "Προσφορά -20%", tone: "orange" },
  },
  {
    id: "kafekopteio-ellas",
    name: "Καφεκοπτείο Ελλάς",
    cuisineLabel: "Καφές • Ροφήματα • Σνακ",
    cuisineIds: ["coffee", "sweets"],
    rating: 4.7,
    reviews: 517,
    etaMinutes: [15, 25],
    minOrder: 4,
    deliveryFee: 0,
    freeDeliveryOver: null,
    image:
      "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=1000&q=80",
    gradient: "from-stone-200 to-amber-200",
    address: "Πλατεία Δημαρχείου 2",
    tag: { label: "Δωρεάν Delivery", tone: "green" },
  },
  {
    id: "zacharoplasteio-melina",
    name: "Ζαχαροπλαστείο Μελίνα",
    cuisineLabel: "Γλυκά • Τούρτες • Σιροπιαστά",
    cuisineIds: ["sweets"],
    rating: 4.9,
    reviews: 944,
    etaMinutes: [35, 45],
    minOrder: 6,
    deliveryFee: 1.8,
    freeDeliveryOver: 25,
    image:
      "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=1000&q=80",
    gradient: "from-pink-200 to-rose-300",
    address: "Αγίου Νικολάου 9",
    tag: { label: "Νέο στο Buka", tone: "purple" },
  },
  {
    id: "steki-tis-plateias",
    name: "Ταβέρνα το Στέκι της Πλατείας",
    cuisineLabel: "Μαγειρευτά • Παραδοσιακά",
    cuisineIds: ["greek", "healthy"],
    rating: 4.5,
    reviews: 388,
    etaMinutes: [40, 50],
    minOrder: 10,
    deliveryFee: 2,
    freeDeliveryOver: 30,
    image:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1000&q=80",
    gradient: "from-emerald-200 to-teal-300",
    address: "Παλαιά Αγορά 31",
  },
];

/** Μενού ανά κατάστημα. Στο Firebase: shops/{shopId}/menuItems */
const MENUS: Record<string, Menu> = {
  "obelistirio-giannis": {
    shopId: "obelistirio-giannis",
    categories: [
      { id: "offers", label: "Προσφορές", emoji: "🔥" },
      { id: "pita", label: "Πίτες", emoji: "🥙" },
      { id: "merida", label: "Μερίδες", emoji: "🍖" },
      { id: "sides", label: "Ορεκτικά", emoji: "🍟" },
      { id: "drinks", label: "Ποτά", emoji: "🥤" },
    ],
    items: [
      {
        id: "og-1",
        shopId: "obelistirio-giannis",
        categoryId: "offers",
        name: "Combo 2 Πίτες + Πατάτες + Αναψυκτικό",
        description:
          "Δύο πίτες της επιλογής σου, μερίδα πατάτες και αναψυκτικό 330ml.",
        price: 11.9,
        oldPrice: 14.5,
        popular: true,
        image:
          "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?auto=format&fit=crop&w=400&q=80",
      },
      {
        id: "og-2",
        shopId: "obelistirio-giannis",
        categoryId: "pita",
        name: "Πίτα Γύρος Χοιρινός",
        description:
          "Γύρος, τζατζίκι, ντομάτα, κρεμμύδι, πατάτες σε ζεστή πίτα.",
        price: 3.9,
        popular: true,
      },
      {
        id: "og-3",
        shopId: "obelistirio-giannis",
        categoryId: "pita",
        name: "Πίτα Κοτόπουλο",
        description: "Γύρος κοτόπουλο, σως γιαουρτιού, μαρούλι, ντομάτα.",
        price: 4.1,
      },
      {
        id: "og-4",
        shopId: "obelistirio-giannis",
        categoryId: "pita",
        name: "Πίτα Σουβλάκι Χοιρινό",
        description: "Καλαμάκι χοιρινό, τζατζίκι, ντομάτα, κρεμμύδι, πατάτες.",
        price: 3.7,
      },
      {
        id: "og-5",
        shopId: "obelistirio-giannis",
        categoryId: "merida",
        name: "Μερίδα Γύρος Χοιρινός",
        description:
          "400γρ. γύρος με πατάτες, πίτα, τζατζίκι και φρέσκια σαλάτα.",
        price: 10.5,
        popular: true,
      },
      {
        id: "og-6",
        shopId: "obelistirio-giannis",
        categoryId: "merida",
        name: "Μερίδα Παϊδάκια",
        description: "Χοιρινά παϊδάκια στα κάρβουνα με πατάτες και λεμόνι.",
        price: 13.9,
      },
      {
        id: "og-7",
        shopId: "obelistirio-giannis",
        categoryId: "sides",
        name: "Πατάτες Τηγανητές",
        description: "Φρέσκιες χειροποίητες πατάτες με ρίγανη.",
        price: 3.2,
      },
      {
        id: "og-8",
        shopId: "obelistirio-giannis",
        categoryId: "sides",
        name: "Τζατζίκι",
        description: "Παραδοσιακό τζατζίκι με στραγγιστό γιαούρτι.",
        price: 2.5,
      },
      {
        id: "og-9",
        shopId: "obelistirio-giannis",
        categoryId: "drinks",
        name: "Αναψυκτικό 330ml",
        description: "Cola, πορτοκαλάδα ή λεμονάδα.",
        price: 1.6,
      },
      {
        id: "og-10",
        shopId: "obelistirio-giannis",
        categoryId: "drinks",
        name: "Εμφιαλωμένο Νερό 500ml",
        description: "Φυσικό μεταλλικό νερό.",
        price: 0.6,
      },
    ],
  },

  "pizza-roma": {
    shopId: "pizza-roma",
    categories: [
      { id: "offers", label: "Προσφορές", emoji: "🔥" },
      { id: "pizzas", label: "Πίτσες", emoji: "🍕" },
      { id: "pasta", label: "Ζυμαρικά", emoji: "🍝" },
      { id: "salads", label: "Σαλάτες", emoji: "🥗" },
      { id: "drinks", label: "Ποτά", emoji: "🥤" },
    ],
    items: [
      {
        id: "pr-1",
        shopId: "pizza-roma",
        categoryId: "offers",
        name: "1+1 Πίτσα Μεσαία",
        description:
          "Δύο μεσαίες πίτσες της επιλογής σου από τη βασική λίστα υλικών.",
        price: 15.9,
        oldPrice: 21.8,
        popular: true,
        image:
          "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=400&q=80",
      },
      {
        id: "pr-2",
        shopId: "pizza-roma",
        categoryId: "pizzas",
        name: "Μargherita",
        description: "Σάλτσα ντομάτας, μοτσαρέλα, φρέσκος βασιλικός.",
        price: 8.5,
      },
      {
        id: "pr-3",
        shopId: "pizza-roma",
        categoryId: "pizzas",
        name: "Special Roma",
        description: "Ζαμπόν, μπέικον, πιπεριά, μανιτάρια, διπλή μοτσαρέλα.",
        price: 11.9,
        popular: true,
      },
      {
        id: "pr-4",
        shopId: "pizza-roma",
        categoryId: "pizzas",
        name: "Pepperoni Piccante",
        description: "Πεπερόνι, καυτερή πιπεριά, μοτσαρέλα, ρίγανη.",
        price: 11.2,
      },
      {
        id: "pr-5",
        shopId: "pizza-roma",
        categoryId: "pasta",
        name: "Καρμπονάρα",
        description: "Φρέσκια ταλιατέλα, κρέμα, μπέικον, παρμεζάνα.",
        price: 9.8,
      },
      {
        id: "pr-6",
        shopId: "pizza-roma",
        categoryId: "pasta",
        name: "Πέννες Αραμπιάτα",
        description: "Πικάντικη σάλτσα ντομάτας, σκόρδο, φρέσκος βασιλικός.",
        price: 8.4,
      },
      {
        id: "pr-7",
        shopId: "pizza-roma",
        categoryId: "salads",
        name: "Σαλάτα Καπρέζε",
        description: "Ντομάτα, μοτσαρέλα μπουφάλα, βασιλικός, ελαιόλαδο.",
        price: 7.9,
      },
      {
        id: "pr-8",
        shopId: "pizza-roma",
        categoryId: "drinks",
        name: "Αναψυκτικό 1,5L",
        description: "Οικογενειακή φιάλη.",
        price: 2.8,
      },
    ],
  },

  "burger-project": {
    shopId: "burger-project",
    categories: [
      { id: "offers", label: "Προσφορές", emoji: "🔥" },
      { id: "burgers", label: "Burgers", emoji: "🍔" },
      { id: "sides", label: "Συνοδευτικά", emoji: "🍟" },
      { id: "sauces", label: "Σως", emoji: "🥫" },
      { id: "drinks", label: "Ποτά", emoji: "🥤" },
    ],
    items: [
      {
        id: "bp-1",
        shopId: "burger-project",
        categoryId: "offers",
        name: "Double Smash Menu -20%",
        description:
          "Double smash burger, πατάτες τσένταρ και αναψυκτικό της επιλογής σου.",
        price: 12.8,
        oldPrice: 16.0,
        popular: true,
        image:
          "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=400&q=80",
      },
      {
        id: "bp-2",
        shopId: "burger-project",
        categoryId: "burgers",
        name: "Classic Smash",
        description:
          "Μοσχαρίσιο smash patty 120γρ., τσένταρ, πίκλες, κρεμμύδι, house sauce.",
        price: 8.9,
        popular: true,
      },
      {
        id: "bp-3",
        shopId: "burger-project",
        categoryId: "burgers",
        name: "Bacon Lover",
        description: "Διπλό patty, τραγανό μπέικον, τσένταρ, BBQ σως.",
        price: 11.5,
      },
      {
        id: "bp-4",
        shopId: "burger-project",
        categoryId: "burgers",
        name: "Crispy Chicken",
        description: "Τραγανό φιλέτο κοτόπουλο, coleslaw, μαγιονέζα λάιμ.",
        price: 9.6,
      },
      {
        id: "bp-5",
        shopId: "burger-project",
        categoryId: "burgers",
        name: "Garden Veggie",
        description: "Μπιφτέκι λαχανικών, αβοκάντο, ντομάτα, vegan μαγιονέζα.",
        price: 9.2,
      },
      {
        id: "bp-6",
        shopId: "burger-project",
        categoryId: "sides",
        name: "Πατάτες Cheddar & Bacon",
        description: "Τραγανές πατάτες με λιωμένη τσένταρ και μπέικον.",
        price: 5.4,
      },
      {
        id: "bp-7",
        shopId: "burger-project",
        categoryId: "sides",
        name: "Onion Rings",
        description: "8 τεμάχια, τραγανή πανάρισμα μπύρας.",
        price: 4.3,
      },
      {
        id: "bp-8",
        shopId: "burger-project",
        categoryId: "sauces",
        name: "House Sauce",
        description: "Η υπογραφή του μαγαζιού, 50ml.",
        price: 0.8,
      },
      {
        id: "bp-9",
        shopId: "burger-project",
        categoryId: "drinks",
        name: "Χειροποίητη Λεμονάδα",
        description: "Φρέσκο λεμόνι, δυόσμος, χωρίς ζάχαρη.",
        price: 2.9,
      },
    ],
  },

  "kafekopteio-ellas": {
    shopId: "kafekopteio-ellas",
    categories: [
      { id: "coffee", label: "Καφέδες", emoji: "☕" },
      { id: "cold", label: "Κρύα Ροφήματα", emoji: "🧊" },
      { id: "snacks", label: "Σνακ", emoji: "🥐" },
    ],
    items: [
      {
        id: "ke-1",
        shopId: "kafekopteio-ellas",
        categoryId: "coffee",
        name: "Espresso Διπλός",
        description: "Μείγμα 100% arabica, φρεσκοκαβουρδισμένο στο κατάστημα.",
        price: 2.2,
        popular: true,
      },
      {
        id: "ke-2",
        shopId: "kafekopteio-ellas",
        categoryId: "coffee",
        name: "Cappuccino",
        description: "Βελούδινος αφρός γάλακτος, επιλογή κανέλας.",
        price: 2.8,
      },
      {
        id: "ke-3",
        shopId: "kafekopteio-ellas",
        categoryId: "coffee",
        name: "Ελληνικός Διπλός",
        description: "Παραδοσιακός, σε χόβολη.",
        price: 2.0,
      },
      {
        id: "ke-4",
        shopId: "kafekopteio-ellas",
        categoryId: "cold",
        name: "Freddo Espresso",
        description: "Διπλός espresso, χτυπημένος με πάγο.",
        price: 3.0,
        popular: true,
      },
      {
        id: "ke-5",
        shopId: "kafekopteio-ellas",
        categoryId: "cold",
        name: "Freddo Cappuccino",
        description: "Με αφρόγαλα και επιλογή γλυκύτητας.",
        price: 3.3,
      },
      {
        id: "ke-6",
        shopId: "kafekopteio-ellas",
        categoryId: "snacks",
        name: "Κρουασάν Βουτύρου",
        description: "Ζύμη σφολιάτας, ψημένο κάθε πρωί.",
        price: 2.4,
      },
      {
        id: "ke-7",
        shopId: "kafekopteio-ellas",
        categoryId: "snacks",
        name: "Τυρόπιτα Χωριάτικη",
        description: "Χειροποίητο φύλλο, φέτα Δωδεκανήσου.",
        price: 2.9,
      },
    ],
  },

  "zacharoplasteio-melina": {
    shopId: "zacharoplasteio-melina",
    categories: [
      { id: "sweets", label: "Γλυκά Ταψιού", emoji: "🍯" },
      { id: "cakes", label: "Τούρτες", emoji: "🎂" },
      { id: "pastry", label: "Παγωτά & Άλλα", emoji: "🍨" },
    ],
    items: [
      {
        id: "zm-1",
        shopId: "zacharoplasteio-melina",
        categoryId: "sweets",
        name: "Γαλακτομπούρεκο",
        description: "Κρέμα σιμιγδαλιού, τραγανό φύλλο, σιρόπι λεμονιού.",
        price: 3.6,
        popular: true,
      },
      {
        id: "zm-2",
        shopId: "zacharoplasteio-melina",
        categoryId: "sweets",
        name: "Μπακλαβάς",
        description: "Καρύδι, κανέλα, μέλι Ελάτης.",
        price: 3.4,
      },
      {
        id: "zm-3",
        shopId: "zacharoplasteio-melina",
        categoryId: "sweets",
        name: "Ρεβανί",
        description: "Αφράτο σιροπιαστό με άρωμα πορτοκαλιού.",
        price: 3.1,
      },
      {
        id: "zm-4",
        shopId: "zacharoplasteio-melina",
        categoryId: "cakes",
        name: "Τούρτα Σοκολάτα 1kg",
        description: "Τρεις στρώσεις παντεσπάνι, γκανάς σοκολάτας.",
        price: 22.0,
        popular: true,
      },
      {
        id: "zm-5",
        shopId: "zacharoplasteio-melina",
        categoryId: "cakes",
        name: "Cheesecake Φράουλα (κομμάτι)",
        description: "Βάση μπισκότου, τυρί κρέμα, σάλτσα φράουλας.",
        price: 4.5,
      },
      {
        id: "zm-6",
        shopId: "zacharoplasteio-melina",
        categoryId: "pastry",
        name: "Παγωτό Οικογενειακό 1L",
        description: "Βανίλια, σοκολάτα ή κανέλα-καραμέλα.",
        price: 8.9,
      },
    ],
  },

  "steki-tis-plateias": {
    shopId: "steki-tis-plateias",
    categories: [
      { id: "mageirefta", label: "Μαγειρευτά", emoji: "🍲" },
      { id: "grill", label: "Της Ώρας", emoji: "🔥" },
      { id: "salads", label: "Σαλάτες", emoji: "🥗" },
      { id: "drinks", label: "Ποτά", emoji: "🍷" },
    ],
    items: [
      {
        id: "sp-1",
        shopId: "steki-tis-plateias",
        categoryId: "mageirefta",
        name: "Μουσακάς",
        description: "Πατάτα, μελιτζάνα, κιμάς και σπιτική μπεσαμέλ.",
        price: 9.5,
        popular: true,
      },
      {
        id: "sp-2",
        shopId: "steki-tis-plateias",
        categoryId: "mageirefta",
        name: "Γεμιστά με Ρύζι",
        description: "Ντομάτες και πιπεριές, με φέτα και πατάτες φούρνου.",
        price: 8.6,
      },
      {
        id: "sp-3",
        shopId: "steki-tis-plateias",
        categoryId: "mageirefta",
        name: "Κοκκινιστό Μοσχάρι",
        description: "Σιγομαγειρεμένο με μακαρόνια και τριμμένο κεφαλοτύρι.",
        price: 11.4,
      },
      {
        id: "sp-4",
        shopId: "steki-tis-plateias",
        categoryId: "grill",
        name: "Μπιφτέκι Γεμιστό",
        description: "Με φέτα και πιπεριά, συνοδεία πατάτες τηγανητές.",
        price: 9.9,
      },
      {
        id: "sp-5",
        shopId: "steki-tis-plateias",
        categoryId: "salads",
        name: "Χωριάτικη Σαλάτα",
        description: "Ντομάτα, αγγούρι, φέτα ΠΟΠ, ελιές Καλαμών, κάπαρη.",
        price: 6.8,
        popular: true,
      },
      {
        id: "sp-6",
        shopId: "steki-tis-plateias",
        categoryId: "drinks",
        name: "Κρασί Χύμα 500ml",
        description: "Λευκό ή κόκκινο, τοπικής παραγωγής.",
        price: 4.5,
      },
    ],
  },
};

/* ==========================================================================
 *  3. DATA LAYER
 *  Μόνο αυτές οι τρεις συναρτήσεις αγγίζουν τα δεδομένα. Για Firebase:
 *
 *  import { db } from "@/lib/firebase";
 *  import { collection, getDocs, query, where, addDoc } from "firebase/firestore";
 *
 *  export async function fetchShops() {
 *    const snap = await getDocs(collection(db, "shops"));
 *    return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Shop[];
 *  }
 * ========================================================================== */

/** Προσομοίωση καθυστέρησης δικτύου, ώστε τα loading states να είναι αληθινά */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchShops(): Promise<Shop[]> {
  await delay(350);
  return SHOPS;
}

export async function fetchMenu(shopId: string): Promise<Menu> {
  await delay(450);
  const menu = MENUS[shopId];
  if (!menu) {
    return { shopId, categories: [], items: [] };
  }
  return menu;
}

export async function submitOrder(order: NewOrder): Promise<string> {
  await delay(1100);
  // Firebase: const ref = await addDoc(collection(db, "orders"), order);
  //           return ref.id;
  console.log("[Buka] Νέα παραγγελία προς αποστολή:", order);
  return `BK-${Math.floor(100000 + Math.random() * 900000)}`;
}

/* ==========================================================================
 *  4. HELPERS
 * ========================================================================== */

function formatPrice(value: number): string {
  return `${value.toFixed(2).replace(".", ",")}€`;
}

function formatEta(eta: [number, number]): string {
  return `${eta[0]}-${eta[1]}'`;
}

const TAG_TONES: Record<"green" | "orange" | "purple", string> = {
  green: "bg-emerald-500/95 text-white",
  orange: "bg-orange-500/95 text-white",
  purple: "bg-violet-600/95 text-white",
};

/* ==========================================================================
 *  5. ΚΥΡΙΟ COMPONENT
 * ========================================================================== */

export default function HomePage() {
  /* ---------------------------- Δεδομένα ---------------------------- */
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsLoading, setShopsLoading] = useState(true);

  const [activeShop, setActiveShop] = useState<Shop | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const [activeMenuCategory, setActiveMenuCategory] = useState<string>("");

  /* ------------------------------ UI ------------------------------- */
  const [view, setView] = useState<View>("home");
  const [address, setAddress] = useState(DELIVERY_ADDRESSES[0]);
  const [addressOpen, setAddressOpen] = useState(false);
  const [activeCuisine, setActiveCuisine] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  /* ---------------------------- Καλάθι ----------------------------- */
  const [cart, setCart] = useState<CartState>({
    shopId: null,
    shopName: null,
    lines: [],
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [conflictItem, setConflictItem] = useState<MenuItem | null>(null);
  const [orderState, setOrderState] = useState<"idle" | "sending" | "done">(
    "idle",
  );
  const [orderCode, setOrderCode] = useState<string | null>(null);

  /* ------------------------ Φόρτωση καταστημάτων -------------------- */
  useEffect(() => {
    let cancelled = false;
    setShopsLoading(true);
    fetchShops()
      .then((data) => {
        if (!cancelled) setShops(data);
      })
      .finally(() => {
        if (!cancelled) setShopsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* --------------------------- Φόρτωση μενού ------------------------ */
  useEffect(() => {
    if (!activeShop) {
      setMenu(null);
      return;
    }
    let cancelled = false;
    setMenuLoading(true);
    fetchMenu(activeShop.id)
      .then((data) => {
        if (cancelled) return;
        setMenu(data);
        setActiveMenuCategory(data.categories[0]?.id ?? "");
      })
      .finally(() => {
        if (!cancelled) setMenuLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeShop]);

  /* --------------------- Κλείδωμα scroll σε modal ------------------- */
  useEffect(() => {
    const locked = cartOpen || conflictItem !== null;
    document.body.style.overflow = locked ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [cartOpen, conflictItem]);

  /* ------------------------- Υπολογισμοί καλαθιού ------------------- */
  const itemCount = useMemo(
    () => cart.lines.reduce((sum, line) => sum + line.quantity, 0),
    [cart.lines],
  );

  const subtotal = useMemo(
    () => cart.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [cart.lines],
  );

  const cartShop = useMemo(
    () => shops.find((shop) => shop.id === cart.shopId) ?? activeShop,
    [shops, cart.shopId, activeShop],
  );

  const deliveryFee = useMemo(() => {
    if (!cartShop || cart.lines.length === 0) return 0;
    if (cartShop.deliveryFee === 0) return 0;
    if (cartShop.freeDeliveryOver !== null && subtotal >= cartShop.freeDeliveryOver) {
      return 0;
    }
    return cartShop.deliveryFee;
  }, [cartShop, subtotal, cart.lines.length]);

  const total = subtotal + deliveryFee;
  const minOrder = cartShop?.minOrder ?? 0;
  const missingForMinOrder = Math.max(0, minOrder - subtotal);
  const canCheckout = cart.lines.length > 0 && missingForMinOrder === 0;

  /* --------------------------- Ενέργειες ---------------------------- */
  const openShop = (shop: Shop) => {
    setActiveShop(shop);
    setView("shop");
    setCartOpen(false);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const backToHome = () => {
    setView("home");
    setActiveShop(null);
    setCartOpen(false);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const pushToCart = (item: MenuItem, shop: Shop) => {
    setOrderState("idle");
    setOrderCode(null);
    setCart((prev) => {
      const sameShop = prev.shopId === shop.id;
      const lines = sameShop ? prev.lines : [];
      const existing = lines.find((line) => line.itemId === item.id);

      const nextLines = existing
        ? lines.map((line) =>
            line.itemId === item.id
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          )
        : [
            ...lines,
            {
              itemId: item.id,
              name: item.name,
              unitPrice: item.price,
              quantity: 1,
            },
          ];

      return { shopId: shop.id, shopName: shop.name, lines: nextLines };
    });
  };

  const addToCart = (item: MenuItem) => {
    if (!activeShop) return;
    // Καλάθι από άλλο κατάστημα → ζητάμε επιβεβαίωση
    if (cart.shopId && cart.shopId !== activeShop.id && cart.lines.length > 0) {
      setConflictItem(item);
      return;
    }
    pushToCart(item, activeShop);
  };

  const confirmReplaceCart = () => {
    if (conflictItem && activeShop) {
      setCart({ shopId: null, shopName: null, lines: [] });
      pushToCart(conflictItem, activeShop);
    }
    setConflictItem(null);
  };

  const changeQuantity = (itemId: string, delta: number) => {
    setCart((prev) => {
      const nextLines = prev.lines
        .map((line) =>
          line.itemId === itemId
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0);

      return nextLines.length === 0
        ? { shopId: null, shopName: null, lines: [] }
        : { ...prev, lines: nextLines };
    });
  };

  const removeLine = (itemId: string) => {
    setCart((prev) => {
      const nextLines = prev.lines.filter((line) => line.itemId !== itemId);
      return nextLines.length === 0
        ? { shopId: null, shopName: null, lines: [] }
        : { ...prev, lines: nextLines };
    });
  };

  const clearCart = () => {
    setCart({ shopId: null, shopName: null, lines: [] });
    setOrderState("idle");
    setOrderCode(null);
  };

  const placeOrder = async () => {
    if (!cartShop || !canCheckout) return;
    setOrderState("sending");
    const payload: NewOrder = {
      shopId: cartShop.id,
      shopName: cartShop.name,
      address,
      lines: cart.lines,
      subtotal,
      deliveryFee,
      total,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    const code = await submitOrder(payload);
    setOrderCode(code);
    setOrderState("done");
    setCart({ shopId: null, shopName: null, lines: [] });
  };

  const scrollToMenuCategory = (categoryId: string) => {
    setActiveMenuCategory(categoryId);
    if (typeof document === "undefined") return;
    const element = document.getElementById(`menu-cat-${categoryId}`);
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY - 150;
    window.scrollTo({ top, behavior: "smooth" });
  };

  /* --------------------- Φιλτράρισμα στην αρχική --------------------- */
  const visibleShops = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return shops.filter((shop) => {
      const matchesCuisine =
        activeCuisine === "all" || shop.cuisineIds.includes(activeCuisine);
      const matchesTerm =
        term.length === 0 ||
        shop.name.toLowerCase().includes(term) ||
        shop.cuisineLabel.toLowerCase().includes(term);
      return matchesCuisine && matchesTerm;
    });
  }, [shops, activeCuisine, searchTerm]);

  /* ------------------------------ Render ---------------------------- */
  return (
    <div className="min-h-screen w-full bg-white font-sans text-gray-900 antialiased">
      {/* ============================ NAVBAR ============================ */}
      <header className="sticky top-0 z-50 w-full border-b border-gray-100 bg-white/85 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:h-20 lg:px-8">
          <button onClick={backToHome} className="group flex shrink-0 items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-lg font-black text-white shadow-lg shadow-orange-500/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 lg:h-10 lg:w-10">
              B
            </span>
            <span className="text-xl font-extrabold tracking-tight lg:text-2xl">
              Buka
              <span className="text-orange-500">.</span>
              <span className="font-light text-gray-500">delivery</span>
            </span>
          </button>

          {/* Διεύθυνση — desktop */}
          <div className="relative hidden flex-1 justify-center md:flex">
            <button
              onClick={() => setAddressOpen((open) => !open)}
              className="group flex max-w-xs items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 text-left transition-all duration-300 hover:border-orange-300 hover:bg-orange-50 hover:shadow-md"
            >
              <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
              <span className="flex min-w-0 flex-col leading-none">
                <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  Παράδοση σε
                </span>
                <span className="truncate text-sm font-semibold text-gray-900">
                  {address}
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-300 ${
                  addressOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {addressOpen && (
              <div className="absolute top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-gray-100 bg-white p-2 shadow-2xl shadow-gray-900/10">
                <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Οι διευθύνσεις μου
                </p>
                {DELIVERY_ADDRESSES.map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      setAddress(item);
                      setAddressOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors duration-200 hover:bg-orange-50 hover:text-orange-600"
                  >
                    <span className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-gray-400" />
                      {item}
                    </span>
                    {address === item && <Check className="h-4 w-4 text-orange-500" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button
              onClick={() => setCartOpen(true)}
              className="relative hidden h-11 w-11 items-center justify-center rounded-full border border-gray-200 text-gray-700 transition-all duration-300 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600 md:flex"
              aria-label="Καλάθι"
            >
              <ShoppingBag className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[11px] font-bold text-white shadow-md">
                  {itemCount}
                </span>
              )}
            </button>
            <button className="hidden rounded-full px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors duration-300 hover:bg-gray-100 hover:text-gray-900 sm:block">
              Σύνδεση
            </button>
            <button className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gray-900/10 transition-all duration-300 hover:scale-105 hover:bg-orange-500 hover:shadow-xl hover:shadow-orange-500/30">
              Εγγραφή
            </button>
          </div>
        </nav>

        {/* Διεύθυνση — mobile */}
        <div className="border-t border-gray-100 px-4 py-2 md:hidden">
          <button
            onClick={() => setAddressOpen((open) => !open)}
            className="flex w-full items-center gap-2 text-left"
          >
            <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
            <span className="text-xs text-gray-500">Παράδοση σε:</span>
            <span className="truncate text-xs font-bold text-gray-900">{address}</span>
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-gray-400" />
          </button>
          {addressOpen && (
            <div className="mt-2 space-y-1 pb-1">
              {DELIVERY_ADDRESSES.map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setAddress(item);
                    setAddressOpen(false);
                  }}
                  className="flex w-full items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-orange-50 hover:text-orange-600"
                >
                  {item}
                  {address === item && <Check className="h-4 w-4 text-orange-500" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ============================ ΑΡΧΙΚΗ ============================ */}
      {view === "home" && (
        <main>
          {/* ------------------------------ HERO ----------------------- */}
          <section className="relative overflow-hidden bg-gray-50">
            <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-orange-200/40 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-amber-200/40 blur-3xl" />

            <div className="relative mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
              <div className="flex flex-col items-start">
                <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-orange-600">
                  <Sparkles className="h-3.5 w-3.5" />
                  Τοπικά μαγαζιά, τοπικές τιμές
                </span>

                <h1 className="text-[2.5rem] font-black leading-[1.05] tracking-tight text-gray-900 sm:text-6xl lg:text-7xl">
                  Το αγαπημένο σου
                  <br />
                  φαγητό,{" "}
                  <span className="relative inline-block">
                    <span className="relative z-10 bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
                      στην πόρτα σου
                    </span>
                    <span className="absolute -bottom-1 left-0 z-0 h-3 w-full rounded-full bg-orange-200/70 sm:h-4" />
                  </span>{" "}
                  σε 1&apos;
                </h1>

                <p className="mt-6 max-w-lg text-base leading-relaxed text-gray-600 sm:text-lg">
                  Παράγγειλε από τα καλύτερα μαγαζιά της πόλης σου. Ζεστό φαγητό,
                  δίκαιες τιμές και παράδοση που δεν σε αφήνει να περιμένεις.
                </p>

                <div className="mt-8 w-full max-w-xl">
                  <div className="flex flex-col gap-2 rounded-3xl border border-gray-200 bg-white p-2 shadow-xl shadow-gray-900/5 transition-all duration-300 focus-within:border-orange-300 focus-within:shadow-2xl focus-within:shadow-orange-500/10 sm:flex-row sm:rounded-full">
                    <div className="flex flex-1 items-center gap-3 px-4 py-2">
                      <SearchIcon className="h-5 w-5 shrink-0 text-orange-500" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="Ψάξε μαγαζί ή κουζίνα…"
                        className="w-full bg-transparent text-base font-medium text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400"
                      />
                    </div>
                    <button className="flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-7 py-3.5 text-base font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-105 hover:bg-orange-600 hover:shadow-xl hover:shadow-orange-500/40 active:scale-95 sm:rounded-full">
                      <SearchIcon className="h-5 w-5" />
                      Αναζήτηση
                    </button>
                  </div>
                  <p className="mt-3 pl-2 text-xs text-gray-500">
                    Δημοφιλή:{" "}
                    <span className="font-semibold text-gray-700">Σουβλάκι</span> ·{" "}
                    <span className="font-semibold text-gray-700">Πίτσα</span> ·{" "}
                    <span className="font-semibold text-gray-700">Καφές</span>
                  </p>
                </div>

                <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
                  {[
                    { icon: StoreIcon, value: "180+", label: "τοπικά μαγαζιά" },
                    { icon: Timer, value: "28'", label: "μέσος χρόνος" },
                    { icon: Star, value: "4,8", label: "μέση βαθμολογία" },
                  ].map((stat) => (
                    <div key={stat.label} className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-md shadow-gray-900/5">
                        <stat.icon className="h-5 w-5 text-orange-500" />
                      </span>
                      <span className="flex flex-col leading-tight">
                        <span className="text-lg font-extrabold text-gray-900">
                          {stat.value}
                        </span>
                        <span className="text-xs text-gray-500">{stat.label}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative mx-auto w-full max-w-md lg:max-w-none">
                <div className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-tr from-orange-400 via-amber-300 to-red-400 opacity-20 blur-2xl" />

                <div className="group relative aspect-[4/5] w-full rotate-3 overflow-hidden rounded-[2rem] bg-gradient-to-br from-orange-200 to-amber-300 shadow-2xl shadow-orange-900/20 transition-all duration-500 hover:rotate-0 hover:scale-[1.03] sm:aspect-[4/4.5]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80"
                    alt="Πιάτο με φρέσκο φαγητό"
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                  <div className="absolute bottom-5 left-5 right-5 text-white">
                    <p className="text-xs font-semibold uppercase tracking-widest text-orange-200">
                      Σήμερα στην πόλη σου
                    </p>
                    <p className="mt-1 text-2xl font-black leading-tight">
                      Φρέσκο. Τοπικό. Στην ώρα του.
                    </p>
                  </div>
                </div>

                <div className="absolute -left-2 top-8 flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-xl shadow-gray-900/10 transition-transform duration-300 hover:-translate-y-1 sm:-left-8">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-100">
                    <Bike className="h-5 w-5 text-orange-600" />
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="text-sm font-bold text-gray-900">
                      Παράδοση σε 22&apos;
                    </span>
                    <span className="text-xs text-gray-500">Ο διανομέας ξεκίνησε</span>
                  </span>
                </div>

                <div className="absolute -bottom-4 right-0 flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-xl shadow-gray-900/10 transition-transform duration-300 hover:-translate-y-1 sm:-right-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100">
                    <Star className="h-5 w-5 fill-amber-500 text-amber-500" />
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="text-sm font-bold text-gray-900">4,8 / 5</span>
                    <span className="text-xs text-gray-500">από 12.400 πελάτες</span>
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* --------------------------- ΚΑΤΗΓΟΡΙΕΣ --------------------- */}
          <section className="border-b border-gray-100 bg-white py-8 sm:py-12">
            <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mb-5 flex items-end justify-between gap-4">
                <h2 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
                  Τι σου άνοιξε η όρεξη;
                </h2>
              </div>

              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
                {CUISINES.map((cuisine) => {
                  const active = activeCuisine === cuisine.id;
                  return (
                    <button
                      key={cuisine.id}
                      onClick={() => setActiveCuisine(cuisine.id)}
                      className={`flex shrink-0 items-center gap-2 rounded-full border px-5 py-3 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${
                        active
                          ? "border-orange-500 bg-orange-500 text-white shadow-lg shadow-orange-500/30"
                          : "border-gray-200 bg-white text-gray-700 hover:border-orange-300 hover:text-orange-600"
                      }`}
                    >
                      <span className="text-lg leading-none">{cuisine.emoji}</span>
                      {cuisine.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ----------------------- ΠΡΟΤΕΙΝΟΜΕΝΑ ΜΑΓΑΖΙΑ ---------------- */}
          <section className="bg-gray-50 py-14 sm:py-20">
            <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mb-8 sm:mb-10">
                <span className="text-sm font-bold uppercase tracking-wider text-orange-500">
                  Επιλεγμένα για σένα
                </span>
                <h2 className="mt-2 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">
                  Τα αγαπημένα της πόλης
                </h2>
                <p className="mt-2 text-sm text-gray-600 sm:text-base">
                  Διάλεξε μαγαζί για να δεις τον κατάλογο και να παραγγείλεις.
                </p>
              </div>

              {shopsLoading ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <div
                      key={index}
                      className="overflow-hidden rounded-3xl border border-gray-100 bg-white"
                    >
                      <div className="aspect-[16/10] w-full animate-pulse bg-gray-200" />
                      <div className="space-y-3 p-5">
                        <div className="h-4 w-2/3 animate-pulse rounded-full bg-gray-200" />
                        <div className="h-3 w-1/2 animate-pulse rounded-full bg-gray-100" />
                        <div className="h-3 w-1/3 animate-pulse rounded-full bg-gray-100" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : visibleShops.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-gray-300 bg-white py-16 text-center">
                  <p className="text-lg font-bold text-gray-900">
                    Δεν βρέθηκαν καταστήματα
                  </p>
                  <p className="mt-2 text-sm text-gray-500">
                    Δοκίμασε άλλη κατηγορία ή καθάρισε την αναζήτηση.
                  </p>
                  <button
                    onClick={() => {
                      setActiveCuisine("all");
                      setSearchTerm("");
                    }}
                    className="mt-6 rounded-full bg-orange-500 px-6 py-3 text-sm font-bold text-white transition-all duration-300 hover:scale-105 hover:bg-orange-600"
                  >
                    Καθαρισμός φίλτρων
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleShops.map((shop) => (
                    <article
                      key={shop.id}
                      onClick={() => openShop(shop)}
                      className="group cursor-pointer overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-orange-200 hover:shadow-2xl hover:shadow-gray-900/10"
                    >
                      <div
                        className={`relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br ${shop.gradient}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={shop.image}
                          alt={shop.name}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                        {shop.tag && (
                          <span
                            className={`absolute left-3 top-3 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide shadow-lg backdrop-blur-sm ${
                              TAG_TONES[shop.tag.tone]
                            }`}
                          >
                            {shop.tag.label}
                          </span>
                        )}

                        <button
                          onClick={(event) => event.stopPropagation()}
                          aria-label="Προσθήκη στα αγαπημένα"
                          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-600 shadow-md backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:bg-white hover:text-red-500"
                        >
                          <Heart className="h-4 w-4" />
                        </button>

                        <span className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-gray-900 shadow-md backdrop-blur-sm">
                          <Clock className="h-3.5 w-3.5 text-orange-500" />
                          {formatEta(shop.etaMinutes)}
                        </span>
                      </div>

                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-lg font-extrabold leading-snug tracking-tight text-gray-900 transition-colors duration-300 group-hover:text-orange-600">
                            {shop.name}
                          </h3>
                          <span className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-sm font-bold text-amber-700">
                            <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                            {shop.rating.toFixed(1).replace(".", ",")}
                          </span>
                        </div>

                        <p className="mt-1 text-sm text-gray-500">{shop.cuisineLabel}</p>

                        <div className="mt-4 flex items-center justify-between border-t border-dashed border-gray-100 pt-4">
                          <span className="text-xs font-semibold text-gray-600">
                            Ελάχιστη: {formatPrice(shop.minOrder)}
                          </span>
                          <span className="text-xs text-gray-400">
                            {shop.reviews.toLocaleString("el-GR")} κριτικές
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* --------------------------- ΓΙΑΤΙ BUKA --------------------- */}
          <section className="bg-white py-14 sm:py-20">
            <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                {[
                  {
                    icon: Timer,
                    title: "Γρήγορη παράδοση",
                    text: "Μέσος χρόνος 28 λεπτά, με ζωντανή παρακολούθηση της παραγγελίας σου.",
                  },
                  {
                    icon: Percent,
                    title: "Καθημερινές προσφορές",
                    text: "Αποκλειστικές εκπτώσεις από τα τοπικά μαγαζιά, κάθε μέρα.",
                  },
                  {
                    icon: ShieldCheck,
                    title: "Ασφαλείς πληρωμές",
                    text: "Κάρτα, μετρητά ή digital wallet — όπως σε βολεύει, με πλήρη ασφάλεια.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="group rounded-3xl border border-gray-100 bg-gray-50 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-orange-200 hover:bg-white hover:shadow-xl"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-500/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
                      <item.icon className="h-6 w-6" />
                    </span>
                    <h3 className="mt-5 text-lg font-extrabold tracking-tight text-gray-900">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-gray-600">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ------------------------------- CTA ------------------------ */}
          <section className="bg-white px-4 pb-14 sm:px-6 sm:pb-20 lg:px-8">
            <div className="relative mx-auto w-full max-w-7xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 px-6 py-14 text-center shadow-2xl shadow-orange-500/30 sm:px-12 sm:py-20">
              <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
              <div className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-white/10 blur-2xl" />
              <div className="relative">
                <h2 className="mx-auto max-w-2xl text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">
                  Έχεις μαγαζί; Φέρ&apos; το στο Buka.
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-base text-orange-50 sm:text-lg">
                  Δώσε στην επιχείρησή σου μια premium ψηφιακή παρουσία και βρες
                  νέους πελάτες στην περιοχή σου — χωρίς κρυφές χρεώσεις.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <button className="w-full rounded-full bg-white px-8 py-4 text-base font-bold text-orange-600 shadow-xl transition-all duration-300 hover:scale-105 active:scale-95 sm:w-auto">
                    Γίνε συνεργάτης
                  </button>
                  <button className="w-full rounded-full border-2 border-white/40 px-8 py-4 text-base font-bold text-white transition-all duration-300 hover:scale-105 hover:border-white hover:bg-white/10 active:scale-95 sm:w-auto">
                    Μάθε περισσότερα
                  </button>
                </div>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* ========================= ΣΕΛΙΔΑ ΚΑΤΑΣΤΗΜΑΤΟΣ ==================== */}
      {view === "shop" && activeShop && (
        <main className="bg-gray-50 pb-32 md:pb-16">
          {/* --------------------------- BANNER ------------------------ */}
          <section className="relative h-56 w-full overflow-hidden bg-gray-900 sm:h-72 lg:h-80">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeShop.image}
              alt={activeShop.name}
              className="h-full w-full object-cover opacity-80"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/40 to-transparent" />

            <button
              onClick={backToHome}
              className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2.5 text-sm font-bold text-gray-900 shadow-lg backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:bg-white sm:left-6 sm:top-6"
            >
              <ChevronLeft className="h-4 w-4" />
              Πίσω
            </button>

            <div className="absolute bottom-0 left-0 right-0 mx-auto w-full max-w-7xl px-4 pb-5 sm:px-6 lg:px-8">
              {activeShop.tag && (
                <span
                  className={`mb-3 inline-block rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide shadow-lg ${
                    TAG_TONES[activeShop.tag.tone]
                  }`}
                >
                  {activeShop.tag.label}
                </span>
              )}
              <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">
                {activeShop.name}
              </h1>
              <p className="mt-1 text-sm text-gray-200 sm:text-base">
                {activeShop.cuisineLabel}
              </p>
            </div>
          </section>

          {/* ------------------------ ΠΛΗΡΟΦΟΡΙΕΣ ---------------------- */}
          <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="-mt-6 grid grid-cols-2 gap-3 rounded-3xl border border-gray-100 bg-white p-4 shadow-xl shadow-gray-900/5 sm:grid-cols-4 sm:p-5">
              {[
                {
                  icon: Star,
                  label: "Βαθμολογία",
                  value: `${activeShop.rating.toFixed(1).replace(".", ",")} (${activeShop.reviews.toLocaleString("el-GR")})`,
                },
                {
                  icon: Clock,
                  label: "Παράδοση",
                  value: formatEta(activeShop.etaMinutes),
                },
                {
                  icon: Bike,
                  label: "Μεταφορικά",
                  value:
                    activeShop.deliveryFee === 0
                      ? "Δωρεάν"
                      : formatPrice(activeShop.deliveryFee),
                },
                {
                  icon: ShoppingBag,
                  label: "Ελάχιστη",
                  value: formatPrice(activeShop.minOrder),
                },
              ].map((info) => (
                <div key={info.label} className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-orange-50">
                    <info.icon className="h-5 w-5 text-orange-500" />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="text-[11px] uppercase tracking-wider text-gray-400">
                      {info.label}
                    </span>
                    <span className="truncate text-sm font-bold text-gray-900">
                      {info.value}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            {activeShop.freeDeliveryOver !== null && (
              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <p>
                  Δωρεάν μεταφορικά για παραγγελίες άνω των{" "}
                  <span className="font-bold">
                    {formatPrice(activeShop.freeDeliveryOver)}
                  </span>
                  .
                </p>
              </div>
            )}
          </section>

          {/* ---------------- ΜΕΝΟΥ + ΚΑΛΑΘΙ (desktop sidebar) --------- */}
          <div className="mx-auto mt-8 grid w-full max-w-7xl grid-cols-1 gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
            {/* -------------------------- ΜΕΝΟΥ ----------------------- */}
            <div>
              {/* Sticky κατηγορίες μενού */}
              <div className="sticky top-[104px] z-30 -mx-4 border-b border-gray-100 bg-gray-50/95 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:top-20 lg:mx-0 lg:rounded-2xl lg:border lg:border-gray-100 lg:px-3">
                <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {menuLoading
                    ? [0, 1, 2, 3].map((index) => (
                        <div
                          key={index}
                          className="h-10 w-28 shrink-0 animate-pulse rounded-full bg-gray-200"
                        />
                      ))
                    : menu?.categories.map((category) => {
                        const active = activeMenuCategory === category.id;
                        return (
                          <button
                            key={category.id}
                            onClick={() => scrollToMenuCategory(category.id)}
                            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all duration-300 ${
                              active
                                ? "border-orange-500 bg-orange-500 text-white shadow-md shadow-orange-500/30"
                                : "border-gray-200 bg-white text-gray-700 hover:border-orange-300 hover:text-orange-600"
                            }`}
                          >
                            <span className="text-base leading-none">
                              {category.emoji}
                            </span>
                            {category.label}
                          </button>
                        );
                      })}
                </div>
              </div>

              {/* Λίστα προϊόντων */}
              <div className="mt-6 space-y-10">
                {menuLoading && (
                  <div className="space-y-4">
                    {[0, 1, 2, 3].map((index) => (
                      <div
                        key={index}
                        className="flex gap-4 rounded-3xl border border-gray-100 bg-white p-4"
                      >
                        <div className="flex-1 space-y-3">
                          <div className="h-4 w-1/2 animate-pulse rounded-full bg-gray-200" />
                          <div className="h-3 w-3/4 animate-pulse rounded-full bg-gray-100" />
                          <div className="h-3 w-1/4 animate-pulse rounded-full bg-gray-100" />
                        </div>
                        <div className="h-24 w-24 animate-pulse rounded-2xl bg-gray-200" />
                      </div>
                    ))}
                  </div>
                )}

                {!menuLoading &&
                  menu?.categories.map((category) => {
                    const items = menu.items.filter(
                      (item) => item.categoryId === category.id,
                    );
                    if (items.length === 0) return null;

                    return (
                      <section
                        key={category.id}
                        id={`menu-cat-${category.id}`}
                        className="scroll-mt-40"
                      >
                        <div className="mb-4 flex items-center gap-2">
                          <span className="text-2xl leading-none">{category.emoji}</span>
                          <h2 className="text-2xl font-black tracking-tight text-gray-900">
                            {category.label}
                          </h2>
                          <span className="ml-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-500">
                            {items.length}
                          </span>
                        </div>

                        <div className="space-y-3">
                          {items.map((item) => {
                            const inCart =
                              cart.shopId === activeShop.id
                                ? cart.lines.find((line) => line.itemId === item.id)
                                : undefined;

                            return (
                              <article
                                key={item.id}
                                className="group flex items-stretch gap-4 rounded-3xl border border-gray-100 bg-white p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-xl hover:shadow-gray-900/5"
                              >
                                <div className="flex min-w-0 flex-1 flex-col">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-base font-extrabold tracking-tight text-gray-900 transition-colors duration-300 group-hover:text-orange-600 sm:text-lg">
                                      {item.name}
                                    </h3>
                                    {item.popular && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-600">
                                        <Flame className="h-3 w-3" />
                                        Δημοφιλές
                                      </span>
                                    )}
                                  </div>

                                  <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-500">
                                    {item.description}
                                  </p>

                                  <div className="mt-auto flex items-center gap-2 pt-3">
                                    <span className="text-lg font-black text-gray-900">
                                      {formatPrice(item.price)}
                                    </span>
                                    {item.oldPrice && (
                                      <span className="text-sm font-medium text-gray-400 line-through">
                                        {formatPrice(item.oldPrice)}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="relative flex shrink-0 flex-col items-end justify-between">
                                  <div
                                    className={`h-24 w-24 overflow-hidden rounded-2xl bg-gradient-to-br ${activeShop.gradient} sm:h-28 sm:w-28`}
                                  >
                                    {item.image ? (
                                      /* eslint-disable-next-line @next/next/no-img-element */
                                      <img
                                        src={item.image}
                                        alt={item.name}
                                        loading="lazy"
                                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                                      />
                                    ) : (
                                      <span className="flex h-full w-full items-center justify-center text-3xl">
                                        {category.emoji}
                                      </span>
                                    )}
                                  </div>

                                  {inCart ? (
                                    <div className="absolute -bottom-1 right-0 flex items-center gap-1 rounded-full border border-orange-200 bg-white p-1 shadow-lg">
                                      <button
                                        onClick={() => changeQuantity(item.id, -1)}
                                        aria-label="Μείωση"
                                        className="flex h-7 w-7 items-center justify-center rounded-full text-orange-600 transition-colors hover:bg-orange-50"
                                      >
                                        <Minus className="h-4 w-4" />
                                      </button>
                                      <span className="min-w-5 text-center text-sm font-black text-gray-900">
                                        {inCart.quantity}
                                      </span>
                                      <button
                                        onClick={() => addToCart(item)}
                                        aria-label="Αύξηση"
                                        className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-white transition-colors hover:bg-orange-600"
                                      >
                                        <Plus className="h-4 w-4" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => addToCart(item)}
                                      className="absolute -bottom-1 right-0 flex h-9 items-center gap-1 rounded-full bg-orange-500 px-3 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-110 hover:bg-orange-600 active:scale-95"
                                    >
                                      <Plus className="h-4 w-4" />
                                      Προσθήκη
                                    </button>
                                  )}
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}

                {!menuLoading && menu && menu.items.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-gray-300 bg-white py-16 text-center">
                    <p className="text-lg font-bold text-gray-900">
                      Ο κατάλογος ετοιμάζεται
                    </p>
                    <p className="mt-2 text-sm text-gray-500">
                      Το κατάστημα δεν έχει ανεβάσει ακόμη προϊόντα.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* --------------------- ΚΑΛΑΘΙ (desktop) ------------------ */}
            <aside className="hidden lg:block">
              <div className="sticky top-24 overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-900/5">
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                  <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-gray-900">
                    <ShoppingBag className="h-5 w-5 text-orange-500" />
                    Το καλάθι σου
                  </h2>
                  {cart.lines.length > 0 && (
                    <button
                      onClick={clearCart}
                      className="text-xs font-semibold text-gray-400 transition-colors hover:text-red-500"
                    >
                      Άδειασμα
                    </button>
                  )}
                </div>

                <div className="max-h-[calc(100vh-24rem)] overflow-y-auto px-5 py-4">
                  <CartBody
                    cart={cart}
                    orderState={orderState}
                    orderCode={orderCode}
                    onIncrease={(itemId) => changeQuantity(itemId, 1)}
                    onDecrease={(itemId) => changeQuantity(itemId, -1)}
                    onRemove={removeLine}
                    onReset={() => setOrderState("idle")}
                  />
                </div>

                {cart.lines.length > 0 && orderState !== "done" && (
                  <CartFooter
                    subtotal={subtotal}
                    deliveryFee={deliveryFee}
                    total={total}
                    missingForMinOrder={missingForMinOrder}
                    canCheckout={canCheckout}
                    sending={orderState === "sending"}
                    address={address}
                    onCheckout={placeOrder}
                  />
                )}
              </div>
            </aside>
          </div>
        </main>
      )}

      {/* ========================= FOOTER (μόνο αρχική) ================== */}
      {view === "home" && (
        <footer className="border-t border-gray-100 bg-gray-50 pb-24 pt-14 md:pb-14">
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
              <div className="col-span-2 sm:col-span-1">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-lg font-black text-white">
                    B
                  </span>
                  <span className="text-xl font-extrabold tracking-tight text-gray-900">
                    Buka<span className="text-orange-500">.</span>
                  </span>
                </div>
                <p className="mt-4 max-w-xs text-sm leading-relaxed text-gray-600">
                  Το τοπικό delivery της επαρχίας, φτιαγμένο με μεράκι για τα
                  μαγαζιά της γειτονιάς σου.
                </p>
              </div>

              {[
                {
                  title: "Buka Delivery",
                  links: ["Σχετικά με εμάς", "Καριέρα", "Blog", "Τύπος"],
                },
                {
                  title: "Βοήθεια",
                  links: ["Συχνές ερωτήσεις", "Επικοινωνία", "Όροι χρήσης", "Απόρρητο"],
                },
                {
                  title: "Συνεργάτες",
                  links: [
                    "Εγγραφή καταστήματος",
                    "Γίνε διανομέας",
                    "Buka για εταιρείες",
                  ],
                },
              ].map((column) => (
                <div key={column.title}>
                  <h4 className="text-sm font-extrabold uppercase tracking-wider text-gray-900">
                    {column.title}
                  </h4>
                  <ul className="mt-4 space-y-2.5">
                    {column.links.map((link) => (
                      <li key={link}>
                        <a
                          href="#"
                          className="text-sm text-gray-600 transition-colors duration-200 hover:text-orange-600"
                        >
                          {link}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-gray-200 pt-6 sm:flex-row">
              <p className="text-xs text-gray-500">
                © {new Date().getFullYear()} Buka Delivery. Με επιφύλαξη παντός
                δικαιώματος.
              </p>
              <p className="text-xs text-gray-500">Φτιαγμένο με ❤️ στην Ελλάδα</p>
            </div>
          </div>
        </footer>
      )}

      {/* ================== ΚΙΝΗΤΟ: ΜΠΑΡΑ ΚΑΛΑΘΙΟΥ ή NAV ================ */}
      {itemCount > 0 ? (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-4 left-4 right-4 z-40 flex items-center justify-between gap-3 rounded-2xl bg-orange-500 px-5 py-4 text-white shadow-2xl shadow-orange-500/40 transition-all duration-300 hover:bg-orange-600 active:scale-[0.98] lg:hidden"
        >
          <span className="flex items-center gap-3">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <ShoppingBag className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-black text-orange-600">
                {itemCount}
              </span>
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-xs font-medium text-orange-100">
                {cart.shopName}
              </span>
              <span className="text-sm font-bold">Δες το καλάθι</span>
            </span>
          </span>
          <span className="text-lg font-black">{formatPrice(subtotal)}</span>
        </button>
      ) : (
        view === "home" && (
          <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-100 bg-white/90 backdrop-blur-xl md:hidden">
            <div className="mx-auto flex max-w-lg items-center justify-around px-2 py-2">
              {[
                { icon: HomeIcon, label: "Αρχική", active: true },
                { icon: SearchIcon, label: "Αναζήτηση", active: false },
                { icon: ShoppingBag, label: "Καλάθι", active: false },
                { icon: User, label: "Προφίλ", active: false },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => item.label === "Καλάθι" && setCartOpen(true)}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold transition-colors duration-200 ${
                    item.active ? "text-orange-600" : "text-gray-400 hover:text-gray-700"
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </button>
              ))}
            </div>
          </nav>
        )
      )}

      {/* ==================== BOTTOM SHEET / MODAL ΚΑΛΑΘΙΟΥ ============= */}
      {cartOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
            onClick={() => setCartOpen(false)}
          />

          <div className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-md sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-gray-900">
                  <ShoppingBag className="h-5 w-5 text-orange-500" />
                  Το καλάθι σου
                </h2>
                {cart.shopName && (
                  <p className="mt-0.5 text-xs text-gray-500">από {cart.shopName}</p>
                )}
              </div>
              <button
                onClick={() => setCartOpen(false)}
                aria-label="Κλείσιμο"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <CartBody
                cart={cart}
                orderState={orderState}
                orderCode={orderCode}
                onIncrease={(itemId) => changeQuantity(itemId, 1)}
                onDecrease={(itemId) => changeQuantity(itemId, -1)}
                onRemove={removeLine}
                onReset={() => {
                  setOrderState("idle");
                  setCartOpen(false);
                }}
              />
            </div>

            {cart.lines.length > 0 && orderState !== "done" && (
              <CartFooter
                subtotal={subtotal}
                deliveryFee={deliveryFee}
                total={total}
                missingForMinOrder={missingForMinOrder}
                canCheckout={canCheckout}
                sending={orderState === "sending"}
                address={address}
                onCheckout={placeOrder}
              />
            )}
          </div>
        </div>
      )}

      {/* ================ MODAL: ΚΑΛΑΘΙ ΑΠΟ ΑΛΛΟ ΚΑΤΑΣΤΗΜΑ ============== */}
      {conflictItem && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
            onClick={() => setConflictItem(null)}
          />
          <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100">
              <ShoppingBag className="h-7 w-7 text-orange-600" />
            </span>
            <h3 className="mt-4 text-xl font-black tracking-tight text-gray-900">
              Νέα παραγγελία;
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Το καλάθι σου έχει ήδη προϊόντα από{" "}
              <span className="font-bold text-gray-900">{cart.shopName}</span>. Αν
              συνεχίσεις, θα αδειάσει για να παραγγείλεις από{" "}
              <span className="font-bold text-gray-900">{activeShop?.name}</span>.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                onClick={confirmReplaceCart}
                className="w-full rounded-full bg-orange-500 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-105 hover:bg-orange-600 active:scale-95"
              >
                Άδειασμα &amp; προσθήκη
              </button>
              <button
                onClick={() => setConflictItem(null)}
                className="w-full rounded-full px-6 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100"
              >
                Άκυρο
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
 *  6. ΥΠΟ-COMPONENTS ΚΑΛΑΘΙΟΥ
 * ========================================================================== */

type CartBodyProps = {
  cart: CartState;
  orderState: "idle" | "sending" | "done";
  orderCode: string | null;
  onIncrease: (itemId: string) => void;
  onDecrease: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onReset: () => void;
};

function CartBody({
  cart,
  orderState,
  orderCode,
  onIncrease,
  onDecrease,
  onRemove,
  onReset,
}: CartBodyProps) {
  /* Επιτυχής παραγγελία */
  if (orderState === "done") {
    return (
      <div className="py-8 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100">
          <PartyPopper className="h-8 w-8 text-emerald-600" />
        </span>
        <h3 className="mt-5 text-xl font-black tracking-tight text-gray-900">
          Η παραγγελία καταχωρήθηκε!
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Το κατάστημα ενημερώθηκε και ετοιμάζει ήδη το φαγητό σου.
        </p>
        {orderCode && (
          <p className="mt-4 inline-block rounded-full bg-gray-100 px-4 py-2 text-sm font-bold tracking-wider text-gray-700">
            Κωδικός: {orderCode}
          </p>
        )}
        <button
          onClick={onReset}
          className="mt-6 w-full rounded-full bg-gray-900 px-6 py-3.5 text-sm font-bold text-white transition-all duration-300 hover:scale-105 hover:bg-orange-500"
        >
          Νέα παραγγελία
        </button>
      </div>
    );
  }

  /* Άδειο καλάθι */
  if (cart.lines.length === 0) {
    return (
      <div className="py-10 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gray-100">
          <ShoppingBag className="h-8 w-8 text-gray-400" />
        </span>
        <p className="mt-5 text-base font-bold text-gray-900">
          Το καλάθι σου είναι άδειο
        </p>
        <p className="mt-1.5 text-sm text-gray-500">
          Πρόσθεσε προϊόντα από τον κατάλογο για να ξεκινήσεις.
        </p>
      </div>
    );
  }

  /* Γραμμές καλαθιού */
  return (
    <ul className="space-y-3">
      {cart.lines.map((line) => (
        <li
          key={line.itemId}
          className="flex items-start gap-3 rounded-2xl border border-gray-100 p-3 transition-colors duration-300 hover:border-orange-200 hover:bg-orange-50/40"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-gray-900">{line.name}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {formatPrice(line.unitPrice)} / τεμ.
            </p>

            <div className="mt-2.5 flex items-center gap-1 rounded-full border border-gray-200 bg-white p-1 w-fit">
              <button
                onClick={() => onDecrease(line.itemId)}
                aria-label="Μείωση ποσότητας"
                className="flex h-7 w-7 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-orange-600"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-5 text-center text-sm font-black text-gray-900">
                {line.quantity}
              </span>
              <button
                onClick={() => onIncrease(line.itemId)}
                aria-label="Αύξηση ποσότητας"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-white transition-colors hover:bg-orange-600"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="text-sm font-black text-gray-900">
              {formatPrice(line.unitPrice * line.quantity)}
            </span>
            <button
              onClick={() => onRemove(line.itemId)}
              aria-label="Αφαίρεση προϊόντος"
              className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

type CartFooterProps = {
  subtotal: number;
  deliveryFee: number;
  total: number;
  missingForMinOrder: number;
  canCheckout: boolean;
  sending: boolean;
  address: string;
  onCheckout: () => void;
};

function CartFooter({
  subtotal,
  deliveryFee,
  total,
  missingForMinOrder,
  canCheckout,
  sending,
  address,
  onCheckout,
}: CartFooterProps) {
  return (
    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between text-gray-600">
          <span>Υποσύνολο</span>
          <span className="font-semibold text-gray-900">{formatPrice(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-gray-600">
          <span>Μεταφορικά</span>
          <span
            className={`font-semibold ${
              deliveryFee === 0 ? "text-emerald-600" : "text-gray-900"
            }`}
          >
            {deliveryFee === 0 ? "Δωρεάν" : formatPrice(deliveryFee)}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-dashed border-gray-200 pt-2.5 text-base">
          <span className="font-bold text-gray-900">Σύνολο</span>
          <span className="text-xl font-black text-gray-900">{formatPrice(total)}</span>
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-orange-500" />
        Παράδοση σε: <span className="font-semibold text-gray-700">{address}</span>
      </p>

      {missingForMinOrder > 0 && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          Πρόσθεσε ακόμη {formatPrice(missingForMinOrder)} για να φτάσεις την ελάχιστη
          παραγγελία.
        </p>
      )}

      <button
        onClick={onCheckout}
        disabled={!canCheckout || sending}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none disabled:hover:scale-100"
      >
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Αποστολή…
          </>
        ) : (
          <>
            Ολοκλήρωση παραγγελίας
            <ChevronRight className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  );
}
