import { describe, expect, it } from "vitest";
import {
  freshKeyState,
  generateIdempotencyKey,
  requestFingerprint,
  resolveKeyForSubmission,
} from "@/lib/checkout/idempotency";
import {
  chooseSavedAddress,
  createFormState,
  editField,
  reconcilePrefill,
  type PrefillInput,
} from "@/lib/checkout/prefill";
import { isValidIdempotencyKey } from "@/lib/checkout/validation";
import type { UserProfile } from "@/lib/auth";
import type { CheckoutRequest } from "@/types";

/* ==========================================================================
 *  Κλειδί idempotency (browser)
 * ========================================================================== */

const request: Omit<CheckoutRequest, "idempotencyKey"> = {
  shopId: "pizza-roma",
  customer: { fullName: "Κώστας", phone: "6912345678" },
  delivery: { street: "Ερμού 5", city: "Τρίκαλα" },
  paymentMethod: "cash_on_delivery",
  lines: [
    { itemId: "b", quantity: 1 },
    { itemId: "a", quantity: 2 },
  ],
  expectedTotalCents: 1000,
};

describe("κλειδί idempotency", () => {
  it("παράγει κλειδιά που δέχεται ο server", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateIdempotencyKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(isValidIdempotencyKey(key)).toBe(true);
  });

  it("το αποτύπωμα αγνοεί σειρά γραμμών και undefined πεδία", () => {
    const reordered = { ...request, lines: [...request.lines].reverse(), notes: undefined };
    expect(requestFingerprint(reordered)).toBe(requestFingerprint(request));
  });

  it("ίδιο αίτημα → ίδιο κλειδί· αλλαγή → νέο κλειδί", () => {
    let counter = 0;
    const generate = () => `key-${++counter}-padding-000000`;

    const first = resolveKeyForSubmission(null, requestFingerprint(request), generate);
    const retry = resolveKeyForSubmission(first, requestFingerprint(request), generate);
    expect(retry.key).toBe(first.key);

    const edited = resolveKeyForSubmission(
      retry,
      requestFingerprint({ ...request, notes: "χωρίς κρεμμύδι" }),
      generate,
    );
    expect(edited.key).not.toBe(first.key);

    const reconfirmed = resolveKeyForSubmission(
      edited,
      requestFingerprint({ ...request, notes: "χωρίς κρεμμύδι", expectedTotalCents: 1050 }),
      generate,
    );
    expect(reconfirmed.key).not.toBe(edited.key);
  });

  it("αχρησιμοποίητο κλειδί υιοθετεί το πρώτο αποτύπωμα", () => {
    const initial = freshKeyState(() => "fresh-key-0000000000");
    const used = resolveKeyForSubmission(initial, "fp");
    expect(used).toEqual({ key: "fresh-key-0000000000", fingerprint: "fp" });
  });
});

/* ==========================================================================
 *  Προσυμπλήρωση
 * ========================================================================== */

function profile(uid: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid,
    fullName: `Χρήστης ${uid}`,
    email: `${uid}@example.com`,
    phone: "6912345678",
    addresses: [
      { id: "home", label: "Σπίτι", street: "Ερμού 5", city: "Τρίκαλα", notes: "2ος όροφος", isDefault: true },
    ],
    createdAt: null,
    updatedAt: null,
    role: "customer",
    ...overrides,
  };
}

const guest: PrefillInput = { uid: null, isAnonymous: false, profile: null, selectedAddress: null };

describe("προσυμπλήρωση φόρμας", () => {
  it("επισκέπτης: τίποτα δεν συμπληρώνεται, ίδιο αντικείμενο", () => {
    const state = createFormState();
    expect(reconcilePrefill(state, guest)).toBe(state);
  });

  it("ανώνυμος χρήστης (checkout επισκέπτη) = επισκέπτης", () => {
    const state = createFormState();
    const next = reconcilePrefill(state, { ...guest, uid: "anon", isAnonymous: true, profile: profile("anon") });
    expect(next.values.fullName).toBe("");
  });

  it("συμπληρώνει όνομα, τηλέφωνο και προεπιλεγμένη διεύθυνση — και είναι ιδεμποτεντική", () => {
    const input: PrefillInput = { uid: "u1", isAnonymous: false, profile: profile("u1"), selectedAddress: null };
    const filled = reconcilePrefill(createFormState(), input);

    expect(filled.values).toMatchObject({
      fullName: "Χρήστης u1",
      phone: "6912345678",
      street: "Ερμού 5",
      city: "Τρίκαλα",
      instructions: "2ος όροφος",
    });
    expect(reconcilePrefill(filled, input)).toBe(filled);
  });

  it("δεν πατά ό,τι έγραψε ο πελάτης πριν φορτώσει ασύγχρονα το προφίλ", () => {
    let state = reconcilePrefill(createFormState(), { ...guest, uid: "u1" }); // προφίλ ακόμη null
    state = editField(state, "fullName", "Το δικό μου όνομα");
    state = editField(state, "street", "Άλλη οδός 1");

    const loaded = reconcilePrefill(state, { uid: "u1", isAnonymous: false, profile: profile("u1"), selectedAddress: null });
    expect(loaded.values.fullName).toBe("Το δικό μου όνομα");
    expect(loaded.values.phone).toBe("6912345678"); // άδειο πεδίο → συμπληρώθηκε
    expect(loaded.values.street).toBe("Άλλη οδός 1"); // η διεύθυνση δεν πατήθηκε
  });

  it("δεν ξαναγεμίζει πεδίο που ο πελάτης άδειασε ρητά", () => {
    const input: PrefillInput = { uid: "u1", isAnonymous: false, profile: profile("u1"), selectedAddress: null };
    let state = reconcilePrefill(createFormState(), input);
    state = editField(state, "phone", "");
    expect(reconcilePrefill(state, input).values.phone).toBe("");
  });

  it("αγνοεί προφίλ που δεν ανήκει στον τρέχοντα χρήστη (καθυστερημένο snapshot)", () => {
    const next = reconcilePrefill(createFormState(), {
      uid: "u2",
      isAnonymous: false,
      profile: profile("u1"),
      selectedAddress: null,
    });
    expect(next.values.fullName).toBe("");
  });

  it("μετά από αλλαγή λογαριασμού σβήνει τα στοιχεία του προηγούμενου — και τα διορθωμένα", () => {
    let state = reconcilePrefill(createFormState(), {
      uid: "u1",
      isAnonymous: false,
      profile: profile("u1"),
      selectedAddress: null,
    });
    state = editField(state, "fullName", "Χρήστης u1 (διόρθωση)");
    state = editField(state, "doorbell", "Κουδούνι που έγραψα εγώ");

    const loggedOut = reconcilePrefill(state, guest);
    expect(loggedOut.values).toMatchObject({
      fullName: "",
      phone: "",
      street: "",
      city: "",
      instructions: "",
      doorbell: "Κουδούνι που έγραψα εγώ", // το έγραψε ο πελάτης — μένει
    });

    const other = reconcilePrefill(loggedOut, {
      uid: "u2",
      isAnonymous: false,
      profile: profile("u2", { addresses: [] }),
      selectedAddress: null,
    });
    expect(other.values.fullName).toBe("Χρήστης u2");
    expect(other.values.street).toBe("");
  });

  it("η επιλογή του Navbar ισχύει μόνο για τον χρήστη που την έκανε", () => {
    const selected = {
      sourceId: "work",
      sourceUid: "u1",
      label: "Δουλειά",
      street: "Βενιζέλου 18",
      city: "Λάρισα",
    };
    const mine = reconcilePrefill(createFormState(), {
      uid: "u1",
      isAnonymous: false,
      profile: profile("u1"),
      selectedAddress: selected,
    });
    expect(mine.values.street).toBe("Βενιζέλου 18");

    const notMine = reconcilePrefill(createFormState(), {
      uid: "u2",
      isAnonymous: false,
      profile: profile("u2", { addresses: [] }),
      selectedAddress: selected,
    });
    expect(notMine.values.street).toBe("");
  });

  it("παραλείπει αποθηκευμένες διευθύνσεις που είναι μόνο ετικέτα", () => {
    const next = reconcilePrefill(createFormState(), {
      uid: "u1",
      isAnonymous: false,
      profile: profile("u1", {
        addresses: [
          { id: "label", label: "Σπίτι", street: "Σπίτι", isDefault: true },
          { id: "real", label: "Γραφείο", street: "Καραϊσκάκη 3", city: "Βόλος" },
        ],
      }),
      selectedAddress: null,
    });
    expect(next.values.street).toBe("Καραϊσκάκη 3");
    expect(next.appliedAddressId).toBe("real");
  });

  it("η ρητή επιλογή διεύθυνσης προστατεύεται από ασύγχρονη προσυμπλήρωση", () => {
    const user = profile("u1", {
      addresses: [
        { id: "home", label: "Σπίτι", street: "Ερμού 5", city: "Τρίκαλα", isDefault: true },
        { id: "work", label: "Δουλειά", street: "Βενιζέλου 18", city: "Λάρισα" },
      ],
    });
    const input: PrefillInput = { uid: "u1", isAnonymous: false, profile: user, selectedAddress: null };
    let state = reconcilePrefill(createFormState(), input);
    state = chooseSavedAddress(state, user.addresses[1]);
    expect(reconcilePrefill(state, input).values.street).toBe("Βενιζέλου 18");
  });
});
