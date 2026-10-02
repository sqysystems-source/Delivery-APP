/* ==========================================================================
 *  Κοινά δεδομένα δοκιμών για τις επιλογές προϊόντος (milestone 3).
 *
 *  Πίτσα 5,00€:
 *    size   (single, υποχρεωτικό): s Μικρή +0 · l Μεγάλη +1,00 · xl Γίγας +2,00 (ΜΗ διαθέσιμη)
 *    extras (multiple, έως 3):     cheese Τυρί +0,50 · bacon Μπέικον +0,80 · mush Μανιτάρια +0,30 (ΜΗ διαθέσιμα)
 *    without (remove):             onion κρεμμύδι · tomato ντομάτα
 * ========================================================================== */

import type { MenuOptionGroup } from "@/types";

export function pizzaGroups(): MenuOptionGroup[] {
  return [
    {
      id: "size",
      label: "Μέγεθος",
      kind: "single",
      required: true,
      minSelect: 1,
      maxSelect: 1,
      choices: [
        { id: "s", label: "Μικρή", priceDelta: 0, available: true },
        { id: "l", label: "Μεγάλη", priceDelta: 1, available: true },
        { id: "xl", label: "Γίγας", priceDelta: 2, available: false },
      ],
    },
    {
      id: "extras",
      label: "Έξτρα",
      kind: "multiple",
      required: false,
      minSelect: 0,
      maxSelect: 3,
      choices: [
        { id: "cheese", label: "Τυρί", priceDelta: 0.5, available: true },
        { id: "bacon", label: "Μπέικον", priceDelta: 0.8, available: true },
        { id: "mush", label: "Μανιτάρια", priceDelta: 0.3, available: false },
      ],
    },
    {
      id: "without",
      label: "Αφαίρεση υλικών",
      kind: "remove",
      required: false,
      minSelect: 0,
      maxSelect: 2,
      choices: [
        { id: "onion", label: "κρεμμύδι", priceDelta: 0, available: true },
        { id: "tomato", label: "ντομάτα", priceDelta: 0, available: true },
      ],
    },
  ];
}

export const PIZZA_ITEM = {
  id: "pizza",
  shopId: "pizza-roma",
  categoryId: "pizzas",
  name: "Πίτσα του σεφ",
  description: "Σάλτσα, μοτσαρέλα",
  price: 5,
  available: true,
  optionGroups: pizzaGroups(),
};

export const SHOP = {
  id: "pizza-roma",
  name: "Pizza Roma",
  cuisineLabel: "Πίτσα",
  cuisineIds: ["pizza"],
  rating: 4.5,
  reviews: 10,
  etaMinutes: [30, 40] as [number, number],
  minOrder: 0,
  deliveryFee: 1.5,
  freeDeliveryOver: null,
  image: "",
  gradient: "from-orange-400 to-red-500",
  address: "Ερμού 1",
};
