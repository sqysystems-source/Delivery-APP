"use client";

/* ==========================================================================
 *  Buka Delivery — context/CartContext.tsx
 *
 *  Global state του καλαθιού. Ζει στο `app/layout.tsx` (μέσα στο <body>),
 *  ώστε να επιβιώνει στις μεταβάσεις μεταξύ `/` και `/shop/[id]`.
 *
 *  Χρήση σε οποιοδήποτε client component:
 *    const { addItem, totals, openCart } = useCart();
 *
 *  Κανόνες:
 *  - Ένα καλάθι ανά κατάστημα. Προσθήκη από άλλο μαγαζί ζητά επιβεβαίωση
 *    μέσω `pendingItem` (το modal το χειρίζεται το CartDrawer).
 *  - Το καλάθι κρατά snapshot των οικονομικών όρων του καταστήματος
 *    (`CartShopRef`), οπότε τα σύνολα υπολογίζονται χωρίς extra fetch.
 *  - Persistence σε localStorage, με ασφαλή hydration για SSR.
 * ========================================================================== */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { submitOrder } from "@/lib/data";
import type {
  CartShopRef,
  CartState,
  CartTotals,
  MenuItem,
  NewOrder,
  OrderState,
  PendingCartItem,
  Shop,
} from "@/types";

/* --------------------------------------------------------------------------
 *  Σταθερές
 * -------------------------------------------------------------------------- */

const CART_STORAGE_KEY = "buka:cart:v1";
const ADDRESS_STORAGE_KEY = "buka:address:v1";
const DEFAULT_ADDRESS = "Κεντρική Πλατεία";

const EMPTY_CART: CartState = { shop: null, lines: [] };

/* --------------------------------------------------------------------------
 *  Τύπος του context
 * -------------------------------------------------------------------------- */

type CartContextValue = {
  /* Κατάσταση */
  cart: CartState;
  totals: CartTotals;
  /** true μόλις διαβαστεί το localStorage — απόφυγε flicker πριν από αυτό */
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

  /* Διεύθυνση παράδοσης */
  address: string;
  setAddress: (address: string) => void;

  /* Checkout */
  orderState: OrderState;
  orderCode: string | null;
  placeOrder: (notes?: string) => Promise<void>;
  resetOrder: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

/* --------------------------------------------------------------------------
 *  Helpers
 * -------------------------------------------------------------------------- */

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

/** Ανάγνωση καλαθιού από localStorage με έλεγχο σχήματος */
function readStoredCart(): CartState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CartState;
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readStoredAddress(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ADDRESS_STORAGE_KEY);
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
 *  Provider
 * -------------------------------------------------------------------------- */

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>(EMPTY_CART);
  const [address, setAddressState] = useState<string>(DEFAULT_ADDRESS);
  const [hydrated, setHydrated] = useState(false);

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [pendingItem, setPendingItem] = useState<PendingCartItem | null>(null);

  const [orderState, setOrderState] = useState<OrderState>("idle");
  const [orderCode, setOrderCode] = useState<string | null>(null);

  /* ------------------------- Hydration από storage ---------------------- */
  useEffect(() => {
    const storedCart = readStoredCart();
    if (storedCart) setCart(storedCart);

    const storedAddress = readStoredAddress();
    if (storedAddress) setAddressState(storedAddress);

    setHydrated(true);
  }, []);

  /* ---------------------------- Persistence ----------------------------- */
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      /* Ιδιωτική περιήγηση ή γεμάτο storage — αγνοούμε σιωπηλά */
    }
  }, [cart, hydrated]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ADDRESS_STORAGE_KEY, address);
    } catch {
      /* ό,τι και παραπάνω */
    }
  }, [address, hydrated]);

  /* --------------------- Κλείδωμα scroll όταν ανοίγει ------------------- */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const locked = isCartOpen || pendingItem !== null;
    document.body.style.overflow = locked ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isCartOpen, pendingItem]);

  /* ------------------------------ Σύνολα -------------------------------- */
  const totals = useMemo<CartTotals>(() => {
    const itemCount = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
    const subtotal = cart.lines.reduce(
      (sum, line) => sum + line.unitPrice * line.quantity,
      0,
    );

    const shop = cart.shop;
    let deliveryFee = 0;
    if (shop && cart.lines.length > 0 && shop.deliveryFee > 0) {
      const qualifiesForFree =
        shop.freeDeliveryOver !== null && subtotal >= shop.freeDeliveryOver;
      deliveryFee = qualifiesForFree ? 0 : shop.deliveryFee;
    }

    const minOrder = shop?.minOrder ?? 0;
    const missingForMinOrder = Math.max(0, minOrder - subtotal);

    return {
      itemCount,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      minOrder,
      missingForMinOrder,
      canCheckout: cart.lines.length > 0 && missingForMinOrder === 0,
    };
  }, [cart]);

  /* ---------------------------- Εσωτερικά ------------------------------- */
  const commitItem = useCallback((item: MenuItem, shop: Shop) => {
    setOrderState("idle");
    setOrderCode(null);

    setCart((prev) => {
      const sameShop = prev.shop?.id === shop.id;
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

      return { shop: toCartShopRef(shop), lines: nextLines };
    });
  }, []);

  /* ----------------------------- Ενέργειες ------------------------------ */
  const addItem = useCallback(
    (item: MenuItem, shop: Shop) => {
      const hasOtherShop =
        cart.shop !== null && cart.shop.id !== shop.id && cart.lines.length > 0;

      if (hasOtherShop) {
        setPendingItem({ item, shop });
        return;
      }
      commitItem(item, shop);
    },
    [cart.shop, cart.lines.length, commitItem],
  );

  const confirmPendingItem = useCallback(() => {
    if (!pendingItem) return;
    setCart(EMPTY_CART);
    commitItem(pendingItem.item, pendingItem.shop);
    setPendingItem(null);
  }, [pendingItem, commitItem]);

  const cancelPendingItem = useCallback(() => setPendingItem(null), []);

  const changeQuantity = useCallback((itemId: string, delta: number) => {
    setCart((prev) => {
      const nextLines = prev.lines
        .map((line) =>
          line.itemId === itemId
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0);

      return nextLines.length === 0 ? EMPTY_CART : { ...prev, lines: nextLines };
    });
  }, []);

  const increase = useCallback(
    (itemId: string) => changeQuantity(itemId, 1),
    [changeQuantity],
  );

  const decrease = useCallback(
    (itemId: string) => changeQuantity(itemId, -1),
    [changeQuantity],
  );

  const removeLine = useCallback((itemId: string) => {
    setCart((prev) => {
      const nextLines = prev.lines.filter((line) => line.itemId !== itemId);
      return nextLines.length === 0 ? EMPTY_CART : { ...prev, lines: nextLines };
    });
  }, []);

  const clearCart = useCallback(() => {
    setCart(EMPTY_CART);
    setOrderState("idle");
    setOrderCode(null);
  }, []);

  const getQuantity = useCallback(
    (itemId: string) =>
      cart.lines.find((line) => line.itemId === itemId)?.quantity ?? 0,
    [cart.lines],
  );

  const openCart = useCallback(() => setIsCartOpen(true), []);
  const closeCart = useCallback(() => setIsCartOpen(false), []);

  const setAddress = useCallback((next: string) => setAddressState(next), []);

  const resetOrder = useCallback(() => {
    setOrderState("idle");
    setOrderCode(null);
  }, []);

  /* ------------------------------ Checkout ------------------------------ */
  const placeOrder = useCallback(
    async (notes?: string) => {
      if (!cart.shop || !totals.canCheckout) return;

      setOrderState("sending");

      const payload: NewOrder = {
        shopId: cart.shop.id,
        shopName: cart.shop.name,
        address,
        lines: cart.lines,
        subtotal: totals.subtotal,
        deliveryFee: totals.deliveryFee,
        total: totals.total,
        createdAt: new Date().toISOString(),
        status: "pending",
        ...(notes ? { notes } : {}),
      };

      try {
        const code = await submitOrder(payload);
        setOrderCode(code);
        setOrderState("done");
        setCart(EMPTY_CART);
      } catch {
        setOrderState("error");
      }
    },
    [cart.shop, cart.lines, totals, address],
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
      address,
      setAddress,
      orderState,
      orderCode,
      placeOrder,
      resetOrder,
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
      address,
      setAddress,
      orderState,
      orderCode,
      placeOrder,
      resetOrder,
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
      "Το useCart() πρέπει να χρησιμοποιείται μέσα σε <CartProvider>. " +
        "Τύλιξε το {children} στο app/layout.tsx.",
    );
  }
  return context;
}
