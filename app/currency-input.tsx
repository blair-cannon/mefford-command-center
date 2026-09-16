"use client";

import type { InputHTMLAttributes } from "react";
import { currencyRawValue, formatCurrencyInput, settleCurrencyInput } from "../lib/money";

export { currencyRawValue, formatCurrencyInput, settleCurrencyInput };

type CurrencyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string | number;
  onValueChange: (rawValue: string) => void;
  allowNegative?: boolean;
};

export function CurrencyInput({ value, onValueChange, allowNegative = false, ...props }: CurrencyInputProps) {
  const suppliedOnBlur = props.onBlur;
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={formatCurrencyInput(value, allowNegative)}
      onChange={(event) => onValueChange(currencyRawValue(event.target.value, allowNegative))}
      onBlur={(event) => {
        onValueChange(settleCurrencyInput(event.currentTarget.value, allowNegative));
        suppliedOnBlur?.(event);
      }}
    />
  );
}
