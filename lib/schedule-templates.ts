export const SCHEDULE_TEMPLATE_RECORD_TYPE = "Schedule Template";
export const SCHEDULE_TEMPLATE_PROJECT_ID = "MEFFORD-COMPANY";

export type ScheduleTemplateTask = {
  name: string;
  offsetDays: number;
  days: number;
  dependency: string;
  qualityCategoryId: string;
  tone: string;
};

export type ScheduleTemplate = {
  id: string;
  name: string;
  description: string;
  source: "Mefford Controlled Standard" | "Saved Company Template";
  tasks: ScheduleTemplateTask[];
};

const task = (name: string, offsetDays: number, days: number, dependency: string, qualityCategoryId: string, tone: string): ScheduleTemplateTask => ({ name, offsetDays, days, dependency, qualityCategoryId, tone });

export const STANDARD_SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  {
    id: "mefford-standard-new-build",
    name: "Mefford Standard New Build",
    description: "Sitework structure enclosure MEP finishes and turnover starter sequence.",
    source: "Mefford Controlled Standard",
    tasks: [
      task("Mobilization And Project Controls", 0, 5, "None", "general-administrative", "charcoal"),
      task("Sitework And Underground Utilities", 5, 20, "Mobilization And Project Controls", "sitework", "green"),
      task("Foundations And Concrete", 18, 18, "Sitework And Underground Utilities", "concrete", "orange"),
      task("Structural Framing", 32, 24, "Foundations And Concrete", "framing", "blue"),
      task("Roofing And Dry-In", 48, 18, "Structural Framing", "roofing", "orange"),
      task("MEP Rough-In", 45, 30, "Structural Framing", "above-ceiling", "purple"),
      task("Drywall And Interior Build-Out", 70, 28, "MEP Rough-In", "drywall", "blue"),
      task("Painting Flooring And Final Finishes", 94, 24, "Drywall And Interior Build-Out", "painting", "green"),
      task("Commissioning Punch And Turnover", 116, 15, "Painting Flooring And Final Finishes", "closeout-commissioning", "charcoal"),
    ],
  },
  {
    id: "commercial-renovation",
    name: "Commercial Renovation",
    description: "Occupied-area controls selective demolition rebuild finishes and turnover.",
    source: "Mefford Controlled Standard",
    tasks: [
      task("Mobilization Protection And Phasing", 0, 5, "None", "general-administrative", "charcoal"),
      task("Selective Demolition", 5, 12, "Mobilization Protection And Phasing", "demolition", "orange"),
      task("Framing And Openings", 14, 18, "Selective Demolition", "framing", "blue"),
      task("MEP Rework And Above-Ceiling Coordination", 20, 24, "Selective Demolition", "above-ceiling", "purple"),
      task("Drywall And Ceilings", 40, 20, "MEP Rework And Above-Ceiling Coordination", "drywall", "blue"),
      task("Painting Flooring And Finish Work", 57, 22, "Drywall And Ceilings", "flooring", "green"),
      task("Commissioning Punch And Turnover", 76, 12, "Painting Flooring And Finish Work", "closeout-commissioning", "charcoal"),
    ],
  },
  {
    id: "restaurant-build-out",
    name: "Restaurant Build-Out",
    description: "Utility rough-ins food-service coordination life safety finishes and turnover.",
    source: "Mefford Controlled Standard",
    tasks: [
      task("Mobilization Layout And Long-Lead Review", 0, 5, "None", "general-administrative", "charcoal"),
      task("Sawcut Trenching And Underground MEP", 5, 18, "Mobilization Layout And Long-Lead Review", "trenching-excavation", "orange"),
      task("Framing And Equipment Blocking", 20, 18, "Sawcut Trenching And Underground MEP", "framing", "blue"),
      task("MEP And Hood Rough-In", 24, 26, "Framing And Equipment Blocking", "above-ceiling", "purple"),
      task("Fire Sprinkler And Life Safety", 35, 18, "Framing And Equipment Blocking", "fire-sprinkler", "red"),
      task("Drywall Ceilings And Inspection Close-In", 48, 20, "MEP And Hood Rough-In", "drywall", "blue"),
      task("Food-Service Equipment And Finishes", 65, 25, "Drywall Ceilings And Inspection Close-In", "flooring", "green"),
      task("Startup Health Inspection Punch And Turnover", 88, 14, "Food-Service Equipment And Finishes", "closeout-commissioning", "charcoal"),
    ],
  },
];
