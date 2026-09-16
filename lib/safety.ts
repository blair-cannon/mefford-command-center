export const VISITOR_WALK_TYPE = "Visitor Safety Walk";
export const VISITOR_WAIVER_TYPE = "Visitor Waiver";
export const SAFETY_INCIDENT_TYPE = "Safety Incidents";
export const SAFETY_CONTROL_TYPE = "Safety Control";
export const WAIVER_CONTROL_ID = "VISITOR-WAIVER-CONTROL";

export const VISITOR_WALK_ITEMS = [
  "Required PPE is fitted and being worn",
  "Emergency alarm, exit route, and muster point reviewed",
  "Restricted areas and active work zones identified",
  "Vehicle, equipment, and spotter rules reviewed",
  "Fall, excavation, electrical, and overhead hazards reviewed",
  "Visitor understands check-in, escort, and check-out rules",
] as const;

export function parseSafetyData(value?: string | null) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

export function visitorKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
