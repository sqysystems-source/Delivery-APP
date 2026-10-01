"use client";

/* ==========================================================================
 *  Buka Delivery — components/checkout/CheckoutField.tsx
 *
 *  Πεδίο φόρμας με σωστή προσβασιμότητα:
 *    • <label> συνδεδεμένο με το πεδίο
 *    • aria-invalid + aria-describedby προς το μήνυμα λάθους και τη βοήθεια
 *    • aria-required στα υποχρεωτικά (χωρίς native `required`, ώστε τα
 *      ελληνικά μηνύματα της εφαρμογής να μην αντικαθίστανται από τα
 *      μηνύματα του browser)
 * ========================================================================== */

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/format";

type BaseProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  autoComplete?: string;
  className?: string;
};

type InputProps = BaseProps & {
  multiline?: false;
  type?: "text" | "tel";
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
};

type TextareaProps = BaseProps & {
  multiline: true;
  rows?: number;
};

export type CheckoutFieldProps = InputProps | TextareaProps;

export default function CheckoutField(props: CheckoutFieldProps) {
  const {
    id,
    label,
    value,
    onChange,
    onBlur,
    error,
    hint,
    required = false,
    disabled = false,
    placeholder,
    maxLength,
    autoComplete,
    className,
  } = props;

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  // Εμφανίζεται είτε το λάθος είτε η βοήθεια — ποτέ αναφορά σε κρυμμένο στοιχείο
  const describedBy = error ? errorId : hint ? hintId : "";

  const fieldClass = cn(
    "w-full rounded-2xl border bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:bg-white focus-visible:ring-2 focus-visible:ring-orange-500/30 disabled:cursor-not-allowed disabled:opacity-60",
    error ? "border-red-300 focus:border-red-400" : "border-gray-200 focus:border-orange-400",
  );

  const shared = {
    id,
    name: id,
    value,
    disabled,
    placeholder,
    maxLength,
    autoComplete,
    "aria-invalid": error ? true : undefined,
    "aria-required": required || undefined,
    "aria-describedby": describedBy || undefined,
    className: fieldClass,
  } as const;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-center gap-2 text-sm font-bold text-gray-900"
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="text-orange-500">
            *
          </span>
        ) : (
          <span className="text-xs font-medium text-gray-400">προαιρετικό</span>
        )}
      </label>

      {props.multiline ? (
        <textarea
          {...shared}
          rows={props.rows ?? 3}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onBlur?.(event.target.value)}
          className={cn(fieldClass, "resize-none")}
        />
      ) : (
        <input
          {...shared}
          type={props.type ?? "text"}
          inputMode={props.inputMode}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onBlur?.(event.target.value)}
        />
      )}

      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-semibold text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-gray-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
