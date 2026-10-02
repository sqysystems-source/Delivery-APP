// @vitest-environment jsdom
/* ==========================================================================
 *  Βιτρίνα (milestone 4): ετικέτα διαθεσιμότητας, ωράριο, επόμενο άνοιγμα,
 *  έλεγχος ΤΚ — jsdom, χωρίς Firebase.
 * ========================================================================== */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Shop } from "@/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import ShopCard from "@/components/ShopCard";
import DeliveryZonesInfo from "@/components/shop/DeliveryZonesInfo";
import ShopAvailabilityPanel from "@/components/shop/ShopAvailabilityPanel";
import { evaluateShopAvailability } from "@/lib/shop/availability";
import { emptyWeekly } from "@/lib/shop/opening-hours";
import { instantsForWallTime } from "@/lib/shop/timezone";

const athens = (date: string, time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return instantsForWallTime(date, hours * 60 + minutes)[0];
};

const HOURS = {
  enabled: true,
  weekly: { ...emptyWeekly(), mon: [{ open: "12:00", close: "23:00" }], fri: [{ open: "18:00", close: "02:00" }] },
  exceptions: [{ date: "2026-10-09", closed: false, intervals: [{ open: "19:00", close: "01:00" }], label: "Εκδήλωση" }],
};

const SHOP: Shop = {
  id: "pizza",
  name: "Pizza",
  cuisineLabel: "Πίτσα",
  cuisineIds: ["pizza"],
  rating: 4.5,
  reviews: 10,
  etaMinutes: [20, 30],
  minOrder: 8,
  deliveryFee: 1.5,
  freeDeliveryOver: null,
  image: "/x.jpg",
  gradient: "from-orange-400 to-red-500",
  address: "Ερμού 5",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ShopAvailabilityPanel", () => {
  it("κλειστό: ετικέτα, επόμενο άνοιγμα (ειδικό ωράριο), εβδομαδιαίο πρόγραμμα, εξαιρέσεις", () => {
    const now = athens("2026-10-05", "23:30");
    const availability = evaluateShopAvailability({ openingHours: HOURS }, now);
    render(<ShopAvailabilityPanel availability={availability} now={now} />);

    // Η πρώτη εμφάνιση είναι η ετικέτα· οι επόμενες είναι κλειστές μέρες του ωραρίου
    expect(screen.getAllByText("Κλειστό")[0].closest("span")?.className).toContain("uppercase");
    expect(screen.getByText("Ανοίγει την Παρασκευή στις 19:00.")).toBeTruthy();
    expect(screen.getByText(/αλλά η παραγγελία ολοκληρώνεται μόνο όταν/)).toBeTruthy();
    expect(screen.getByText("18:00–02:00 (επόμενη μέρα)")).toBeTruthy();
    expect(screen.getByText(/Παρασκευή 9\/10\/2026 \(Εκδήλωση\)/)).toBeTruthy();
  });

  it("ανοιχτό: πότε κλείνει", () => {
    const now = athens("2026-10-05", "13:00");
    render(<ShopAvailabilityPanel availability={evaluateShopAvailability({ openingHours: HOURS }, now)} now={now} />);
    expect(screen.getByText("Ανοιχτό")).toBeTruthy();
    expect(screen.getByText("Δέχεται παραγγελίες — κλείνει σήμερα στις 23:00.")).toBeTruthy();
  });

  it("παύση → «Προσωρινά μη διαθέσιμο»", () => {
    const now = athens("2026-10-05", "13:00");
    render(<ShopAvailabilityPanel availability={evaluateShopAvailability({ active: false }, now)} now={now} />);
    expect(screen.getByText("Προσωρινά μη διαθέσιμο")).toBeTruthy();
  });
});

describe("ShopCard", () => {
  it("η ετικέτα αλλάζει μόνη της στο όριο ωραρίου", () => {
    vi.setSystemTime(athens("2026-10-05", "11:59"));
    render(<ShopCard shop={{ ...SHOP, openingHours: HOURS }} observedAt={Date.now()} />);
    expect(screen.getByText("Κλειστό")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByText("Ανοιχτό")).toBeTruthy();
  });

  it("παλιό κατάστημα χωρίς ωράριο: καμία ετικέτα (όπως πριν)", () => {
    vi.setSystemTime(athens("2026-10-05", "11:59"));
    render(<ShopCard shop={SHOP} observedAt={Date.now()} />);
    expect(screen.queryByText("Ανοιχτό")).toBeNull();
    expect(screen.queryByText("Κλειστό")).toBeNull();
  });
});

describe("DeliveryZonesInfo", () => {
  const config = {
    enabled: true,
    zones: [
      {
        id: "zc",
        name: "Κέντρο",
        available: true,
        postalCodes: ["54622"],
        deliveryFeeCents: 150,
        minOrderCents: 800,
        freeDeliveryOverCents: 2000,
      },
    ],
  };

  it("έλεγχος ΤΚ από τη βιτρίνα", () => {
    render(<DeliveryZonesInfo config={config} />);
    const input = screen.getByLabelText("Έλεγξε τον ΤΚ σου:");
    fireEvent.change(input, { target: { value: "546 22" } });
    expect(screen.getByText(/Εξυπηρετείται — ζώνη «Κέντρο»: Μεταφορικά 1,50€ · ελάχιστη 8,00€/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "10431" } });
    expect(screen.getByText(/δεν εξυπηρετεί τον ΤΚ 10431/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "104" } });
    expect(screen.getByText(/5 ψηφία/)).toBeTruthy();
    expect(screen.getByText(/όχι την οδό ή την απόσταση/)).toBeTruthy();
  });
});
