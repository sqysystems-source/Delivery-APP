/* ==========================================================================
 *  Buka Delivery — lib/checkout/prefill.ts
 *
 *  Προσυμπλήρωση της φόρμας checkout από το προφίλ του χρήστη — με δύο
 *  εγγυήσεις:
 *
 *   1. ΔΕΝ πατάει ό,τι έγραψε ο πελάτης. Αν το προφίλ φορτώσει αργά (είναι
 *      ασύγχρονο), τα πεδία που ο πελάτης άγγιξε ήδη μένουν ως έχουν.
 *
 *   2. ΔΕΝ διαρρέει στοιχεία σε άλλον χρήστη. Αν αλλάξει ο λογαριασμός
 *      (αποσύνδεση, σύνδεση με άλλον), ό,τι προήλθε από το ΠΡΟΗΓΟΥΜΕΝΟ προφίλ
 *      — ακόμη κι αν ο πελάτης το διόρθωσε λίγο — σβήνεται.
 *
 *  Για να γίνουν και τα δύο, κάθε πεδίο θυμάται την ΠΡΟΕΛΕΥΣΗ του.
 * ========================================================================== */

import type { SelectedDeliveryAddress } from "@/types";
import type { UserAddress, UserProfile } from "@/lib/auth";
import {
  CHECKOUT_FORM_FIELDS,
  cleanSingleLine,
  isUsableStreet,
  type CheckoutFormField,
  type CheckoutFormValues,
} from "@/lib/checkout/validation";

/**
 *   empty          — άδειο, κανείς δεν το άγγιξε
 *   user           — γραμμένο (ή σβησμένο) από τον πελάτη
 *   prefill        — ήρθε από το προφίλ, ανέγγιχτο
 *   prefill-edited — ήρθε από το προφίλ και ο πελάτης το διόρθωσε, ή το
 *                    διάλεξε ρητά από τις αποθηκευμένες διευθύνσεις του
 */
export type FieldSource = "empty" | "user" | "prefill" | "prefill-edited";

export type CheckoutFormState = {
  values: CheckoutFormValues;
  sources: Record<CheckoutFormField, FieldSource>;
  /** Για ποιον χρήστη έγινε η τρέχουσα προσυμπλήρωση (null = επισκέπτης) */
  prefillUid: string | null;
  /** Ποια αποθηκευμένη διεύθυνση εφαρμόστηκε τελευταία */
  appliedAddressId: string | null;
};

export type PrefillInput = {
  uid: string | null;
  isAnonymous: boolean;
  profile: UserProfile | null;
  selectedAddress: SelectedDeliveryAddress | null;
};

export const EMPTY_FORM_VALUES: CheckoutFormValues = {
  fullName: "",
  phone: "",
  street: "",
  city: "",
  floor: "",
  doorbell: "",
  instructions: "",
};

function allSources(source: FieldSource): Record<CheckoutFormField, FieldSource> {
  return Object.fromEntries(CHECKOUT_FORM_FIELDS.map((field) => [field, source])) as Record<
    CheckoutFormField,
    FieldSource
  >;
}

export function createFormState(): CheckoutFormState {
  return {
    values: { ...EMPTY_FORM_VALUES },
    sources: allSources("empty"),
    prefillUid: null,
    appliedAddressId: null,
  };
}

/* --------------------------------------------------------------------------
 *  Επεξεργασία από τον πελάτη
 * -------------------------------------------------------------------------- */

export function editField(
  state: CheckoutFormState,
  field: CheckoutFormField,
  value: string,
): CheckoutFormState {
  const previous = state.sources[field];
  let source: FieldSource;

  if (previous === "prefill" || previous === "prefill-edited") {
    // Ρητό σβήσιμο προσυμπληρωμένου πεδίου = απόφαση του πελάτη, δεν το ξαναγεμίζουμε
    source = value === "" ? "user" : "prefill-edited";
  } else {
    source = value === "" ? "empty" : "user";
  }

  return {
    ...state,
    values: { ...state.values, [field]: value },
    sources: { ...state.sources, [field]: source },
  };
}

/* --------------------------------------------------------------------------
 *  Διευθύνσεις
 * -------------------------------------------------------------------------- */

type AddressCandidate = {
  id: string;
  street: string;
  city: string;
  instructions: string;
};

function fromSavedAddress(address: UserAddress): AddressCandidate | null {
  if (!isUsableStreet(address.street)) return null;
  return {
    id: address.id,
    street: cleanSingleLine(address.street),
    city: cleanSingleLine(address.city ?? ""),
    instructions: typeof address.notes === "string" ? address.notes.trim() : "",
  };
}

function fromSelected(address: SelectedDeliveryAddress): AddressCandidate | null {
  if (!isUsableStreet(address.street)) return null;
  return {
    id: address.sourceId,
    street: cleanSingleLine(address.street),
    city: cleanSingleLine(address.city),
    instructions: address.instructions?.trim() ?? "",
  };
}

/** Η προεπιλεγμένη διεύθυνση του προφίλ — πρώτα η isDefault, αλλιώς η πρώτη χρησιμοποιήσιμη */
export function pickDefaultAddress(profile: UserProfile): UserAddress | null {
  const usable = profile.addresses.filter((address) => isUsableStreet(address.street));
  return usable.find((address) => address.isDefault) ?? usable[0] ?? null;
}

const ADDRESS_FIELDS: readonly CheckoutFormField[] = ["street", "city", "instructions"];

function setPrefilled(
  values: CheckoutFormValues,
  sources: Record<CheckoutFormField, FieldSource>,
  field: CheckoutFormField,
  value: string,
  source: FieldSource,
) {
  values[field] = value;
  sources[field] = value === "" ? "empty" : source;
}

/**
 * Ο πελάτης διάλεξε ρητά μια αποθηκευμένη διεύθυνση μέσα στο checkout.
 * Σημειώνεται ως «prefill-edited»: δεν πατιέται από ασύγχρονη προσυμπλήρωση,
 * αλλά σβήνεται αν αλλάξει λογαριασμός (ανήκει στο προφίλ του).
 */
export function chooseSavedAddress(
  state: CheckoutFormState,
  address: UserAddress,
): CheckoutFormState {
  const candidate = fromSavedAddress(address);
  if (!candidate) return state;

  const values = { ...state.values };
  const sources = { ...state.sources };
  setPrefilled(values, sources, "street", candidate.street, "prefill-edited");
  setPrefilled(values, sources, "city", candidate.city, "prefill-edited");
  setPrefilled(values, sources, "instructions", candidate.instructions, "prefill-edited");

  return { ...state, values, sources, appliedAddressId: candidate.id };
}

/* --------------------------------------------------------------------------
 *  Συμφιλίωση με το προφίλ
 *
 *  ΚΑΘΑΡΗ και ΙΔΕΜΠΟΤΕΝΤΗ: αν δεν υπάρχει τίποτα να αλλάξει, επιστρέφει το
 *  ΙΔΙΟ αντικείμενο. Έτσι μπορεί να καλείται σε κάθε render χωρίς βρόχο.
 * -------------------------------------------------------------------------- */

export function reconcilePrefill(
  state: CheckoutFormState,
  input: PrefillInput,
): CheckoutFormState {
  // Ανώνυμος χρήστης = επισκέπτης: δεν έχει προφίλ για προσυμπλήρωση
  const uid = input.uid && !input.isAnonymous ? input.uid : null;

  let values = state.values;
  let sources = state.sources;
  let appliedAddressId = state.appliedAddressId;
  let changed = false;

  const ensureCopy = () => {
    if (!changed) {
      values = { ...values };
      sources = { ...sources };
      changed = true;
    }
  };

  /* 1. Άλλαξε ο λογαριασμός → σβήνουμε ό,τι προήλθε από το ΠΡΟΗΓΟΥΜΕΝΟ προφίλ */
  if (uid !== state.prefillUid) {
    ensureCopy();
    for (const field of CHECKOUT_FORM_FIELDS) {
      if (sources[field] === "prefill" || sources[field] === "prefill-edited") {
        values[field] = "";
        sources[field] = "empty";
      }
    }
    appliedAddressId = null;
  }

  const profile =
    uid && input.profile && input.profile.uid === uid ? input.profile : null;

  /* 2. Όνομα και τηλέφωνο — μόνο σε άδεια ή ανέγγιχτα προσυμπληρωμένα πεδία */
  if (profile) {
    const personal: Array<[CheckoutFormField, string]> = [
      ["fullName", profile.fullName.trim()],
      ["phone", profile.phone.trim()],
    ];
    for (const [field, value] of personal) {
      const source = sources[field];
      if (value && (source === "empty" || source === "prefill") && values[field] !== value) {
        ensureCopy();
        values[field] = value;
        sources[field] = "prefill";
      }
    }
  }

  /* 3. Διεύθυνση — η επιλογή του Navbar έχει προτεραιότητα, μετά η προεπιλογή */
  let candidate: AddressCandidate | null = null;
  if (uid && input.selectedAddress && input.selectedAddress.sourceUid === uid) {
    candidate = fromSelected(input.selectedAddress);
  }
  if (!candidate && profile) {
    const fallback = pickDefaultAddress(profile);
    candidate = fallback ? fromSavedAddress(fallback) : null;
  }

  const addressUntouched = ADDRESS_FIELDS.every(
    (field) => sources[field] === "empty" || sources[field] === "prefill",
  );

  if (candidate && candidate.id !== appliedAddressId && addressUntouched) {
    ensureCopy();
    setPrefilled(values, sources, "street", candidate.street, "prefill");
    setPrefilled(values, sources, "city", candidate.city, "prefill");
    setPrefilled(values, sources, "instructions", candidate.instructions, "prefill");
    appliedAddressId = candidate.id;
  }

  if (!changed && uid === state.prefillUid && appliedAddressId === state.appliedAddressId) {
    return state;
  }

  return { values, sources, prefillUid: uid, appliedAddressId };
}
