"use client";

import {
  SMALL_PROJECT_PRICING_METHODS,
  normalizeSmallProjectPricingMethod,
} from "../lib/owner-contracts";
import { CurrencyInput } from "./currency-input";

export function SmallProjectPricingPanel({
  fields,
  disabled = false,
  onChange,
}: {
  fields: Record<string, string>;
  disabled?: boolean;
  onChange: (field: string, value: string) => void;
}) {
  const selected = normalizeSmallProjectPricingMethod(fields.SMALL_PROJECT_PRICING_METHOD);
  const needsAmount = selected !== "Time & Materials";
  const needsRates = selected !== "Lump Sum";

  return <section className="small-project-pricing-panel">
    <header>
      <span>Small Projects / T&M</span>
      <h3>Choose The Pricing Method For This Contract</h3>

    </header>
    <div className="small-project-pricing-options" role="radiogroup" aria-label="Small Project Pricing Arrangement">
      {SMALL_PROJECT_PRICING_METHODS.map((item) => <button
        key={item.value}
        type="button"
        role="radio"
        aria-checked={selected === item.value}
        className={selected === item.value ? "active" : ""}
        disabled={disabled}
        onClick={() => onChange("SMALL_PROJECT_PRICING_METHOD", item.value)}
      >
        <strong>{item.value}</strong>
        <small>{item.description}</small>
      </button>)}
    </div>
    <div className="small-project-pricing-inputs">
      {needsAmount ? <label>
        <span>{selected === "Lump Sum" ? "Lump Sum Contract Price" : "Not-to-Exceed Cap"}</span>
        <CurrencyInput
          value={fields.SMALL_PROJECT_CONTRACT_AMOUNT || ""}
          disabled={disabled}
          onValueChange={(value) => onChange("SMALL_PROJECT_CONTRACT_AMOUNT", value)}
        />
      </label> : <div className="small-project-no-cap"><strong>No Maximum Price</strong><span>Invoices use actual documented cost plus the agreed fee.</span></div>}
      {needsRates ? <>
        <label className="wide">
          <span>T&M Labor And Equipment Rate Schedule</span>
          <textarea
            rows={4}
            value={fields.TIME_AND_MATERIALS_RATE_SCHEDULE || ""}
            disabled={disabled}
            placeholder="List labor classifications, equipment rates, and what each rate includes."
            onChange={(event) => onChange("TIME_AND_MATERIALS_RATE_SCHEDULE", event.target.value)}
          />
        </label>
        <label>
          <span>Contractor Fee / Profit</span>
          <div className="small-project-percent-input">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={fields.CONTRACTOR_FEE_PROFIT_PERCENTAGE || ""}
              disabled={disabled}
              onChange={(event) => onChange("CONTRACTOR_FEE_PROFIT_PERCENTAGE", event.target.value)}
            />
            <b>%</b>
          </div>
        </label>
      </> : null}
    </div>
    <label className="small-project-guaranty">
      <input
        type="checkbox"
        checked={/^(?:yes|y|true|1)$/i.test(fields.PERSONAL_GUARANTY_REQUIRED_YES_OR_NO || "")}
        disabled={disabled}
        onChange={(event) => onChange("PERSONAL_GUARANTY_REQUIRED_YES_OR_NO", event.target.checked ? "YES" : "NO")}
      />
      <span><strong>Require A Personal Guaranty</strong><small>Leave this off unless the approved deal specifically requires an individual guarantor.</small></span>
    </label>
    {/^(?:yes|y|true|1)$/i.test(fields.PERSONAL_GUARANTY_REQUIRED_YES_OR_NO || "") ? <label className="small-project-guarantor-name">
      <span>Personal Guarantor Name</span>
      <input
        value={fields.GUARANTOR_NAME || ""}
        disabled={disabled}
        onChange={(event) => onChange("GUARANTOR_NAME", event.target.value)}
      />
    </label> : null}
  </section>;
}
