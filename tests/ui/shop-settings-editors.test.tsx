// @vitest-environment jsdom
/* ==========================================================================
 *  Ρυθμίσεις καταστήματος (milestone 4) — editors ωραρίου και ζωνών, jsdom.
 *  Ψεύτικο: η αποθήκευση (save) — ο server δοκιμάζεται χωριστά.
 * ========================================================================== */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));

import DeliveryZonesEditor from "@/components/admin/DeliveryZonesEditor";
import OpeningHoursEditor from "@/components/admin/OpeningHoursEditor";
import { ShopSettingsSaveError, type saveShopSettings } from "@/lib/shop/save-shop-settings";
import type { DeliveryZonesConfig, OpeningHoursConfig } from "@/types";

afterEach(() => cleanup());

type SaveFn = typeof saveShopSettings;

/* ================================= Ζώνες ================================= */

describe("DeliveryZonesEditor", () => {
  const shop = { minOrder: 8, deliveryFee: 1.5, freeDeliveryOver: 20 };

  function renderZones(save: SaveFn, initial: DeliveryZonesConfig | null = null) {
    return render(<DeliveryZonesEditor shopId="shop-a" shop={shop} initial={initial} storedInvalid={false} save={save} />);
  }

  it("νέα ζώνη ξεκινά από τους γενικούς όρους και αποθηκεύει ρητές, επικυρωμένες τιμές", async () => {
    const save = vi.fn<SaveFn>(async (_shopId, payload) => ({ deliveryZones: payload.deliveryZones }));
    renderZones(save);

    fireEvent.click(screen.getByLabelText("Παράδοση μόνο σε συγκεκριμένους ΤΚ"));
    fireEvent.click(screen.getByRole("button", { name: /Νέα ζώνη/ }));

    expect((screen.getByLabelText("Μεταφορικά (€)") as HTMLInputElement).value).toBe("1,50");
    expect((screen.getByLabelText("Ελάχιστη παραγγελία (€)") as HTMLInputElement).value).toBe("8,00");
    expect((screen.getByLabelText("Δωρεάν μεταφορικά από (€)") as HTMLInputElement).value).toBe("20,00");

    fireEvent.change(screen.getByLabelText("Όνομα ζώνης"), { target: { value: "Κέντρο" } });
    fireEvent.change(screen.getByLabelText("Ταχυδρομικοί κώδικες"), { target: { value: "546 22, 54623\n012 34" } });
    fireEvent.change(screen.getByLabelText("Μεταφορικά (€)"), { target: { value: "2,5" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση ζωνών" }));
    });

    expect(save).toHaveBeenCalledTimes(1);
    const [shopId, payload] = save.mock.calls[0];
    expect(shopId).toBe("shop-a");
    expect(payload.deliveryZones).toMatchObject({
      enabled: true,
      zones: [
        {
          name: "Κέντρο",
          available: true,
          postalCodes: ["01234", "54622", "54623"],
          deliveryFeeCents: 250,
          minOrderCents: 800,
          freeDeliveryOverCents: 2000,
        },
      ],
    });
    expect(screen.getByText("Οι ζώνες παράδοσης αποθηκεύτηκαν.")).toBeTruthy();
  });

  it("ΤΚ σε δύο ζώνες → inline σφάλμα, καμία αποθήκευση", async () => {
    const save = vi.fn<SaveFn>();
    const zone = {
      id: "za",
      name: "Α",
      available: true,
      postalCodes: ["54622"],
      deliveryFeeCents: 150,
      minOrderCents: 800,
      freeDeliveryOverCents: null,
    };
    renderZones(save, { enabled: true, zones: [zone, { ...zone, id: "zb", name: "Β", postalCodes: ["54623"] }] });

    const codeFields = screen.getAllByLabelText("Ταχυδρομικοί κώδικες");
    fireEvent.change(codeFields[1], { target: { value: "54623, 546 22" } });
    expect(screen.getByText(/ανήκει ήδη στη ζώνη «Α»/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση ζωνών" }));
    });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("Διόρθωσε τα σημειωμένα πεδία πριν την αποθήκευση.")).toBeTruthy();
  });

  it("κακόμορφοι ΤΚ και ποσά → ελληνικά μηνύματα στο πεδίο", () => {
    renderZones(vi.fn<SaveFn>());
    fireEvent.click(screen.getByRole("button", { name: /Νέα ζώνη/ }));
    fireEvent.change(screen.getByLabelText("Ταχυδρομικοί κώδικες"), { target: { value: "5462, ΤΚ" } });
    fireEvent.change(screen.getByLabelText("Ελάχιστη παραγγελία (€)"), { target: { value: "8,999" } });
    expect(screen.getByText(/Μη έγκυροι ΤΚ: 5462, ΤΚ/)).toBeTruthy();
    expect(screen.getByText(/Γράψε ποσό από 0 έως 500€/)).toBeTruthy();
  });

  it("σφάλματα του server εμφανίζονται στο σωστό πεδίο", async () => {
    const save = vi.fn<SaveFn>(async () => {
      throw new ShopSettingsSaveError({
        code: "validation_failed",
        message: "Έλεγξε τα σημειωμένα πεδία.",
        errors: [{ path: "deliveryZones.zones.0.postalCodes", message: "Ο ΤΚ 54622 ανήκει ήδη στη ζώνη «Χ»." }],
      });
    });
    renderZones(save);
    fireEvent.click(screen.getByRole("button", { name: /Νέα ζώνη/ }));
    fireEvent.change(screen.getByLabelText("Ταχυδρομικοί κώδικες"), { target: { value: "54622" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση ζωνών" }));
    });
    expect(screen.getByText("Ο ΤΚ 54622 ανήκει ήδη στη ζώνη «Χ».")).toBeTruthy();
    expect(screen.getByText("Έλεγξε τα σημειωμένα πεδία.")).toBeTruthy();
  });
});

/* ================================ Ωράριο ================================= */

describe("OpeningHoursEditor", () => {
  function renderHours(save: SaveFn, initial: OpeningHoursConfig | null = null) {
    return render(<OpeningHoursEditor shopId="shop-a" initial={initial} storedInvalid={false} save={save} />);
  }

  it("επικάλυψη → inline σφάλμα στη μέρα, καμία αποθήκευση· μετά τη διόρθωση αποθηκεύεται", async () => {
    const save = vi.fn<SaveFn>(async (_shopId, payload) => ({ openingHours: payload.openingHours }));
    renderHours(save);

    fireEvent.click(screen.getByLabelText("Εφαρμογή ωραρίου"));
    fireEvent.click(screen.getAllByRole("button", { name: "Ακόμη ένα διάστημα" })[0]); // Δευτέρα: 18:00–23:00
    expect(screen.getByText(/12:00–23:00 και 18:00–23:00 επικαλύπτονται/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση ωραρίου" }));
    });
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Δευτέρα: κλείσιμο διαστήματος 1"), { target: { value: "16:00" } });
    fireEvent.change(screen.getByLabelText("Δευτέρα: κλείσιμο διαστήματος 2"), { target: { value: "02:00" } });
    expect(screen.getByText("κλείνει την επόμενη μέρα")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση ωραρίου" }));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].openingHours).toMatchObject({
      enabled: true,
      weekly: { mon: [{ open: "12:00", close: "16:00" }, { open: "18:00", close: "02:00" }] },
    });
    expect(screen.getByText("Το ωράριο αποθηκεύτηκε.")).toBeTruthy();
  });

  it("εξαίρεση ημερομηνίας: κλειστό όλη μέρα ή ειδικό ωράριο", async () => {
    const save = vi.fn<SaveFn>(async (_shopId, payload) => ({ openingHours: payload.openingHours }));
    renderHours(save);
    fireEvent.click(screen.getByRole("button", { name: "Νέα εξαίρεση" }));
    fireEvent.change(screen.getByLabelText("Ημερομηνία εξαίρεσης 1"), { target: { value: "2026-12-25" } });
    fireEvent.change(screen.getByLabelText("Σημείωση εξαίρεσης 1"), { target: { value: "Χριστούγεννα" } });

    fireEvent.click(screen.getByRole("button", { name: "Νέα εξαίρεση" }));
    fireEvent.change(screen.getByLabelText("Ημερομηνία εξαίρεσης 2"), { target: { value: "2026-12-25" } });
    expect(screen.getByText(/Υπάρχει ήδη εξαίρεση για 25\/12\/2026/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Ημερομηνία εξαίρεσης 2"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("Είδος εξαίρεσης 2"), { target: { value: "custom" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση ωραρίου" }));
    });
    expect(save.mock.calls[0][1].openingHours?.exceptions).toEqual([
      { date: "2026-12-25", closed: true, intervals: [], label: "Χριστούγεννα" },
      { date: "2026-12-31", closed: false, intervals: [{ open: "12:00", close: "18:00" }] },
    ]);
  });

  it("προειδοποίηση: ενεργό ωράριο χωρίς κανένα διάστημα = πάντα κλειστό", () => {
    renderHours(vi.fn<SaveFn>(), {
      enabled: true,
      weekly: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      exceptions: [],
    });
    expect(screen.getByText(/δεν θα δέχεται ποτέ παραγγελίες/)).toBeTruthy();
  });
});
