import type { TurnoverChecklistItem } from "./turnovers";

type Items = Record<string, TurnoverChecklistItem[]>;
const normalized = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/** Contract templates deliberately carry aliases. A meeting reviews each fact
 * once; explicit aliases also let a deployed checklist retain its old notes. */
export function consolidateOperationsChecklist(items: Items) {
  const get = (section: string, key: string) => items[section]?.find(item => item.key === key);
  const merge = (section: string, target: TurnoverChecklistItem, aliases: Array<[string, string]>) => {
    target.replaces ||= [];
    for (const [from, key] of aliases) {
      if (from === section && key === target.key) continue;
      target.replaces.push({section: from, key});
      items[from] = (items[from] || []).filter(item => item.key !== key);
    }
  };
  const team = get("control", "required-participants");
  if (team) {
    team.title = "Project Team And Responsibilities";
    const roster = new Map<string, {name:string; roles:Set<string>}>();
    for (const line of team.source.split("\n")) {
      const split = line.lastIndexOf(": ");
      if (split < 0) continue;
      const name = line.slice(split + 2), key = normalized(name);
      const entry = roster.get(key) || {name, roles:new Set<string>()};
      for (const role of line.slice(0, split).split(/; |, /)) entry.roles.add(role);
      roster.set(key, entry);
    }
    const people: Array<[string,string,string]> = [["control","salesperson","Salesperson"],["control","estimator","Estimator"],["project","project-manager","Project Manager"],["project","site-superintendent","Site Superintendent"]];
    for (const [section,key,role] of people) {
      const name = get(section,key)?.source;
      if (!name || name === "Not Recorded") continue;
      const entry = roster.get(normalized(name)) || {name,roles:new Set<string>()};
      entry.roles.add(role); roster.set(normalized(name),entry);
    }
    team.source = [...roster.values()].map(person => `${[...person.roles].join("; ")}: ${person.name}`).join("\n");
    merge("control",team,[...people.map(([section,key]):[string,string]=>[section,key]),["control","receiving-lead"],["setup","project-participants"],
      ...["PROJECT_MANAGER_NAME","PROJECT_MANAGER_NAME_OR_FIRM","PROJECT_MANAGER_CONTACT","PROJECT_MANAGER_CONTACT_INCLUDED_SCOPE","SUPERINTENDENT_CONTACT_INCLUDED_SCOPE"].map((key):[string,string]=>["scope",`contract:${key}`])]);
  }
  const payment = get("commercial","payment-terms");
  if (payment) merge("commercial",payment,[["commercial","contract:PAYMENT_TERMS"],["commercial","contract:REMAINING_PAYMENT_SCHEDULE"]]);
  const retainage = get("commercial","retainage");
  if (retainage) merge("commercial",retainage,[["commercial","initial-retainage-"],["commercial","retainage-after-halfway-"],
    ...["RETAINAGE_PERCENTAGE","RETAINAGE_TERMS","RETAINAGE_TERMS_AND_RELEASE","CONSTRUCTION_RETAINAGE"].map((key):[string,string]=>["commercial",`contract:${key}`])]);
  const damages = (items.commercial || []).filter(item => item.key.startsWith("contract:LIQUIDATED_DAMAGES"));
  if (damages.length) {
    damages[0].title = "Liquidated Damages";
    damages[0].source = [...new Map(damages.map(item=>[normalized(item.source),item.source])).values()].join("\n");
    merge("commercial",damages[0],damages.flatMap(item=>[["commercial",item.key],["scope",item.key]] as Array<[string,string]>));
  }
  // Terms that mention "scope" still belong to their commercial topic once.
  for (const commercial of items.commercial || []) if (get("scope",commercial.key)) merge("commercial",commercial,[["scope",commercial.key]]);
  const authority = get("control","handoff-authority");
  if (authority) merge("control",authority,[["commercial","owner-contract"],["commercial","construction-sales-billing"]]);
  const budget = get("estimate","budget"), direct = get("estimate","direct-job-cost");
  if (budget && direct?.source === budget.source) merge("estimate",budget,[["estimate","direct-job-cost"]]);
  if (budget && get("estimate","reconciliation-difference")?.source === "$0.00") merge("estimate",budget,[["estimate","reconciliation-difference"]]);
  const insurance = get("estimate","budget:0142.00"), insuranceAmount = get("commercial","contract:INSURANCE_AND_BONDS_AMOUNT");
  if (insurance && insuranceAmount?.source === insurance.source) merge("estimate",insurance,[["commercial",insuranceAmount.key]]);
  for (const setup of items.setup || []) if (get("risks",setup.key)) merge("setup",setup,[["risks",setup.key]]);
  for (const [title,key] of [["Contract Start","start-date"],["Substantial Completion","substantial-completion"],["Final Completion","final-completion"]]) {
    const date = get("project",key);
    if (!date) continue;
    for (const risk of [...(items.risks || [])]) if (risk.title === `Schedule · ${title}` && risk.source.startsWith("Scheduled ·") && risk.source.split("\n")[0].endsWith(`Due ${date.source}`) && !risk.source.split("\n").slice(1).join("").trim()) merge("project",date,[["risks",risk.key]]);
  }
  const duration = get("estimate","duration-months");
  if (duration) merge("estimate",duration,[["project","estimated-months"]]);
  for (const [oldKey,newKey] of [["cost-risk","review:cost"],["schedule-risk","review:schedule"],["field-logistics-risk","review:logistics"]]) {
    const risk = get("risks",newKey); if (risk) merge("risks",risk,[["recap",oldKey]]);
  }
  // These belong to pre-award sales or repeat facts already reviewed above.
  for (const [section,keys] of Object.entries({commercial:["customer-budget","cap-sheet-total"],project:["bid-due"],setup:["controlled-contract","budget-lines","source-opportunity"]})) {
    items[section] = (items[section] || []).filter(item => !keys.includes(item.key));
  }
  // Only collapse matching prose within the same topic. Equal dollar amounts,
  // percentages, different scopes and distinct payment conditions stay distinct.
  for (const section of ["scope"]) {
    const prior = new Map<string, TurnoverChecklistItem>();
    for (const item of [...(items[section] || [])]) {
      if (!/^(contract:|proposal:|project-scope|owner-commitments)/.test(item.key)) continue;
      const value = normalized(item.source);
      if (value.length < 20 || /^(not recorded|none|n\/a)$/i.test(value)) continue;
      const same = prior.get(value);
      if (same) merge(section,same,[[section,item.key]]);
      else prior.set(value,item);
    }
  }
  // Template summary fields repeat their individual exclusions/design scopes.
  // Keep the dedicated entries; retain only genuinely additional paragraphs.
  const body = (value:string) => normalized(value.replace(/^[•*-]\s*/, "").replace(/^[^\n]+?\s+[—–]\s+/, ""));
  for (const item of [...(items.scope || [])]) {
    if (!/^(contract:|proposal:)/.test(item.key)) continue;
    const parts = item.source.split(/\n+/).filter(part=>part.trim());
    if (parts.length < 2) continue;
    const remaining = parts.filter(part=>!items.scope.some(other=>other!==item && body(other.source) === body(part)));
    if (!remaining.length) items.scope = items.scope.filter(other=>other!==item);
    else if (remaining.length < parts.length) {
      item.source = remaining.join("\n\n");
      if (remaining.length === 1 && /^.+?\s+[—–]\s+/.test(remaining[0])) item.title = remaining[0].split(/\s+[—–]\s+/)[0];
    }
  }
  for (const item of items.scope || []) {
    const exclusion = item.key.match(/^contract:EXCLUSION_OR_DEFERRED_SCOPE_(\d+)_/);
    if (exclusion) item.title = `Exclusion Or Deferred Scope ${exclusion[1]}`;
  }
  const included = get("scope","contract:TOTAL_LUMP_SUM_CONTRACT_SUM_INCLUDED_SCOPE_NOTES") || get("scope","contract:DESIGN_AND_CONSTRUCTION_SCOPE");
  if (included) {
    included.title = "Included Work";
    for (const item of [...(items.scope || [])]) if (/^contract:GENERAL_(CONDITIONS|REQUIREMENTS).*INCLUDED_SCOPE_NOTES$/.test(item.key) && item.source.split(";").every(part=>part.trim() && normalized(included.source).includes(normalized(part)))) merge("scope",included,[["scope",item.key]]);
  }
  return items;
}
