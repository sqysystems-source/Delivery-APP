/* ==========================================================================
 *  Milestone 3 — στιγμιότυπα επιλογών σε ταμπλό, απόδειξη και σελίδες
 *  πελάτη· οι ιστορικές παραγγελίες χωρίς επιλογές μένουν αναγνώσιμες.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import { mapAdminOrder } from "@/lib/admin/order-mapper";
import { RECEIPT_WIDTH, buildReceiptText } from "@/lib/admin/receipt";
import { mapCustomerOrder } from "@/lib/orders/customer-order";

const createdAt = { toDate: () => new Date("2026-10-02T19:00:00+03:00") };

const options = [
  { groupId: "size", groupLabel: "Μέγεθος", kind: "single", choiceId: "l", label: "Μεγάλη", priceDelta: 1, priceDeltaCents: 100 },
  { groupId: "extras", groupLabel: "Έξτρα", kind: "multiple", choiceId: "cheese", label: "Τυρί", priceDelta: 0.5, priceDeltaCents: 50 },
  { groupId: "without", groupLabel: "Αφαίρεση υλικών", kind: "remove", choiceId: "onion", label: "κρεμμύδι", priceDelta: 0, priceDeltaCents: 0 },
];

/** Δύο ΠΑΡΑΛΛΑΓΕΣ του ίδιου προϊόντος (ίδιο itemId) + ένα απλό */
const orderDoc = {
  shopId: "pizza-roma",
  shopName: "Pizza Roma",
  userId: "cust",
  customer: { fullName: "Κώστας", phone: "+306912345678" },
  delivery: { street: "Ερμού 5", city: "Τρίκαλα" },
  address: "Ερμού 5, Τρίκαλα",
  paymentMethod: "cash_on_delivery",
  notes: "Χτυπήστε δυνατά",
  lines: [
    { itemId: "pizza", name: "Πίτσα του σεφ", quantity: 2, unitPrice: 6.5, lineTotal: 13, unitPriceCents: 650, lineTotalCents: 1300, basePrice: 5, basePriceCents: 500, options },
    { itemId: "pizza", name: "Πίτσα του σεφ", quantity: 1, unitPrice: 5, lineTotal: 5, unitPriceCents: 500, lineTotalCents: 500, basePrice: 5, basePriceCents: 500, options: [{ ...options[0], choiceId: "s", label: "Μικρή", priceDelta: 0, priceDeltaCents: 0 }] },
    { itemId: "cola", name: "Cola", quantity: 1, unitPrice: 2, lineTotal: 2, unitPriceCents: 200, lineTotalCents: 200 },
  ],
  subtotal: 20,
  deliveryFee: 1.5,
  total: 21.5,
  totalCents: 2150,
  status: "pending",
  schemaVersion: 2,
  createdAt,
};

describe("ταμπλό: παραλλαγές δεν ενώνονται ούτε κρύβονται", () => {
  it("κάθε παραλλαγή είναι δική της γραμμή με το στιγμιότυπό της", () => {
    const order = mapAdminOrder("abcdef123", orderDoc);
    expect(order.lines).toHaveLength(3);
    expect(order.lines.map((line) => line.itemId)).toEqual(["pizza", "pizza", "cola"]);
    expect(order.lines[0]).toMatchObject({ basePrice: 5, unitPrice: 6.5, lineTotal: 13 });
    expect(order.lines[0].options.map((option) => option.label)).toEqual(["Μεγάλη", "Τυρί", "κρεμμύδι"]);
    expect(order.lines[2]).toMatchObject({ options: [], basePrice: null });
  });

  it("ιστορική παραγγελία χωρίς επιλογές (milestone 1) διαβάζεται κανονικά", () => {
    const legacy = mapAdminOrder("old123456", {
      shopId: "s",
      shopName: "S",
      address: "Οδός 1, Πόλη",
      lines: [{ itemId: "x", name: "Σουβλάκι", unitPrice: 3, quantity: 2 }],
      subtotal: 6,
      deliveryFee: 0,
      total: 6,
      status: "completed",
      createdAt,
    });
    expect(legacy.lines[0]).toMatchObject({ name: "Σουβλάκι", lineTotal: 6, options: [], basePrice: null });
  });

  it("κακόμορφο στιγμιότυπο δεν σπάει την οθόνη", () => {
    const order = mapAdminOrder("bad123456", { ...orderDoc, lines: [{ ...orderDoc.lines[0], options: "χαλασμένο" }] });
    expect(order.lines[0].options).toEqual([]);
  });
});

describe("απόδειξη 58mm", () => {
  it("τυπώνει τις επιλογές κάθε παραλλαγής με εσοχή, από το στιγμιότυπο", () => {
    const text = buildReceiptText(mapAdminOrder("abcdef123", orderDoc));
    expect(text).toContain("   Μέγεθος: Μεγάλη (+1,00€)");
    expect(text).toContain("   Έξτρα: Τυρί (+0,50€)");
    expect(text).toContain("   Χωρίς: κρεμμύδι");
    expect(text).toContain("   Μέγεθος: Μικρή");
    // Το σχόλιο παραγγελίας μένει ξεχωριστό από τις επιλογές
    expect(text).toContain("Σχόλιο: Χτυπήστε δυνατά");
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(RECEIPT_WIDTH);
  });

  it("μεγάλες ετικέτες επιλογών σπάνε σε γραμμές ≤ 32", () => {
    const long = {
      ...orderDoc,
      lines: [{ ...orderDoc.lines[0], options: [{ ...options[1], label: "Πολύ μεγάλο όνομα έξτρα υλικού εδώ" }] }],
    };
    const text = buildReceiptText(mapAdminOrder("abcdef123", long));
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(RECEIPT_WIDTH);
    expect(text).toContain("Πολύ μεγάλο");
  });
});

describe("σελίδες πελάτη (παρακολούθηση/ιστορικό)", () => {
  it("δείχνουν το στιγμιότυπο της παραγγελίας, όχι τον σημερινό κατάλογο", () => {
    const order = mapCustomerOrder("abcdef123", orderDoc);
    expect(order.lines.map((line) => line.options.length)).toEqual([3, 1, 0]);
    expect(order.lines[0]).toMatchObject({ unitPrice: 6.5, lineTotal: 13 });
    expect(order.itemCount).toBe(4);
  });

  it("ιστορική παραγγελία χωρίς options → κενή λίστα", () => {
    const order = mapCustomerOrder("old123456", { ...orderDoc, lines: [{ itemId: "x", name: "Γύρος", unitPrice: 3, quantity: 1 }] });
    expect(order.lines[0].options).toEqual([]);
  });
});
