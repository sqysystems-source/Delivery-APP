// @vitest-environment jsdom
/* ==========================================================================
 *  Checkout με ωράριο και ζώνες ΤΚ (milestone 4) — jsdom.
 *
 *  Πραγματικά: CartProvider, CheckoutClient, useLiveShop/useShopAvailability
 *  (χρονόμετρα, visibilitychange), υπολογισμοί ζωνών.
 *  Ψεύτικα: ο listener του Firestore (subscribe-shop — ελέγχουμε πότε
 *  «έρχεται» snapshot), το AuthContext, το δίκτυο (submitOrder).
 * ========================================================================== */

import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutQuote, CheckoutRequest, CheckoutSuccess } from "@/types";
import { emptyWeekly } from "@/lib/shop/opening-hours";
import { instantsForWallTime } from "@/lib/shop/timezone";

/* ------------------------------- Mocks ---------------------------------- */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/checkout",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null }, ensureSignedIn: vi.fn() }));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    isAuthenticated: false,
    isAnonymous: false,
    loading: false,
    profileLoading: false,
    authMode: null,
    openLogin: vi.fn(),
    openRegister: vi.fn(),
    closeAuth: vi.fn(),
    switchMode: vi.fn(),
    logout: vi.fn(),
    displayName: "",
  }),
}));

const submitOrderMock = vi.fn<(request: CheckoutRequest) => Promise<CheckoutSuccess>>();
vi.mock("@/lib/checkout/submit-order", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/checkout/submit-order")>();
  return { ...actual, submitOrder: (request: CheckoutRequest) => submitOrderMock(request) };
});

vi.mock("@/lib/checkout/recover-attempt", () => ({
  recoverCheckoutAttempt: vi.fn(async () => ({ kind: "no_order" })),
}));

/* Ελεγχόμενος «listener» Firestore */
type Subscription = {
  shopId: string;
  onData: (data: Record<string, unknown> | null) => void;
  onError: (error: unknown) => void;
  closed: boolean;
};
const subscriptions: Subscription[] = [];
vi.mock("@/lib/shop/subscribe-shop", () => ({
  subscribeShopDocument: (
    shopId: string,
    onData: Subscription["onData"],
    onError: Subscription["onError"],
  ) => {
    const subscription: Subscription = { shopId, onData, onError, closed: false };
    subscriptions.push(subscription);
    return () => {
      subscription.closed = true;
    };
  },
}));

import CheckoutClient from "@/components/checkout/CheckoutClient";
import { CartProvider } from "@/context/CartContext";
import { CheckoutError } from "@/lib/checkout/submit-order";
import { useShopAvailability } from "@/hooks/useShopAvailability";

/* ------------------------------ Δεδομένα -------------------------------- */

const athens = (date: string, time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return instantsForWallTime(date, hours * 60 + minutes)[0];
};
const MON = "2026-10-05";

const CART_KEY = "buka:cart:v1";
const cartShop = { id: "pizza-roma", name: "Pizza Roma", minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 };
const cartLines = [{ itemId: "pr-2", name: "Margherita", unitPrice: 8.5, quantity: 1 }];

const HOURS = {
  enabled: true,
  weekly: { ...emptyWeekly(), mon: [{ open: "12:00", close: "23:00" }], fri: [{ open: "18:00", close: "02:00" }] },
  exceptions: [],
};

const ZONE_CENTER = {
  id: "zcenter",
  name: "Κέντρο",
  available: true,
  postalCodes: ["54622"],
  deliveryFeeCents: 200,
  minOrderCents: 800,
  freeDeliveryOverCents: null,
};

function shopData(overrides: Record<string, unknown> = {}) {
  return { name: "Pizza Roma", minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20, ...overrides };
}

function emit(data: Record<string, unknown> | null) {
  act(() => {
    for (const subscription of subscriptions) if (!subscription.closed) subscription.onData(data);
  });
}

function renderCheckout() {
  window.localStorage.setItem(CART_KEY, JSON.stringify({ shop: cartShop, lines: cartLines }));
  return render(
    <CartProvider>
      <CheckoutClient />
    </CartProvider>,
  );
}

const field = (name: string) => document.getElementById(`checkout-${name}`) as HTMLInputElement;
function fill(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) fireEvent.change(field(name), { target: { value } });
}
const guest = { fullName: "Κώστας Παπαδόπουλος", phone: "6912345678", street: "Ερμού 5", city: "Θεσσαλονίκη" };

const submitButton = () => screen.getByRole("button", { name: /Ολοκλήρωση παραγγελίας|Επιβεβαίωση νέου συνόλου|Δεν δέχεται|Έλεγχος καταστήματος/ });

async function submit() {
  await act(async () => {
    fireEvent.click(submitButton());
  });
}

function zoneQuote(feeCents: number, zone: { id: string; name: string }): CheckoutQuote {
  return {
    shopId: "pizza-roma",
    shopName: "Pizza Roma",
    lines: [{ itemId: "pr-2", name: "Margherita", quantity: 1, unitPrice: 8.5, lineTotal: 8.5, unitPriceCents: 850, lineTotalCents: 850 }],
    subtotal: 8.5,
    deliveryFee: feeCents / 100,
    total: (850 + feeCents) / 100,
    subtotalCents: 850,
    deliveryFeeCents: feeCents,
    totalCents: 850 + feeCents,
    shopTerms: { minOrder: 8, deliveryFee: feeCents / 100, freeDeliveryOver: null },
    delivery: {
      mode: "zone",
      zoneId: zone.id,
      zoneName: zone.name,
      postalCode: "54622",
      deliveryFeeCents: feeCents,
      minOrderCents: 800,
      freeDeliveryOverCents: null,
    },
  };
}

const storedCart = () => JSON.parse(window.localStorage.getItem(CART_KEY) ?? "null");

beforeEach(() => {
  window.localStorage.clear();
  subscriptions.length = 0;
  submitOrderMock.mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(athens(MON, "13:00"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/* ============================== Διαθεσιμότητα ============================ */

describe("checkout: διαθεσιμότητα καταστήματος", () => {
  it("ένας listener στο κατάστημα· κλείνει στο unmount", () => {
    const view = renderCheckout();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].shopId).toBe("pizza-roma");
    view.unmount();
    expect(subscriptions[0].closed).toBe(true);
  });

  it("όσο δεν ξέρουμε, η υποβολή περιμένει", () => {
    renderCheckout();
    expect(submitButton().textContent).toContain("Έλεγχος καταστήματος");
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("καμία απάντηση του listener για 10″ → δεν μένει κλειδωμένο· αποφασίζει ο server", () => {
    renderCheckout();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(10_001);
    });
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Ο έλεγχος θα γίνει κατά την αποστολή/)).toBeTruthy();
  });

  it("κλειστό: εξήγηση + επόμενο άνοιγμα, υποβολή κλειδωμένη, καλάθι άθικτο", async () => {
    vi.setSystemTime(athens(MON, "23:30"));
    renderCheckout();
    emit(shopData({ openingHours: HOURS }));

    expect(screen.getByText(/δέχεται παραγγελίες ξανά την Παρασκευή στις 18:00/)).toBeTruthy();
    expect(screen.getByText("Κλειστό")).toBeTruthy();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    fill(guest);
    await submit();
    expect(submitOrderMock).not.toHaveBeenCalled();
    expect(storedCart().lines).toHaveLength(1);
  });

  it("παύση → «Προσωρινά μη διαθέσιμο»", () => {
    renderCheckout();
    emit(shopData({ active: false, openingHours: HOURS }));
    expect(screen.getByText("Προσωρινά μη διαθέσιμο")).toBeTruthy();
    expect(screen.getByText(/δεν δέχεται προσωρινά παραγγελίες/)).toBeTruthy();
  });

  it("το όριο ωραρίου περνά → η σελίδα ανοίγει ΧΩΡΙΣ νέα ανάγνωση (χρονόμετρο)", () => {
    vi.setSystemTime(athens(MON, "11:59") + 30_000);
    renderCheckout();
    emit(shopData({ openingHours: HOURS }));
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
    expect(submitButton().textContent).toContain("10,00€");
    expect(subscriptions).toHaveLength(1);
  });

  it("η καρτέλα ξαναγίνεται ορατή → φρέσκια ώρα (χρονόμετρα «παγωμένα» σε κρυφή καρτέλα)", () => {
    vi.setSystemTime(athens(MON, "23:30"));
    renderCheckout();
    emit(shopData({ openingHours: HOURS }));
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);

    // Το ρολόι προχώρησε χωρίς να τρέξουν χρονόμετρα (κρυφή καρτέλα)
    vi.setSystemTime(athens("2026-10-09", "19:00"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("αλλαγή ρύθμισης (νέο snapshot) ενημερώνει αμέσως", () => {
    renderCheckout();
    emit(shopData({ openingHours: HOURS }));
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
    emit(shopData({ openingHours: HOURS, active: false }));
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("ο server απορρίπτει (έκλεισε στο μεταξύ): μήνυμα, καλάθι άθικτο", async () => {
    renderCheckout();
    emit(shopData({ openingHours: HOURS }));
    fill(guest);
    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({
        code: "shop_closed",
        status: 409,
        uncertain: false,
        message: "Το κατάστημα δεν δέχεται προσωρινά παραγγελίες. Το καλάθι σου μένει ως έχει — δοκίμασε ξανά αργότερα.",
        availability: { state: "paused", nextOpenAt: null },
      }),
    );
    await submit();
    expect(screen.getByRole("alert").textContent).toContain("δεν δέχεται προσωρινά παραγγελίες");
    expect(storedCart().lines).toEqual(cartLines);
  });

  it("αποτυχία listener: η υποβολή επιτρέπεται και αποφασίζει ο server", async () => {
    renderCheckout();
    act(() => subscriptions[0].onError(new Error("offline")));
    expect(screen.getByText(/Ο έλεγχος θα γίνει κατά την αποστολή/)).toBeTruthy();
    fill(guest);
    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({ code: "shop_closed", status: 409, uncertain: false, message: "Κλειστό." }),
    );
    await submit();
    expect(submitOrderMock).toHaveBeenCalledTimes(1);
  });
});

/* ================================= Ζώνες ================================= */

describe("checkout: ζώνες ΤΚ", () => {
  const zones = (extra: Record<string, unknown>[] = []) =>
    shopData({ deliveryZones: { enabled: true, zones: [ZONE_CENTER, ...extra] } });

  it("ΤΚ υποχρεωτικός: χωρίς ΤΚ καμία αποστολή, ελληνικό μήνυμα στο πεδίο", async () => {
    renderCheckout();
    emit(zones());
    fill(guest);
    expect(screen.getByText("Συμπλήρωσε ΤΚ")).toBeTruthy();
    await submit();
    expect(submitOrderMock).not.toHaveBeenCalled();
    expect(document.getElementById("checkout-postalCode-error")?.textContent).toContain("ταχυδρομικό κώδικα");
    expect(document.activeElement).toBe(field("postalCode"));
  });

  it("ΤΚ εκτός περιοχής: καθαρή εξήγηση, καμία αποστολή", async () => {
    renderCheckout();
    emit(zones());
    fill({ ...guest, postalCode: "104 31" });
    expect(screen.getByText(/δεν εξυπηρετεί τον ΤΚ 10431/)).toBeTruthy();
    await submit();
    expect(submitOrderMock).not.toHaveBeenCalled();
  });

  it("ανενεργή ζώνη: «δεν εξυπηρετείται προσωρινά»", () => {
    renderCheckout();
    emit(zones([{ ...ZONE_CENTER, id: "zoff", name: "Κλειστή", available: false, postalCodes: ["55132"] }]));
    fill({ ...guest, postalCode: "55132" });
    expect(screen.getByText(/δεν εξυπηρετείται προσωρινά/)).toBeTruthy();
  });

  it("έγκυρος ΤΚ: μεταφορικά/σύνολο της ζώνης, αποστολή ΤΚ + ζώνης για σύγκριση", async () => {
    renderCheckout();
    emit(zones());
    fill({ ...guest, postalCode: "546 22" });

    expect(screen.getByText(/Εξυπηρετείται — ζώνη «Κέντρο»/)).toBeTruthy();
    expect(screen.getByTestId("checkout-zone-label").textContent).toContain("546 22");
    expect(submitButton().textContent).toContain("10,50€");

    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({ code: "network_error", status: 0, uncertain: false, message: "x" }),
    );
    await submit();
    const request = submitOrderMock.mock.calls[0][0];
    expect(request.delivery.postalCode).toBe("54622");
    expect(request.expectedDeliveryZoneId).toBe("zcenter");
    expect(request.expectedTotalCents).toBe(1050);
    // Καμία τιμή ή όροι ζώνης δεν φεύγουν από τον browser
    expect(JSON.stringify(request)).not.toContain("deliveryFee");
  });

  it("η ελάχιστη της ζώνης δεν καλύπτεται → οδηγία και κλειδωμένο κουμπί", () => {
    renderCheckout();
    emit(zones([{ ...ZONE_CENTER, id: "zfar", name: "Μακριά", postalCodes: ["55131"], minOrderCents: 1500 }]));
    fill({ ...guest, postalCode: "55131" });
    expect(screen.getByText(/Η ελάχιστη παραγγελία είναι 15,00€/)).toBeTruthy();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("ο server βρίσκει άλλη ζώνη → ειδοποίηση, ρητή επανεπιβεβαίωση, καλάθι άθικτο", async () => {
    renderCheckout();
    emit(zones());
    fill({ ...guest, postalCode: "54622" });

    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({
        code: "delivery_zone_changed",
        status: 409,
        uncertain: false,
        message: "Άλλαξε η ζώνη.",
        quote: zoneQuote(300, { id: "znew", name: "Νέα" }),
      }),
    );
    await submit();

    expect(screen.getByText(/Περιοχή παράδοσης: Κέντρο → Νέα/)).toBeTruthy();
    expect(submitButton().textContent).toContain("Επιβεβαίωση νέου συνόλου · 11,50€");
    expect(storedCart().lines).toEqual(cartLines);
    expect(storedCart().shop).toMatchObject({ deliveryFee: 1.5 }); // όροι ζώνης ΔΕΝ γίνονται γενικοί

    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({ code: "network_error", status: 0, uncertain: false, message: "x" }),
    );
    await submit();
    const second = submitOrderMock.mock.calls[1][0];
    expect(second.expectedDeliveryZoneId).toBe("znew");
    expect(second.expectedTotalCents).toBe(1150);
    expect(second.idempotencyKey).not.toBe(submitOrderMock.mock.calls[0][0].idempotencyKey);
  });

  it("ΤΚ που απέρριψε ο server → μήνυμα στο πεδίο και εστίαση", async () => {
    renderCheckout();
    emit(zones());
    fill({ ...guest, postalCode: "54622" });
    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({
        code: "delivery_zone_unsupported",
        status: 409,
        uncertain: false,
        message: "Το κατάστημα δεν εξυπηρετεί τον ΤΚ 54622.",
        fieldErrors: { postalCode: "Το κατάστημα δεν εξυπηρετεί τον ΤΚ 54622." },
      }),
    );
    await submit();
    expect(document.getElementById("checkout-postalCode-error")?.textContent).toContain("54622");
    expect(document.activeElement).toBe(field("postalCode"));
    expect(storedCart().lines).toEqual(cartLines);
  });

  it("κατάστημα χωρίς ζώνες: ΤΚ προαιρετικός, γενικά μεταφορικά όπως πριν", async () => {
    renderCheckout();
    emit(shopData());
    fill(guest);
    expect(submitButton().textContent).toContain("10,00€");
    submitOrderMock.mockRejectedValueOnce(
      new CheckoutError({ code: "network_error", status: 0, uncertain: false, message: "x" }),
    );
    await submit();
    const request = submitOrderMock.mock.calls[0][0];
    expect(request.delivery).not.toHaveProperty("postalCode");
    expect(request).not.toHaveProperty("expectedDeliveryZoneId");
    expect(request.expectedTotalCents).toBe(1000);
  });
});

/* ========================= useShopAvailability ========================== */

describe("useShopAvailability: χρονόμετρα και καθαρισμός", () => {
  it("ένα χρονόμετρο για το επόμενο όριο — και κανένα μετά το unmount", () => {
    const observedAt = athens(MON, "13:00");
    const shop = { openingHours: HOURS };
    const { result, unmount } = renderHook(() => useShopAvailability(shop, observedAt));
    expect(result.current.availability?.state).toBe("open");
    expect(vi.getTimerCount()).toBe(1);

    vi.setSystemTime(athens(MON, "23:00"));
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(result.current.availability?.state).toBe("closed");

    const removeSpy = vi.spyOn(document, "removeEventListener");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("χωρίς ωράριο: κανένα χρονόμετρο (καμία άσκοπη δουλειά)", () => {
    renderHook(() => useShopAvailability({ name: "παλιό" }, athens(MON, "13:00")));
    expect(vi.getTimerCount()).toBe(0);
  });
});
