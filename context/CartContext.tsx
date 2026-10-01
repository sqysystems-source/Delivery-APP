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
  applyQuoteToCart,
  computeCartTotals,
  parseStoredCart,
  removeSubmittedLines,
  type SubmittedCartSnapshot,
} from "@/lib/checkout/cart";
import { CHECKOUT_LIMITS } from "@/lib/checkout/constants";
import type {
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

  /* Ενέργειες καλαθιού */
  addItem: (item: MenuItem, shop: Shop) => void;
  increase: (itemId: string) => void;
  decrease: (itemId: string) => void;
  removeLine: (itemId: string) => void;
  clearCart: () => void;
  /** Ποσότητα ενός προϊόντος στο καλάθι (0 όταν δεν υπάρχει) */
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
    const locked = isCartOpen || pendingItem !== null;
    document.body.style.overflow = locked ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isCartOpen, pendingItem]);

  /* ------------------------------ Σύνολα -------------------------------- */
  const totals = useMemo(() => computeCartTotals(cart), [cart]);

  /* ----------------------------- Ενέργειες ------------------------------ */
  const commitItem = useCallback(
    (item: MenuItem, shop: Shop) => {
      store.update((previous) => {
        const sameShop = previous.shop?.id === shop.id;
        const lines = sameShop ? previous.lines : [];
        const existing = lines.find((line) => line.itemId === item.id);

        if (existing && existing.quantity >= CHECKOUT_LIMITS.maxQuantityPerLine) {
          return previous;
        }
        if (!existing && lines.length >= CHECKOUT_LIMITS.maxLines) {
          return previous;
        }

        const nextLines = existing
          ? lines.map((line) =>
              line.itemId === item.id ? { ...line, quantity: line.quantity + 1 } : line,
            )
          : [...lines, { itemId: item.id, name: item.name, unitPrice: item.price, quantity: 1 }];

        return { shop: toCartShopRef(shop), lines: nextLines };
      });
    },
    [store],
  );

  const addItem = useCallback(
    (item: MenuItem, shop: Shop) => {
      const current = store.getSnapshot();
      const hasOtherShop =
        current.shop !== null && current.shop.id !== shop.id && current.lines.length > 0;

      if (hasOtherShop) {
        setPendingItem({ item, shop });
        return;
      }
      commitItem(item, shop);
    },
    [store, commitItem],
  );

  const confirmPendingItem = useCallback(() => {
    if (!pendingItem) return;
    store.update(() => EMPTY_CART);
    setOrderNotes("");
    commitItem(pendingItem.item, pendingItem.shop);
    setPendingItem(null);
  }, [pendingItem, store, commitItem]);

  const cancelPendingItem = useCallback(() => setPendingItem(null), []);

  const changeQuantity = useCallback(
    (itemId: string, delta: number) => {
      store.update((previous) => {
        const nextLines = previous.lines
          .map((line) =>
            line.itemId === itemId
              ? {
                  ...line,
                  quantity: Math.min(line.quantity + delta, CHECKOUT_LIMITS.maxQuantityPerLine),
                }
              : line,
          )
          .filter((line) => line.quantity > 0);

        return nextLines.length === 0 ? EMPTY_CART : { ...previous, lines: nextLines };
      });
    },
    [store],
  );

  const increase = useCallback((itemId: string) => changeQuantity(itemId, 1), [changeQuantity]);
  const decrease = useCallback((itemId: string) => changeQuantity(itemId, -1), [changeQuantity]);

  const removeLine = useCallback(
    (itemId: string) => {
      store.update((previous) => {
        const nextLines = previous.lines.filter((line) => line.itemId !== itemId);
        return nextLines.length === 0 ? EMPTY_CART : { ...previous, lines: nextLines };
      });
    },
    [store],
  );

  const clearCart = useCallback(() => {
    store.update(() => EMPTY_CART);
    setOrderNotes("");
  }, [store]);

  const getQuantity = useCallback(
    (itemId: string) => cart.lines.find((line) => line.itemId === itemId)?.quantity ?? 0,
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
      increase,
      decrease,
      removeLine,
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
      increase,
      decrease,
      removeLine,
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
