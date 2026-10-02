"use client";

/* ==========================================================================
 *  Buka Delivery — context/CartContext.tsx
 *
 *  Global state του καλαθιού. Ζει στο app/(storefront)/layout.tsx, ώστε να
 *  επιβιώνει στις μεταβάσεις /, /shop/[id] και /checkout.
 *
 *  Κανόνες:
 *  - Ένα καλάθι ανά κατάστημα. Προσθήκη από άλλο μαγαζί ζητά επιβεβαίωση
 *    μέσω `pendingItem` (το modal το χειρίζεται το CartDrawer).
 *  - Persistence στο localStorage ΜΟΝΟ για το καλάθι (προϊόντα/ποσότητες/
 *    όροι καταστήματος). Τηλέφωνα, διευθύνσεις και φόρμες checkout ΔΕΝ
 *    αποθηκεύονται ποτέ στη συσκευή.
 *  - Ό,τι διαβάζεται από το localStorage επικυρώνεται (lib/checkout/cart.ts).
 *  - Η ΥΠΟΒΟΛΗ δεν γίνεται εδώ: γίνεται στο /checkout, αφού ο πελάτης δει τη
 *    σύνοψη και πατήσει επιβεβαίωση. Εδώ υπάρχουν μόνο οι ενέργειες που
 *    χρειάζεται το checkout πριν/μετά (applyQuote, completeSubmittedOrder).
 *
 *  ── HYDRATION ───────────────────────────────────────────────────────────
 *  Το καλάθι ζει σε μικρό εξωτερικό store που διαβάζεται με
 *  useSyncExternalStore: ο server (και το πρώτο render στον browser) βλέπει
 *  πάντα άδειο καλάθι· αμέσως μετά το React περνά στο αποθηκευμένο. Έτσι δεν
 *  υπάρχει hydration mismatch και δεν χρειάζεται setState μέσα σε effect.
 *  Το `hydrated` γίνεται true μόνο αφού διαβαστεί το αποθηκευμένο καλάθι.
 * ========================================================================== */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import {
  EMPTY_CART,
  addLineToCart,
  applyQuoteToCart,
  buildCartLine,
  computeCartTotals,
  parseStoredCart,
  productQuantity,
  removeSubmittedLines,
  replaceCartLine,
  type CartLineChange,
  type SubmittedCartSnapshot,
} from "@/lib/checkout/cart";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import { lineKeyOf } from "@/lib/menu/options";
import { lockScroll } from "@/lib/scroll-lock";
import type {
  CartLine,
  CartShopRef,
  CartState,
  CartTotals,
  CheckoutQuote,
  MenuItem,
  PendingCartItem,
  SelectedDeliveryAddress,
  Shop,
} from "@/types";

/* --------------------------------------------------------------------------
 *  Σταθερές
 * -------------------------------------------------------------------------- */

const CART_STORAGE_KEY = "buka:cart:v1";

/**
 * Παλιό κλειδί: κρατούσε τη διεύθυνση ως απλό string (συχνά την ενδεικτική
 * «Κεντρική Πλατεία»). Δεν διαβάζεται πια — σβήνεται στο πρώτο φόρτωμα.
 */
const LEGACY_ADDRESS_STORAGE_KEY = "buka:address:v1";

/* --------------------------------------------------------------------------
 *  Εξωτερικό store καλαθιού
 * -------------------------------------------------------------------------- */

type CartStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => CartState;
  getServerSnapshot: () => CartState;
  update: (updater: (previous: CartState) => CartState) => void;
};

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // ιδιωτική περιήγηση / μπλοκαρισμένο storage
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* Ιδιωτική περιήγηση ή γεμάτο storage — το καλάθι δουλεύει στη μνήμη */
  }
}

function createCartStore(): CartStore {
  let state: CartState | null = null;
  const listeners = new Set<() => void>();

  const load = (): CartState => {
    if (state) return state;
    if (typeof window === "undefined") return EMPTY_CART;
    state = parseStoredCart(readStorage(CART_STORAGE_KEY));
    return state;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: load,
    getServerSnapshot: () => EMPTY_CART,
    update(updater) {
      const previous = load();
      const next = updater(previous);
      if (next === previous) return;
      state = next;
      writeStorage(CART_STORAGE_KEY, next.lines.length === 0 ? null : JSON.stringify(next));
      listeners.forEach((listener) => listener());
    },
  };
}

const subscribeNever = () => () => {};

/* --------------------------------------------------------------------------
 *  Τύπος του context
 * -------------------------------------------------------------------------- */

type CartContextValue = {
  /* Κατάσταση */
  cart: CartState;
  totals: CartTotals;
  /** true μόλις διαβαστεί το αποθηκευμένο καλάθι — πριν από αυτό μην αποφασίζεις τίποτα */
  hydrated: boolean;

  /* Ενέργειες καλαθιού
   *
   * Milestone 3: increase/decrease/removeLine δέχονται το ΚΛΕΙΔΙ ΓΡΑΜΜΗΣ
   * (lineKeyOf). Για προϊόντα χωρίς επιλογές το κλειδί είναι το ίδιο το
   * itemId, οπότε οι παλιές κλήσεις με itemId λειτουργούν όπως πριν. */
  /** Γρήγορη προσθήκη 1 τεμαχίου — ΜΟΝΟ για προϊόντα χωρίς επιλογές */
  addItem: (item: MenuItem, shop: Shop) => void;
  /** Προσθήκη γραμμής από τον διάλογο επιλογών (με σύγκρουση καταστήματος) */
  addConfiguredLine: (item: MenuItem, shop: Shop, line: CartLine) => CartAddResult;
  /** Επεξεργασία γραμμής — ενώνει με άλλη γραμμή αν γίνουν ίδιες */
  updateLine: (lineKey: string, line: CartLine) => CartLineChange;
  increase: (lineKey: string) => void;
  decrease: (lineKey: string) => void;
  removeLine: (lineKey: string) => void;
  /** Αφαιρεί ΟΛΕΣ τις παραλλαγές ενός προϊόντος (π.χ. προϊόν που καταργήθηκε) */
  removeItemLines: (itemId: string) => void;
  clearCart: () => void;
  /** Ποσότητα ενός προϊόντος στο καλάθι, όλες οι παραλλαγές μαζί (0 όταν δεν υπάρχει) */
  getQuantity: (itemId: string) => number;

  /* Drawer / bottom sheet */
  isCartOpen: boolean;
  openCart: () => void;
  closeCart: () => void;

  /* Σύγκρουση καταστήματος */
  pendingItem: PendingCartItem | null;
  confirmPendingItem: () => void;
  cancelPendingItem: () => void;

  /* Διεύθυνση που διάλεξε ο πελάτης από τις αποθηκευμένες του (ή null) */
  deliveryAddress: SelectedDeliveryAddress | null;
  selectDeliveryAddress: (address: SelectedDeliveryAddress | null) => void;

  /* Σχόλια παραγγελίας — στη μνήμη μόνο, επιβιώνουν στην πλοήγηση προς /checkout */
  orderNotes: string;
  setOrderNotes: (notes: string) => void;

  /* Checkout */
  /** Ενημερώνει τιμές/όρους με την εξουσιοδοτημένη απάντηση του server */
  applyQuote: (quote: CheckoutQuote) => void;
  /** Μετά από ΕΠΙΤΥΧΙΑ: αφαιρεί ΜΟΝΟ ό,τι στάλθηκε και καθαρίζει τα σχόλια */
  completeSubmittedOrder: (snapshot: SubmittedCartSnapshot) => void;
};

export type CartAddResult =
  | { ok: true; merged: boolean }
  | { ok: false; reason: "product_limit" | "line_limit" | "not_found" }
  /** Το καλάθι έχει άλλο κατάστημα — περιμένει επιβεβαίωση (pendingItem) */
  | { ok: "pending" };

const CartContext = createContext<CartContextValue | null>(null);

/** Κρατάμε από το Shop μόνο ό,τι χρειάζεται το καλάθι για τα σύνολα */
function toCartShopRef(shop: Shop): CartShopRef {
  return {
    id: shop.id,
    name: shop.name,
    minOrder: shop.minOrder,
    deliveryFee: shop.deliveryFee,
    freeDeliveryOver: shop.freeDeliveryOver,
  };
}

/* --------------------------------------------------------------------------
 *  Provider
 * -------------------------------------------------------------------------- */

export function CartProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createCartStore);

  const cart = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const { user } = useAuth();
  const currentUid = user && !user.isAnonymous ? user.uid : null;

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [pendingItem, setPendingItem] = useState<PendingCartItem | null>(null);
  const [orderNotes, setOrderNotes] = useState("");
  const [selectedAddress, setSelectedAddress] = useState<SelectedDeliveryAddress | null>(null);

  /* Η επιλογή ανήκει στον χρήστη που την έκανε: μετά από αλλαγή λογαριασμού
   * δεν εμφανίζεται — έτσι δεν διαρρέει η διεύθυνση του προηγούμενου. */
  const deliveryAddress =
    selectedAddress && selectedAddress.sourceUid === currentUid ? selectedAddress : null;

  /* --------------- Καθαρισμός παλιάς αποθηκευμένης διεύθυνσης ----------- */
  useEffect(() => {
    writeStorage(LEGACY_ADDRESS_STORAGE_KEY, null);
  }, []);

  /* --------------------- Κλείδωμα scroll όταν ανοίγει ------------------- */
  useEffect(() => {
    if (!isCartOpen && pendingItem === null) return;
    // Μετρητής: ένας διάλογος επιλογών πάνω από το καλάθι δεν το ξεκλειδώνει
    return lockScroll();
  }, [isCartOpen, pendingItem]);

  /* ------------------------------ Σύνολα -------------------------------- */
  const totals = useMemo(() => computeCartTotals(cart), [cart]);

  /* ----------------------------- Ενέργειες ------------------------------ */
  /** Γράφει μια ΗΔΗ διαμορφωμένη γραμμή στο καλάθι του καταστήματος */
  const commitLine = useCallback(
    (line: CartLine, shop: Shop): CartLineChange => {
      let outcome: CartLineChange = { ok: false, reason: "not_found" };
      store.update((previous) => {
        const sameShop = previous.shop?.id === shop.id;
        outcome = addLineToCart(sameShop ? previous : EMPTY_CART, toCartShopRef(shop), line);
        return outcome.ok ? outcome.cart : previous;
      });
      return outcome;
    },
    [store],
  );

  const commitItem = useCallback(
    (item: MenuItem, shop: Shop) => {
      const built = buildCartLine(item, [], 1);
      if (built.ok) commitLine(built.line, shop);
    },
    [commitLine],
  );

  const hasOtherShop = useCallback(
    (shop: Shop) => {
      const current = store.getSnapshot();
      return current.shop !== null && current.shop.id !== shop.id && current.lines.length > 0;
    },
    [store],
  );

  const addItem = useCallback(
    (item: MenuItem, shop: Shop) => {
      if (hasOtherShop(shop)) {
        setPendingItem({ item, shop });
        return;
      }
      commitItem(item, shop);
    },
    [hasOtherShop, commitItem],
  );

  const addConfiguredLine = useCallback(
    (item: MenuItem, shop: Shop, line: CartLine): CartAddResult => {
      if (hasOtherShop(shop)) {
        setPendingItem({ item, shop, line });
        return { ok: "pending" };
      }
      const outcome = commitLine(line, shop);
      return outcome.ok ? { ok: true, merged: outcome.merged } : outcome;
    },
    [hasOtherShop, commitLine],
  );

  const confirmPendingItem = useCallback(() => {
    if (!pendingItem) return;
    store.update(() => EMPTY_CART);
    setOrderNotes("");
    if (pendingItem.line) commitLine(pendingItem.line, pendingItem.shop);
    else commitItem(pendingItem.item, pendingItem.shop);
    setPendingItem(null);
  }, [pendingItem, store, commitItem, commitLine]);

  const cancelPendingItem = useCallback(() => setPendingItem(null), []);

  const changeQuantity = useCallback(
    (lineKey: string, delta: number) => {
      store.update((previous) => {
        const target = previous.lines.find((line) => lineKeyOf(line) === lineKey);
        if (!target) return previous;

        /* Όριο ανά ΠΡΟΪΟΝ: όλες οι παραλλαγές μαζί (ίδιο με τον server) */
        const others = productQuantity(previous.lines, target.itemId, lineKey);
        const quantity = Math.min(
          target.quantity + delta,
          CHECKOUT_LIMITS.maxQuantityPerLine - others,
        );
        if (quantity === target.quantity) return previous;

        const nextLines = previous.lines
          .map((line) => (line === target ? { ...line, quantity } : line))
          .filter((line) => line.quantity > 0);

        return nextLines.length === 0 ? EMPTY_CART : { ...previous, lines: nextLines };
      });
    },
    [store],
  );

  const increase = useCallback((lineKey: string) => changeQuantity(lineKey, 1), [changeQuantity]);
  const decrease = useCallback((lineKey: string) => changeQuantity(lineKey, -1), [changeQuantity]);

  const removeLine = useCallback(
    (lineKey: string) => {
      store.update((previous) => {
        const nextLines = previous.lines.filter((line) => lineKeyOf(line) !== lineKey);
        if (nextLines.length === previous.lines.length) return previous;
        return nextLines.length === 0 ? EMPTY_CART : { ...previous, lines: nextLines };
      });
    },
    [store],
  );

  const removeItemLines = useCallback(
    (itemId: string) => {
      store.update((previous) => {
        const nextLines = previous.lines.filter((line) => line.itemId !== itemId);
        if (nextLines.length === previous.lines.length) return previous;
        return nextLines.length === 0 ? EMPTY_CART : { ...previous, lines: nextLines };
      });
    },
    [store],
  );

  const updateLine = useCallback(
    (lineKey: string, line: CartLine): CartLineChange => {
      let outcome: CartLineChange = { ok: false, reason: "not_found" };
      store.update((previous) => {
        outcome = replaceCartLine(previous, lineKey, line);
        return outcome.ok ? outcome.cart : previous;
      });
      return outcome;
    },
    [store],
  );

  const clearCart = useCallback(() => {
    store.update(() => EMPTY_CART);
    setOrderNotes("");
  }, [store]);

  const getQuantity = useCallback(
    (itemId: string) => productQuantity(cart.lines, itemId),
    [cart.lines],
  );

  const openCart = useCallback(() => setIsCartOpen(true), []);
  const closeCart = useCallback(() => setIsCartOpen(false), []);

  const selectDeliveryAddress = useCallback(
    (address: SelectedDeliveryAddress | null) => setSelectedAddress(address),
    [],
  );

  const applyQuote = useCallback(
    (quote: CheckoutQuote) => store.update((previous) => applyQuoteToCart(previous, quote)),
    [store],
  );

  const completeSubmittedOrder = useCallback(
    (snapshot: SubmittedCartSnapshot) => {
      store.update((previous) => removeSubmittedLines(previous, snapshot));
      setOrderNotes("");
    },
    [store],
  );

  /* ------------------------------- Value -------------------------------- */
  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      totals,
      hydrated,
      addItem,
      addConfiguredLine,
      updateLine,
      increase,
      decrease,
      removeLine,
      removeItemLines,
      clearCart,
      getQuantity,
      isCartOpen,
      openCart,
      closeCart,
      pendingItem,
      confirmPendingItem,
      cancelPendingItem,
      deliveryAddress,
      selectDeliveryAddress,
      orderNotes,
      setOrderNotes,
      applyQuote,
      completeSubmittedOrder,
    }),
    [
      cart,
      totals,
      hydrated,
      addItem,
      addConfiguredLine,
      updateLine,
      increase,
      decrease,
      removeLine,
      removeItemLines,
      clearCart,
      getQuantity,
      isCartOpen,
      openCart,
      closeCart,
      pendingItem,
      confirmPendingItem,
      cancelPendingItem,
      deliveryAddress,
      selectDeliveryAddress,
      orderNotes,
      applyQuote,
      completeSubmittedOrder,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/* --------------------------------------------------------------------------
 *  Hook
 * -------------------------------------------------------------------------- */

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error(
      "Το useCart() πρέπει να χρησιμοποιείται μέσα σε <CartProvider> " +
        "(μπαίνει στο app/(storefront)/layout.tsx).",
    );
  }
  return context;
}
