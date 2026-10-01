// @vitest-environment jsdom
/* ==========================================================================
 *  Καλάθι (drawer κινητού + panel desktop): οδηγεί στο /checkout, κλείνει
 *  το overlay και ΔΕΝ υποβάλλει παραγγελία.
 * ========================================================================== */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/shop/pizza-roma";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        event.preventDefault(); // το jsdom δεν πλοηγείται
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null }, ensureSignedIn: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null, profile: null, isAuthenticated: false, openLogin: vi.fn() }),
}));

const submitOrderMock = vi.fn();
vi.mock("@/lib/checkout/submit-order", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/checkout/submit-order")>();
  return { ...actual, submitOrder: (...args: unknown[]) => submitOrderMock(...args) };
});

import CartDrawer, { CartPanel } from "@/components/CartDrawer";
import { CartProvider, useCart } from "@/context/CartContext";

const shop = { id: "pizza-roma", name: "Pizza Roma", minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 };

function OpenCartButton() {
  const { openCart } = useCart();
  return (
    <button type="button" onClick={openCart}>
      άνοιγμα
    </button>
  );
}

beforeEach(() => {
  pathname = "/shop/pizza-roma";
  submitOrderMock.mockReset();
  window.localStorage.clear();
  window.localStorage.setItem(
    "buka:cart:v1",
    JSON.stringify({ shop, lines: [{ itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 1 }] }),
  );
});

afterEach(() => cleanup());

describe("καλάθι → checkout", () => {
  it("drawer: «Συνέχεια στο ταμείο» οδηγεί στο /checkout και κλείνει το overlay", () => {
    render(
      <CartProvider>
        <OpenCartButton />
        <CartDrawer />
      </CartProvider>,
    );
    expect(screen.getByRole("button", { name: /Pizza Roma/ })).toBeTruthy(); // floating μπάρα
    fireEvent.click(screen.getByRole("button", { name: "άνοιγμα" }));
    const dialog = screen.getByRole("dialog", { name: "Το καλάθι σου" });

    const link = screen.getByRole("link", { name: /Συνέχεια στο ταμείο/ });
    expect(link.getAttribute("href")).toBe("/checkout");
    expect(dialog.textContent).toContain("Margherita");

    fireEvent.click(link);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(submitOrderMock).not.toHaveBeenCalled();
  });

  it("panel desktop: σύνδεσμος στο /checkout χωρίς υποβολή", () => {
    render(
      <CartProvider>
        <CartPanel />
      </CartProvider>,
    );
    const link = screen.getByRole("link", { name: /Συνέχεια στο ταμείο/ });
    expect(link.getAttribute("href")).toBe("/checkout");
    fireEvent.click(link);
    expect(submitOrderMock).not.toHaveBeenCalled();
  });

  it("η floating μπάρα κρύβεται στο /checkout", () => {
    pathname = "/checkout";
    render(
      <CartProvider>
        <CartDrawer />
      </CartProvider>,
    );
    expect(screen.queryByRole("button", { name: /Pizza Roma/ })).toBeNull();
  });
});
