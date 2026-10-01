import { describe, expect, it } from "vitest";
import {
  EMPTY_CART,
  applyQuoteToCart,
  computeCartTotals,
  parseStoredCart,
  removeSubmittedLines,
  snapshotCart,
} from "@/lib/checkout/cart";
import { computeTotalsCents, parseItemPriceCents, parseShopTerms, toCents } from "@/lib/checkout/money";
import type { CartState, CheckoutQuote } from "@/types";

const shop = { id: "pizza-roma", name: "Pizza Roma", minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 };

function cartOf(lines: Array<[string, number, number]>): CartState {
  return {
    shop,
    lines: lines.map(([itemId, unitPrice, quantity]) => ({ itemId, name: itemId, unitPrice, quantity })),
  };
}

describe("χρήμα σε ακέραια λεπτά", () => {
  it("μετατρέπει χωρίς σφάλματα κινητής υποδιαστολής", () => {
    expect(toCents(3.9)).toBe(390);
    expect(toCents(11.9) * 3).toBe(3570); // 11.9 * 3 = 35.699999999999996 σε floats
    expect(toCents(0.1) + toCents(0.2)).toBe(30);
  });

  it.each([
    [{ minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 }, true],
    [{}, true], // απόντα = παλιά συμπεριφορά (0, 0, χωρίς όριο)
    [{ freeDeliveryOver: null }, true],
    [{ deliveryFee: "1.5" }, false],
    [{ deliveryFee: -1 }, false],
    [{ minOrder: Number.NaN }, false],
    [{ freeDeliveryOver: Number.POSITIVE_INFINITY }, false],
    [{ minOrder: 10_000 }, false],
  ])("όροι %j → έγκυροι: %s", (raw, valid) => {
    expect(parseShopTerms(raw).ok).toBe(valid);
  });

  it.each([
    [3.9, 390],
    [0, 0],
    [999, 99_900],
    ["3.90", null],
    [-0.5, null],
    [1000, null],
    [Number.NaN, null],
  ])("τιμή προϊόντος %s → %s λεπτά", (value, expected) => {
    expect(parseItemPriceCents(value)).toBe(expected);
  });

  describe("όρια μεταφορικών και ελάχιστης παραγγελίας", () => {
    const terms = { minOrderCents: 1000, deliveryFeeCents: 200, freeDeliveryOverCents: 2000 };

    it("δωρεάν μεταφορικά ΑΚΡΙΒΩΣ στο όριο", () => {
      expect(computeTotalsCents(2000, terms)).toMatchObject({ deliveryFeeCents: 0, totalCents: 2000 });
    });

    it("χρέωση μεταφορικών ένα λεπτό κάτω από το όριο", () => {
      expect(computeTotalsCents(1999, terms)).toMatchObject({
        deliveryFeeCents: 200,
        totalCents: 2199,
        missingForFreeDeliveryCents: 1,
      });
    });

    it("ελάχιστη παραγγελία: ακριβώς στο όριο περνά, ένα λεπτό κάτω όχι", () => {
      expect(computeTotalsCents(1000, terms).missingForMinOrderCents).toBe(0);
      expect(computeTotalsCents(999, terms).missingForMinOrderCents).toBe(1);
    });

    it("χωρίς όριο δωρεάν μεταφοράς χρεώνει πάντα", () => {
      expect(computeTotalsCents(50_000, { ...terms, freeDeliveryOverCents: null }).deliveryFeeCents).toBe(200);
    });
  });
});

describe("επικύρωση αποθηκευμένου καλαθιού", () => {
  const valid = { shop, lines: [{ itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 2 }] };

  it("κρατά έγκυρο καλάθι αυτούσιο", () => {
    expect(parseStoredCart(JSON.stringify(valid))).toEqual(valid);
  });

  it.each([null, "", "όχι json", "null", "42", "[]", JSON.stringify({ lines: [] })])(
    "άκυρη ρίζα %s → άδειο καλάθι",
    (raw) => {
      expect(parseStoredCart(raw)).toEqual(EMPTY_CART);
    },
  );

  it.each([
    { ...shop, id: "shops/evil" },
    { ...shop, id: "" },
    { ...shop, name: "" },
    { ...shop, deliveryFee: -1 },
    { ...shop, minOrder: "8" },
    { ...shop, freeDeliveryOver: "20" },
  ])("χαλασμένο κατάστημα → άδειο καλάθι (%j)", (badShop) => {
    expect(parseStoredCart(JSON.stringify({ ...valid, shop: badShop }))).toEqual(EMPTY_CART);
  });

  it("πετά χαλασμένες γραμμές και κρατά τις υπόλοιπες", () => {
    const stored = {
      shop,
      lines: [
        { itemId: "ok", name: "Καλό", unitPrice: 3, quantity: 1 },
        { itemId: "../x", name: "Κακό id", unitPrice: 3, quantity: 1 },
        { itemId: "q0", name: "Μηδέν", unitPrice: 3, quantity: 0 },
        { itemId: "q21", name: "Πολλά", unitPrice: 3, quantity: 21 },
        { itemId: "qf", name: "Κλάσμα", unitPrice: 3, quantity: 1.5 },
        { itemId: "qs", name: "String", unitPrice: 3, quantity: "2" },
        { itemId: "pn", name: "Αρνητική", unitPrice: -1, quantity: 1 },
        { itemId: "ps", name: "Τιμή string", unitPrice: "3", quantity: 1 },
        { itemId: "nn", name: "", unitPrice: 3, quantity: 1 },
        "όχι αντικείμενο",
      ],
    };
    const parsed = parseStoredCart(JSON.stringify(stored));
    expect(parsed.lines.map((line) => line.itemId)).toEqual(["ok"]);
  });

  it("ενώνει διπλότυπα με ταβάνι 20 και κρατά έως 40 γραμμές", () => {
    const duplicates = parseStoredCart(
      JSON.stringify({
        shop,
        lines: [
          { itemId: "a", name: "A", unitPrice: 1, quantity: 15 },
          { itemId: "a", name: "A", unitPrice: 1, quantity: 15 },
        ],
      }),
    );
    expect(duplicates.lines).toEqual([{ itemId: "a", name: "A", unitPrice: 1, quantity: 20 }]);

    const many = parseStoredCart(
      JSON.stringify({
        shop,
        lines: Array.from({ length: 45 }, (_, index) => ({
          itemId: `i${index}`,
          name: `I${index}`,
          unitPrice: 1,
          quantity: 1,
        })),
      }),
    );
    expect(many.lines).toHaveLength(40);
  });

  it("καθαρίζει αόρατους χαρακτήρες από ονόματα", () => {
    const parsed = parseStoredCart(
      JSON.stringify({ shop, lines: [{ itemId: "a", name: "Γύρος\u202E\u0000 πίτα", unitPrice: 1, quantity: 1 }] }),
    );
    expect(parsed.lines[0].name).toBe("Γύρος πίτα");
  });
});

describe("σύνολα καλαθιού", () => {
  it("χρησιμοποιεί την ίδια αριθμητική με τον server", () => {
    const totals = computeCartTotals(cartOf([["pr-3", 11.9, 3]]));
    expect(totals).toMatchObject({ subtotalCents: 3570, deliveryFeeCents: 0, totalCents: 3570, canCheckout: true });
  });

  it("αναφέρει πόσα λείπουν για την ελάχιστη", () => {
    const totals = computeCartTotals(cartOf([["pr-8", 2.8, 1]]));
    expect(totals).toMatchObject({ missingForMinOrderCents: 520, canCheckout: false, deliveryFeeCents: 150 });
  });

  it("πάνω από 500€ → δεν επιτρέπεται υποβολή (ίδιο όριο με τον server)", () => {
    expect(computeCartTotals(cartOf([["big", 25, 20]]))).toMatchObject({ totalCents: 50_000, exceedsMaxOrder: false, canCheckout: true });
    expect(computeCartTotals(cartOf([["big", 25, 20], ["pr-8", 0.01, 1]]))).toMatchObject({ exceedsMaxOrder: true, canCheckout: false });
  });

  it("άδειο καλάθι → μηδενικά σύνολα", () => {
    expect(computeCartTotals(EMPTY_CART)).toMatchObject({ totalCents: 0, deliveryFeeCents: 0, canCheckout: false });
  });
});

describe("μετά την υποβολή", () => {
  it("αφαιρεί ΜΟΝΟ τις ποσότητες που στάλθηκαν — κρατά νέες προσθήκες", () => {
    const submitted = snapshotCart(cartOf([["a", 1, 2], ["b", 1, 1]]));
    if (!submitted) throw new Error("snapshot");

    // Όσο περίμενε το αίτημα: +1 στο «a» και νέο προϊόν «c»
    const current = cartOf([["a", 1, 3], ["b", 1, 1], ["c", 1, 4]]);
    const after = removeSubmittedLines(current, submitted);

    expect(after.lines).toEqual([
      { itemId: "a", name: "a", unitPrice: 1, quantity: 1 },
      { itemId: "c", name: "c", unitPrice: 1, quantity: 4 },
    ]);
  });

  it("αδειάζει όταν δεν προστέθηκε τίποτα", () => {
    const cart = cartOf([["a", 1, 2]]);
    const snapshot = snapshotCart(cart);
    if (!snapshot) throw new Error("snapshot");
    expect(removeSubmittedLines(cart, snapshot)).toEqual(EMPTY_CART);
  });

  it("δεν αγγίζει καλάθι άλλου καταστήματος", () => {
    const snapshot = { shopId: "other-shop", lines: [{ itemId: "a", name: "a", unitPrice: 1, quantity: 2 }] };
    const cart = cartOf([["a", 1, 2]]);
    expect(removeSubmittedLines(cart, snapshot)).toBe(cart);
  });

  it("το στιγμιότυπο είναι αντίγραφο — μεταγενέστερες αλλαγές δεν το επηρεάζουν", () => {
    const cart = cartOf([["a", 1, 2]]);
    const snapshot = snapshotCart(cart);
    cart.lines[0].quantity = 9;
    expect(snapshot?.lines[0].quantity).toBe(2);
  });

  it("εφαρμόζει εξουσιοδοτημένες τιμές/όρους χωρίς να αλλάξει ποσότητες", () => {
    const cart = cartOf([["pr-2", 8.5, 2]]);
    const quote: CheckoutQuote = {
      shopId: "pizza-roma",
      shopName: "Pizza Roma (νέο)",
      lines: [
        { itemId: "pr-2", name: "Margherita", quantity: 2, unitPrice: 9, lineTotal: 18, unitPriceCents: 900, lineTotalCents: 1800 },
      ],
      subtotal: 18,
      deliveryFee: 2,
      total: 20,
      subtotalCents: 1800,
      deliveryFeeCents: 200,
      totalCents: 2000,
      shopTerms: { minOrder: 8, deliveryFee: 2, freeDeliveryOver: 25 },
    };
    const updated = applyQuoteToCart(cart, quote);
    expect(updated.lines[0]).toEqual({ itemId: "pr-2", name: "Margherita", unitPrice: 9, quantity: 2 });
    expect(updated.shop).toMatchObject({ name: "Pizza Roma (νέο)", deliveryFee: 2, freeDeliveryOver: 25 });
    expect(computeCartTotals(updated).totalCents).toBe(quote.totalCents);

    expect(applyQuoteToCart(cart, { ...quote, shopId: "other" })).toBe(cart);
  });
});
