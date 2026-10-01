import { describe, expect, it } from "vitest";
import { mapAdminOrder } from "@/lib/admin/order-mapper";
import { RECEIPT_WIDTH, buildReceiptText, wrapText } from "@/lib/admin/receipt";
import { orderCodeFromId } from "@/lib/server/checkout-service";

const createdAt = { toDate: () => new Date("2026-09-30T18:45:00+03:00") };

/** Έγγραφο όπως το γράφει το νέο /api/orders (schemaVersion 2) */
const newOrderDoc = {
  shopId: "pizza-roma",
  shopName: "Pizza Roma",
  ownerUid: "owner-1",
  userId: "uid-guest",
  customer: { fullName: "Κώστας Παπαδόπουλος", phone: "+306912345678" },
  delivery: {
    street: "Ερμού 5",
    city: "Τρίκαλα",
    floor: "2ος",
    doorbell: "Παπαδόπουλος",
    instructions: "Η πόρτα δίπλα στο φαρμακείο, χτυπήστε δυνατά γιατί δεν ακούγεται το κουδούνι",
  },
  address: "Ερμού 5, Τρίκαλα",
  notes: "Χωρίς κρεμμύδι",
  paymentMethod: "cash_on_delivery",
  lines: [
    { itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 2, lineTotal: 17, unitPriceCents: 850, lineTotalCents: 1700 },
    {
      itemId: "pr-3",
      name: "Πίτσα Special με όλα τα υλικά και διπλό τυρί",
      unitPrice: 11.9,
      quantity: 1,
      lineTotal: 11.9,
    },
  ],
  subtotal: 28.9,
  deliveryFee: 0,
  total: 28.9,
  status: "pending",
  schemaVersion: 2,
  createdAt,
};

/** Έγγραφο από την προηγούμενη έκδοση — μόνο συμβατή διεύθυνση */
const legacyOrderDoc = {
  shopId: "pizza-roma",
  shopName: "Pizza Roma",
  userId: "uid-old",
  address: "Σπίτι",
  lines: [{ itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 1 }],
  subtotal: 8.5,
  deliveryFee: 1.5,
  total: 10,
  status: "accepted",
  createdAt,
};

describe("mapAdminOrder", () => {
  it("νέα παραγγελία → δομημένα στοιχεία πελάτη/παράδοσης/πληρωμής", () => {
    const order = mapAdminOrder("abc123xyz", newOrderDoc);
    expect(order).toMatchObject({
      code: "BK-ABC123",
      isLegacy: false,
      customer: { fullName: "Κώστας Παπαδόπουλος", phone: "+306912345678" },
      delivery: { street: "Ερμού 5", city: "Τρίκαλα", floor: "2ος", doorbell: "Παπαδόπουλος" },
      paymentMethod: "cash_on_delivery",
      address: "Ερμού 5, Τρίκαλα",
      notes: "Χωρίς κρεμμύδι",
      total: 28.9,
    });
    expect(order.createdAt?.toISOString()).toBe("2026-09-30T15:45:00.000Z");
  });

  it("ο κωδικός του ταμπλό είναι ίδιος με αυτόν που είδε ο πελάτης", () => {
    expect(mapAdminOrder("abc123xyz", newOrderDoc).code).toBe(orderCodeFromId("abc123xyz"));
  });

  it("παλαιά παραγγελία → διαβάζεται, με null στα νέα πεδία", () => {
    const order = mapAdminOrder("old999", legacyOrderDoc);
    expect(order).toMatchObject({
      isLegacy: true,
      customer: null,
      delivery: null,
      paymentMethod: null,
      address: "Σπίτι",
      status: "accepted",
    });
    expect(order.lines[0].lineTotal).toBe(8.5); // υπολογίζεται όταν λείπει
  });

  it("κακόμορφο έγγραφο → ασφαλείς προεπιλογές, χωρίς εξαίρεση", () => {
    const order = mapAdminOrder("bad", {
      status: "hacked",
      total: "10",
      lines: "όχι πίνακας",
      customer: "Κώστας",
      delivery: { street: "   " },
      paymentMethod: "bitcoin",
      createdAt: { toDate: () => "όχι ημερομηνία" },
    });
    expect(order).toMatchObject({
      status: "pending",
      total: 0,
      lines: [],
      customer: null,
      delivery: null,
      paymentMethod: null,
      createdAt: null,
      address: "",
    });
  });

  it("serverTimestamp που δεν έχει επιβεβαιωθεί ακόμα → createdAt null", () => {
    expect(mapAdminOrder("x", { ...newOrderDoc, createdAt: null }).createdAt).toBeNull();
  });

  it("χωρίς συμβατή διεύθυνση → προκύπτει από το delivery", () => {
    const { address: _omit, ...withoutAddress } = newOrderDoc;
    void _omit;
    expect(mapAdminOrder("x", withoutAddress).address).toBe("Ερμού 5, Τρίκαλα");
  });
});

describe("κείμενο απόδειξης", () => {
  it("wrapText δεν ξεπερνά ποτέ το πλάτος", () => {
    const lines = wrapText(`Πολύ ${"Α".repeat(70)} μεγάλη λέξη`, 32);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
    expect(lines.join("")).toContain("Α".repeat(32));
  });

  it("νέα παραγγελία: πελάτης, τηλέφωνο, παράδοση, μετρητά — έως 32 χαρακτήρες/γραμμή", () => {
    const text = buildReceiptText(mapAdminOrder("abc123xyz", newOrderDoc));

    for (const expected of [
      "BK-ABC123",
      "ΠΕΛΑΤΗΣ",
      "Κώστας Παπαδόπουλος",
      "Τηλ.: 691 234 5678",
      "ΠΑΡΑΔΟΣΗ",
      "Ερμού 5",
      "Τρίκαλα",
      "Όροφος: 2ος",
      "Κουδούνι: Παπαδόπουλος",
      "Οδηγίες:",
      "2x Margherita",
      "Πληρωμή: Μετρητά κατά την",
      "Είσπραξη:",
      "28,90€",
      "Σχόλιο: Χωρίς κρεμμύδι",
    ]) {
      expect(text).toContain(expected);
    }
    for (const line of text.split("\n")) {
      expect(line.length, JSON.stringify(line)).toBeLessThanOrEqual(RECEIPT_WIDTH);
    }
  });

  it("παλαιά παραγγελία: τυπώνει τη συμβατή διεύθυνση και δηλώνει τα κενά", () => {
    const text = buildReceiptText(mapAdminOrder("old999", legacyOrderDoc));
    expect(text).toContain("Δεν καταγράφηκαν στοιχεία");
    expect(text).toContain("Σπίτι");
    expect(text).toContain("Πληρωμή: δεν καταγράφηκε");
    expect(text).not.toContain("Είσπραξη");
  });
});
