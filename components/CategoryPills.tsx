"use client";

/* ==========================================================================
 *  Buka Delivery — components/CategoryPills.tsx
 *
 *  Οριζόντια scrollable σειρά από pills. Χρησιμοποιείται σε δύο σημεία:
 *
 *  1. Αρχική → κατηγορίες κουζίνας (Cuisine[])
 *  2. Σελίδα καταστήματος → κατηγορίες μενού (MenuCategory[]), σε μικρό
 *     μέγεθος και μέσα σε sticky μπάρα
 *
 *  Δέχεται οποιοδήποτε array με { id, label, emoji }, οπότε δουλεύει και με
 *  τους δύο τύπους χωρίς μετατροπή.
 * ========================================================================== */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/format";

/** Ελάχιστο σχήμα που χρειάζεται ένα pill — το καλύπτουν Cuisine και MenuCategory */
export type PillOption = {
  id: string;
  label: string;
  emoji: string;
};

type CategoryPillsProps = {
  options: PillOption[];
  activeId: string;
  onSelect: (id: string) => void;
  /** "lg" για την αρχική, "sm" για τη sticky μπάρα του μενού */
  size?: "sm" | "lg";
  /** Κρατά το ενεργό pill πάντα μέσα στο ορατό πλάτος */
  autoScrollToActive?: boolean;
  className?: string;
};

export default function CategoryPills({
  options,
  activeId,
  onSelect,
  size = "lg",
  autoScrollToActive = true,
  className,
}: CategoryPillsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  /* Οριζόντιο scroll ώστε το ενεργό pill να είναι πάντα ορατό */
  useEffect(() => {
    if (!autoScrollToActive || !containerRef.current) return;

    const active = containerRef.current.querySelector<HTMLButtonElement>(
      `[data-pill-id="${activeId}"]`,
    );
    if (!active) return;

    active.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeId, autoScrollToActive]);

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Κατηγορίες"
      className={cn(
        "flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        size === "lg" && "gap-3 pb-3",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.id === activeId;

        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-pill-id={option.id}
            onClick={() => onSelect(option.id)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border font-semibold transition-all duration-300",
              size === "lg"
                ? "px-5 py-3 text-sm hover:-translate-y-0.5 hover:shadow-lg"
                : "gap-1.5 px-4 py-2.5 text-sm",
              active
                ? "border-orange-500 bg-orange-500 text-white shadow-lg shadow-orange-500/30"
                : "border-gray-200 bg-white text-gray-700 hover:border-orange-300 hover:text-orange-600",
            )}
          >
            <span className={cn("leading-none", size === "lg" ? "text-lg" : "text-base")}>
              {option.emoji}
            </span>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------------------
 *  Skeleton για όσο φορτώνει το μενού
 * -------------------------------------------------------------------------- */

export function CategoryPillsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-2 overflow-hidden">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="h-10 w-28 shrink-0 animate-pulse rounded-full bg-gray-200"
        />
      ))}
    </div>
  );
}
