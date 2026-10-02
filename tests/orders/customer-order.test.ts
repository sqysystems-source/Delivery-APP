import { describe, expect, it } from "vitest";
import {
  describeOrderStatus,
  isTerminalStatus,
  mapCustomerOrder,
  orderCodeFromId,
  progressIndex,
  ORDER_PROGRESS_STEPS,
} from "@/lib/orders/customer-order";
import { cancelReasonForStatus } from "@/lib/admin/order-mapper";

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

function v2Order(overrides: Record<string, unknown> = {}) {
  return {
    shopId: "pizza-roma",
    shopName: "Pizza Roma",
    ownerUid: "owner-1",
    userId: "uid-1",
    customer: { fullName: "Κώστας Παπαδόπουλος", phone: "+306912345678" },
    delivery: { street: "Ερμού 5", city: "Τρίκαλα", floor: "2ος", doorbell: "Παπαδόπουλος" },
    address: "Ερμού 5, Τρίκαλα",
    paymentMethod: "cash_on_delivery",
    lines: [
      { itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 2, lineTotal: 17, unitPriceCents: 850, lineTotalCents: 1700 },
    ],
    subtotal: 17,
    deliveryFee: 0,
    total: 17,
    subtotalCents: 1700,
    deliveryFeeCents: 0,
    totalCents: 1700,
    status: "pending",
    etaMinutes: [30, 40],
    schemaVersion: 2,
    createdAt: ts("2026-10-01T10:00:00Z"),
    ...overrides,
  };
}

describe("mapCustomerOrder", () => {
  it("νέα παραγγελία: κωδικός ίδιος με τον server, ποσά από τα λεπτά, ΧΩΡΙΣ στοιχεία επικοινωνίας", () => {
    const order = mapCustomerOrder("abc123xyz", v2Order());
    expect(order.code).toBe("BK-ABC123");
    expect(order.code).toBe(orderCodeFromId("abc123xyz"));
    expect(order).toMatchObject({
      shopName: "Pizza Roma",
      status: "pending",
      subtotal: 17,
      deliveryFee: 0,
      total: 17,
      itemCount: 2,
      paymentMethod: "cash_on_delivery",
      address: "Ερμού 5, Τρίκαλα",
      cancelReason: null,
    });
    expect(order.createdAt?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    // Όνομα/τηλέφωνο δεν περνούν στο view model
    expect(JSON.stringify(order)).not.toContain("+306912345678");
    expect(JSON.stringify(order)).not.toContain("Κώστας");
    // Ούτε εκτίμηση χρόνου
    expect(order).not.toHaveProperty("etaMinutes");
  });

  it("ιστορική παραγγελία (χωρίς customer/delivery/paymentMethod/λεπτά) → ασφαλή fallbacks", () => {
    const order = mapCustomerOrder("legacy0001", {
      shopId: "s1",
      shopName: "Παλιό",
      userId: "uid-1",
      address: "Κεντρική 1, Λάρισα",
      lines: [{ itemId: "x", name: "Σουβλάκι", unitPrice: 3.2, quantity: 3 }],
      subtotal: 9.6,
      deliveryFee: 1,
      total: 10.6,
      status: "completed",
      createdAt: ts("2025-05-01T10:00:00Z"),
    });
    expect(order).toMatchObject({
      paymentMethod: null,
      delivery: null,
      address: "Κεντρική 1, Λάρισα",
      total: 10.6,
      status: "completed",
    });
    expect(order.lines[0].lineTotal).toBeCloseTo(9.6);
  });

  it("κακόμορφα δεδομένα δεν σκάνε", () => {
    const order = mapCustomerOrder("weird", { lines: "nope", status: 42, createdAt: "χθες", total: "10" });
    expect(order).toMatchObject({ status: "unknown", lines: [], total: 0, createdAt: null, shopName: "Κατάστημα" });
  });

  it("άγνωστη τιμή status → «unknown», ΟΧΙ pending ή accepted", () => {
    expect(mapCustomerOrder("x", v2Order({ status: "ready_for_pickup" })).status).toBe("unknown");
    expect(progressIndex("unknown")).toBe(-1);
  });

  it("cancelReason διαβάζεται μόνο σε ακυρωμένη", () => {
    expect(mapCustomerOrder("x", v2Order({ status: "cancelled", cancelReason: "rejected_by_shop" })).cancelReason).toBe("rejected_by_shop");
    expect(mapCustomerOrder("x", v2Order({ status: "accepted", cancelReason: "rejected_by_shop" })).cancelReason).toBeNull();
    expect(mapCustomerOrder("x", v2Order({ status: "cancelled", cancelReason: "<script>" })).cancelReason).toBeNull();
  });
});

describe("κείμενα κατάστασης", () => {
  it("τα βήματα είναι ακριβώς οι τιμές του ταμπλό", () => {
    expect(ORDER_PROGRESS_STEPS).toEqual(["pending", "accepted", "preparing", "delivering", "completed"]);
  });

  it("pending ΔΕΝ λέει ότι έγινε δεκτή", () => {
    const copy = describeOrderStatus("pending");
    expect(copy.label).toBe("Σε αναμονή αποδοχής");
    expect(`${copy.label} ${copy.description}`).not.toMatch(/έγινε δεκτή|αποδέχτηκε την/);
  });

  it("κανένα κείμενο δεν λέει «πληρώθηκε» ή δίνει χρόνο παράδοσης", () => {
    for (const status of [...ORDER_PROGRESS_STEPS, "cancelled", "unknown"] as const) {
      const copy = describeOrderStatus(status);
      expect(`${copy.label} ${copy.description}`).not.toMatch(/πληρώθηκε|εξοφλ|λεπτά|΄|'|σε \d/i);
    }
  });

  it("απόρριψη vs ακύρωση vs παλιά ακύρωση χωρίς λόγο", () => {
    expect(describeOrderStatus("cancelled", "rejected_by_shop").label).toBe("Δεν έγινε δεκτή");
    expect(describeOrderStatus("cancelled", "cancelled_by_shop").description).toContain("αφού την είχε αποδεχτεί");
    expect(describeOrderStatus("cancelled", null).label).toBe("Ακυρώθηκε");
    expect(progressIndex("cancelled")).toBe(-1);
  });

  it("τελικές καταστάσεις", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("delivering")).toBe(false);
  });

  it("ταμπλό: ακύρωση από pending = απόρριψη, αλλιώς ακύρωση", () => {
    expect(cancelReasonForStatus("pending")).toBe("rejected_by_shop");
    expect(cancelReasonForStatus("accepted")).toBe("cancelled_by_shop");
    expect(cancelReasonForStatus("delivering")).toBe("cancelled_by_shop");
  });
});
