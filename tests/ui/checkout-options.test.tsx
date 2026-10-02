// @vitest-environment jsdom
/* ==========================================================================
 *  Milestone 3 — checkout με επιλογές: τι στέλνεται, σφάλματα επιλογών,
 *  επεξεργασία της γραμμής, επανεπιβεβαίωση ποσού, στιγμιότυπο επιτυχίας.
 *  Το δίκτυο (submitOrder) είναι ψεύτικο — ο server δοκιμάζεται χωριστά.
 * ========================================================================== */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutQuote, CheckoutRequest, CheckoutSuccess, MenuItem, OrderLineOption } from "@/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/checkout",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null }, ensureSignedIn: vi.fn(), db: {} }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    isAuthenticated: false,
    isAnonymous: false,
    loading: false,
    openLogin: vi.fn(),
  }),
}));

const submitOrderMock = vi.fn<(request: CheckoutRequest, options?: unknown) => Promise<CheckoutSuccess>>();
vi.mock("@/lib/checkout/submit-order", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/checkout/submit-order")>();
  return { ...actual, submitOrder: (request: CheckoutRequest, options?: unknown) => submitOrderMock(request, options) };
});
vi.mock("@/lib/checkout/recover-attempt", () => ({ recoverCheckoutAttempt: vi.fn(async () => ({ kind: "no_order" })) }));

const fetchMenuItemMock = vi.fn<(shopId: string, itemId: string) => Promise<MenuItem | null>>();
vi.mock("@/lib/menu/fetch-menu-item", () => ({
  fetchMenuItem: (shopId: string, itemId: string) => fetchMenuItemMock(shopId, itemId),
}));

import CheckoutClient from "@/components/checkout/CheckoutClient";
import { CartProvider } from "@/context/CartContext";
import { CheckoutError } from "@/lib/checkout/submit-order";
import { PIZZA_ITEM, pizzaGroups } from "../fixtures/menu-options";

const shop = { id: "pizza-roma", name: "Pizza Roma", minOrder: 0, deliveryFee: 1.5, freeDeliveryOver: null };
const largeCheese = {
  itemId: "pizza",
  name: "Πίτσα του σεφ",
  unitPrice: 6.5,
  quantity: 2,
  basePrice: 5,
  options: [
    { groupId: "size", groupLabel: "Μέγεθος", kind: "single", choiceId: "l", label: "Μεγάλη", priceDelta: 1, priceDeltaCents: 100 },
    { groupId: "extras", groupLabel: "Έξτρα", kind: "multiple", choiceId: "cheese", label: "Τυρί", priceDelta: 0.5, priceDeltaCents: 50 },
  ] as OrderLineOption[],
};
const small = {
  itemId: "pizza",
  name: "Πίτσα του σεφ",
  unitPrice: 5,
  quantity: 1,
  basePrice: 5,
  options: [{ groupId: "size", groupLabel: "Μέγεθος", kind: "single", choiceId: "s", label: "Μικρή", priceDelta: 0, priceDeltaCents: 0 }] as OrderLineOption[],
};

function quoteFor(cheeseCents: number): CheckoutQuote {
  const unit = 600 + cheeseCents;
  return {
    shopId: "pizza-roma",
    shopName: "Pizza Roma",
    lines: [
      {
        itemId: "pizza",
        name: "Πίτσα του σεφ",
        quantity: 2,
        unitPrice: unit / 100,
        lineTotal: (unit * 2) / 100,
        unitPriceCents: unit,
        lineTotalCents: unit * 2,
        basePrice: 5,
        basePriceCents: 500,
        options: [largeCheese.options[0], { ...largeCheese.options[1], priceDelta: cheeseCents / 100, priceDeltaCents: cheeseCents }],
      },
      { itemId: "pizza", name: "Πίτσα του σεφ", quantity: 1, unitPrice: 5, lineTotal: 5, unitPriceCents: 500, lineTotalCents: 500, basePrice: 5, basePriceCents: 500, options: small.options },
    ],
    subtotal: (unit * 2 + 500) / 100,
    deliveryFee: 1.5,
    total: (unit * 2 + 650) / 100,
    subtotalCents: unit * 2 + 500,
    deliveryFeeCents: 150,
    totalCents: unit * 2 + 650,
    shopTerms: { minOrder: 0, deliveryFee: 1.5, freeDeliveryOver: null },
  };
}

function renderCheckout() {
  window.localStorage.setItem("buka:cart:v1", JSON.stringify({ shop, lines: [largeCheese, small] }));
  render(
    <CartProvider>
      <CheckoutClient />
    </CartProvider>,
  );
  for (const [name, value] of Object.entries({ fullName: "Κώστας Παπαδόπουλος", phone: "6912345678", street: "Ερμού 5", city: "Τρίκαλα" })) {
    fireEvent.change(document.getElementById(`checkout-${name}`) as HTMLInputElement, { target: { value } });
  }
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Ολοκλήρωση παραγγελίας|Επιβεβαίωση νέου συνόλου/ }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  submitOrderMock.mockReset();
  fetchMenuItemMock.mockReset();
});
afterEach(() => cleanup());

describe("checkout με επιλογές", () => {
  it("η σύνοψη δείχνει τις παραλλαγές· το αίτημα έχει ΜΟΝΟ ids", async () => {
    submitOrderMock.mockResolvedValue({
      ...quoteFor(50),
      ok: true,
      orderId: "ord123abc",
      code: "BK-ORD123",
      status: "pending",
      paymentMethod: "cash_on_delivery",
      address: "Ερμού 5, Τρίκαλα",
      replayed: false,
    });
    renderCheckout();
    const summary = within(screen.getByRole("list", { name: "Προϊόντα παραγγελίας" }));
    expect(summary.getByText("Έξτρα: Τυρί (+0,50€)")).toBeTruthy();
    expect(summary.getByText("Μέγεθος: Μικρή")).toBeTruthy();

    await submit();
    const request = submitOrderMock.mock.calls[0][0];
    expect(request.lines).toEqual([
      { itemId: "pizza", quantity: 2, selections: [{ groupId: "extras", choiceIds: ["cheese"] }, { groupId: "size", choiceIds: ["l"] }] },
      { itemId: "pizza", quantity: 1, selections: [{ groupId: "size", choiceIds: ["s"] }] },
    ]);
    expect(JSON.stringify(request)).not.toMatch(/Τυρί|priceDelta|basePrice|unitPrice/);
    expect(request.expectedTotalCents).toBe(1950);

    // Η οθόνη επιτυχίας δείχνει το στιγμιότυπο του server
    const success = await screen.findByRole("heading", { level: 2, name: /Τι παρήγγειλες/ });
    expect(success.parentElement?.textContent).toContain("Έξτρα: Τυρί (+0,50€)");
  });

  it("option_unavailable: καμία παραγγελία, η ΣΥΓΚΕΚΡΙΜΕΝΗ γραμμή επισημαίνεται, επεξεργασία την διορθώνει", async () => {
    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({
        code: "option_unavailable",
        status: 409,
        uncertain: false,
        message: "Η επιλογή «Τυρί» για «Πίτσα του σεφ» δεν είναι διαθέσιμη αυτή τη στιγμή. Επεξεργάσου το προϊόν στο καλάθι.",
        itemId: "pizza",
        lineKey: "pizza|extras:cheese;size:l",
      }),
    );
    const groups = pizzaGroups();
    groups[1].choices[0].available = false;
    fetchMenuItemMock.mockResolvedValue({ ...PIZZA_ITEM, optionGroups: groups });

    renderCheckout();
    await submit();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("«Τυρί»");
    expect(screen.getByText("Χρειάζεται επεξεργασία επιλογών πριν την αποστολή.")).toBeTruthy();
    // Η άλλη παραλλαγή ΔΕΝ επισημαίνεται και τίποτα δεν αφαιρέθηκε σιωπηλά
    expect(screen.getAllByText("Χρειάζεται επεξεργασία επιλογών πριν την αποστολή.")).toHaveLength(1);
    expect(screen.getByText("Έξτρα: Τυρί (+0,50€)")).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Επεξεργασία επιλογών" }));
    });
    const dialog = await screen.findByRole("dialog", { name: "Πίτσα του σεφ" });
    expect(dialog.textContent).toContain("δεν είναι διαθέσιμη"); // το μήνυμα του server στον διάλογο
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Μπέικον/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Αποθήκευση αλλαγών/ }));

    expect(screen.queryByText("Χρειάζεται επεξεργασία επιλογών πριν την αποστολή.")).toBeNull();
    expect(screen.getByText("Έξτρα: Μπέικον (+0,80€)")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("options_changed σε γραμμή → κουμπί «Αφαίρεση γραμμής» αφαιρεί ΜΟΝΟ αυτή την παραλλαγή", async () => {
    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({
        code: "options_changed",
        status: 409,
        uncertain: false,
        message: "Οι επιλογές για «Πίτσα του σεφ» άλλαξαν στον κατάλογο.",
        itemId: "pizza",
        lineKey: "pizza|size:s",
      }),
    );
    renderCheckout();
    await submit();
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Αφαίρεση γραμμής" }));
    expect(screen.queryByText("Μέγεθος: Μικρή")).toBeNull();
    expect(screen.getByText("Έξτρα: Τυρί (+0,50€)")).toBeTruthy();
  });

  it("αλλαγή προσαύξησης → price_changed: νέο σύνολο, ρητή επανεπιβεβαίωση, ΝΕΟ κλειδί", async () => {
    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({ code: "price_changed", status: 409, uncertain: false, message: "Οι τιμές άλλαξαν.", quote: quoteFor(90) }),
    );
    renderCheckout();
    await submit();

    const notice = screen.getByText("Οι τιμές άλλαξαν", { selector: "p" }).parentElement as HTMLElement;
    expect(notice.textContent).toContain("Πίτσα του σεφ (Μέγεθος: Μεγάλη (+1,00€) · Έξτρα: Τυρί (+0,90€)): 6,50€ → 6,90€");
    expect(screen.getByText("Έξτρα: Τυρί (+0,90€)")).toBeTruthy();
    expect(submitOrderMock).toHaveBeenCalledTimes(1); // καμία αυτόματη επανάληψη

    submitOrderMock.mockRejectedValueOnce(new CheckoutError({ code: "internal_error", status: 500, uncertain: true, message: "x" }));
    await submit();
    const [first, second] = submitOrderMock.mock.calls.map(([request]) => request);
    expect(second.expectedTotalCents).toBe(2030);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
