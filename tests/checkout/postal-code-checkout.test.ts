/* ==========================================================================
 *  ΤΚ στο checkout (milestone 4): φόρμα, προσυμπλήρωση, παλιές διευθύνσεις,
 *  καλάθια, αιτήματα και παραγγελίες — καθαρή λογική, χωρίς Firebase.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import type { CartState, CheckoutQuote } from "@/types";
import type { UserProfile } from "@/lib/auth";
import { mapAdminOrder } from "@/lib/admin/order-mapper";
import { buildReceiptText } from "@/lib/admin/receipt";
import { applyQuoteToCart, computeCartTotals, parseStoredCart } from "@/lib/checkout/cart";
import { requestFingerprint } from "@/lib/checkout/idempotency";
import { createFormState, editField, reconcilePrefill, chooseSavedAddress } from "@/lib/checkout/prefill";
import {
  buildDeliveryFromForm,
  validateCheckoutForm,
  validateCheckoutRequest,
  validateFormField,
} from "@/lib/checkout/validation";
import { mapCustomerOrder } from "@/lib/orders/customer-order";
import { EMPTY_FORM_VALUES } from "@/lib/checkout/prefill";

function profile(addresses: UserProfile["addresses"]): UserProfile {
  return {
    uid: "u1",
    fullName: "Χρήστης",
    email: "u1@example.com",
    phone: "6912345678",
    addresses,
    createdAt: null,
    updatedAt: null,
    role: "customer",
  };
}

/* ==========================================================================
 *  Φόρμα
 * ========================================================================== */

describe("πεδίο ΤΚ στη φόρμα", () => {
  it("προαιρετικό χωρίς ζώνες, υποχρεωτικό με ζώνες", () => {
    expect(validateFormField("postalCode", "")).toBeNull();
    expect(validateFormField("postalCode", "", { postalCodeRequired: true })).toContain("Συμπλήρωσε");
  });

  it("κακόμορφος ΤΚ → ελληνικό μήνυμα, ακόμη κι όταν είναι προαιρετικός", () => {
    expect(validateFormField("postalCode", "5462")).toContain("5 ψηφία");
    expect(validateFormField("postalCode", "546 22")).toBeNull();
  });

  it("validateCheckoutForm εφαρμόζει το «υποχρεωτικό»", () => {
    const values = { ...EMPTY_FORM_VALUES, fullName: "Κώστας", phone: "6912345678", street: "Ερμού 5", city: "Τρίκαλα" };
    expect(validateCheckoutForm(values, "").postalCode).toBeUndefined();
    expect(validateCheckoutForm(values, "", { postalCodeRequired: true }).postalCode).toBeTruthy();
  });

  it("ο ΤΚ φεύγει κανονικοποιημένος· κενός → κανένα πεδίο (ίδιο αίτημα με πριν)", () => {
    const base = { ...EMPTY_FORM_VALUES, street: "Ερμού 5", city: "Τρίκαλα" };
    expect(buildDeliveryFromForm({ ...base, postalCode: " 546 22 " })).toEqual({
      street: "Ερμού 5",
      city: "Τρίκαλα",
      postalCode: "54622",
    });
    expect(buildDeliveryFromForm(base)).toEqual({ street: "Ερμού 5", city: "Τρίκαλα" });
  });

  it("αλλαγή ΤΚ → άλλο αποτύπωμα αιτήματος (νέο κλειδί idempotency)", () => {
    const request = {
      shopId: "s",
      customer: { fullName: "Κ", phone: "6912345678" },
      delivery: { street: "Ερμού 5", city: "Τρίκαλα", postalCode: "54622" },
      paymentMethod: "cash_on_delivery" as const,
      lines: [{ itemId: "a", quantity: 1 }],
      expectedTotalCents: 1000,
      expectedDeliveryZoneId: "zc",
    };
    const other = { ...request, delivery: { ...request.delivery, postalCode: "54623" } };
    expect(requestFingerprint(request)).not.toBe(requestFingerprint(other));
  });
});

/* ==========================================================================
 *  Προσυμπλήρωση
 * ========================================================================== */

describe("προσυμπλήρωση ΤΚ από αποθηκευμένες διευθύνσεις", () => {
  const input = (addresses: UserProfile["addresses"]) => ({
    uid: "u1",
    isAnonymous: false,
    profile: profile(addresses),
    selectedAddress: null,
  });

  it("παλιά διεύθυνση χωρίς ΤΚ: διαβάζεται κανονικά, ο ΤΚ μένει κενός", () => {
    const state = reconcilePrefill(createFormState(), input([{ id: "home", label: "Σπίτι", street: "Ερμού 5", city: "Τρίκαλα", isDefault: true }]));
    expect(state.values).toMatchObject({ street: "Ερμού 5", city: "Τρίκαλα", postalCode: "" });
  });

  it("δεν «μαντεύει» ΤΚ από οδό, πόλη ή ετικέτα", () => {
    const state = reconcilePrefill(
      createFormState(),
      input([{ id: "home", label: "54622", street: "Τσιμισκή 54622", city: "Θεσσαλονίκη 54622", isDefault: true }]),
    );
    expect(state.values.postalCode).toBe("");
  });

  it("ρητός ΤΚ αποθηκευμένης διεύθυνσης → κανονικοποιημένος", () => {
    const state = reconcilePrefill(
      createFormState(),
      input([{ id: "home", label: "Σπίτι", street: "Ερμού 5", city: "Θεσσαλονίκη", postalCode: "546 22", isDefault: true }]),
    );
    expect(state.values.postalCode).toBe("54622");
  });

  it("κακόμορφος αποθηκευμένος ΤΚ → αγνοείται (όχι λάθος δεδομένο στη φόρμα)", () => {
    const state = reconcilePrefill(
      createFormState(),
      input([{ id: "home", label: "Σπίτι", street: "Ερμού 5", postalCode: "ΤΚ5462", isDefault: true }]),
    );
    expect(state.values.postalCode).toBe("");
    expect(state.values.street).toBe("Ερμού 5");
  });

  it("ΤΚ που έγραψε ο πελάτης ΔΕΝ πατιέται από καθυστερημένη προσυμπλήρωση", () => {
    let state = reconcilePrefill(createFormState(), { uid: "u1", isAnonymous: false, profile: null, selectedAddress: null });
    state = editField(state, "postalCode", "55131");
    const loaded = reconcilePrefill(
      state,
      input([{ id: "home", label: "Σπίτι", street: "Ερμού 5", city: "Θεσσαλονίκη", postalCode: "54622", isDefault: true }]),
    );
    expect(loaded.values.postalCode).toBe("55131");
    // Η διεύθυνση συμπληρώνεται ως ενότητα: δεν ανακατεύουμε οδό προφίλ με ΤΚ πελάτη
    expect(loaded.values.street).toBe("");
  });

  it("ρητή επιλογή αποθηκευμένης διεύθυνσης φέρνει και τον ΤΚ της", () => {
    const next = chooseSavedAddress(createFormState(), {
      id: "work",
      label: "Δουλειά",
      street: "Βενιζέλου 18",
      city: "Λάρισα",
      postalCode: "41222",
    });
    expect(next.values).toMatchObject({ street: "Βενιζέλου 18", postalCode: "41222" });
  });

  it("αλλαγή λογαριασμού σβήνει και τον ΤΚ του προηγούμενου", () => {
    const filled = reconcilePrefill(
      createFormState(),
      input([{ id: "home", label: "Σπίτι", street: "Ερμού 5", postalCode: "54622", isDefault: true }]),
    );
    const guest = reconcilePrefill(filled, { uid: null, isAnonymous: false, profile: null, selectedAddress: null });
    expect(guest.values.postalCode).toBe("");
  });
});

/* ==========================================================================
 *  Αίτημα server — συμβατότητα
 * ========================================================================== */

describe("επικύρωση αιτήματος με/χωρίς ΤΚ", () => {
  const base = {
    idempotencyKey: "key-000000000000001",
    shopId: "s",
    customer: { fullName: "Κώστας", phone: "6912345678" },
    paymentMethod: "cash_on_delivery",
    lines: [{ itemId: "a", quantity: 1 }],
    expectedTotalCents: 1000,
  };

  it("παλιό αίτημα χωρίς ΤΚ: ίδια κανονική μορφή με πριν", () => {
    const result = validateCheckoutRequest({ ...base, delivery: { street: "Ερμού 5", city: "Τρίκαλα" } });
    expect(result.ok && result.value.delivery).toEqual({ street: "Ερμού 5", city: "Τρίκαλα" });
    expect(result.ok && "expectedDeliveryZoneId" in result.value).toBe(false);
  });

  it("κενός ΤΚ = χωρίς ΤΚ", () => {
    const result = validateCheckoutRequest({ ...base, delivery: { street: "Ερμού 5", city: "Τρίκαλα", postalCode: "  " } });
    expect(result.ok && result.value.delivery).toEqual({ street: "Ερμού 5", city: "Τρίκαλα" });
  });

  it("ΤΚ ως αριθμός (θα έχανε μηδενικά) → απορρίπτεται", () => {
    const result = validateCheckoutRequest({ ...base, delivery: { street: "Ερμού 5", city: "Τρίκαλα", postalCode: 1234 } });
    expect(result.ok).toBe(false);
  });
});

/* ==========================================================================
 *  Καλάθι
 * ========================================================================== */

describe("καλάθι και όροι ζώνης", () => {
  const cart: CartState = {
    shop: { id: "s", name: "S", minOrder: 5, deliveryFee: 1, freeDeliveryOver: null },
    lines: [{ itemId: "a", name: "Α", unitPrice: 9.5, quantity: 2 }],
  };

  it("παλιό αποθηκευμένο καλάθι διαβάζεται ίδιο", () => {
    expect(parseStoredCart(JSON.stringify(cart))).toEqual(cart);
  });

  it("σημάδι «χρέωση ανά ΤΚ»: κρατιέται μόνο το ρητό true", () => {
    const zoned = { ...cart, shop: { ...cart.shop, zonedDelivery: true } };
    expect(parseStoredCart(JSON.stringify(zoned)).shop).toMatchObject({ zonedDelivery: true });
    const bogus = { ...cart, shop: { ...cart.shop, zonedDelivery: "yes" } };
    expect(parseStoredCart(JSON.stringify(bogus)).shop).not.toHaveProperty("zonedDelivery");
  });

  it("σύνολα με όρους ζώνης (ακριβές όριο δωρεάν μεταφορικών)", () => {
    const zone = { deliveryFeeCents: 250, minOrderCents: 2000, freeDeliveryOverCents: 1900 };
    expect(computeCartTotals(cart, zone)).toMatchObject({
      subtotalCents: 1900,
      deliveryFeeCents: 0,
      missingForMinOrderCents: 100,
      freeDeliveryOverCents: 1900,
    });
    expect(computeCartTotals(cart)).toMatchObject({ deliveryFeeCents: 100, totalCents: 2000 });
  });

  it("απάντηση με όρους ΖΩΝΗΣ δεν αλλάζει τους γενικούς όρους στο καλάθι", () => {
    const quote: CheckoutQuote = {
      shopId: "s",
      shopName: "S",
      lines: [{ itemId: "a", name: "Α", quantity: 2, unitPrice: 9.5, lineTotal: 19, unitPriceCents: 950, lineTotalCents: 1900 }],
      subtotal: 19,
      deliveryFee: 2.5,
      total: 21.5,
      subtotalCents: 1900,
      deliveryFeeCents: 250,
      totalCents: 2150,
      shopTerms: { minOrder: 20, deliveryFee: 2.5, freeDeliveryOver: null },
      delivery: {
        mode: "zone",
        zoneId: "zc",
        zoneName: "Κέντρο",
        postalCode: "54622",
        deliveryFeeCents: 250,
        minOrderCents: 2000,
        freeDeliveryOverCents: null,
      },
    };
    expect(applyQuoteToCart(cart, quote).shop).toMatchObject({ minOrder: 5, deliveryFee: 1 });
    const legacyQuote = { ...quote, delivery: undefined };
    expect(applyQuoteToCart(cart, legacyQuote).shop).toMatchObject({ minOrder: 20, deliveryFee: 2.5 });
  });
});

/* ==========================================================================
 *  Παραγγελίες — εμφάνιση
 * ========================================================================== */

describe("παραγγελίες με ΤΚ/ζώνη και παλιές παραγγελίες", () => {
  const zoned = {
    shopId: "s",
    shopName: "Pizza",
    userId: "u1",
    status: "pending",
    address: "Ερμού 5, Θεσσαλονίκη",
    customer: { fullName: "Κώστας", phone: "+306912345678" },
    delivery: { street: "Ερμού 5", city: "Θεσσαλονίκη", postalCode: "54622" },
    deliveryTerms: {
      mode: "zone",
      zoneId: "zc",
      zoneName: "Κέντρο",
      postalCode: "54622",
      deliveryFeeCents: 150,
      minOrderCents: 800,
      freeDeliveryOverCents: 2000,
    },
    paymentMethod: "cash_on_delivery",
    lines: [{ itemId: "a", name: "Margherita", unitPrice: 8.5, quantity: 1, lineTotal: 8.5 }],
    subtotal: 8.5,
    deliveryFee: 1.5,
    total: 10,
    createdAt: null,
  };

  it("ταμπλό: ΤΚ και ζώνη από το στιγμιότυπο", () => {
    const order = mapAdminOrder("abcdef123", zoned);
    expect(order.delivery?.postalCode).toBe("54622");
    expect(order.deliveryTerms).toMatchObject({ mode: "zone", zoneName: "Κέντρο" });
    const receipt = buildReceiptText(order);
    expect(receipt).toContain("ΤΚ: 546 22");
    expect(receipt).toContain("Ζώνη: Κέντρο");
  });

  it("πελάτης: ΤΚ/ζώνη χωρίς στοιχεία επικοινωνίας στο view model", () => {
    const order = mapCustomerOrder("abcdef123", zoned);
    expect(order.delivery?.postalCode).toBe("54622");
    expect(order.deliveryTerms?.mode).toBe("zone");
    expect(order).not.toHaveProperty("customer");
  });

  it("παλιές παραγγελίες (χωρίς ΤΚ/ζώνη) διαβάζονται όπως πριν", () => {
    const legacy = { ...zoned, delivery: { street: "Ερμού 5", city: "Τρίκαλα" }, deliveryTerms: undefined };
    expect(mapAdminOrder("old123", legacy)).toMatchObject({ deliveryTerms: null, delivery: { street: "Ερμού 5" } });
    expect(mapAdminOrder("old123", legacy).delivery).not.toHaveProperty("postalCode");
    expect(mapCustomerOrder("old123", legacy).deliveryTerms).toBeNull();
    expect(buildReceiptText(mapAdminOrder("old123", legacy))).not.toContain("ΤΚ:");
  });
});
