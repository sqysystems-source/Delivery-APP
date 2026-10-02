"use client";

/* ==========================================================================
 *  Buka Delivery — hooks/useCheckoutForm.ts
 *
 *  Κατάσταση της φόρμας checkout: τιμές, λάθη ανά πεδίο και προσυμπλήρωση
 *  από το προφίλ (lib/checkout/prefill.ts).
 *
 *  Η προσυμπλήρωση εφαρμόζεται ΚΑΤΑ ΤΟ RENDER με το μοτίβο «ρύθμιση state
 *  από το προηγούμενο render» της τεκμηρίωσης του React: η reconcilePrefill
 *  είναι καθαρή και επιστρέφει το ίδιο αντικείμενο όταν δεν αλλάζει τίποτα,
 *  οπότε το setState τρέχει μόνο όταν πράγματι φόρτωσε/άλλαξε το προφίλ.
 *  Έτσι δεν υπάρχει effect που γράφει state, ούτε ενδιάμεσο render με
 *  «παλιά» στοιχεία άλλου χρήστη.
 * ========================================================================== */

import { useCallback, useState } from "react";
import type { CheckoutFieldErrors } from "@/types";
import type { UserAddress } from "@/lib/auth";
import {
  chooseSavedAddress,
  createFormState,
  editField,
  reconcilePrefill,
  type PrefillInput,
} from "@/lib/checkout/prefill";
import {
  validateCheckoutForm,
  validateFormField,
  type CheckoutFormField,
  type CheckoutFormOptions,
  type CheckoutFormValues,
} from "@/lib/checkout/validation";

function withoutKeys(
  errors: CheckoutFieldErrors,
  keys: readonly (keyof CheckoutFieldErrors)[],
): CheckoutFieldErrors {
  if (!keys.some((key) => errors[key])) return errors;
  const next = { ...errors };
  for (const key of keys) delete next[key];
  return next;
}

/**
 * Milestone 4: `options.postalCodeRequired` — το κατάστημα έχει ενεργές ζώνες
 * ΤΚ. Αλλάζει ζωντανά (ρύθμιση καταστήματος), γι' αυτό οι έλεγχοι
 * ξαναδημιουργούνται όταν αλλάζει και δεν μένουν «παγωμένοι» στο πρώτο render.
 */
export function useCheckoutForm(prefill: PrefillInput, options: CheckoutFormOptions = {}) {
  const postalCodeRequired = options.postalCodeRequired === true;
  const [state, setState] = useState(createFormState);
  const [errors, setErrors] = useState<CheckoutFieldErrors>({});

  /* Προσυμπλήρωση / καθαρισμός μετά από αλλαγή χρήστη — βλ. σχόλιο κεφαλίδας */
  const reconciled = reconcilePrefill(state, prefill);
  if (reconciled !== state) {
    setState(reconciled);
  }

  const setField = useCallback((field: CheckoutFormField, value: string) => {
    setState((previous) => editField(previous, field, value));
    // Το λάθος φεύγει μόλις ο πελάτης αρχίσει να διορθώνει
    setErrors((previous) => withoutKeys(previous, [field]));
  }, []);

  /** Έλεγχος πεδίου όταν ο πελάτης φεύγει από αυτό */
  const blurField = useCallback(
    (field: CheckoutFormField, value: string) => {
      const error = validateFormField(field, value, { postalCodeRequired });
      setErrors((previous) => {
        if (error) return previous[field] === error ? previous : { ...previous, [field]: error };
        return withoutKeys(previous, [field]);
      });
    },
    [postalCodeRequired],
  );

  const chooseAddress = useCallback((address: UserAddress) => {
    setState((previous) => chooseSavedAddress(previous, address));
    setErrors((previous) => withoutKeys(previous, ["street", "city", "postalCode", "instructions"]));
  }, []);

  /** Πλήρης έλεγχος πριν την αποστολή — επιστρέφει και εφαρμόζει τα λάθη */
  const validateAll = useCallback(
    (values: CheckoutFormValues, notes: string) => {
      const result = validateCheckoutForm(values, notes, { postalCodeRequired });
      setErrors(result);
      return result;
    },
    [postalCodeRequired],
  );

  /** Milestone 4: λάθος ΤΚ από τον server (εκτός ζώνης κ.λπ.) */
  const setFieldError = useCallback((field: CheckoutFormField, message: string) => {
    setErrors((previous) => (previous[field] === message ? previous : { ...previous, [field]: message }));
  }, []);

  /** Λάθη που επέστρεψε ο server (validation_failed) */
  const applyServerErrors = useCallback((serverErrors: CheckoutFieldErrors) => {
    setErrors(serverErrors);
  }, []);

  const clearNotesError = useCallback(() => {
    setErrors((previous) => withoutKeys(previous, ["notes"]));
  }, []);

  return {
    values: reconciled.values,
    sources: reconciled.sources,
    appliedAddressId: reconciled.appliedAddressId,
    errors,
    setField,
    blurField,
    chooseAddress,
    validateAll,
    applyServerErrors,
    clearNotesError,
    setFieldError,
  };
}
