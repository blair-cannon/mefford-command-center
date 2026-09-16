import { formatMoney } from "./money";
import { isPercentageContractField, isScalarMoneyContractField } from "./owner-contracts";

type OwnerContractRenderOptions = {
  trustedHtmlFields?: Iterable<string>;
  missingValue?: (field: string) => string;
  adaptiveValues?: boolean;
};

const TOKEN_PATTERN = "\\{\\{([A-Z0-9_]+)\\}\\}";
const BLANK_PARAGRAPH_PATTERN = /<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?\s*>)*<\/p>/gi;
const CONDITIONAL_PATTERN = /\{\{#IF_([A-Z0-9_]+):([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/IF_\1\}\}/g;

export const OWNER_CONTRACT_DOCUMENT_CSS = `
  @page { size: letter portrait; margin: .62in .68in .58in; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background: #e6e6e6; color: #000; font-family: Arial, Helvetica, sans-serif; }
  .contract-toolbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 10px; padding: 11px 16px; background: #111; color: #fff; }
  .contract-toolbar button, .contract-toolbar a { border: 1px solid #fff; border-radius: 3px; padding: 9px 14px; background: #fff; color: #000; text-decoration: none; font: 700 12px/1.2 Arial, Helvetica, sans-serif; cursor: pointer; }
  .contract-toolbar span { color: #fff; font: 400 11px/1.35 Arial, Helvetica, sans-serif; }
  .contract-document-cover, .contract-basis-schedule, .contract-body { width: 8.5in; margin: 18px auto 0; background: #fff; color: #000; border: 1px solid #777; box-shadow: 0 2px 14px rgba(0, 0, 0, .12); }
  .contract-document-cover { min-height: 9.65in; padding: .62in .68in; }
  .contract-document-cover header { display: flex; justify-content: space-between; gap: 28px; border-bottom: 2px solid #000; padding-bottom: 14px; }
  .contract-document-cover header p { margin: 0; color: #000; font-size: 9pt; line-height: 1.35; }
  .contract-document-cover h1 { margin: 5px 0 6px; color: #000; font-size: 20pt; line-height: 1.15; }
  .contract-document-cover .status { align-self: flex-start; max-width: 1.75in; border: 1px solid #000; border-radius: 2px; padding: 6px 9px; background: #fff; color: #000; font-size: 8pt; font-weight: 700; line-height: 1.3; text-align: center; text-transform: uppercase; }
  .contract-document-cover dl { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: .28in 0; border: 1px solid #000; }
  .contract-document-cover dl div { min-height: .58in; padding: .09in .12in; border-bottom: 1px solid #777; }
  .contract-document-cover dl div:nth-child(odd) { border-right: 1px solid #777; }
  .contract-document-cover dt { color: #000; font-size: 7.5pt; font-weight: 700; letter-spacing: .04em; line-height: 1.2; text-transform: uppercase; }
  .contract-document-cover dd { margin: 4px 0 0; color: #000; font-size: 9.5pt; font-weight: 600; line-height: 1.35; }
  .signature-certificate { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .signature-certificate article { min-height: 1.05in; border: 1px solid #000; padding: .12in; }
  .signature-certificate strong { display: block; color: #000; font-size: 8.5pt; }
  .signature-certificate span { display: block; margin-top: 4px; color: #000; font-size: 8.5pt; line-height: 1.3; }
  .signature-certificate img, .contract-body img.contract-signature { display: block; max-width: 2.25in; max-height: .58in; margin: 6px 0; filter: grayscale(1) contrast(1.2); }
  .draft-warning { margin-top: .22in; border: 1px solid #000; padding: .12in .14in; background: #fff; color: #000; font-size: 8.5pt; font-weight: 700; line-height: 1.45; }
  .contract-basis-schedule { min-height: 9.65in; padding: .62in .68in; }
  .contract-basis-schedule header { border-bottom: 2px solid #000; padding-bottom: .18in; }
  .contract-basis-schedule header p { margin: 0; font-size: 8pt; font-weight: 700; letter-spacing: .08em; }
  .contract-basis-schedule h1 { margin: .06in 0; font-size: 20pt; line-height: 1.15; }
  .contract-basis-schedule header span { font-size: 9.5pt; line-height: 1.4; }
  .contract-basis-schedule table { width: 100%; margin: .28in 0; border-collapse: collapse; }
  .contract-basis-schedule th, .contract-basis-schedule td { border: 1px solid #555; padding: .1in; color: #000; font-size: 8.5pt; line-height: 1.35; text-align: left; vertical-align: top; }
  .contract-basis-schedule th { border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; font-size: 7.5pt; letter-spacing: .035em; text-transform: uppercase; }
  .contract-basis-schedule td strong, .contract-basis-schedule td span { display: block; }
  .contract-basis-schedule td span { margin-top: 3px; }
  .contract-basis-schedule a { color: #000; font-weight: 700; text-decoration: underline; }
  .contract-basis-order { border: 1px solid #000; padding: .12in .14in; font-size: 8.5pt; line-height: 1.45; }
  .contract-document-watermark { position: fixed; right: -58px; top: 106px; z-index: 15; transform: rotate(35deg); border: 1px solid #000; padding: 7px 68px; background: #fff; color: #000; font-size: 8pt; font-weight: 700; letter-spacing: .08em; opacity: .42; }
  .contract-body { margin-bottom: 30px; padding: .58in .68in; font-size: 10pt; line-height: 1.38; }
  .contract-body, .contract-body * { color: #000 !important; font-family: Arial, Helvetica, sans-serif !important; box-shadow: none !important; }
  .contract-body [bgcolor], .contract-body [style*="background"] { background: transparent !important; }
  .contract-body p, .contract-body li, .contract-body div:not([title="header"]), .contract-body span, .contract-body font { font-size: 10pt !important; line-height: 1.38 !important; }
  .contract-body p { margin-top: 0 !important; margin-bottom: .1in !important; orphans: 3; widows: 3; }
  .contract-body > div[title="header"] { margin: 0 0 .3in !important; border-bottom: 1px solid #000; padding: 0 0 .08in !important; }
  .contract-body > div[title="header"] p, .contract-body > div[title="header"] p * { margin: 0 !important; color: #000 !important; font-size: 8pt !important; font-weight: 700 !important; letter-spacing: .04em !important; line-height: 1.25 !important; }
  .contract-body > div[title="header"] + p, .contract-body > div[title="header"] + p * { margin: 0 0 .07in !important; font-size: 19pt !important; font-weight: 700 !important; letter-spacing: 0 !important; line-height: 1.15 !important; text-align: center !important; }
  .contract-body > div[title="header"] + p + p, .contract-body > div[title="header"] + p + p * { margin: 0 0 .09in !important; font-size: 10.5pt !important; font-weight: 400 !important; letter-spacing: 0 !important; line-height: 1.3 !important; text-align: center !important; }
  .contract-body > div[title="header"] + p + p + p, .contract-body > div[title="header"] + p + p + p * { margin: 0 0 .24in !important; font-size: 8pt !important; font-weight: 700 !important; letter-spacing: .06em !important; line-height: 1.25 !important; text-align: center !important; }
  .contract-body h1, .contract-body h1 * { margin: .26in 0 .1in !important; color: #000 !important; font-size: 13pt !important; font-weight: 700 !important; letter-spacing: .01em !important; line-height: 1.2 !important; break-before: auto !important; break-after: avoid !important; page-break-before: auto !important; page-break-after: avoid !important; }
  .contract-body h2, .contract-body h2 * { margin: .2in 0 .08in !important; color: #000 !important; font-size: 11pt !important; font-weight: 700 !important; line-height: 1.25 !important; break-after: avoid !important; page-break-after: avoid !important; }
  .contract-body h3, .contract-body h3 * { margin: .16in 0 .07in !important; color: #000 !important; font-size: 10pt !important; font-weight: 700 !important; line-height: 1.3 !important; break-after: avoid !important; }
  .contract-body table { width: 100% !important; max-width: 100% !important; margin: .14in 0 .2in !important; border-collapse: collapse !important; table-layout: auto; break-inside: auto; }
  .contract-body thead { display: table-header-group; }
  .contract-body tr { break-inside: avoid; page-break-inside: avoid; }
  .contract-body td, .contract-body th { height: auto !important; border: 1px solid #555 !important; padding: .07in .08in !important; background: #fff !important; color: #000 !important; font-size: 9pt !important; line-height: 1.3 !important; vertical-align: top !important; }
  .contract-body td *, .contract-body th * { margin-top: 0 !important; margin-bottom: 0 !important; color: #000 !important; font-size: 9pt !important; line-height: 1.3 !important; }
  .contract-body thead td, .contract-body thead th { border-top: 1.5px solid #000 !important; border-bottom: 1.5px solid #000 !important; background: #fff !important; font-size: 8pt !important; font-weight: 700 !important; letter-spacing: .035em !important; text-transform: uppercase; }
  .contract-body thead td *, .contract-body thead th * { font-size: 8pt !important; font-weight: 700 !important; letter-spacing: .035em !important; }
  .contract-body a { color: #000 !important; text-decoration: underline; }
  .contract-body .brand { display: flex; align-items: flex-end; justify-content: space-between; gap: .25in; margin-bottom: .28in; border-bottom: 1px solid #000 !important; padding-bottom: .1in; }
  .contract-body .brand *, .contract-body .brand strong, .contract-body .brand span { color: #000 !important; font-size: 8.5pt !important; font-weight: 700 !important; line-height: 1.25 !important; }
  .contract-body .brand + h1, .contract-body .brand + h1 * { margin-top: 0 !important; font-size: 17pt !important; }
  .contract-body .control { border: 1px solid #000 !important; padding: .12in !important; background: #fff !important; }
  .contract-body .signature { margin-top: .3in !important; break-inside: avoid; }
  .contract-body-small-project { font-size: 10pt; line-height: 1.42; }
  .contract-body-small-project > .brand { margin-bottom: .22in !important; }
  .contract-body-small-project > .project-title { margin: 0 0 .2in !important; overflow-wrap: anywhere; }
  .contract-body-small-project .opening { margin-bottom: .1in !important; text-align: left !important; }
  .contract-body-small-project h2 { margin: .21in 0 .07in !important; }
  .contract-body-small-project p,
  .contract-body-small-project td,
  .contract-body-small-project .contract-value { overflow-wrap: anywhere; word-break: normal; }
  .contract-body-small-project .contract-value { max-width: 100%; white-space: pre-wrap; }
  .contract-body-small-project .contract-value-extended { line-height: 1.42 !important; }
  .contract-body-small-project .subsection { margin-left: 0 !important; border-left: 1px solid #777; padding-left: .16in; }
  .contract-body-small-project .scope-block {
    min-height: 0 !important;
    margin: .05in 0 .14in !important;
    border-left: 2px solid #000;
    padding: .05in .09in !important;
    white-space: pre-wrap !important;
    overflow-wrap: anywhere;
    break-inside: auto;
    page-break-inside: auto;
  }
  .contract-body-small-project .scope-block > .contract-value { display: block; }
  .contract-body-small-project .scope-block-compact { margin-bottom: .11in !important; padding-top: .035in !important; padding-bottom: .035in !important; break-inside: avoid; page-break-inside: avoid; }
  .contract-body-small-project .scope-block-standard { margin-bottom: .14in !important; }
  .contract-body-small-project .scope-block-extended { margin-bottom: .18in !important; line-height: 1.42 !important; }
  .contract-body-small-project .detail-table { table-layout: fixed !important; }
  .contract-body-small-project .detail-table th { width: 31% !important; }
  .contract-body-small-project .detail-table td { white-space: normal !important; }
  .contract-body-small-project .detail-table tr:has(.contract-value-extended) { break-inside: auto; page-break-inside: auto; }
  .contract-body-small-project table.signature { width: 100% !important; margin-top: .3in !important; table-layout: fixed !important; break-inside: avoid; page-break-inside: avoid; }
  .contract-body-small-project table.signature td {
    width: 50% !important;
    height: auto !important;
    border: 0 !important;
    border-bottom: 1px solid #000 !important;
    padding: .08in .18in .03in 0 !important;
    font-size: 9.5pt !important;
    line-height: 1.35 !important;
    vertical-align: bottom !important;
    white-space: normal !important;
    overflow-wrap: anywhere;
  }
  .contract-body-small-project table.signature td:nth-child(2) { padding-left: .18in !important; padding-right: 0 !important; }
  .contract-body-small-project table.signature td .contract-value { font-size: 9.5pt !important; line-height: 1.35 !important; }
  .contract-body-small-project table.signature .label td { border-bottom: 0 !important; padding-top: .02in !important; padding-bottom: .11in !important; font-size: 7.5pt !important; font-weight: 700 !important; line-height: 1.25 !important; }
  .contract-body-small-project table.signature .signature-image td { height: auto !important; padding-top: .08in !important; }
  .contract-body-small-project table.signature img { display: block; max-width: 2.15in !important; max-height: .52in !important; margin: 0 !important; }
  @media (max-width: 900px) {
    .contract-document-cover, .contract-basis-schedule, .contract-body { width: calc(100% - 24px); }
    .contract-document-cover, .contract-basis-schedule { min-height: 0; padding: 34px; }
    .contract-body { padding: 34px; }
  }
  @media print {
    html, body { background: #fff !important; color: #000 !important; print-color-adjust: economy; -webkit-print-color-adjust: economy; }
    .contract-toolbar { display: none !important; }
    .contract-document-cover, .contract-basis-schedule, .contract-body { width: auto; margin: 0; padding: 0; border: 0; box-shadow: none; background: #fff !important; }
    .contract-document-cover, .contract-basis-schedule { min-height: 0; break-after: page; page-break-after: always; }
    .contract-document-cover, .contract-document-cover *, .contract-basis-schedule, .contract-basis-schedule *, .contract-body, .contract-body * { color: #000 !important; background-color: #fff !important; }
    .contract-document-watermark { position: absolute; border-color: #000; background: #fff !important; color: #000 !important; }
    .signature-certificate img, .contract-body img { filter: grayscale(1) contrast(1.25) !important; }
    .contract-body a { color: #000 !important; text-decoration: none !important; }
    .contract-basis-schedule a { color: #000 !important; text-decoration: none !important; }
  }
`;

export function renderOwnerContractTemplate(
  templateBody: string,
  values: Record<string, string>,
  options: OwnerContractRenderOptions = {},
) {
  const trustedHtml = new Set(Array.from(options.trustedHtmlFields || [], String));
  const missingValue = options.missingValue || (() => "Not Completed / Not Applicable");
  const render = (field: string, kind: "auto" | "money" | "percent" = "auto") => {
    const raw = String(values[field] || "").trim() || missingValue(field);
    const display = kind === "money"
      ? formatContractMoney(raw)
      : kind === "percent"
        ? formatContractPercent(raw)
        : formatOwnerContractFieldValue(field, raw);
    if (trustedHtml.has(field) && /^<img\b[^>]*>$/.test(display)) return display;
    const escaped = escapeContractHtml(display).replace(/\r?\n/g, "<br>");
    return options.adaptiveValues
      ? `<span class="contract-value contract-value-${contractValueDensity(display)}" data-contract-field="${field}">${escaped}</span>`
      : escaped;
  };

  const selectedTemplate = templateBody.replace(
    CONDITIONAL_PATTERN,
    (_match, field: string, expected: string, content: string) => String(values[field] || "").trim() === expected ? content : "",
  );

  const rendered = selectedTemplate
    .replace(BLANK_PARAGRAPH_PATTERN, "")
    .replace(new RegExp(`\\$\\s*${TOKEN_PATTERN}`, "g"), (_match, field: string) => render(field, "money"))
    .replace(new RegExp(`%\\s*${TOKEN_PATTERN}`, "g"), (_match, field: string) => render(field, "percent"))
    .replace(new RegExp(`${TOKEN_PATTERN}\\s*%`, "g"), (_match, field: string) => render(field, "percent"))
    .replace(new RegExp(TOKEN_PATTERN, "g"), (_match, field: string) => render(field));
  return options.adaptiveValues ? annotateAdaptiveBlocks(rendered) : rendered;
}

function contractValueDensity(value: string) {
  const lines = value.split(/\r?\n/).length;
  if (value.length <= 64 && lines <= 2) return "compact";
  if (value.length <= 360 && lines <= 8) return "standard";
  return "extended";
}

function annotateAdaptiveBlocks(html: string) {
  return html.replace(/<div class="scope-block">([\s\S]*?)<\/div>/g, (_match, content: string) => {
    const text = content.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
    return `<div class="scope-block scope-block-${contractValueDensity(text)}">${content}</div>`;
  });
}

export function formatOwnerContractFieldValue(field: string, value: string) {
  if (isPercentageContractField(field)) return formatContractPercent(value);
  if (isScalarMoneyContractField(field) || isContractMoneyDisplayField(field)) return formatContractMoney(value);
  return value;
}

function isContractMoneyDisplayField(field: string) {
  if (isPercentageContractField(field) || /TERMS|NOTES|RULES|TREATMENT|BASIS|METHOD|CALCULATION|SCOPE|VALIDITY|DATE|SCHEDULE|REQUIREMENTS|DOCUMENTATION|CATEGORIES|IN_WORDS/.test(field)) return false;
  return /AMOUNT|BUDGET|PRICE|COST_OF_THE_WORK|LUMP_SUM|CONTINGENC(?:Y|IES)|ALLOWANCES?|DEPOSIT|ADVANCE|(?:^|_)FEE(?:_|$)|HOURLY_RATE|UNIT_PRICE|_HR$|_HOURLY$|_DAILY$|_WEEKLY$/.test(field);
}

function formatContractMoney(value: string) {
  const amount = parseFinancialNumber(value, false);
  return amount === null ? value : formatMoney(amount);
}

function formatContractPercent(value: string) {
  const amount = parseFinancialNumber(value, true);
  if (amount === null) return value;
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount);
  return `${formatted}%`;
}

function parseFinancialNumber(value: string, allowPercent: boolean) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parenthetical = /^\(.*\)$/.test(trimmed);
  const inner = parenthetical ? trimmed.slice(1, -1) : trimmed;
  const normalized = inner.replace(/[$,\s]/g, "").replace(allowPercent ? /%/g : /$^/, "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return parenthetical ? -Math.abs(amount) : amount;
}

function escapeContractHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}
