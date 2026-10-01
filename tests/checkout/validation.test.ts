import { describe, expect, it } from "vitest";
import { normalizePhone, phoneHref, formatPhoneForDisplay } from "@/lib/checkout/phone";
import {
  buildCompatAddress,
  isValidDocumentId,
  isValidIdempotencyKey,
  validateAndMergeLines,
  validateCheckoutForm,
  validateCheckoutRequest,
  validateStreet,
} from "@/lib/checkout/validation";
import { EMPTY_FORM_VALUES } from "@/lib/checkout/prefill";

const baseRequest = {
  idempotencyKey: "0f8fad5b-d9cb-469f-a165-70867728950e",
  shopId: "pizza-roma",
  customer: { fullName: "Κώστας Παπαδόπουλος", phone: "691 234 5678" },
  delivery: { street: "Ερμού 5", city: "Τρίκαλα" },
  paymentMethod: "cash_on_delivery",
  lines: [{ itemId: "pr-2", quantity: 1 }],
  expectedTotalCents: 1000,
};

describe("τηλέφωνο", () => {
  it.each([
    ["6912345678", "+306912345678"],
    ["691 234 5678", "+306912345678"],
    ["691-234-5678", "+306912345678"],
    ["2101234567", "+302101234567"],
    ["(210) 123 4567", "+302101234567"],
    ["+30 691 234 5678", "+306912345678"],
    ["0030 6912345678", "+306912345678"],
    ["306912345678", "+306912345678"],
    ["+44 20 7946 0958", "+442079460958"],
    ["+49 1512 3456789", "+4915123456789"],
  ])("δέχεται %s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    "",
    "12345",
    "5912345678", // δεν είναι ελληνικό κινητό/σταθερό
    "691234567", // 9 ψηφία
    "69123456789", // 11 ψηφία
    "+30 5912345678", // +30 με άκυρο εθνικό μέρος
    "+0123456789",
    "69123456ab",
    "+" + "1".repeat(16),
    "6".repeat(40),
  ])("απορρίπτει %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("μορφοποιεί για εμφάνιση και για σύνδεσμο κλήσης", () => {
    expect(formatPhoneForDisplay("+306912345678")).toBe("691 234 5678");
    expect(phoneHref("6912345678")).toBe("tel:+306912345678");
    expect(phoneHref("όχι τηλέφωνο")).toBeNull();
  });
});

describe("ids εγγράφων και κλειδιά", () => {
  it.each(["pizza-roma", "og-1", "AbC_123", "a".repeat(128)])("δέχεται id %s", (id) => {
    expect(isValidDocumentId(id)).toBe(true);
  });

  it.each(["", "shops/evil", "../x", "a/b", ".", "..", "__name__", "a b", "ά", "a".repeat(129), 7, null])(
    "απορρίπτει id %s",
    (id) => {
      expect(isValidDocumentId(id)).toBe(false);
    },
  );

  it("επικυρώνει κλειδί idempotency", () => {
    expect(isValidIdempotencyKey("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    expect(isValidIdempotencyKey("short")).toBe(false);
    expect(isValidIdempotencyKey("x".repeat(65))).toBe(false);
    expect(isValidIdempotencyKey("key/with/slashes-1234567")).toBe(false);
  });
});

describe("ενδεικτικές και «μόνο ετικέτα» διευθύνσεις", () => {
  it.each(["Κεντρική Πλατεία", "κεντρικη πλατεια", "ΚΕΝΤΡΙΚΗ ΠΛΑΤΕΙΑ.", "Οδός Ερμού 45", "Διεύθυνση", "Test"])(
    "απορρίπτει ενδεικτική «%s»",
    (street) => {
      expect(validateStreet(street)).toMatch(/ενδεικτική/);
    },
  );

  it.each(["Σπίτι", "σπιτι", "Δουλειά", "Home", "Γραφείο"])("απορρίπτει σκέτη ετικέτα «%s»", (street) => {
    expect(validateStreet(street)).toMatch(/ετικέτα/);
  });

  it.each(["Κεντρική Πλατεία 5", "Πανεπιστημιούπολη, Εστία Β", "Ερμού 5", "Οδός Σπιτιού 3"])(
    "δέχεται πραγματική διεύθυνση «%s»",
    (street) => {
      expect(validateStreet(street)).toBeNull();
    },
  );

  it("απαιτεί γράμμα στην οδό", () => {
    expect(validateStreet("12345")).not.toBeNull();
  });
});

describe("γραμμές παραγγελίας", () => {
  it("ενοποιεί διπλότυπα και ταξινομεί", () => {
    const result = validateAndMergeLines([
      { itemId: "b", quantity: 2 },
      { itemId: "a", quantity: 1 },
      { itemId: "b", quantity: 3 },
    ]);
    expect(result).toEqual({
      ok: true,
      lines: [
        { itemId: "a", quantity: 1 },
        { itemId: "b", quantity: 5 },
      ],
    });
  });

  it("ξαναελέγχει το όριο 20 τεμαχίων ΜΕΤΑ την ενοποίηση", () => {
    const over = validateAndMergeLines([
      { itemId: "pr-2", quantity: 15 },
      { itemId: "pr-2", quantity: 10 },
    ]);
    expect(over.ok).toBe(false);

    const exact = validateAndMergeLines([
      { itemId: "pr-2", quantity: 10 },
      { itemId: "pr-2", quantity: 10 },
    ]);
    expect(exact).toEqual({ ok: true, lines: [{ itemId: "pr-2", quantity: 20 }] });
  });

  it("εφαρμόζει τα όρια 40 γραμμών και 100 τεμαχίων", () => {
    const fortyOne = Array.from({ length: 41 }, (_, index) => ({ itemId: `i${index}`, quantity: 1 }));
    expect(validateAndMergeLines(fortyOne).ok).toBe(false);

    const tooMany = Array.from({ length: 6 }, (_, index) => ({ itemId: `i${index}`, quantity: 17 }));
    expect(validateAndMergeLines(tooMany).ok).toBe(false); // 102 τεμάχια

    const hundred = Array.from({ length: 5 }, (_, index) => ({ itemId: `i${index}`, quantity: 20 }));
    expect(validateAndMergeLines(hundred).ok).toBe(true);
  });

  it.each([0, 21, 1.5, -1, "2", null])("απορρίπτει ποσότητα %s", (quantity) => {
    expect(validateAndMergeLines([{ itemId: "pr-2", quantity }]).ok).toBe(false);
  });

  it("απορρίπτει άκυρα itemId πριν φτιαχτεί οποιαδήποτε διαδρομή", () => {
    expect(validateAndMergeLines([{ itemId: "../pr-2", quantity: 1 }]).ok).toBe(false);
    expect(validateAndMergeLines([{ itemId: "a/b", quantity: 1 }]).ok).toBe(false);
  });
});

describe("validateCheckoutRequest (server)", () => {
  it("δέχεται έγκυρο αίτημα και κανονικοποιεί", () => {
    const result = validateCheckoutRequest({
      ...baseRequest,
      customer: { fullName: "  Κώστας   Παπαδόπουλος ", phone: "691 234 5678" },
      delivery: { street: " Ερμού 5 ", city: "Τρίκαλα", floor: "  ", doorbell: "Παπαδόπουλος" },
      notes: "  χωρίς κρεμμύδι  ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customer).toEqual({ fullName: "Κώστας Παπαδόπουλος", phone: "+306912345678" });
    expect(result.value.delivery).toEqual({ street: "Ερμού 5", city: "Τρίκαλα", doorbell: "Παπαδόπουλος" });
    expect(result.value.notes).toBe("χωρίς κρεμμύδι");
  });

  it("αγνοεί πεδία που δεν ανήκουν στο αίτημα (τιμές, userId, κατάσταση…)", () => {
    const result = validateCheckoutRequest({
      ...baseRequest,
      price: 0.01,
      total: 0.01,
      userId: "attacker",
      ownerUid: "attacker",
      status: "completed",
      shopName: "Ψεύτικο",
      createdAt: "1999-01-01",
      lines: [{ itemId: "pr-2", quantity: 1, unitPrice: 0.01, name: "Δώρο" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.value);
    for (const forbidden of ["price", "total", "userId", "ownerUid", "status", "shopName", "createdAt", "unitPrice", "Δώρο"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("επιστρέφει λάθη ανά πεδίο", () => {
    const result = validateCheckoutRequest({
      ...baseRequest,
      customer: { fullName: "", phone: "123" },
      delivery: { street: "Κεντρική Πλατεία", city: "" },
      notes: "x".repeat(301),
      paymentMethod: "card",
      expectedTotalCents: 1.5,
      shopId: "shops/evil",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual(
      ["city", "expectedTotalCents", "fullName", "notes", "paymentMethod", "phone", "shopId", "street"].sort(),
    );
  });

  it("απορρίπτει μη-string τιμές σε πεδία κειμένου", () => {
    const result = validateCheckoutRequest({
      ...baseRequest,
      customer: { fullName: ["Κώστας"], phone: 6912345678 },
    });
    expect(result.ok).toBe(false);
  });

  it("η συμβατή διεύθυνση χωράει πάντα στους 200 χαρακτήρες", () => {
    const address = buildCompatAddress({ street: "Α".repeat(120), city: "Β".repeat(60) });
    expect(address.length).toBeLessThanOrEqual(200);
  });
});

describe("φόρμα checkout (browser)", () => {
  it("χρησιμοποιεί τους ίδιους κανόνες με τον server", () => {
    const errors = validateCheckoutForm(
      { ...EMPTY_FORM_VALUES, fullName: "Κ", phone: "abc", street: "Σπίτι", city: "Τρίκαλα" },
      "x".repeat(301),
    );
    expect(Object.keys(errors).sort()).toEqual(["fullName", "notes", "phone", "street"].sort());
  });
});
