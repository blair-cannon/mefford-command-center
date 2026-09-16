"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { evaluateEstimateFormula } from "../lib/estimate-formula";
import { roundMoney } from "../lib/money";

function displayNumber(value: number | null, currency: boolean, decimals: number) {
  if (value === null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US", currency
    ? { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: decimals }).format(value);
}

export function FormulaNumberInput({
  label,
  value,
  expression = "",
  onValueChange,
  onExpressionChange,
  readOnly = false,
  currency = false,
  allowEmpty = false,
  min,
  max,
  decimals = 2,
  className = "",
}: {
  label: string;
  value: number | null;
  expression?: string;
  onValueChange: (value: number | null) => void;
  onExpressionChange?: (expression: string) => void;
  readOnly?: boolean;
  currency?: boolean;
  allowEmpty?: boolean;
  min?: number;
  max?: number;
  decimals?: number;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const cancelBlur = useRef(false);
  const initial = useRef<{ value: number | null; expression: string }>({ value, expression });

  function commit(raw: string) {
    if (!raw.trim()) {
      setError("");
      if (value !== (allowEmpty ? null : 0)) onValueChange(allowEmpty ? null : 0);
      if (expression) onExpressionChange?.("");
      return true;
    }
    const result = evaluateEstimateFormula(raw);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    if ((min !== undefined && result.value < min) || (max !== undefined && result.value > max)) {
      setError(min === undefined
        ? `Value must be no more than ${max}.`
        : max === undefined
          ? `Value must be at least ${min}.`
          : `Value must be between ${min} and ${max}.`);
      return false;
    }
    setError("");
    const nextValue = currency ? roundMoney(result.value) : result.value;
    if (nextValue !== value) onValueChange(nextValue);
    if (result.expression !== expression) onExpressionChange?.(result.expression);
    return true;
  }

  const formatted = displayNumber(value, currency, decimals);
  return <input
    aria-label={label}
    aria-invalid={Boolean(error)}
    className={`${className} formula-number-input ${expression ? "formula-active" : ""} ${error ? "formula-invalid" : ""}`.trim()}
    inputMode="decimal"
    readOnly={readOnly}
    title={error || (expression ? `${expression} = ${formatted || "0"}` : "Enter a number or formula such as 4x3")}
    value={editing || error ? draft : formatted}
    onFocus={(event) => {
      if (readOnly) return;
      initial.current = { value, expression };
      flushSync(() => {
        setEditing(true);
        if (!error) setDraft(expression || (value === null ? "" : String(value)));
      });
      event.currentTarget.select();
    }}
    onChange={(event) => {
      const raw = event.target.value;
      setDraft(raw);
      setError("");
    }}
    onBlur={() => {
      if (readOnly) return;
      if (cancelBlur.current) { cancelBlur.current = false; return; }
      flushSync(() => {
        commit(draft);
        setEditing(false);
      });
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") {
        cancelBlur.current = true;
        setError("");
        setEditing(false);
        setDraft(initial.current.expression || (initial.current.value === null ? "" : String(initial.current.value || "")));
        event.currentTarget.blur();
      }
    }}
  />;
}
