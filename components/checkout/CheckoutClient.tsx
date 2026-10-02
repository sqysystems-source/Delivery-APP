"use client";

/* ==========================================================================
 *  Buka Delivery — components/checkout/CheckoutClient.tsx
 *
 *  Η σελίδα checkout (client). Εδώ —και ΜΟΝΟ εδώ— γίνεται η υποβολή: αφού
 *  ο πελάτης συμπληρώσει στοιχεία, δει τη σύνοψη και πατήσει επιβεβαίωση.
 *
 *  ── ΕΓΓΥΗΣΕΙΣ ───────────────────────────────────────────────────────────
 *  • Διπλό κλικ: ο έλεγχος `submittingRef` γίνεται ΣΥΓΧΡΟΝΑ, πριν από κάθε
 *    await — ένα δεύτερο κλικ στο ίδιο tick δεν περνά ποτέ.
 *  • Idempotency: ένα κλειδί ανά λογική προσπάθεια. Επανάληψη του ΙΔΙΟΥ
 *    αιτήματος (π.χ. μετά από χαμένη απάντηση) κρατά το κλειδί· οποιαδήποτε
 *    αλλαγή, επανεπιβεβαίωση ποσού ή επιτυχία φέρνει νέο.
 *  • Σταθερό στιγμιότυπο: το καλάθι «φωτογραφίζεται» τη στιγμή του κλικ. Σε
 *    επιτυχία αφαιρείται ΜΟΝΟ αυτό — ό,τι μπήκε στο μεταξύ μένει.
 *  • Αποτυχία: το καλάθι μένει ακριβώς όπως ήταν.
 *  • Αλλαγή τιμών: καμία παραγγελία· το καλάθι παίρνει τις νέες τιμές και ο
 *    πελάτης πρέπει να επιβεβαιώσει ξανά ρητά.
 *
 *  ── ΑΝΑΚΤΗΣΗ ΜΕΤΑ ΑΠΟ ΑΒΕΒΑΙΟΤΗΤΑ (milestone 2) ─────────────────────────
 *  • Πριν φύγει κάθε αίτημα καταγράφεται ΜΟΝΟ { uid, κλειδί, ώρα } στο
 *    localStorage (lib/checkout/checkout-attempt.ts) — κανένα προσωπικό στοιχείο.
 *  • Ανανέωση σελίδας με ανεπίλυτη προσπάθεια του ΙΔΙΟΥ uid → η σελίδα ρωτά
 *    το POST /api/orders/recover. ΔΕΝ ξαναστέλνει ποτέ αυτόματα παραγγελία.
 *    Μέχρι να απαντήσει, η υποβολή είναι κλειδωμένη.
 *      – βρέθηκε → οθόνη επιτυχίας με την ΑΡΧΙΚΗ παραγγελία
 *      – δεν βρέθηκε → ο server ΚΛΕΙΝΕΙ το κλειδί (οριστικό), νέα υποβολή OK
 *      – αποτυχία ελέγχου → «Έλεγχος ξανά», η υποβολή μένει κλειδωμένη
 *  • Αλλαγή στοιχείων μετά από αβέβαιη αποτυχία → πρώτα ο ίδιος έλεγχος για
 *    το παλιό κλειδί, και ΜΟΝΟ αν δεν υπάρχει παραγγελία φεύγει το νέο.
 *  • Προσπάθεια άλλου uid ή παλαιότερη από 6 ημέρες → ρητή ειδοποίηση, χωρίς
 *    αυτόματο έλεγχο.
 *
 *  ── ΕΠΙΛΟΓΕΣ ΠΡΟΪΟΝΤΟΣ (milestone 3) ───────────────────────────────────
 *  • Το αίτημα στέλνει ΜΟΝΟ ids επιλογών (toRequestLines)· ο server τιμολογεί.
 *  • option_unavailable / options_changed: ΚΑΜΙΑ παραγγελία. Η συγκεκριμένη
 *    γραμμή επισημαίνεται και ο πελάτης την επεξεργάζεται (EditCartLineDialog)
 *    ή την αφαιρεί — οι επιλογές του δεν πετιούνται ποτέ σιωπηλά.
 *  • Όλα τα στιγμιότυπα/αφαιρέσεις γίνονται ανά ΓΡΑΜΜΗ (itemId + επιλογές).
 *
 *  ── ΩΡΑΡΙΟ ΚΑΙ ΖΩΝΕΣ ΤΚ (milestone 4) ───────────────────────────────────
 *  • Ένας listener στο κατάστημα (useLiveShop) + χρονόμετρο για το επόμενο
 *    όριο ωραρίου (useShopAvailability). Κλειστό/σε παύση → η υποβολή
 *    κλειδώνει με ελληνική εξήγηση· το καλάθι μένει ΑΘΙΚΤΟ.
 *  • Ζώνες ΤΚ ενεργές → ο ΤΚ είναι υποχρεωτικός· σύνολα, ελάχιστη και δωρεάν
 *    μεταφορικά υπολογίζονται με τους όρους της ζώνης του. Εκτός περιοχής ή
 *    ανενεργή ζώνη → καθαρό μήνυμα, καμία υποβολή.
 *  • Το αίτημα στέλνει ΤΚ + τη ζώνη που είδε ο πελάτης (μόνο για σύγκριση).
 *    Ο server αποφασίζει· αν άλλαξε ζώνη/ποσό → καμία παραγγελία, νέα ρητή
 *    επιβεβαίωση με τους νέους όρους (ποτέ σιωπηλή αλλαγή ζώνης/τιμής).
 *  • Αν ο listener αποτύχει, η σελίδα δεν μαντεύει: η υποβολή επιτρέπεται και
 *    ο server κάνει τον έλεγχο.
 * ========================================================================== */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  ChevronLeft,
  Info,
  Loader2,
  LogIn,
  MapPin,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import CheckoutField from "@/components/checkout/CheckoutField";
import CheckoutSuccess from "@/components/checkout/CheckoutSuccess";
import CheckoutSummary, { type PriceChangeNotice } from "@/components/checkout/CheckoutSummary";
import EditCartLineDialog from "@/components/options/EditCartLineDialog";
import AvailabilityBadge from "@/components/shop/AvailabilityBadge";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useCheckoutForm } from "@/hooks/useCheckoutForm";
import { useLiveShop } from "@/hooks/useLiveShop";
import { useShopAvailability } from "@/hooks/useShopAvailability";
import {
  computeCartTotals,
  snapshotCart,
  toRequestLines,
  type SubmittedCartSnapshot,
} from "@/lib/checkout/cart";
import { describeOrderBlock } from "@/lib/shop/availability";
import {
  describeDeliveryProblem,
  formatZoneTerms,
  parseDeliveryZones,
  resolveDeliveryTerms,
  type DeliveryTermsResolution,
} from "@/lib/shop/delivery-zones";
import { POSTAL_CODE_INPUT_MAX, formatPostalCode, normalizePostalCode } from "@/lib/shop/postal-code";
import {
  clearCheckoutAttempt,
  clearCheckoutAttemptsExcept,
  isAttemptExpired,
  saveCheckoutAttempt,
  useCheckoutAttempts,
  type CheckoutAttempt,
} from "@/lib/checkout/checkout-attempt";
import {
  recoverCheckoutAttempt,
  type RecoverAttemptOutcome,
} from "@/lib/checkout/recover-attempt";
import { saveLastOrder } from "@/lib/orders/last-order";
import { CHECKOUT_LIMITS, PAYMENT_METHOD_LABELS } from "@/lib/checkout/constants";
import {
  requestFingerprint,
  resolveKeyForSubmission,
  type IdempotencyKeyState,
} from "@/lib/checkout/idempotency";
import { centsToEuros } from "@/lib/checkout/money";
import { formatOptionLines, lineKeyOf } from "@/lib/menu/options";
import { CheckoutError, submitOrder } from "@/lib/checkout/submit-order";
import { auth } from "@/lib/firebase";
import {
  CHECKOUT_FORM_FIELDS,
  buildDeliveryFromForm,
  cleanMultiLine,
  cleanSingleLine,
  isUsableStreet,
  type CheckoutFormField,
} from "@/lib/checkout/validation";
import { cn, formatPrice } from "@/lib/format";
import type {
  CartLine,
  CheckoutFieldErrors,
  CheckoutQuote,
  CheckoutRequest,
  CheckoutSuccess as CheckoutSuccessResult,
  DeliveryTermsSnapshot,
} from "@/types";

/** Αποτέλεσμα ελέγχου μιας αποθηκευμένης προσπάθειας (κλειδωμένο σε uid+κλειδί) */
type RecoveryCheck = {
  uid: string;
  key: string;
  kind: "failed";
  message: string;
};

/** Ειδοποίηση που μένει ορατή αφού λυθεί/σβηστεί η προσπάθεια */
type RecoveryNotice = {
  uid: string;
  kind: "no_order" | "expired" | "invalid";
};

const RECOVERY_NOTICE_TEXT: Record<RecoveryNotice["kind"], string> = {
  no_order:
    "Ελέγξαμε την προηγούμενη προσπάθειά σου: δεν είχε καταχωρηθεί παραγγελία, και πλέον δεν μπορεί να καταχωρηθεί. Συμπλήρωσε τα στοιχεία και επιβεβαίωσε ξανά.",
  expired:
    "Βρέθηκε παλιά προσπάθεια παραγγελίας (πάνω από 6 ημέρες) που δεν μπορεί πια να ελεγχθεί αυτόματα. Αν δεν είσαι σίγουρος/η αν καταχωρήθηκε, δες τις παραγγελίες σου ή επικοινώνησε με το κατάστημα πριν παραγγείλεις ξανά.",
  invalid:
    "Δεν ήταν δυνατός ο έλεγχος μιας προηγούμενης προσπάθειας παραγγελίας. Αν δεν είσαι σίγουρος/η αν καταχωρήθηκε, δες τις παραγγελίες σου πριν παραγγείλεις ξανά.",
};

/** Ελέγχει μια αποθηκευμένη προσπάθεια — ΠΟΤΕ δεν στέλνει παραγγελία */
async function resolveStoredAttempt(
  attempt: CheckoutAttempt,
): Promise<RecoverAttemptOutcome | { kind: "expired" }> {
  if (isAttemptExpired(attempt, Date.now())) return { kind: "expired" };
  return recoverCheckoutAttempt(attempt);
}

/** Στιγμιότυπο καλαθιού από τις γραμμές που ΕΠΑΛΗΘΕΥΣΕ ο server */
function snapshotFromResult(result: CheckoutSuccessResult): SubmittedCartSnapshot {
  return {
    shopId: result.shopId,
    lines: result.lines.map((line) =>
      line.options && line.options.length > 0 && line.basePrice !== undefined
        ? {
            itemId: line.itemId,
            name: line.name,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            basePrice: line.basePrice,
            options: line.options,
          }
        : {
            itemId: line.itemId,
            name: line.name,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
          },
    ),
  };
}

/** Κωδικοί σφάλματος που ζητούν επεξεργασία ΜΙΑΣ γραμμής (milestone 3) */
const OPTION_ERROR_CODES = new Set(["option_unavailable", "options_changed"]);

/** Milestone 4: σφάλματα που αφορούν τον ΤΚ — εστίαση στο πεδίο */
const POSTAL_ERROR_CODES = new Set([
  "postal_code_required",
  "delivery_zone_unsupported",
  "delivery_zone_unavailable",
]);

type ZoneSnapshot = Extract<DeliveryTermsSnapshot, { mode: "zone" }>;

/**
 * Milestone 4 — όροι παράδοσης όπως τους βλέπει ΤΩΡΑ το checkout:
 *   default — γενικοί όροι του καταστήματος (όπως πριν)
 *   zone    — όροι της ζώνης του ΤΚ
 *   problem — ΤΚ κενός/εκτός περιοχής/ανενεργή ζώνη/κακόμορφη ρύθμιση
 */
type CheckoutDeliveryState =
  | { kind: "default" }
  | { kind: "zone"; snapshot: ZoneSnapshot }
  | {
      kind: "problem";
      reason: Exclude<DeliveryTermsResolution, { ok: true }>["reason"];
      message: string;
    };

/** Όροι που επέστρεψε ο server (μετά από αλλαγή) — ισχύουν μέχρι το επόμενο snapshot */
type DeliveryOverride = {
  postalCode: string | null;
  version: number;
  snapshot: DeliveryTermsSnapshot;
};

const DELIVERY_PENDING_TEXT: Record<Exclude<DeliveryTermsResolution, { ok: true }>["reason"], string> = {
  postal_code_required: "Συμπλήρωσε ΤΚ",
  postal_code_invalid: "Έλεγξε τον ΤΚ",
  unsupported: "Εκτός περιοχής",
  zone_unavailable: "Μη διαθέσιμη περιοχή",
  zones_config_invalid: "Μη διαθέσιμα",
  shop_terms_invalid: "Μη διαθέσιμα",
};

/** Όνομα + σύντομη περιγραφή επιλογών για ειδοποιήσεις */
function lineLabel(line: { name: string; options?: CartLine["options"] }): string {
  const summary = line.options ? formatOptionLines(line.options).join(" · ") : "";
  return summary ? `${line.name} (${summary})` : line.name;
}

type FocusTarget =
  | { kind: "field"; id: string }
  | { kind: "alert" }
  | { kind: "price" }
  | { kind: "success" };

const FIELD_ID = (field: CheckoutFormField | "notes") => `checkout-${field}`;

/** Ποια πεδία αλλάζουν τιμή μετά την απάντηση του server — για την ειδοποίηση */
function buildPriceNotice(
  snapshot: SubmittedCartSnapshot,
  previousDeliveryFee: number,
  previousTotalCents: number,
  quote: CheckoutQuote,
): PriceChangeNotice {
  const before = new Map(snapshot.lines.map((line) => [lineKeyOf(line), line.unitPrice]));
  const changes = quote.lines
    .map((line) => ({ line, key: lineKeyOf(line) }))
    .filter(({ key, line }) => before.has(key) && before.get(key) !== line.unitPrice)
    .map(({ key, line }) => ({
      key,
      name: lineLabel(line),
      before: before.get(key) as number,
      after: line.unitPrice,
    }));

  return {
    previousTotalCents,
    newTotalCents: quote.totalCents,
    changes,
    delivery:
      previousDeliveryFee !== quote.deliveryFee
        ? { before: previousDeliveryFee, after: quote.deliveryFee }
        : null,
  };
}

export default function CheckoutClient() {
  const router = useRouter();
  const {
    cart,
    totals,
    hydrated,
    increase,
    decrease,
    removeLine,
    removeItemLines,
    orderNotes,
    setOrderNotes,
    deliveryAddress,
    applyQuote,
    completeSubmittedOrder,
  } = useCart();
  const { user, profile, isAuthenticated, openLogin, loading: authLoading } = useAuth();
  const uid = user?.uid ?? null;

  /* ---------------- Milestone 4: ζωντανή ρύθμιση καταστήματος -------------- */
  const live = useLiveShop(hydrated ? (cart.shop?.id ?? null) : null);
  const liveData = live.status === "ready" ? live.data : null;
  const { availability, now } = useShopAvailability(liveData, live.receivedAt);
  const zonesParsed = useMemo(
    () => (liveData ? parseDeliveryZones(liveData.deliveryZones) : null),
    [liveData],
  );
  /** unknown: ακόμη δεν ξέρουμε · none: χωρίς ζώνες · zones · invalid */
  const zonesMode: "unknown" | "none" | "zones" | "invalid" =
    live.status === "loading"
      ? "unknown"
      : !zonesParsed
        ? "none"
        : zonesParsed.kind === "invalid"
          ? "invalid"
          : zonesParsed.kind === "config" && zonesParsed.config.enabled
            ? "zones"
            : "none";
  const postalCodeRequired = zonesMode === "zones" || zonesMode === "invalid";

  const form = useCheckoutForm(
    {
      uid: user?.uid ?? null,
      isAnonymous: user?.isAnonymous ?? false,
      profile,
      selectedAddress: deliveryAddress,
    },
    { postalCodeRequired },
  );

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<CheckoutSuccessResult | null>(null);
  const [submitError, setSubmitError] = useState<CheckoutError | null>(null);
  const [priceNotice, setPriceNotice] = useState<PriceChangeNotice | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusTarget | null>(null);
  const [recovered, setRecovered] = useState(false);
  /** Κλειδιά που δημιούργησε ΑΥΤΗ η σελίδα — τα χειρίζεται η ίδια, όχι ο έλεγχος φόρτωσης */
  const [pageKeys, setPageKeys] = useState<readonly string[]>([]);
  const [recoveryCheck, setRecoveryCheck] = useState<RecoveryCheck | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(null);
  const [recheckToken, setRecheckToken] = useState(0);
  /** Milestone 3: γραμμή υπό επεξεργασία επιλογών */
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);
  const [lineAnnouncement, setLineAnnouncement] = useState("");
  /** Milestone 4: όροι παράδοσης από απάντηση του server (price/zone change) */
  const [deliveryOverride, setDeliveryOverride] = useState<DeliveryOverride | null>(null);

  /* ------------------ Milestone 4: όροι παράδοσης τώρα ------------------- */
  const postalInput = cleanSingleLine(form.values.postalCode);
  const normalizedPostal = normalizePostalCode(postalInput);
  const delivery = useMemo<CheckoutDeliveryState>(() => {
    if (zonesMode === "invalid") {
      return {
        kind: "problem",
        reason: "zones_config_invalid",
        message: describeDeliveryProblem("zones_config_invalid", null),
      };
    }
    /* Ο server μόλις μας είπε τους τρέχοντες όρους για ΑΥΤΟΝ τον ΤΚ, και ο
     * listener δεν έχει φέρει ακόμη νεότερη ρύθμιση */
    if (
      deliveryOverride &&
      deliveryOverride.version === live.version &&
      deliveryOverride.postalCode === normalizedPostal
    ) {
      return deliveryOverride.snapshot.mode === "zone"
        ? { kind: "zone", snapshot: deliveryOverride.snapshot }
        : { kind: "default" };
    }
    if (zonesMode !== "zones" || !liveData) return { kind: "default" };

    const resolution = resolveDeliveryTerms(liveData, postalInput || null);
    if (resolution.ok) {
      return resolution.snapshot.mode === "zone"
        ? { kind: "zone", snapshot: resolution.snapshot }
        : { kind: "default" };
    }
    return {
      kind: "problem",
      reason: resolution.reason,
      message: describeDeliveryProblem(resolution.reason, normalizedPostal),
    };
  }, [zonesMode, deliveryOverride, live.version, normalizedPostal, liveData, postalInput]);

  /** Σύνολα με τους όρους που ισχύουν (της ζώνης, αν υπάρχει) */
  const checkoutTotals = useMemo(
    () =>
      delivery.kind === "zone"
        ? computeCartTotals(cart, {
            deliveryFeeCents: delivery.snapshot.deliveryFeeCents,
            minOrderCents: delivery.snapshot.minOrderCents,
            freeDeliveryOverCents: delivery.snapshot.freeDeliveryOverCents,
          })
        : totals,
    [delivery, cart, totals],
  );

  /** Διαθεσιμότητα: μόνο όταν ΞΕΡΟΥΜΕ ότι δεν δέχεται (αποτυχία listener → αποφασίζει ο server) */
  const checkingShop = hydrated && cart.lines.length > 0 && live.status === "loading";
  const orderBlockMessage =
    live.status === "missing"
      ? "Το κατάστημα δεν είναι πια διαθέσιμο. Το καλάθι σου μένει ως έχει."
      : live.status === "ready" && availability && availability.state !== "open"
        ? describeOrderBlock(availability, now)
        : zonesMode === "invalid"
          ? `${describeDeliveryProblem("zones_config_invalid", null)} Το καλάθι σου μένει ως έχει.`
          : null;

  const submittingRef = useRef(false);
  const keyRef = useRef<IdempotencyKeyState | null>(null);
  /** Κλειδί με αβέβαιο αποτέλεσμα σε αυτή τη σελίδα + ο uid που το έστειλε */
  const uncertainRef = useRef<{ uid: string | null; key: string } | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const alertRef = useRef<HTMLDivElement | null>(null);
  const priceNoticeRef = useRef<HTMLDivElement | null>(null);
  const successHeadingRef = useRef<HTMLHeadingElement | null>(null);

  /* Η εστίαση γίνεται ΜΕΤΑ το render που εμφάνισε το στοιχείο */
  useEffect(() => {
    if (!focusRequest) return;
    switch (focusRequest.kind) {
      case "field":
        document.getElementById(focusRequest.id)?.focus();
        break;
      case "alert":
        alertRef.current?.focus();
        break;
      case "price":
        priceNoticeRef.current?.focus();
        break;
      case "success":
        successHeadingRef.current?.focus();
        break;
    }
  }, [focusRequest]);

  /* ----------------- Αποθηκευμένες προσπάθειες (ανανέωση) ----------------- */
  const attempts = useCheckoutAttempts();
  const ownAttempt =
    hydrated && !authLoading && uid ? (attempts.find((entry) => entry.uid === uid) ?? null) : null;
  /** Προσπάθεια από ΠΡΙΝ τη φόρτωση της σελίδας, που περιμένει έλεγχο */
  const storedAttempt = ownAttempt && !pageKeys.includes(ownAttempt.key) ? ownAttempt : null;
  /* Προσπάθειες άλλης σύνδεσης (όχι όσες έστειλε αυτή η σελίδα — π.χ. νέος
   * ανώνυμος uid που δεν έχει φτάσει ακόμη στο AuthContext) */
  const otherAccountAttempts =
    hydrated && !authLoading
      ? attempts.filter((entry) => entry.uid !== uid && !pageKeys.includes(entry.key))
      : [];
  const currentCheck =
    storedAttempt && recoveryCheck?.uid === storedAttempt.uid && recoveryCheck.key === storedAttempt.key
      ? recoveryCheck
      : null;
  /** idle: τίποτα να ελεγχθεί · checking: περιμένουμε τον server · failed: άγνωστο */
  const recoveryPhase: "idle" | "checking" | "failed" = storedAttempt
    ? (currentCheck?.kind ?? "checking")
    : "idle";
  const visibleNotice = recoveryNotice && recoveryNotice.uid === uid ? recoveryNotice : null;

  const storedKey = storedAttempt?.key ?? null;
  const storedUid = storedAttempt?.uid ?? null;
  const storedStartedAt = storedAttempt?.startedAt ?? 0;

  useEffect(() => {
    if (!storedKey || !storedUid) return;
    const attempt: CheckoutAttempt = { uid: storedUid, key: storedKey, startedAt: storedStartedAt };
    let cancelled = false;

    void resolveStoredAttempt(attempt).then((outcome) => {
      if (cancelled) return;
      switch (outcome.kind) {
        case "order_found":
          clearCheckoutAttempt(attempt.uid, attempt.key);
          saveLastOrder({ uid: attempt.uid, orderId: outcome.order.orderId, savedAt: Date.now() });
          completeSubmittedOrder(snapshotFromResult(outcome.order));
          setRecovered(true);
          setSuccess(outcome.order);
          setFocusRequest({ kind: "success" });
          break;
        case "no_order":
        case "expired":
        case "invalid":
          clearCheckoutAttempt(attempt.uid, attempt.key);
          setRecoveryNotice({ uid: attempt.uid, kind: outcome.kind });
          break;
        case "identity_mismatch":
          // Ο συνδεδεμένος χρήστης άλλαξε ενώ ελέγχαμε — ο νέος έλεγχος θα ξεκινήσει μόνος του
          setRecoveryCheck({
            uid: attempt.uid,
            key: attempt.key,
            kind: "failed",
            message: "Η σύνδεση άλλαξε κατά τον έλεγχο. Πάτα «Έλεγχος ξανά».",
          });
          break;
        case "failed":
          setRecoveryCheck({ uid: attempt.uid, key: attempt.key, kind: "failed", message: outcome.message });
          break;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [storedKey, storedUid, storedStartedAt, recheckToken, completeSubmittedOrder]);

  const recheckStoredAttempt = () => {
    setRecoveryCheck(null);
    setRecheckToken((value) => value + 1);
  };

  const savedAddresses = useMemo(() => {
    if (!isAuthenticated || !user || !profile || profile.uid !== user.uid) return [];
    return profile.addresses.filter((address) => isUsableStreet(address.street));
  }, [isAuthenticated, user, profile]);

  /* Η ειδοποίηση τιμών ισχύει όσο το καλάθι δείχνει το νέο σύνολο */
  const activePriceNotice =
    priceNotice && priceNotice.newTotalCents === checkoutTotals.totalCents ? priceNotice : null;

  /* ------------------------------ Υποβολή ------------------------------ */
  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    // Συγχρονος φραγμός: κανένα δεύτερο αίτημα όσο τρέχει το πρώτο
    if (submittingRef.current) return;
    // Ανεπίλυτη προσπάθεια από πριν την ανανέωση: πρώτα ο έλεγχος
    if (recoveryPhase !== "idle") return;
    // Milestone 4: κλειστό/σε παύση/ακόμη άγνωστο → καμία αποστολή, το καλάθι μένει
    if (checkingShop || orderBlockMessage) return;

    const snapshot = snapshotCart(cart);
    if (!hydrated || !snapshot) return;

    setSubmitError(null);

    /* 1. Έλεγχος φόρμας στον browser */
    const fieldErrors = form.validateAll(form.values, orderNotes);
    const firstInvalid = [...CHECKOUT_FORM_FIELDS, "notes" as const].find(
      (field) => fieldErrors[field],
    );
    if (firstInvalid) {
      setFocusRequest({ kind: "field", id: FIELD_ID(firstInvalid) });
      return;
    }
    /* Milestone 4: ΤΚ εκτός περιοχής / ανενεργή ζώνη → καθαρό μήνυμα στο πεδίο */
    if (delivery.kind === "problem") {
      form.setFieldError("postalCode", delivery.message);
      setFocusRequest({ kind: "field", id: FIELD_ID("postalCode") });
      return;
    }
    if (checkoutTotals.missingForMinOrderCents > 0 || checkoutTotals.exceedsMaxOrder) return;

    /* 2. Το αίτημα — ΜΟΝΟ στοιχεία πελάτη, ids και ποσότητες */
    const notes = cleanMultiLine(orderNotes);
    const request: Omit<CheckoutRequest, "idempotencyKey"> = {
      shopId: snapshot.shopId,
      customer: {
        fullName: cleanSingleLine(form.values.fullName),
        phone: cleanSingleLine(form.values.phone),
      },
      delivery: buildDeliveryFromForm(form.values),
      ...(notes ? { notes } : {}),
      paymentMethod: "cash_on_delivery",
      lines: toRequestLines(snapshot.lines),
      // Το σύνολο που βλέπει ο πελάτης — ΜΟΝΟ για σύγκριση στον server
      expectedTotalCents: checkoutTotals.totalCents,
      // Milestone 4: η ζώνη που βλέπει ο πελάτης — ΜΟΝΟ για σύγκριση
      ...(delivery.kind === "zone" ? { expectedDeliveryZoneId: delivery.snapshot.zoneId } : {}),
    };

    /* 3. Κλειδί: ίδιο για ίδιο αίτημα, νέο για οτιδήποτε άλλαξε */
    const keyState = resolveKeyForSubmission(keyRef.current, requestFingerprint(request));

    const submittedDeliveryFee = checkoutTotals.deliveryFee;
    const submittedZone = {
      name: delivery.kind === "zone" ? delivery.snapshot.zoneName : null,
      postalCode: normalizedPostal,
      version: live.version,
    };
    submittingRef.current = true;
    setSubmitting(true);

    try {
      /* 4. Αβέβαιο προηγούμενο κλειδί και ΝΕΟ κλειδί τώρα (άλλαξε κάτι): πρώτα
       *    μαθαίνουμε αν το παλιό δημιούργησε παραγγελία. Ποτέ τυφλά νέα. */
      const outstanding = uncertainRef.current;
      if (outstanding && outstanding.key !== keyState.key) {
        const outstandingUid = outstanding.uid ?? uid;
        const outcome: RecoverAttemptOutcome = outstandingUid
          ? await recoverCheckoutAttempt({ uid: outstandingUid, key: outstanding.key })
          : { kind: "identity_mismatch" };

        if (outcome.kind === "order_found") {
          uncertainRef.current = null;
          keyRef.current = null;
          if (outstandingUid) clearCheckoutAttempt(outstandingUid, outstanding.key);
          showSuccess(outcome.order, snapshotFromResult(outcome.order), outstandingUid, true);
          return;
        }
        if (outcome.kind === "no_order") {
          uncertainRef.current = null;
          if (outstandingUid) clearCheckoutAttempt(outstandingUid, outstanding.key);
        } else if (outcome.kind === "identity_mismatch") {
          // Άλλη σύνδεση: το παλιό κλειδί δεν ελέγχεται από εδώ. Ενημερώνουμε ρητά.
          uncertainRef.current = null;
          setSubmitError(
            new CheckoutError({
              code: "auth_failed",
              status: 0,
              uncertain: false,
              message:
                "Η σύνδεσή σου άλλαξε μετά την προηγούμενη αβέβαιη αποστολή, οπότε δεν μπορούμε να ελέγξουμε αν εκείνη καταχωρήθηκε. Έλεγξε τις παραγγελίες του προηγούμενου λογαριασμού πριν συνεχίσεις· αν θέλεις να παραγγείλεις, πάτα ξανά «Ολοκλήρωση παραγγελίας».",
            }),
          );
          setFocusRequest({ kind: "alert" });
          return;
        } else {
          setSubmitError(
            new CheckoutError({
              code: "network_error",
              status: 0,
              uncertain: true,
              message:
                "Δεν μπορέσαμε να ελέγξουμε αν καταχωρήθηκε η προηγούμενη αποστολή, γι' αυτό ΔΕΝ στείλαμε νέα παραγγελία. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.",
            }),
          );
          setFocusRequest({ kind: "alert" });
          return;
        }
      }

      keyRef.current = keyState;
      setPageKeys((previous) =>
        previous.includes(keyState.key) ? previous : [...previous, keyState.key],
      );

      let sentUid: string | null = null;
      try {
        const result = await submitOrder(
          { ...request, idempotencyKey: keyState.key },
          {
            onBeforeSend: (senderUid) => {
              sentUid = senderUid;
              saveCheckoutAttempt({ uid: senderUid, key: keyState.key, startedAt: Date.now() });
            },
          },
        );

        if (sentUid) clearCheckoutAttempt(sentUid, keyState.key);
        uncertainRef.current = null;
        keyRef.current = null; // η επόμενη παραγγελία ξεκινά με νέο κλειδί
        showSuccess(result, snapshot, sentUid ?? auth.currentUser?.uid ?? uid, false);
      } catch (caught) {
        if (!(caught instanceof CheckoutError) || caught.uncertain) {
          uncertainRef.current = { uid: sentUid, key: keyState.key };
        } else {
          /* Οριστική απάντηση: με αυτό το κλειδί ΔΕΝ υπάρχει παραγγελία */
          if (sentUid) clearCheckoutAttempt(sentUid, keyState.key);
          if (uncertainRef.current?.key === keyState.key) uncertainRef.current = null;
        }
        throw caught;
      }
    } catch (caught) {
      const error =
        caught instanceof CheckoutError
          ? caught
          : new CheckoutError({
              code: "internal_error",
              status: 0,
              message:
                "Κάτι πήγε στραβά. Πάτα «Δοκίμασε ξανά» χωρίς αλλαγές — δεν θα δημιουργηθεί δεύτερη παραγγελία.",
              uncertain: true,
            });

      handleSubmitError(error, snapshot, submittedDeliveryFee, request.expectedTotalCents, submittedZone);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const showSuccess = (
    result: CheckoutSuccessResult,
    submitted: SubmittedCartSnapshot,
    ownerUid: string | null,
    wasRecovered: boolean,
  ) => {
    completeSubmittedOrder(submitted);
    if (ownerUid) saveLastOrder({ uid: ownerUid, orderId: result.orderId, savedAt: Date.now() });
    setPriceNotice(null);
    setSubmitError(null);
    setRecovered(wasRecovered);
    setSuccess(result);
    setFocusRequest({ kind: "success" });
  };

  const handleSubmitError = (
    error: CheckoutError,
    snapshot: SubmittedCartSnapshot,
    previousDeliveryFee: number,
    previousTotalCents: number,
    previousZone: { name: string | null; postalCode: string | null; version: number },
  ) => {
    /* Milestone 4: ο server έστειλε τους ΤΡΕΧΟΝΤΕΣ όρους παράδοσης — ισχύουν
     * για αυτόν τον ΤΚ μέχρι να φέρει ο listener νεότερη ρύθμιση */
    const quoteDelivery = error.quote?.delivery;
    if (quoteDelivery) {
      setDeliveryOverride({
        postalCode: previousZone.postalCode,
        version: previousZone.version,
        snapshot: quoteDelivery,
      });
    }

    /* Αλλαγή τιμών ή ζώνης: νέα σύνοψη, ΚΑΜΙΑ παραγγελία, χρειάζεται νέο κλικ */
    if ((error.code === "price_changed" || error.code === "delivery_zone_changed") && error.quote) {
      const notice = buildPriceNotice(snapshot, previousDeliveryFee, previousTotalCents, error.quote);
      if (quoteDelivery) {
        const nextZone = quoteDelivery.mode === "zone" ? quoteDelivery.zoneName : null;
        if (nextZone !== previousZone.name || error.code === "delivery_zone_changed") {
          notice.zone = { before: previousZone.name, after: nextZone };
        }
      }
      setPriceNotice(notice);
      applyQuote(error.quote);
      setFocusRequest({ kind: "price" });
      return;
    }

    /* Milestone 4: ΤΚ εκτός περιοχής / ανενεργή ζώνη / λείπει → στο πεδίο */
    if (POSTAL_ERROR_CODES.has(error.code)) {
      setSubmitError(error);
      form.setFieldError("postalCode", error.fieldErrors?.postalCode ?? error.message);
      setFocusRequest({ kind: "field", id: FIELD_ID("postalCode") });
      return;
    }

    if (
      (error.code === "below_minimum_order" || error.code === "order_too_large") &&
      error.quote
    ) {
      applyQuote(error.quote);
    }

    if (error.code === "idempotency_key_reused" || error.code === "checkout_attempt_closed") {
      keyRef.current = null;
    }

    setSubmitError(error);

    if (error.code === "validation_failed" && error.fieldErrors) {
      form.applyServerErrors(error.fieldErrors);
      const firstInvalid = [...CHECKOUT_FORM_FIELDS, "notes" as const].find(
        (field) => error.fieldErrors?.[field],
      );
      if (firstInvalid) {
        setFocusRequest({ kind: "field", id: FIELD_ID(firstInvalid) });
        return;
      }
    }

    setFocusRequest({ kind: "alert" });
  };

  /* ============================ ΚΑΤΑΣΤΑΣΕΙΣ ============================ */

  if (success) {
    return (
      <CheckoutSuccess
        result={success}
        recovered={recovered}
        headingRef={successHeadingRef}
        onContinue={() => router.push("/")}
      />
    );
  }

  if (!hydrated) {
    return (
      <div
        className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8"
        aria-busy="true"
        aria-label="Φόρτωση καλαθιού"
      >
        <div className="h-8 w-64 animate-pulse rounded-full bg-gray-200" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="h-96 animate-pulse rounded-3xl bg-gray-100" />
          <div className="h-72 animate-pulse rounded-3xl bg-gray-100" />
        </div>
      </div>
    );
  }

  if (!cart.shop || cart.lines.length === 0) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16 text-center sm:px-6">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gray-100">
          <ShoppingBag className="h-8 w-8 text-gray-400" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-black tracking-tight text-gray-900">
          Το καλάθι σου είναι άδειο
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Διάλεξε κατάστημα και πρόσθεσε προϊόντα για να ολοκληρώσεις παραγγελία.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-full bg-orange-500 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-105 hover:bg-orange-600"
        >
          Δες τα καταστήματα
        </Link>
      </div>
    );
  }

  /* ================================ ΦΟΡΜΑ ================================ */

  const { values, errors } = form;
  /* Milestone 4: όσο δεν έχει βρεθεί ζώνη, η ελάχιστη/το σύνολο δεν είναι
   * γνωστά — το κουμπί μένει ενεργό ώστε το πάτημα να δείξει το μήνυμα ΤΚ */
  const deliveryPending =
    delivery.kind === "problem" ? DELIVERY_PENDING_TEXT[delivery.reason] : null;
  const canSubmit =
    !submitting &&
    recoveryPhase === "idle" &&
    !checkingShop &&
    !orderBlockMessage &&
    (deliveryPending !== null ||
      (checkoutTotals.missingForMinOrderCents === 0 && !checkoutTotals.exceedsMaxOrder));
  const zoneLabel =
    delivery.kind === "zone"
      ? `Ζώνη «${delivery.snapshot.zoneName}» · ΤΚ ${formatPostalCode(delivery.snapshot.postalCode)}`
      : null;
  /* Milestone 3: σφάλμα επιλογών → η ΣΥΓΚΕΚΡΙΜΕΝΗ γραμμή (όχι όλο το προϊόν) */
  const errorLine =
    submitError && OPTION_ERROR_CODES.has(submitError.code) && submitError.lineKey
      ? (cart.lines.find((line) => lineKeyOf(line) === submitError.lineKey) ?? null)
      : null;
  /* Προϊόν που καταργήθηκε/εξαντλήθηκε → όλες οι παραλλαγές του */
  const errorItemInCart =
    !errorLine &&
    submitError?.itemId &&
    !OPTION_ERROR_CODES.has(submitError.code) &&
    cart.lines.some((line) => line.itemId === submitError.itemId)
      ? submitError.itemId
      : null;

  const serverOnlyErrors: CheckoutFieldErrors = {};
  if (submitError?.fieldErrors) {
    for (const [key, message] of Object.entries(submitError.fieldErrors)) {
      if (![...CHECKOUT_FORM_FIELDS, "notes", "lines"].includes(key)) {
        serverOnlyErrors[key as keyof CheckoutFieldErrors] = message;
      }
    }
  }

  const fieldProps = (field: CheckoutFormField) => ({
    id: FIELD_ID(field),
    value: values[field],
    onChange: (value: string) => form.setField(field, value),
    onBlur: (value: string) => form.blurField(field, value),
    error: errors[field],
    disabled: submitting,
  });

  return (
    <main className="bg-gray-50 pb-16">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <Link
          href={`/shop/${cart.shop.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 transition-colors hover:text-orange-600"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Πίσω στο κατάστημα
        </Link>

        <h1 className="mt-3 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">
          Ολοκλήρωση παραγγελίας
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Συμπλήρωσε τα στοιχεία σου, έλεγξε τη σύνοψη και επιβεβαίωσε.
        </p>

        {/* Ανακοίνωση για αναγνώστες οθόνης */}
        <p className="sr-only" role="status" aria-live="polite">
          {submitting
            ? "Αποστολή παραγγελίας…"
            : recoveryPhase === "checking"
              ? "Έλεγχος προηγούμενης παραγγελίας…"
              : ""}
        </p>

        {/* ------------- Ανάκτηση προσπάθειας μετά από ανανέωση ------------- */}
        {recoveryPhase === "checking" && (
          <div
            className="mt-5 flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"
            aria-busy="true"
          >
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            <p className="leading-relaxed">
              <span className="font-bold">Ελέγχουμε αν καταχωρήθηκε η προηγούμενη παραγγελία σου…</span>{" "}
              Η προηγούμενη αποστολή δεν επιβεβαιώθηκε πριν φύγεις από τη σελίδα. Δεν θα σταλεί
              τίποτα ξανά χωρίς να το επιβεβαιώσεις εσύ.
            </p>
          </div>
        )}

        {recoveryPhase === "failed" && currentCheck && (
          <div
            role="alert"
            className="mt-5 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
          >
            <p className="flex items-start gap-2 font-semibold leading-relaxed">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{currentCheck.message}</span>
            </p>
            <p className="mt-2 text-xs leading-relaxed">
              Μέχρι να ολοκληρωθεί ο έλεγχος, η νέα υποβολή είναι κλειδωμένη, ώστε να μη
              δημιουργηθεί διπλή παραγγελία.
            </p>
            <button
              type="button"
              onClick={recheckStoredAttempt}
              className="mt-3 flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-700"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Έλεγχος ξανά
            </button>
          </div>
        )}

        {visibleNotice && recoveryPhase === "idle" && (
          <div
            role="status"
            className="mt-5 flex items-start gap-3 rounded-3xl border border-sky-200 bg-sky-50 p-5 text-sm text-sky-900"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="leading-relaxed">{RECOVERY_NOTICE_TEXT[visibleNotice.kind]}</p>
          </div>
        )}

        {otherAccountAttempts.length > 0 && (
          <div className="mt-5 rounded-3xl border border-gray-200 bg-white p-5 text-sm text-gray-700">
            <p className="flex items-start gap-2 leading-relaxed">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
              <span>
                Σε αυτόν τον browser υπάρχει ανεπιβεβαίωτη προσπάθεια παραγγελίας από{" "}
                <span className="font-semibold">άλλη σύνδεση</span>. Δεν μπορούμε να ελέγξουμε αν
                καταχωρήθηκε χωρίς εκείνη τη σύνδεση. Αν ήταν δική σου με λογαριασμό, συνδέσου ξανά
                σε εκείνον πριν παραγγείλεις ξανά. Αν ήταν παραγγελία επισκέπτη, επικοινώνησε με το
                κατάστημα.
              </span>
            </p>
            <button
              type="button"
              onClick={() => clearCheckoutAttemptsExcept(uid)}
              className="mt-3 rounded-full border border-gray-200 px-4 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50"
            >
              Κατάλαβα
            </button>
          </div>
        )}

        {/* ---------- Milestone 4: το κατάστημα δεν δέχεται παραγγελίες ---------- */}
        {orderBlockMessage && (
          <div
            id="checkout-availability"
            role="status"
            className="mt-5 flex items-start gap-3 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="space-y-2">
              {availability && live.status === "ready" && availability.state !== "open" && (
                <AvailabilityBadge state={availability.state} />
              )}
              <p className="font-semibold leading-relaxed">{orderBlockMessage}</p>
            </div>
          </div>
        )}

        <form
          ref={formRef}
          noValidate
          onSubmit={handleSubmit}
          aria-busy={submitting}
          className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start"
        >
          {/* ============================ ΑΡΙΣΤΕΡΑ ============================ */}
          <div className="space-y-5">
            {!isAuthenticated && (
              <div className="flex flex-col gap-3 rounded-3xl border border-orange-100 bg-orange-50/60 p-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-relaxed text-gray-700">
                  Παραγγέλνεις ως επισκέπτης —{" "}
                  <span className="font-semibold">δεν χρειάζεται λογαριασμός</span>.
                </p>
                <button
                  type="button"
                  onClick={openLogin}
                  className="flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-orange-200 bg-white px-4 py-2.5 text-sm font-bold text-orange-600 transition-colors hover:bg-orange-100"
                >
                  <LogIn className="h-4 w-4" aria-hidden="true" />
                  Σύνδεση για αυτόματη συμπλήρωση
                </button>
              </div>
            )}

            {/* ------------------------- Στοιχεία πελάτη ------------------- */}
            <fieldset className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
              <legend className="sr-only">Στοιχεία επικοινωνίας</legend>
              <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-gray-900">
                <UserRound className="h-5 w-5 text-orange-500" aria-hidden="true" />
                Στοιχεία επικοινωνίας
              </h2>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <CheckoutField
                  {...fieldProps("fullName")}
                  label="Ονοματεπώνυμο"
                  required
                  autoComplete="name"
                  maxLength={CHECKOUT_LIMITS.fullNameMax}
                  placeholder="Κώστας Παπαδόπουλος"
                />
                <CheckoutField
                  {...fieldProps("phone")}
                  label="Τηλέφωνο"
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={CHECKOUT_LIMITS.phoneRawMax}
                  placeholder="69XXXXXXXX"
                  hint="Για να σε βρει ο διανομέας αν χρειαστεί."
                />
              </div>
            </fieldset>

            {/* ---------------------------- Διεύθυνση ---------------------- */}
            <fieldset className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
              <legend className="sr-only">Διεύθυνση παράδοσης</legend>
              <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-gray-900">
                <MapPin className="h-5 w-5 text-orange-500" aria-hidden="true" />
                Διεύθυνση παράδοσης
              </h2>

              {savedAddresses.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                    Αποθηκευμένες διευθύνσεις
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {savedAddresses.map((address) => {
                      const selected = form.appliedAddressId === address.id;
                      return (
                        <button
                          key={address.id}
                          type="button"
                          onClick={() => form.chooseAddress(address)}
                          disabled={submitting}
                          aria-pressed={selected}
                          className={cn(
                            "rounded-2xl border px-3.5 py-2 text-left text-sm transition-colors disabled:opacity-60",
                            selected
                              ? "border-orange-500 bg-orange-50 text-orange-700"
                              : "border-gray-200 bg-white text-gray-700 hover:border-orange-300",
                          )}
                        >
                          <span className="block font-bold">
                            {cleanSingleLine(address.label) || cleanSingleLine(address.street)}
                          </span>
                          <span className="block text-xs text-gray-500">
                            {[address.street, address.city].filter(Boolean).join(", ")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <CheckoutField
                  {...fieldProps("street")}
                  label="Οδός και αριθμός"
                  required
                  autoComplete="address-line1"
                  maxLength={CHECKOUT_LIMITS.streetMax}
                  placeholder="π.χ. Βενιζέλου 18"
                  className="sm:col-span-2"
                />
                <CheckoutField
                  {...fieldProps("city")}
                  label="Πόλη ή περιοχή"
                  required
                  autoComplete="address-level2"
                  maxLength={CHECKOUT_LIMITS.cityMax}
                  placeholder="π.χ. Τρίκαλα"
                  className="sm:col-span-2"
                />
                {/* Milestone 4: υποχρεωτικός μόνο σε καταστήματα με ζώνες ΤΚ */}
                <CheckoutField
                  {...fieldProps("postalCode")}
                  label="Ταχυδρομικός κώδικας"
                  required={postalCodeRequired}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={POSTAL_CODE_INPUT_MAX}
                  placeholder="π.χ. 546 22"
                  hint={
                    postalCodeRequired
                      ? "Το κατάστημα εξυπηρετεί συγκεκριμένους ΤΚ. Ελέγχουμε μόνο τον ΤΚ — όχι την οδό ή την απόσταση."
                      : undefined
                  }
                  className="sm:col-span-2"
                />
                {zonesMode === "zones" && postalInput && !errors.postalCode && (
                  <p
                    id="checkout-zone-status"
                    role="status"
                    aria-live="polite"
                    className={cn(
                      "rounded-2xl px-3.5 py-2.5 text-xs font-semibold sm:col-span-2",
                      delivery.kind === "zone"
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-amber-50 text-amber-900",
                    )}
                  >
                    {delivery.kind === "zone"
                      ? `Εξυπηρετείται — ζώνη «${delivery.snapshot.zoneName}»: ${formatZoneTerms(delivery.snapshot)}.`
                      : delivery.kind === "problem"
                        ? delivery.message
                        : ""}
                  </p>
                )}
                <CheckoutField
                  {...fieldProps("floor")}
                  label="Όροφος"
                  autoComplete="address-line2"
                  maxLength={CHECKOUT_LIMITS.floorMax}
                  placeholder="π.χ. 2ος"
                />
                <CheckoutField
                  {...fieldProps("doorbell")}
                  label="Κουδούνι"
                  autoComplete="off"
                  maxLength={CHECKOUT_LIMITS.doorbellMax}
                  placeholder="π.χ. Παπαδόπουλος"
                />
                <CheckoutField
                  {...fieldProps("instructions")}
                  multiline
                  rows={2}
                  label="Οδηγίες για τον διανομέα"
                  autoComplete="off"
                  maxLength={CHECKOUT_LIMITS.instructionsMax}
                  placeholder="π.χ. η είσοδος είναι από το πλάι"
                  className="sm:col-span-2"
                />
              </div>
            </fieldset>

            {/* ----------------------------- Σχόλια ------------------------ */}
            <fieldset className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
              <legend className="sr-only">Σχόλια παραγγελίας</legend>
              <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-gray-900">
                <MessageSquareText className="h-5 w-5 text-orange-500" aria-hidden="true" />
                Σχόλια για το κατάστημα
              </h2>
              <CheckoutField
                id={FIELD_ID("notes")}
                multiline
                rows={3}
                label="Σχόλια παραγγελίας"
                value={orderNotes}
                onChange={(value) => {
                  setOrderNotes(value);
                  form.clearNotesError();
                }}
                error={errors.notes}
                disabled={submitting}
                autoComplete="off"
                maxLength={CHECKOUT_LIMITS.maxNotesLength}
                placeholder="π.χ. χρειαζόμαστε μαχαιροπίρουνα"
                hint={`${orderNotes.length}/${CHECKOUT_LIMITS.maxNotesLength}`}
                className="mt-4"
              />
            </fieldset>

            {/* ----------------------------- Πληρωμή ----------------------- */}
            <fieldset className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
              <legend className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-gray-900">
                <Banknote className="h-5 w-5 text-orange-500" aria-hidden="true" />
                Τρόπος πληρωμής
              </legend>
              <label className="mt-4 flex cursor-default items-start gap-3 rounded-2xl border-2 border-orange-500 bg-orange-50/50 p-4">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cash_on_delivery"
                  checked
                  readOnly
                  className="mt-1 h-4 w-4 accent-orange-500"
                />
                <span>
                  <span className="block text-sm font-bold text-gray-900">
                    {PAYMENT_METHOD_LABELS.cash_on_delivery}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-600">
                    Πληρώνεις τον διανομέα όταν παραλάβεις. Προς το παρόν δεν υπάρχει online πληρωμή.
                  </span>
                </span>
              </label>
            </fieldset>
          </div>

          {/* ============================= ΔΕΞΙΑ ============================= */}
          <div className="lg:sticky lg:top-24">
            <CheckoutSummary
              cart={cart}
              totals={checkoutTotals}
              deliveryPending={deliveryPending}
              zoneLabel={zoneLabel}
              locked={submitting}
              onIncrease={increase}
              onDecrease={decrease}
              onRemove={removeLine}
              onEdit={setEditingLine}
              highlightKey={errorLine ? lineKeyOf(errorLine) : null}
              linesError={errors.lines ?? submitError?.fieldErrors?.lines}
              priceNotice={activePriceNotice}
              priceNoticeRef={priceNoticeRef}
            >
              {submitError && (
                <div
                  ref={alertRef}
                  tabIndex={-1}
                  role="alert"
                  className={cn(
                    "rounded-2xl border p-4 text-sm outline-none focus-visible:ring-2",
                    submitError.uncertain
                      ? "border-amber-300 bg-amber-50 text-amber-900 focus-visible:ring-amber-500"
                      : "border-red-200 bg-red-50 text-red-800 focus-visible:ring-red-500",
                  )}
                >
                  <p className="flex items-start gap-2 font-semibold leading-relaxed">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{submitError.message}</span>
                  </p>

                  {Object.values(serverOnlyErrors).length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-6 text-xs">
                      {Object.entries(serverOnlyErrors).map(([key, message]) => (
                        <li key={key}>{message}</li>
                      ))}
                    </ul>
                  )}

                  {submitError.existingOrder && (
                    <p className="mt-2 text-xs">
                      Υπάρχει ήδη καταχωρημένη παραγγελία με κωδικό{" "}
                      <strong className="font-mono">{submitError.existingOrder.code}</strong>.{" "}
                      <Link
                        href={`/orders/${submitError.existingOrder.orderId}`}
                        className="font-bold underline underline-offset-2"
                      >
                        Παρακολούθηση παραγγελίας
                      </Link>
                    </p>
                  )}

                  {errorItemInCart && (
                    <button
                      type="button"
                      onClick={() => {
                        removeItemLines(errorItemInCart);
                        setSubmitError(null);
                      }}
                      className="mt-3 rounded-full bg-white px-4 py-2 text-xs font-bold text-red-700 shadow-sm transition-colors hover:bg-red-100"
                    >
                      Αφαίρεση από το καλάθι
                    </button>
                  )}

                  {errorLine && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingLine(errorLine)}
                        aria-haspopup="dialog"
                        className="rounded-full bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-red-700"
                      >
                        Επεξεργασία επιλογών
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removeLine(lineKeyOf(errorLine));
                          setSubmitError(null);
                        }}
                        className="rounded-full bg-white px-4 py-2 text-xs font-bold text-red-700 shadow-sm transition-colors hover:bg-red-100"
                      >
                        Αφαίρεση γραμμής
                      </button>
                    </div>
                  )}

                  {submitError.uncertain && (
                    <>
                      <button
                        type="button"
                        onClick={() => formRef.current?.requestSubmit()}
                        disabled={submitting}
                        className="mt-3 flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        Δοκίμασε ξανά
                      </button>
                      <p className="mt-2 text-xs">
                        Αν αλλάξεις κάτι πριν ξαναδοκιμάσεις, θα ελέγξουμε πρώτα αν καταχωρήθηκε η
                        προηγούμενη αποστολή — δεν θα δημιουργηθεί διπλή παραγγελία.
                      </p>
                    </>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                aria-describedby={
                  orderBlockMessage
                    ? "checkout-availability"
                    : !deliveryPending && checkoutTotals.missingForMinOrderCents > 0
                      ? "checkout-min-order"
                      : !deliveryPending && checkoutTotals.exceedsMaxOrder
                        ? "checkout-max-order"
                        : undefined
                }
                className="flex w-full items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-4 text-base font-bold text-white shadow-lg shadow-orange-500/30 transition-all duration-300 hover:scale-[1.02] hover:bg-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none disabled:hover:scale-100"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                    Αποστολή…
                  </>
                ) : checkingShop ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                    Έλεγχος καταστήματος…
                  </>
                ) : orderBlockMessage ? (
                  <>Δεν δέχεται παραγγελίες τώρα</>
                ) : deliveryPending ? (
                  <>Ολοκλήρωση παραγγελίας</>
                ) : activePriceNotice ? (
                  <>Επιβεβαίωση νέου συνόλου · {formatPrice(centsToEuros(checkoutTotals.totalCents))}</>
                ) : (
                  <>Ολοκλήρωση παραγγελίας · {formatPrice(centsToEuros(checkoutTotals.totalCents))}</>
                )}
              </button>

              {live.status === "error" && (
                <p className="flex items-start gap-2 text-xs leading-relaxed text-gray-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                  Δεν μπορέσαμε να ελέγξουμε ζωντανά το ωράριο και τις περιοχές του καταστήματος. Ο
                  έλεγχος θα γίνει κατά την αποστολή.
                </p>
              )}

              <p className="flex items-start gap-2 text-xs leading-relaxed text-gray-500">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                Το τελικό ποσό υπολογίζεται από το κατάστημα με τις τρέχουσες τιμές. Αν διαφέρει
                από αυτό που βλέπεις, θα σου ζητήσουμε νέα επιβεβαίωση.
              </p>
            </CheckoutSummary>
          </div>
        </form>

        <p className="sr-only" role="status" aria-live="polite">
          {lineAnnouncement}
        </p>

        {editingLine && (
          <EditCartLineDialog
            key={lineKeyOf(editingLine)}
            shopId={cart.shop.id}
            line={editingLine}
            notice={
              errorLine && lineKeyOf(errorLine) === lineKeyOf(editingLine) ? submitError?.message : null
            }
            onClose={() => setEditingLine(null)}
            onSaved={(message) => {
              setLineAnnouncement(message);
              // Το σφάλμα αφορούσε αυτή τη γραμμή — ο πελάτης την άλλαξε ρητά
              if (errorLine && lineKeyOf(errorLine) === lineKeyOf(editingLine)) setSubmitError(null);
            }}
          />
        )}
      </div>
    </main>
  );
}
