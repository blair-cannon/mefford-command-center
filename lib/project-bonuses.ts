export const BONUS_FILE_CATEGORY = "Turnover Bonus Agreement";
export const BONUS_CONSENT = "I have reviewed all pages of this exact bonus agreement, including the completion date, budget, bonus amounts and accountability standards. I agree and intend my electronic signature to be binding.";
export type BonusPerson = { name:string; email:string };
export type BonusSnapshot = {
  projectId:string; projectName:string; budget:number; budgetSource:string; finalDate:string; payoutMonth:string;
  pm:BonusPerson; superintendent:BonusPerson; pmBonus:number; superintendentBonus:number;
  supplementaryBonus:number; tier:number; templateHash:string; effectiveDate:string; reason:string;
};
export type BonusSignature = { name:string; email:string; at:string; imageKey:string; consent:string; hash:string; meetingId:string };
export const BONUS_TIERS = [
  { label:"Up to $250,000.00", pm:500, superintendent:1000, supplementary:200 },
  { label:"$250,001.00 - $500,000.00", pm:1000, superintendent:2000, supplementary:400 },
  { label:"$500,000.00 - $1,000,000.00", pm:2000, superintendent:4000, supplementary:600 },
  { label:"$1,000,001.00 - $2,500,000.00", pm:4000, superintendent:6000, supplementary:1000 },
  { label:"$2,500,001.00 - $5,000,000.00", pm:6000, superintendent:8000, supplementary:1500 },
  { label:"$5,000,001.00 - $10,000,000.00", pm:8000, superintendent:10000, supplementary:2000 },
  { label:"Over $10,000,000.00", pm:10000, superintendent:12000, supplementary:2500 },
] as const;
/** The source overlaps at 500000 and leaves fractional-dollar boundary gaps. Do not guess. */
export function bonusTier(budget:number) {
  const matches = [[0,250000],[250001,500000],[500000,1000000],[1000001,2500000],[2500001,5000000],[5000001,10000000],[10000000.01,Infinity]]
    .flatMap(([lo,hi],i) => budget > 0 && budget >= lo && budget <= hi ? [i] : []);
  return matches.length === 1 ? matches[0] : -1;
}
export function bonusPayoutMonth(date:string) {
  if (!validBonusDate(date)) return "";
  const year = Number(date.slice(0,4)), month = Number(date.slice(5,7));
  return `${year}-${month <= 7 ? "07" : "12"}`;
}
export function validBonusDate(value:string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
export function bonusMissing(snapshot:BonusSnapshot) {
  return [!snapshot.projectName && "Project name", !(snapshot.budget>0) && "Approved project budget", !validBonusDate(snapshot.finalDate) && "Final completion date", !snapshot.pm.email && "Active, uniquely identified PM", !snapshot.superintendent.email && "Active, uniquely identified site superintendent", snapshot.pm.email && snapshot.pm.email===snapshot.superintendent.email && "Separate PM and site superintendent signers", snapshot.tier < 0 && "Company Owner bonus-tier decision"] .filter(Boolean) as string[];
}
export const bonusMoney = (value:number) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
export type BonusAgreementView = { id:string; revision:number; version:number; snapshot:BonusSnapshot; hash:string; signatures:{pm:BonusSignature|null;superintendent:BonusSignature|null}; fileId:number; createdAt:string };
export type BonusView = { projectId:string; current:BonusAgreementView; suggested:BonusSnapshot; history:BonusAgreementView[]; sourceChanged:boolean; missing:string[]; canManage:boolean; canSign:"pm"|"superintendent"|""; meetingActive:boolean; canStartReplacement:boolean; closeoutAt:string; paymentStatus:string; employees:BonusPerson[] };
