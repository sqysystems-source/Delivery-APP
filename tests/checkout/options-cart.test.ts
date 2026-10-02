/* ==========================================================================
 *  Milestone 3 — καλάθι με παραλλαγές: ταυτότητα γραμμής, ένωση, όρια ανά
 *  προϊόν, επεξεργασία με σύγκρουση, επικύρωση αποθηκευμένου καλαθιού,
 *  στιγμιότυπο υποβολής, αίτημα και αποτύπωμα idempotency.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import {
  EMPTY_CART,
  addLineToCart,
  applyQuoteToCart,
  buildCartLine,
  computeCartTotals,
  parseStoredCart,
  removeSubmittedLines,
  replaceCartLine,
  snapshotCart,
  toRequestLines,
} from "@/lib/checkout/cart";
import { requestFingerprint } from "@/lib/checkout/idempotency";
import { lineKeyOf } from "@/lib/menu/options";
import type { CartLine, CartShopRef, CartState, CheckoutQuote, CheckoutRequest, OptionSelection } from "@/types";
import { PIZZA_ITEM } from "../fixtures/menu-options";

const shop: CartShopRef = { id: "pizza-roma", name: "Pizza Roma", minOrder: 0, deliveryFee: 1.5, freeDeliveryOver: null };

const LARGE_CHEESE: OptionSelection[] = [
  { groupId: "size", choiceIds: ["l"] },
  { groupId: "extras", choiceIds: ["cheese"] },
];
const SMALL: OptionSelection[] = [{ groupId: "size", choiceIds: ["s"] }];

function line(selections: OptionSelection[], quantity = 1): CartLine {
  const built = buildCartLine(PIZZA_ITEM, selections, quantity);
  if (!built.ok) throw new Error(built.message);
  return built.line;
}

function cartWith(...lines: CartLine[]): CartState {
  return { shop, lines };
}

/* ========================================================================== */

describe("γραμμή από τον διάλογο", () => {
  it("5 + 1 + 0,50 = 6,50/τεμ.· ποσότητα 2 → 13,00 στο σύνολο", () => {
    const pizza = line(LARGE_CHEESE, 2);
    expect(pizza).toMatchObject({ unitPrice: 6.5, basePrice: 5, quantity: 2 });
    expect(computeCartTotals(cartWith(pizza)).subtotalCents).toBe(1300);
  });

  it("δωρεάν αφαίρεση: ίδια τιμή, αλλά ΞΕΧΩΡΙΣΤΗ γραμμή", () => {
    const plain = line(SMALL);
    const noOnion = line([...SMALL, { groupId: "without", choiceIds: ["onion"] }]);
    expect(noOnion.unitPrice).toBe(plain.unitPrice);
    expect(lineKeyOf(noOnion)).not.toBe(lineKeyOf(plain));
  });

  it("υποχρεωτικό μέγεθος που λείπει → άρνηση με ελληνικό μήνυμα", () => {
    const built = buildCartLine(PIZZA_ITEM, [], 1);
    expect(built).toEqual({ ok: false, message: expect.stringContaining("Μέγεθος") });
  });

  it("μη διαθέσιμη επιλογή → άρνηση", () => {
    expect(buildCartLine(PIZZA_ITEM, [{ groupId: "size", choiceIds: ["xl"] }], 1).ok).toBe(false);
  });

  it("προϊόν χωρίς επιλογές → το παλιό σχήμα γραμμής, χωρίς νέα πεδία", () => {
    const built = buildCartLine({ id: "cola", name: "Cola", price: 2.5 }, [], 1);
    expect(built).toEqual({ ok: true, line: { itemId: "cola", name: "Cola", unitPrice: 2.5, quantity: 1 } });
  });
});

describe("ταυτότητα και ένωση γραμμών", () => {
  it("ίδιο προϊόν + ίδιες επιλογές (άλλη σειρά) → μία γραμμή με άθροισμα", () => {
    const first = addLineToCart(EMPTY_CART, shop, line(LARGE_CHEESE, 2));
    if (!first.ok) throw new Error("add");
    const reordered = line([...LARGE_CHEESE].reverse(), 3);
    const second = addLineToCart(first.cart, shop, reordered);
    expect(second.ok && second.merged).toBe(true);
    expect(second.ok && second.cart.lines.map((entry) => entry.quantity)).toEqual([5]);
  });

  it("διαφορετικές επιλογές → ξεχωριστές γραμμές", () => {
    const first = addLineToCart(EMPTY_CART, shop, line(LARGE_CHEESE));
    if (!first.ok) throw new Error("add");
    const second = addLineToCart(first.cart, shop, line(SMALL));
    expect(second.ok && second.cart.lines).toHaveLength(2);
  });

  it("όριο 20 ανά ΠΡΟΪΟΝ για όλες τις παραλλαγές μαζί", () => {
    const cart = cartWith(line(LARGE_CHEESE, 15));
    expect(addLineToCart(cart, shop, line(SMALL, 6))).toEqual({ ok: false, reason: "product_limit" });
    expect(addLineToCart(cart, shop, line(SMALL, 5)).ok).toBe(true);
  });
});

describe("επεξεργασία γραμμής", () => {
  it("αλλάζει επιλογές στη θέση της γραμμής", () => {
    const cola: CartLine = { itemId: "cola", name: "Cola", unitPrice: 2, quantity: 1 };
    const cart = cartWith(line(SMALL), cola);
    const result = replaceCartLine(cart, lineKeyOf(cart.lines[0]), line(LARGE_CHEESE));
    expect(result.ok && result.merged).toBe(false);
    expect(result.ok && result.cart.lines.map(lineKeyOf)).toEqual([lineKeyOf(line(LARGE_CHEESE)), "cola"]);
  });

  it("σύγκρουση: η επεξεργασμένη γίνεται ίδια με άλλη → ενώνονται σε ΜΙΑ (άθροισμα)", () => {
    const cart = cartWith(line(SMALL, 2), line(LARGE_CHEESE, 3));
    const result = replaceCartLine(cart, lineKeyOf(cart.lines[0]), line(LARGE_CHEESE, 2));
    expect(result.ok && result.merged).toBe(true);
    if (!result.ok) return;
    expect(result.cart.lines).toHaveLength(1);
    expect(result.cart.lines[0]).toMatchObject({ quantity: 5, unitPrice: 6.5 });
  });

  it("δεν ξεπερνά το όριο ανά προϊόν όταν αυξάνεται η ποσότητα", () => {
    const cart = cartWith(line(SMALL, 10), line(LARGE_CHEESE, 10));
    expect(replaceCartLine(cart, lineKeyOf(cart.lines[0]), line(SMALL, 11))).toEqual({
      ok: false,
      reason: "product_limit",
    });
  });

  it("γραμμή που δεν υπάρχει πια → not_found, το καλάθι μένει ίδιο", () => {
    expect(replaceCartLine(cartWith(line(SMALL)), "ghost", line(SMALL))).toEqual({ ok: false, reason: "not_found" });
  });
});

/* ========================================================================== */

describe("επικύρωση αποθηκευμένου καλαθιού με επιλογές", () => {
  const pizza = line(LARGE_CHEESE, 2);

  it("κρατά έγκυρη γραμμή με επιλογές (και ξαναϋπολογίζει την τιμή μονάδας)", () => {
    const stored = JSON.stringify({ shop, lines: [{ ...pizza, unitPrice: 0.01 }] });
    const parsed = parseStoredCart(stored);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]).toMatchObject({ unitPrice: 6.5, basePrice: 5, quantity: 2 });
  });

  it("παλιό καλάθι (milestone 1/2) διαβάζεται όπως πριν", () => {
    const legacy = { shop, lines: [{ itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 2 }] };
    expect(parseStoredCart(JSON.stringify(legacy))).toEqual(legacy);
  });

  it.each([
    ["options όχι λίστα", { options: "x" }],
    ["επιλογή χωρίς ετικέτα", { options: [{ ...pizza.options![0], label: "" }] }],
    ["διπλή επιλογή", { options: [pizza.options![0], pizza.options![0]] }],
    ["πειραγμένα λεπτά", { options: [{ ...pizza.options![1], priceDeltaCents: 1 }] }],
    ["αρνητική προσαύξηση", { options: [{ ...pizza.options![1], priceDelta: -1, priceDeltaCents: -100 }] }],
    ["λείπει basePrice", { basePrice: undefined }],
    ["άκυρο id ομάδας", { options: [{ ...pizza.options![0], groupId: "../x" }] }],
  ])("κακόμορφη γραμμή (%s) πετιέται — οι υπόλοιπες μένουν, χωρίς crash", (_name, patch) => {
    const cola = { itemId: "cola", name: "Cola", unitPrice: 2, quantity: 1 };
    const parsed = parseStoredCart(JSON.stringify({ shop, lines: [{ ...pizza, ...patch }, cola] }));
    expect(parsed.lines).toEqual([cola]);
  });

  it("διπλότυπες παραλλαγές ενώνονται· το όριο ανά προϊόν κόβει τις τελευταίες", () => {
    const parsed = parseStoredCart(
      JSON.stringify({
        shop,
        lines: [line(LARGE_CHEESE, 8), line(LARGE_CHEESE, 7), line(SMALL, 9)],
      }),
    );
    expect(parsed.lines.map((entry) => [lineKeyOf(entry), entry.quantity])).toEqual([
      [lineKeyOf(pizza), 15],
      [lineKeyOf(line(SMALL)), 5],
    ]);
  });
});

/* ========================================================================== */

describe("υποβολή: αίτημα, αποτύπωμα, στιγμιότυπο", () => {
  it("στέλνει ΜΟΝΟ ids/ποσότητες — καμία ετικέτα ή τιμή επιλογής", () => {
    const lines = toRequestLines([line(LARGE_CHEESE, 2), { itemId: "cola", name: "Cola", unitPrice: 2, quantity: 1 }]);
    expect(lines).toEqual([
      { itemId: "pizza", quantity: 2, selections: [{ groupId: "extras", choiceIds: ["cheese"] }, { groupId: "size", choiceIds: ["l"] }] },
      { itemId: "cola", quantity: 1 },
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/Τυρί|Μεγάλη|priceDelta|unitPrice/);
  });

  const base: Omit<CheckoutRequest, "idempotencyKey"> = {
    shopId: "pizza-roma",
    customer: { fullName: "Κώστας", phone: "6912345678" },
    delivery: { street: "Ερμού 5", city: "Τρίκαλα" },
    paymentMethod: "cash_on_delivery",
    lines: [],
    expectedTotalCents: 1450,
  };

  it("αποτύπωμα: ίδιες επιλογές σε άλλη σειρά → ίδιο· άλλες επιλογές → άλλο", () => {
    const a = requestFingerprint({
      ...base,
      lines: [
        { itemId: "cola", quantity: 1 },
        { itemId: "pizza", quantity: 2, selections: [{ groupId: "size", choiceIds: ["l"] }, { groupId: "extras", choiceIds: ["bacon", "cheese"] }] },
      ],
    });
    const b = requestFingerprint({
      ...base,
      lines: [
        { itemId: "pizza", quantity: 2, selections: [{ groupId: "extras", choiceIds: ["cheese", "bacon"] }, { groupId: "size", choiceIds: ["l"] }] },
        { itemId: "cola", quantity: 1 },
      ],
    });
    const c = requestFingerprint({
      ...base,
      lines: [
        { itemId: "cola", quantity: 1 },
        { itemId: "pizza", quantity: 2, selections: [{ groupId: "size", choiceIds: ["s"] }, { groupId: "extras", choiceIds: ["bacon", "cheese"] }] },
      ],
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("αποτύπωμα γραμμών χωρίς επιλογές = ίδιο με πριν (κανένα πεδίο selections)", () => {
    expect(requestFingerprint({ ...base, lines: [{ itemId: "cola", quantity: 1 }] })).toContain(
      '"lines":[{"itemId":"cola","quantity":1}]',
    );
  });

  it("μετά την επιτυχία αφαιρείται ΜΟΝΟ η παραλλαγή που στάλθηκε", () => {
    const submitted = snapshotCart(cartWith(line(LARGE_CHEESE, 2)));
    if (!submitted) throw new Error("snapshot");
    // Όσο περίμενε: +1 στην ίδια παραλλαγή και ΝΕΑ παραλλαγή του ίδιου προϊόντος
    const current = cartWith(line(LARGE_CHEESE, 3), line(SMALL, 1));
    const after = removeSubmittedLines(current, submitted);
    expect(after.lines.map((entry) => [lineKeyOf(entry), entry.quantity])).toEqual([
      [lineKeyOf(line(LARGE_CHEESE)), 1],
      [lineKeyOf(line(SMALL)), 1],
    ]);
  });

  it("το στιγμιότυπο είναι βαθύ αντίγραφο (και οι επιλογές)", () => {
    const cart = cartWith(line(LARGE_CHEESE));
    const snapshot = snapshotCart(cart);
    cart.lines[0].options![0].label = "αλλαγμένο";
    expect(snapshot?.lines[0].options?.[0].label).toBe("Μεγάλη");
  });

  it("νέες εξουσιοδοτημένες τιμές εφαρμόζονται ανά παραλλαγή", () => {
    const large = line(LARGE_CHEESE, 1);
    const small = line(SMALL, 1);
    const quote: CheckoutQuote = {
      shopId: "pizza-roma",
      shopName: "Pizza Roma",
      lines: [
        {
          itemId: "pizza",
          name: "Πίτσα του σεφ",
          quantity: 1,
          unitPrice: 7,
          lineTotal: 7,
          unitPriceCents: 700,
          lineTotalCents: 700,
          basePrice: 5,
          basePriceCents: 500,
          options: large.options!.map((option) =>
            option.choiceId === "cheese" ? { ...option, priceDelta: 1, priceDeltaCents: 100 } : option,
          ),
        },
        { itemId: "pizza", name: "Πίτσα του σεφ", quantity: 1, unitPrice: 5, lineTotal: 5, unitPriceCents: 500, lineTotalCents: 500, basePrice: 5, basePriceCents: 500, options: small.options },
      ],
      subtotal: 12,
      deliveryFee: 1.5,
      total: 13.5,
      subtotalCents: 1200,
      deliveryFeeCents: 150,
      totalCents: 1350,
      shopTerms: { minOrder: 0, deliveryFee: 1.5, freeDeliveryOver: null },
    };
    const updated = applyQuoteToCart(cartWith(large, small), quote);
    expect(updated.lines.map((entry) => entry.unitPrice)).toEqual([7, 5]);
    expect(computeCartTotals(updated).totalCents).toBe(quote.totalCents);
  });
});
