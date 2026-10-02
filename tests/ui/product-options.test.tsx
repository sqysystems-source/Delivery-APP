// @vitest-environment jsdom
/* ==========================================================================
 *  Milestone 3 — διάλογος επιλογών, γραμμή καταλόγου, καλάθι με παραλλαγές.
 *
 *  Πραγματικά: CartProvider (localStorage), MenuItemRow, ProductOptionsDialog,
 *  CartLines/EditCartLineDialog. Ψεύτικα: Firebase/Auth, next/*, και η
 *  ανάγνωση του τρέχοντος προϊόντος (fetchMenuItem).
 * ========================================================================== */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItem } from "@/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/shop/pizza-roma" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null }, ensureSignedIn: vi.fn(), db: {} }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null, profile: null, isAuthenticated: false, openLogin: vi.fn() }),
}));

const fetchMenuItemMock = vi.fn<(shopId: string, itemId: string) => Promise<MenuItem | null>>();
vi.mock("@/lib/menu/fetch-menu-item", () => ({
  fetchMenuItem: (shopId: string, itemId: string) => fetchMenuItemMock(shopId, itemId),
}));

import MenuItemRow from "@/components/MenuItemRow";
import { CartLines } from "@/components/CartDrawer";
import { CartProvider, useCart } from "@/context/CartContext";
import { lineKeyOf } from "@/lib/menu/options";
import { PIZZA_ITEM, SHOP } from "../fixtures/menu-options";

const CART_KEY = "buka:cart:v1";
const COLA: MenuItem = { id: "cola", shopId: "pizza-roma", categoryId: "drinks", name: "Cola", description: "", price: 2 };

function CartProbe() {
  const { cart } = useCart();
  return <output data-testid="cart">{JSON.stringify(cart.lines.map((line) => [lineKeyOf(line), line.quantity, line.unitPrice]))}</output>;
}

const cartLines = () => JSON.parse(screen.getByTestId("cart").textContent ?? "[]") as Array<[string, number, number]>;

function renderRow(item: MenuItem) {
  return render(
    <CartProvider>
      <MenuItemRow item={item} shop={SHOP} />
      <CartProbe />
    </CartProvider>,
  );
}

const dialog = () => screen.getByRole("dialog", { name: PIZZA_ITEM.name });

beforeEach(() => {
  window.localStorage.clear();
  fetchMenuItemMock.mockReset();
  document.body.style.overflow = "";
});
afterEach(() => cleanup());

/* ========================================================================== */

describe("προϊόν χωρίς επιλογές", () => {
  it("κρατά τη γρήγορη προσθήκη — χωρίς διάλογο", () => {
    renderRow(COLA);
    fireEvent.click(screen.getByRole("button", { name: "Προσθήκη Cola στο καλάθι" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cartLines()).toEqual([["cola", 1, 2]]);
  });
});

describe("διάλογος επιλογών", () => {
  it("ανοίγει πριν την προσθήκη, δείχνει όνομα/περιγραφή/βασική τιμή και κλειδώνει το scroll", () => {
    renderRow(PIZZA_ITEM);
    fireEvent.click(screen.getByRole("button", { name: /Επιλογές και προσθήκη/ }));
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(dialog().textContent).toContain("Σάλτσα, μοτσαρέλα");
    expect(dialog().textContent).toContain("Βασική τιμή 5,00€");
    expect(document.body.style.overflow).toBe("hidden");
    expect(cartLines()).toEqual([]);
  });

  it("radio για μέγεθος, checkbox για έξτρα/αφαιρέσεις, μη διαθέσιμα disabled", () => {
    renderRow(PIZZA_ITEM);
    fireEvent.click(screen.getByRole("button", { name: /Επιλογές και προσθήκη/ }));
    const d = within(dialog());
    expect((d.getByRole("radio", { name: /Μεγάλη/ }) as HTMLInputElement).type).toBe("radio");
    expect((d.getByRole("radio", { name: /Γίγας/ }) as HTMLInputElement).disabled).toBe(true);
    expect(d.getAllByText("Μη διαθέσιμο")).toHaveLength(2);
    expect((d.getByRole("checkbox", { name: /Τυρί/ }) as HTMLInputElement).type).toBe("checkbox");
    expect((d.getByRole("checkbox", { name: /Μανιτάρια/ }) as HTMLInputElement).disabled).toBe(true);
    expect(d.getByRole("checkbox", { name: "Χωρίς κρεμμύδι" })).toBeTruthy();
    expect(d.getByText("Υποχρεωτικό · διάλεξε 1")).toBeTruthy();
    // Τίποτα προεπιλεγμένο — ούτε το δωρεάν μέγεθος
    expect(d.getAllByRole("radio").some((radio) => (radio as HTMLInputElement).checked)).toBe(false);
  });

  it("το υποχρεωτικό πρέπει να επιλεγεί ρητά: inline λάθος + εστίαση στην ομάδα, τίποτα στο καλάθι", () => {
    renderRow(PIZZA_ITEM);
    fireEvent.click(screen.getByRole("button", { name: /Επιλογές και προσθήκη/ }));
    fireEvent.click(within(dialog()).getByRole("button", { name: /Προσθήκη στο καλάθι/ }));

    expect(within(dialog()).getByText("Διάλεξε μία επιλογή για να συνεχίσεις.")).toBeTruthy();
    const group = document.activeElement as HTMLElement;
    expect(group.tagName).toBe("FIELDSET");
    expect(group.getAttribute("aria-invalid")).toBe("true");
    expect(cartLines()).toEqual([]);
  });

  it("ζωντανή τιμή: μεγάλη + τυρί = 6,50/τεμ., ×2 = 13,00 — και μπαίνει στο καλάθι", () => {
    renderRow(PIZZA_ITEM);
    const trigger = screen.getByRole("button", { name: /Επιλογές και προσθήκη/ });
    trigger.focus();
    fireEvent.click(trigger);
    const d = within(dialog());
    fireEvent.click(d.getByRole("radio", { name: /Μεγάλη/ }));
    fireEvent.click(d.getByRole("checkbox", { name: /Τυρί/ }));
    fireEvent.click(d.getByRole("checkbox", { name: "Χωρίς κρεμμύδι" }));
    fireEvent.click(d.getByRole("button", { name: "Αύξηση ποσότητας" }));

    expect(d.getByRole("status").textContent).toContain("Τιμή μονάδας 6,50€, σύνολο 13,00€");
    const addButton = d.getByRole("button", { name: /Προσθήκη στο καλάθι/ });
    expect(addButton.textContent).toContain("13,00€");
    fireEvent.click(addButton);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cartLines()).toEqual([["pizza|extras:cheese;size:l;without:onion", 2, 6.5]]);
    // Η εστίαση επιστρέφει σε στοιχείο της γραμμής (το κουμπί ξαναστήθηκε με νέο κείμενο)
    expect(document.body.style.overflow).toBe("");
  });

  it("ίδιες επιλογές ξανά → ενώνεται· άλλες επιλογές → ξεχωριστή γραμμή", () => {
    renderRow(PIZZA_ITEM);
    const add = (size: RegExp) => {
      fireEvent.click(screen.getByRole("button", { name: /Επιλογές και προσθήκη|Προσθήκη .* με επιλογές/ }));
      fireEvent.click(within(dialog()).getByRole("radio", { name: size }));
      fireEvent.click(within(dialog()).getByRole("button", { name: /Προσθήκη στο καλάθι/ }));
    };
    add(/Μικρή/);
    add(/Μικρή/);
    add(/Μεγάλη/);
    expect(cartLines()).toEqual([
      ["pizza|size:s", 2, 5],
      ["pizza|size:l", 1, 6],
    ]);
    // Η γραμμή καταλόγου δείχνει το σύνολο όλων των παραλλαγών
    expect(screen.getByRole("button", { name: /έχεις 3 στο καλάθι/ })).toBeTruthy();
  });

  it("max επιλογών: στο μέγιστο, οι υπόλοιπες απενεργοποιούνται", () => {
    const item = { ...PIZZA_ITEM, optionGroups: PIZZA_ITEM.optionGroups.map((group) => (group.id === "extras" ? { ...group, maxSelect: 1 } : group)) };
    renderRow(item);
    fireEvent.click(screen.getByRole("button", { name: /Επιλογές και προσθήκη/ }));
    fireEvent.click(within(dialog()).getByRole("checkbox", { name: /Τυρί/ }));
    expect((within(dialog()).getByRole("checkbox", { name: /Μπέικον/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it("Escape κλείνει και η εστίαση επιστρέφει στο κουμπί που τον άνοιξε", () => {
    renderRow(PIZZA_ITEM);
    const trigger = screen.getByRole("button", { name: /Επιλογές και προσθήκη/ });
    trigger.focus();
    fireEvent.click(trigger);
    expect(dialog().contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("παγίδα εστίασης: Shift+Tab από το πρώτο → στο τελευταίο, Tab από το τελευταίο → στο πρώτο", () => {
    renderRow(PIZZA_ITEM);
    fireEvent.click(screen.getByRole("button", { name: /Επιλογές και προσθήκη/ }));
    const close = within(dialog()).getByRole("button", { name: "Κλείσιμο" });
    const addButton = within(dialog()).getByRole("button", { name: /Προσθήκη στο καλάθι/ });
    // Στο jsdom δεν υπάρχει layout (offsetParent) — το φίλτρο κρατά το ενεργό στοιχείο
    Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get: () => document.body });
    try {
      close.focus();
      fireEvent.keyDown(dialog(), { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(addButton);
      fireEvent.keyDown(dialog(), { key: "Tab" });
      expect(document.activeElement).toBe(close);
    } finally {
      delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent;
    }
  });

  it("κακόμορφη ρύθμιση στον κατάλογο → «Μη διαθέσιμο», όχι προσθήκη χωρίς επιλογές", () => {
    renderRow({ ...PIZZA_ITEM, optionGroups: "χαλασμένο" as unknown as MenuItem["optionGroups"] });
    expect(screen.queryByRole("button", { name: /Προσθήκη|Επιλογές/ })).toBeNull();
    expect(screen.getByText("Μη διαθέσιμο")).toBeTruthy();
  });
});

/* ========================================================================== */

describe("καλάθι: παραλλαγές, επεξεργασία, ένωση", () => {
  const small = {
    itemId: "pizza",
    name: PIZZA_ITEM.name,
    unitPrice: 5,
    quantity: 2,
    basePrice: 5,
    options: [{ groupId: "size", groupLabel: "Μέγεθος", kind: "single", choiceId: "s", label: "Μικρή", priceDelta: 0, priceDeltaCents: 0 }],
  };
  const large = {
    ...small,
    unitPrice: 6.5,
    quantity: 1,
    options: [
      { groupId: "size", groupLabel: "Μέγεθος", kind: "single", choiceId: "l", label: "Μεγάλη", priceDelta: 1, priceDeltaCents: 100 },
      { groupId: "extras", groupLabel: "Έξτρα", kind: "multiple", choiceId: "cheese", label: "Τυρί", priceDelta: 0.5, priceDeltaCents: 50 },
    ],
  };

  function renderCart() {
    window.localStorage.setItem(CART_KEY, JSON.stringify({ shop: { id: "pizza-roma", name: "Pizza Roma", minOrder: 0, deliveryFee: 1.5, freeDeliveryOver: null }, lines: [small, large] }));
    return render(
      <CartProvider>
        <CartLines />
        <CartProbe />
      </CartProvider>,
    );
  }

  it("δείχνει τις παραλλαγές ως ξεχωριστές γραμμές με τις επιλογές τους", () => {
    renderCart();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Μέγεθος: Μικρή");
    expect(items[1].textContent).toContain("Μέγεθος: Μεγάλη (+1,00€)");
    expect(items[1].textContent).toContain("Έξτρα: Τυρί (+0,50€)");
  });

  it("−/+/αφαίρεση επηρεάζουν ΜΟΝΟ τη συγκεκριμένη παραλλαγή", () => {
    renderCart();
    const [first, second] = screen.getAllByRole("listitem");
    fireEvent.click(within(second).getByRole("button", { name: /Αύξηση/ }));
    fireEvent.click(within(first).getByRole("button", { name: /Αφαίρεση/ }));
    expect(cartLines()).toEqual([["pizza|extras:cheese;size:l", 2, 6.5]]);
  });

  it("επεξεργασία που κάνει τη γραμμή ίδια με άλλη → ενώνονται και ανακοινώνεται", async () => {
    fetchMenuItemMock.mockResolvedValue(PIZZA_ITEM);
    renderCart();
    const [first] = screen.getAllByRole("listitem");
    await act(async () => {
      fireEvent.click(within(first).getByRole("button", { name: /Επεξεργασία επιλογών/ }));
    });
    const d = await screen.findByRole("dialog", { name: PIZZA_ITEM.name });
    // Οι τρέχουσες επιλογές είναι προεπιλεγμένες
    expect((within(d).getByRole("radio", { name: /Μικρή/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(d).getByRole("radio", { name: /Μεγάλη/ }));
    fireEvent.click(within(d).getByRole("checkbox", { name: /Τυρί/ }));
    fireEvent.click(within(d).getByRole("button", { name: /Αποθήκευση αλλαγών/ }));

    expect(cartLines()).toEqual([["pizza|extras:cheese;size:l", 3, 6.5]]);
    await waitFor(() => expect(screen.getByText(/οι ποσότητες ενώθηκαν/)).toBeTruthy());
    expect(fetchMenuItemMock).toHaveBeenCalledWith("pizza-roma", "pizza");
  });

  it("επιλογή που έγινε μη διαθέσιμη: ΔΕΝ προεπιλέγεται και ο διάλογος το λέει", async () => {
    const groups = PIZZA_ITEM.optionGroups.map((group) =>
      group.id === "extras"
        ? { ...group, choices: group.choices.map((choice) => (choice.id === "cheese" ? { ...choice, available: false } : choice)) }
        : group,
    );
    fetchMenuItemMock.mockResolvedValue({ ...PIZZA_ITEM, optionGroups: groups });
    renderCart();
    const [, second] = screen.getAllByRole("listitem");
    await act(async () => {
      fireEvent.click(within(second).getByRole("button", { name: /Επεξεργασία επιλογών/ }));
    });
    const d = await screen.findByRole("dialog", { name: PIZZA_ITEM.name });
    expect(d.textContent).toContain("Μία από τις προηγούμενες επιλογές σου δεν υπάρχει πια");
    expect((within(d).getByRole("checkbox", { name: /Τυρί/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("προϊόν που καταργήθηκε → μήνυμα και «Αφαίρεση από το καλάθι»", async () => {
    fetchMenuItemMock.mockResolvedValue(null);
    renderCart();
    const [first] = screen.getAllByRole("listitem");
    await act(async () => {
      fireEvent.click(within(first).getByRole("button", { name: /Επεξεργασία επιλογών/ }));
    });
    await screen.findByText(/δεν υπάρχει πια στον κατάλογο/);
    fireEvent.click(screen.getByRole("button", { name: "Αφαίρεση από το καλάθι" }));
    expect(cartLines()).toEqual([["pizza|extras:cheese;size:l", 1, 6.5]]);
  });
});
