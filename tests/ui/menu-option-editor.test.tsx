// @vitest-environment jsdom
/* ==========================================================================
 *  Milestone 3 — επεξεργαστής επιλογών στη φόρμα προϊόντος του
 *  καταστηματάρχη: δημιουργία, επικύρωση (ίδια με τον server), αναδιάταξη με
 *  σταθερά ids, προεπισκόπηση, λάθη από τον server.
 * ========================================================================== */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItemInput } from "@/hooks/useMenuManager";
import type { MenuItem } from "@/types";

vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null }, db: {} }));

import MenuItemModal from "@/components/admin/MenuItemModal";
import { MenuItemSaveError } from "@/lib/menu/save-menu-item";
import { PIZZA_ITEM } from "../fixtures/menu-options";

const categories = [{ id: "pizzas", label: "Πίτσες", emoji: "🍕", sortOrder: 1 }];
const onSave = vi.fn<(input: MenuItemInput, itemId?: string) => Promise<void>>();
const onClose = vi.fn();

function renderModal(item: MenuItem | null = null) {
  return render(
    <MenuItemModal open item={item} categories={categories} saving={false} onClose={onClose} onSave={onSave} />,
  );
}

const optionsSection = () => screen.getByRole("region", { name: /Επιλογές προϊόντος/ });

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Προσθήκη στον κατάλογο|Αποθήκευση αλλαγών/ }));
  });
}

beforeEach(() => {
  onSave.mockReset();
  onSave.mockResolvedValue(undefined);
  onClose.mockReset();
});
afterEach(() => cleanup());

describe("επεξεργαστής επιλογών", () => {
  it("νέο προϊόν με μέγεθος: ελληνικά λάθη μέχρι να συμπληρωθεί σωστά, μετά αποθήκευση", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Όνομα προϊόντος"), { target: { value: "Πίτσα" } });
    fireEvent.change(screen.getByLabelText("Τιμή (€)"), { target: { value: "5,00" } });

    fireEvent.click(within(optionsSection()).getByRole("button", { name: "Ομάδα επιλογών" }));
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Γράψε τίτλο ομάδας/)).toBeTruthy();
    expect(screen.getByText("Γράψε όνομα επιλογής.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Τίτλος ομάδας"), { target: { value: "Μέγεθος" } });
    fireEvent.change(screen.getByLabelText("Όνομα επιλογής"), { target: { value: "Μεγάλη" } });
    fireEvent.change(screen.getByLabelText("Προσαύξηση σε ευρώ"), { target: { value: "1,5x" } });
    expect(screen.getByText(/Δώσε έγκυρη προσαύξηση/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Προσαύξηση σε ευρώ"), { target: { value: "1,50" } });
    await save();
    expect(onSave).toHaveBeenCalledTimes(1);
    const [input] = onSave.mock.calls[0];
    expect(input.price).toBe(5);
    expect(input.optionGroups).toEqual([
      {
        id: expect.stringMatching(/^g[a-z0-9]+$/),
        label: "Μέγεθος",
        kind: "single",
        required: true,
        minSelect: 1,
        maxSelect: 1,
        choices: [{ id: expect.stringMatching(/^c[a-z0-9]+$/), label: "Μεγάλη", priceDelta: 1.5, available: true }],
      },
    ]);
  });

  it("αδύνατη υποχρεωτική ομάδα (καμία διαθέσιμη επιλογή) → δεν αποθηκεύεται", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("Όνομα προϊόντος"), { target: { value: "Πίτσα" } });
    fireEvent.change(screen.getByLabelText("Τιμή (€)"), { target: { value: "5" } });
    fireEvent.click(within(optionsSection()).getByRole("button", { name: "Ομάδα επιλογών" }));
    fireEvent.change(screen.getByLabelText("Τίτλος ομάδας"), { target: { value: "Μέγεθος" } });
    fireEvent.change(screen.getByLabelText("Όνομα επιλογής"), { target: { value: "Μεγάλη" } });
    const group = screen.getByRole("group", { name: "Μέγεθος" });
    fireEvent.click(within(group).getByRole("checkbox", { name: "Διαθέσιμο" }));
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Η υποχρεωτική ομάδα χρειάζεται τουλάχιστον μία διαθέσιμη επιλογή.")).toBeTruthy();
  });

  it("υπάρχον προϊόν: αναδιάταξη/μετονομασία ΔΕΝ αλλάζει τα ids", async () => {
    renderModal(PIZZA_ITEM);
    const section = within(optionsSection());
    fireEvent.click(section.getByRole("button", { name: "Μετακίνηση ομάδας «Έξτρα» πάνω" }));
    fireEvent.click(section.getByRole("button", { name: "Μετακίνηση «Μπέικον» πάνω" }));
    fireEvent.change(document.getElementById("size-label") as HTMLInputElement, { target: { value: "Μέγεθος πίτσας" } });
    await save();

    const [input, itemId] = onSave.mock.calls[0];
    expect(itemId).toBe("pizza");
    expect(input.optionGroups.map((group) => group.id)).toEqual(["extras", "size", "without"]);
    expect(input.optionGroups[0].choices.map((choice) => choice.id)).toEqual(["bacon", "cheese", "mush"]);
    expect(input.optionGroups[1]).toMatchObject({ id: "size", label: "Μέγεθος πίτσας" });
  });

  it("αφαίρεση όλων των ομάδων → optionGroups: [] (το προϊόν ξαναγίνεται απλό)", async () => {
    renderModal(PIZZA_ITEM);
    const section = within(optionsSection());
    for (const name of ["Μέγεθος", "Έξτρα", "Αφαίρεση υλικών"]) {
      fireEvent.click(section.getByRole("button", { name: `Αφαίρεση ομάδας «${name}»` }));
    }
    await save();
    expect(onSave.mock.calls[0][0].optionGroups).toEqual([]);
  });

  it("προεπισκόπηση: όπως θα το δει ο πελάτης", () => {
    renderModal(PIZZA_ITEM);
    fireEvent.click(within(optionsSection()).getByRole("button", { name: "Προεπισκόπηση πελάτη" }));
    const preview = document.getElementById("option-groups-preview") as HTMLElement;
    expect(within(preview).getByRole("radio", { name: /Μεγάλη/ })).toBeTruthy();
    expect((within(preview).getByRole("radio", { name: /Γίγας/ }) as HTMLInputElement).disabled).toBe(true);
    expect(within(preview).getByRole("checkbox", { name: "Χωρίς κρεμμύδι" })).toBeTruthy();
    expect(within(preview).getByText("Υποχρεωτικό · διάλεξε 1")).toBeTruthy();
  });

  it("λάθη από τον server εμφανίζονται στο σωστό πεδίο", async () => {
    onSave.mockRejectedValueOnce(
      new MenuItemSaveError({
        code: "validation_failed",
        message: "Έλεγξε τα πεδία του προϊόντος.",
        optionErrors: [{ path: "groups.1.choices.0.priceDelta", message: "Μη αποδεκτή προσαύξηση (server)." }],
      }),
    );
    renderModal(PIZZA_ITEM);
    await save();
    expect(screen.getByText("Μη αποδεκτή προσαύξηση (server).")).toBeTruthy();
    expect(screen.getByText("Έλεγξε τα πεδία του προϊόντος.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("403 από τον server (όχι ιδιοκτήτης) → μήνυμα, η φόρμα μένει ανοιχτή", async () => {
    onSave.mockRejectedValueOnce(
      new MenuItemSaveError({ code: "forbidden", message: "Δεν έχεις δικαίωμα διαχείρισης αυτού του καταλόγου." }),
    );
    renderModal(PIZZA_ITEM);
    await save();
    expect(screen.getByText("Δεν έχεις δικαίωμα διαχείρισης αυτού του καταλόγου.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
