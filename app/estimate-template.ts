// Generated From ChatGPT Estimate Template(1).xlsx.
// Do Not Edit Cost Codes Here; Update The Approved Estimating Template And Regenerate.

import { roundMoney } from "../lib/money";

export type EstimateTemplateChild = {
  code: string;
  description: string;
  row: number;
  defaultQuantity: number | null;
  defaultUnit: string | null;
};

export type EstimateCalculation =
  | "direct_cost"
  | "technology_fee"
  | "base_profit"
  | "performance_bond";

export type EstimateTemplateCostCode = {
  id: string;
  divisionCode: string;
  division: string;
  code: string;
  description: string;
  row: number;
  defaultQuantity: number;
  defaultUnit: string;
  children: EstimateTemplateChild[];
  budgetable: boolean;
  calculation: EstimateCalculation;
};

export const ESTIMATE_TEMPLATE_VERSION = "MEFFORD-ESTIMATE-2026.08.10-V1";

export const ESTIMATE_TECHNOLOGY_RULES = {
  withoutBondRate: 0.001,
  withBondRate: 0.00125,
} as const;

export const ESTIMATE_BASE_PROFIT_RATE = 0.1;

export const ESTIMATE_TEMPLATE_COST_CODES: EstimateTemplateCostCode[] = [
  {
    "id": "EST-0131.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0131.00",
    "description": "Construction Management Fees",
    "row": 5,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Management",
        "row": 6,
        "defaultQuantity": 0,
        "defaultUnit": "HR"
      },
      {
        "code": "200",
        "description": "Site Superintendent",
        "row": 7,
        "defaultQuantity": 0,
        "defaultUnit": "HR"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3400.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "3400.00",
    "description": "Transportation",
    "row": 8,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Travel/Fuel",
        "row": 9,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "200",
        "description": "Lodging",
        "row": 10,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      },
      {
        "code": "300",
        "description": "Meals",
        "row": 11,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0131.19",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0131.19",
    "description": "Plan Review",
    "row": 12,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0132.33",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0132.33",
    "description": "Construction Photos-layout",
    "row": 13,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0133.23",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0133.23",
    "description": "Models/Renderings",
    "row": 14,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0135.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0135.00",
    "description": "Technology Fee",
    "row": 0,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": false,
    "calculation": "technology_fee"
  },
  {
    "id": "EST-0141.26",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0141.26",
    "description": "Permit",
    "row": 15,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0142.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0142.00",
    "description": "Insurance",
    "row": 16,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Subcontractors Insurance Premium",
        "row": 17,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "200",
        "description": "Builders Risk",
        "row": 18,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0143.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0143.00",
    "description": "Overhead & Profit",
    "row": 19,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Base Profit",
        "row": 20,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "200",
        "description": "Misc. Adjustment",
        "row": 21,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      }
    ],
    "budgetable": false,
    "calculation": "base_profit"
  },
  {
    "id": "EST-0143.15",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0143.15",
    "description": "Development Fee",
    "row": 22,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": false,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0151.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0151.00",
    "description": "Temporary Utilities",
    "row": 23,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Internet",
        "row": 24,
        "defaultQuantity": 0,
        "defaultUnit": "MO"
      },
      {
        "code": "200",
        "description": "Electric",
        "row": 25,
        "defaultQuantity": 0,
        "defaultUnit": "MO"
      },
      {
        "code": "300",
        "description": "Water",
        "row": 26,
        "defaultQuantity": 0,
        "defaultUnit": "MO"
      },
      {
        "code": "400",
        "description": "Temp. Heat",
        "row": 27,
        "defaultQuantity": 0,
        "defaultUnit": "MO"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0152.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0152.00",
    "description": "Construction Facilities",
    "row": 28,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Job Trailer",
        "row": 29,
        "defaultQuantity": 0,
        "defaultUnit": "MO"
      },
      {
        "code": "200",
        "description": "Storage Containers",
        "row": 30,
        "defaultQuantity": 0,
        "defaultUnit": "MO"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0152.19",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0152.19",
    "description": "Temporary Toilet",
    "row": 31,
    "defaultQuantity": 0,
    "defaultUnit": "MO",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0153.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0153.00",
    "description": "Temporary Construction",
    "row": 32,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Sticky Mats",
        "row": 33,
        "defaultQuantity": 0,
        "defaultUnit": "EA"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0154.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0154.00",
    "description": "Construction Aids & PPE",
    "row": 34,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0156.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0156.00",
    "description": "Site Protection-testing",
    "row": 35,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0156.26",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0156.26",
    "description": "Orange Fence 4x100",
    "row": 36,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0157.13",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0157.13",
    "description": "Silt Fencing",
    "row": 37,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0158.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0158.00",
    "description": "Project Sign",
    "row": 38,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Project Sign",
        "row": 39,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "200",
        "description": "Project Photos",
        "row": 40,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0171.23",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0171.23",
    "description": "Engineering Fees",
    "row": 41,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0172.00",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0172.00",
    "description": "Architectural Fees",
    "row": 42,
    "defaultQuantity": 0,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0174.19",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0174.19",
    "description": "Dumpster (full size, normal wt.)",
    "row": 43,
    "defaultQuantity": 0,
    "defaultUnit": "EA",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0174.23",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0174.23",
    "description": "Cleaning-Up",
    "row": 44,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0178.33",
    "divisionCode": "01",
    "division": "General Requirements",
    "code": "0178.33",
    "description": "Performance Bond",
    "row": 45,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "performance_bond"
  },
  {
    "id": "EST-0241.13",
    "divisionCode": "02",
    "division": "Existing Conditions",
    "code": "0241.13",
    "description": "Site Demolition",
    "row": 50,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0241.16",
    "divisionCode": "02",
    "division": "Existing Conditions",
    "code": "0241.16",
    "description": "Structure Demolition",
    "row": 51,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0241.19",
    "divisionCode": "02",
    "division": "Existing Conditions",
    "code": "0241.19",
    "description": "Select Demolition",
    "row": 52,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0280.00",
    "divisionCode": "02",
    "division": "Existing Conditions",
    "code": "0280.00",
    "description": "Hazardous Material Remediation",
    "row": 53,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0300.00",
    "divisionCode": "03",
    "division": "Concrete",
    "code": "0300.00",
    "description": "Basic Concrete Material",
    "row": 58,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Site Concrete",
        "row": 59,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "200",
        "description": "Building Concrete",
        "row": 60,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "300",
        "description": "Curb & Gutter",
        "row": 61,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "400",
        "description": "Spoils",
        "row": 62,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0400.00",
    "divisionCode": "04",
    "division": "Masonry",
    "code": "0400.00",
    "description": "Masonry",
    "row": 67,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "CMU Masonry",
        "row": 68,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "200",
        "description": "Brick Masonry",
        "row": 69,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "400",
        "description": "Rebar",
        "row": 70,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0512.00",
    "divisionCode": "05",
    "division": "Metals",
    "code": "0512.00",
    "description": "Structural Steel",
    "row": 75,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0550.00",
    "divisionCode": "05",
    "division": "Metals",
    "code": "0550.00",
    "description": "Misc. Metal",
    "row": 76,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Lintels",
        "row": 77,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "200",
        "description": "Bollards",
        "row": 78,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0551.00",
    "divisionCode": "05",
    "division": "Metals",
    "code": "0551.00",
    "description": "Metal Stairs",
    "row": 79,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0552.00",
    "divisionCode": "05",
    "division": "Metals",
    "code": "0552.00",
    "description": "Handrails & Railing",
    "row": 80,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0553.00",
    "divisionCode": "05",
    "division": "Metals",
    "code": "0553.00",
    "description": "Grating",
    "row": 81,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0570.00",
    "divisionCode": "05",
    "division": "Metals",
    "code": "0570.00",
    "description": "Ornamental Railing",
    "row": 82,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0605.23",
    "divisionCode": "06",
    "division": "Wood & Plastic",
    "code": "0605.23",
    "description": "Wood & Plastic Fastenings",
    "row": 87,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0611.00",
    "divisionCode": "06",
    "division": "Wood & Plastic",
    "code": "0611.00",
    "description": "Wood Framing",
    "row": 88,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Blocking",
        "row": 89,
        "defaultQuantity": null,
        "defaultUnit": "LF"
      },
      {
        "code": "200",
        "description": "Wood Framing (For Metal Doors)",
        "row": 90,
        "defaultQuantity": null,
        "defaultUnit": "LF"
      },
      {
        "code": "300",
        "description": "Structural Wood Framing",
        "row": 91,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0622.00",
    "divisionCode": "06",
    "division": "Wood & Plastic",
    "code": "0622.00",
    "description": "Millwork",
    "row": 92,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0641.00",
    "divisionCode": "06",
    "division": "Wood & Plastic",
    "code": "0641.00",
    "description": "Custom Cabinets",
    "row": 93,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0643.00",
    "divisionCode": "06",
    "division": "Wood & Plastic",
    "code": "0643.00",
    "description": "Wood Stairs & Railing",
    "row": 94,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0644.00",
    "divisionCode": "06",
    "division": "Wood & Plastic",
    "code": "0644.00",
    "description": "Wood Ornaments",
    "row": 95,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0661.16",
    "divisionCode": "06",
    "division": "Wood & Plastic",
    "code": "0661.16",
    "description": "Solid Surface Countertops",
    "row": 96,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0661.19",
    "divisionCode": "06",
    "division": "Wood & Plastic",
    "code": "0661.19",
    "description": "Granite/Quartz Countertops",
    "row": 97,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0665.00",
    "divisionCode": "06",
    "division": "Wood & Plastic",
    "code": "0665.00",
    "description": "Laminate Countertops",
    "row": 98,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0710.00",
    "divisionCode": "07",
    "division": "Thermal & Moisture Protection",
    "code": "0710.00",
    "description": "Dampproofing",
    "row": 103,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0721.13",
    "divisionCode": "07",
    "division": "Thermal & Moisture Protection",
    "code": "0721.13",
    "description": "Rigid Insulation",
    "row": 104,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0721.26",
    "divisionCode": "07",
    "division": "Thermal & Moisture Protection",
    "code": "0721.26",
    "description": "Blown Insulation",
    "row": 105,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0721.29",
    "divisionCode": "07",
    "division": "Thermal & Moisture Protection",
    "code": "0721.29",
    "description": "Spray-on Insulation",
    "row": 106,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0724.00",
    "divisionCode": "07",
    "division": "Thermal & Moisture Protection",
    "code": "0724.00",
    "description": "Exterior Insulation Finish System (EIFS)",
    "row": 107,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0730.00",
    "divisionCode": "07",
    "division": "Thermal & Moisture Protection",
    "code": "0730.00",
    "description": "Roofing",
    "row": 108,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0731.00",
    "divisionCode": "07",
    "division": "Thermal & Moisture Protection",
    "code": "0731.00",
    "description": "Asphalt Shingles",
    "row": 109,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0746.00",
    "divisionCode": "07",
    "division": "Thermal & Moisture Protection",
    "code": "0746.00",
    "description": "Siding",
    "row": 110,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0784.00",
    "divisionCode": "07",
    "division": "Thermal & Moisture Protection",
    "code": "0784.00",
    "description": "Fire Stopping",
    "row": 111,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0792.00",
    "divisionCode": "07",
    "division": "Thermal & Moisture Protection",
    "code": "0792.00",
    "description": "Joint Sealants",
    "row": 112,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0813.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0813.00",
    "description": "Metal Doors & Frames",
    "row": 117,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Flush",
        "row": 118,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      },
      {
        "code": "200",
        "description": "Half-lite",
        "row": 119,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      },
      {
        "code": "300",
        "description": "Full-lite",
        "row": 120,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      },
      {
        "code": "400",
        "description": "Louvered",
        "row": 121,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      },
      {
        "code": "500",
        "description": "Frames",
        "row": 122,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0814.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0814.00",
    "description": "Wood Doors",
    "row": 123,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Hollow Core",
        "row": 124,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      },
      {
        "code": "200",
        "description": "Solid Core",
        "row": 125,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0831.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0831.00",
    "description": "Access Doors",
    "row": 126,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0833.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0833.00",
    "description": "Overhead Doors",
    "row": 127,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0843.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0843.00",
    "description": "Aluminum Framed Storefront",
    "row": 128,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0851.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0851.00",
    "description": "Metal Windows",
    "row": 129,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0852.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0852.00",
    "description": "Wood Windows",
    "row": 130,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0862.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0862.00",
    "description": "Skylights",
    "row": 131,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0871.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0871.00",
    "description": "Door Hardware",
    "row": 132,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Door Hardware Sets",
        "row": 133,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      },
      {
        "code": "200",
        "description": "Storefront Hardware Sets",
        "row": 134,
        "defaultQuantity": null,
        "defaultUnit": "EA"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0883.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0883.00",
    "description": "Mirrors",
    "row": 135,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0891.00",
    "divisionCode": "08",
    "division": "Doors & Windows",
    "code": "0891.00",
    "description": "Wall Louvers",
    "row": 136,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0923.00",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0923.00",
    "description": "Gypsum Plaster",
    "row": 141,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0929.00",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0929.00",
    "description": "Gypsum Board",
    "row": 142,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Metal Stud Framing",
        "row": 143,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "200",
        "description": "Batt Insulation",
        "row": 144,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "300",
        "description": "Gypsum Board",
        "row": 145,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0930.13",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0930.13",
    "description": "Ceramic Tile",
    "row": 146,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0951.00",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0951.00",
    "description": "Acoustical Ceilings",
    "row": 147,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0964.00",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0964.00",
    "description": "Wood Strip Flooring",
    "row": 148,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0965.13",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0965.13",
    "description": "Resiliant Base & Accessories",
    "row": 149,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0965.19",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0965.19",
    "description": "Resiliant Tile Flooring",
    "row": 150,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0966.00",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0966.00",
    "description": "Terrazzo",
    "row": 151,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0968.00",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0968.00",
    "description": "Carpet",
    "row": 152,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0972.00",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0972.00",
    "description": "Wall Covering",
    "row": 153,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0981.00",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0981.00",
    "description": "Acoustical Insulation/Sealants",
    "row": 154,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0991.00",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0991.00",
    "description": "Paints & Coatings-interior",
    "row": 155,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0992.13",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0992.13",
    "description": "Furring & Lathing",
    "row": 156,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-0997.00",
    "divisionCode": "09",
    "division": "Finishes",
    "code": "0997.00",
    "description": "Metal Protective Coating",
    "row": 157,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1011.00",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1011.00",
    "description": "Visual Identification Devices",
    "row": 162,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1021.13",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1021.13",
    "description": "Toilet Compartments",
    "row": 163,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1021.16",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1021.16",
    "description": "Shower Compartments",
    "row": 164,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1021.23",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1021.23",
    "description": "Cubicles",
    "row": 165,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1026.00",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1026.00",
    "description": "Wall & Corner Guards",
    "row": 166,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1028.00",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1028.00",
    "description": "Toilet Accessories",
    "row": 167,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1030.00",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1030.00",
    "description": "Fireplaces & Stove",
    "row": 168,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1044.00",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1044.00",
    "description": "Fire Protection Specialties",
    "row": 169,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1055.23",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1055.23",
    "description": "Mail Delivery Systems",
    "row": 170,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1073.00",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1073.00",
    "description": "Awning & Canopies",
    "row": 171,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1075.00",
    "divisionCode": "10",
    "division": "Specialties",
    "code": "1075.00",
    "description": "Flagpoles",
    "row": 172,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1100.00",
    "divisionCode": "11",
    "division": "Equipment",
    "code": "1100.00",
    "description": "Equipment",
    "row": 177,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1131.00",
    "divisionCode": "11",
    "division": "Equipment",
    "code": "1131.00",
    "description": "Residential Appliances",
    "row": 178,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1200.00",
    "divisionCode": "12",
    "division": "Furnishings",
    "code": "1200.00",
    "description": "Furnishings",
    "row": 183,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1220.00",
    "divisionCode": "12",
    "division": "Furnishings",
    "code": "1220.00",
    "description": "Window Treatments",
    "row": 184,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1300.00",
    "divisionCode": "13",
    "division": "Special Construction",
    "code": "1300.00",
    "description": "Special Construction",
    "row": 189,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1330.00",
    "divisionCode": "13",
    "division": "Special Construction",
    "code": "1330.00",
    "description": "Pre-Engineered Structures",
    "row": 190,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-1420.00",
    "divisionCode": "14",
    "division": "Conveying Equipment",
    "code": "1420.00",
    "description": "Elevator",
    "row": 195,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-2100.00",
    "divisionCode": "21",
    "division": "Fire Suppression",
    "code": "2100.00",
    "description": "Fire Suppression",
    "row": 200,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Sprinkler Tap/Meter Fee",
        "row": 201,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "200",
        "description": "Sprinkler Vault Fee",
        "row": 202,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "300",
        "description": "Site Sprinkler",
        "row": 203,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "400",
        "description": "Building Sprinkler",
        "row": 204,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "500",
        "description": "Spoils",
        "row": 205,
        "defaultQuantity": null,
        "defaultUnit": null
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-2200.00",
    "divisionCode": "22",
    "division": "Plumbing",
    "code": "2200.00",
    "description": "Plumbing",
    "row": 210,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Water Tap/Meter Fee",
        "row": 211,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "200",
        "description": "Sanitary Tap/Meter Fee",
        "row": 212,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "300",
        "description": "Site Plumbing",
        "row": 213,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "400",
        "description": "Site Sanitary",
        "row": 214,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "500",
        "description": "Building Plumbing",
        "row": 215,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "600",
        "description": "Building Sanitary",
        "row": 216,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "700",
        "description": "Spoils",
        "row": 217,
        "defaultQuantity": null,
        "defaultUnit": null
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-2300.00",
    "divisionCode": "23",
    "division": "Mechanical - HVAC",
    "code": "2300.00",
    "description": "HVAC",
    "row": 222,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Equipment",
        "row": 223,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "200",
        "description": "Ductwork",
        "row": 224,
        "defaultQuantity": null,
        "defaultUnit": null
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-2500.00",
    "divisionCode": "25",
    "division": "Integrated Automation",
    "code": "2500.00",
    "description": "Integrated Automation",
    "row": 229,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-2600.00",
    "divisionCode": "26",
    "division": "Electrical",
    "code": "2600.00",
    "description": "Electrical",
    "row": 234,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Meter Fee",
        "row": 235,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "200",
        "description": "Site Electric",
        "row": 236,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "300",
        "description": "Building Electric",
        "row": 237,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "400",
        "description": "Equipment/Fixtures/Devices",
        "row": 238,
        "defaultQuantity": null,
        "defaultUnit": null
      },
      {
        "code": "500",
        "description": "Spoils",
        "row": 239,
        "defaultQuantity": null,
        "defaultUnit": null
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-2700.00",
    "divisionCode": "27",
    "division": "Communications",
    "code": "2700.00",
    "description": "Communication",
    "row": 244,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-2810.00",
    "divisionCode": "28",
    "division": "Electronic Security",
    "code": "2810.00",
    "description": "Security Access",
    "row": 249,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-2831.00",
    "divisionCode": "28",
    "division": "Electronic Security",
    "code": "2831.00",
    "description": "Detention & Alarm",
    "row": 250,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-2840.00",
    "divisionCode": "28",
    "division": "Electronic Security",
    "code": "2840.00",
    "description": "Electronic Control",
    "row": 251,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3100.00",
    "divisionCode": "31",
    "division": "Earthwork",
    "code": "3100.00",
    "description": "Earthwork",
    "row": 256,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3131.16",
    "divisionCode": "31",
    "division": "Earthwork",
    "code": "3131.16",
    "description": "Termite Control",
    "row": 257,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3140.00",
    "divisionCode": "31",
    "division": "Earthwork",
    "code": "3140.00",
    "description": "Shoring & Underpinning",
    "row": 258,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3212.16",
    "divisionCode": "32",
    "division": "Exterior Improvements",
    "code": "3212.16",
    "description": "Asphalt Concrete Pavement",
    "row": 263,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [
      {
        "code": "100",
        "description": "Stone Base",
        "row": 264,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      },
      {
        "code": "200",
        "description": "Asphalt",
        "row": 265,
        "defaultQuantity": 1,
        "defaultUnit": "LS"
      }
    ],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3213.13",
    "divisionCode": "32",
    "division": "Exterior Improvements",
    "code": "3213.13",
    "description": "Concrete Pavement",
    "row": 266,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3214.00",
    "divisionCode": "32",
    "division": "Exterior Improvements",
    "code": "3214.00",
    "description": "Unit Pavers",
    "row": 267,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3216.00",
    "divisionCode": "32",
    "division": "Exterior Improvements",
    "code": "3216.00",
    "description": "Curbs & Gutters",
    "row": 268,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3217.00",
    "divisionCode": "32",
    "division": "Exterior Improvements",
    "code": "3217.00",
    "description": "Pavement Markings",
    "row": 269,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3231.00",
    "divisionCode": "32",
    "division": "Exterior Improvements",
    "code": "3231.00",
    "description": "Fence & Gates",
    "row": 270,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3284.00",
    "divisionCode": "32",
    "division": "Exterior Improvements",
    "code": "3284.00",
    "description": "Irrigation",
    "row": 271,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3292.00",
    "divisionCode": "32",
    "division": "Exterior Improvements",
    "code": "3292.00",
    "description": "Lawn & Grasses",
    "row": 272,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3292.19",
    "divisionCode": "32",
    "division": "Exterior Improvements",
    "code": "3292.19",
    "description": "Seeding",
    "row": 273,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3293.00",
    "divisionCode": "32",
    "division": "Exterior Improvements",
    "code": "3293.00",
    "description": "Trees & Shrubs",
    "row": 274,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  },
  {
    "id": "EST-3340.00",
    "divisionCode": "33",
    "division": "Utilities",
    "code": "3340.00",
    "description": "Storm Drainage",
    "row": 279,
    "defaultQuantity": 1,
    "defaultUnit": "LS",
    "children": [],
    "budgetable": true,
    "calculation": "direct_cost"
  }
];

export type MasterCostCode = {
  categoryCode: string;
  category: string;
  code: string;
  description: string;
  budgetable: boolean;
  calculation: EstimateCalculation;
};

export const MEFFORD_MASTER_COST_CODES: MasterCostCode[] =
  ESTIMATE_TEMPLATE_COST_CODES.map((line) => ({
    categoryCode: line.divisionCode.padStart(3, "0"),
    category: line.division,
    code: line.code,
    description: line.description,
    budgetable: line.budgetable,
    calculation: line.calculation,
  }));

export type EstimateEntry = {
  quantity: number;
  unit: string;
  material: number;
  labor: number;
  equipment: number;
  subcontract: number;
  other: number;
};

export type EstimateSettings = {
  baseProfitRate: number;
  includeBaseProfit: boolean;
  includePerformanceBond: boolean;
  projectManagerBillableRate: number;
  projectManagerCostRate: number;
  superintendentBillableRate: number;
  superintendentCostRate: number;
};

export type EstimateProjectInputs = {
  projectDurationMonths: number;
  distanceToFromJobMiles: number;
  distanceCalculatedMiles: number | null;
  distanceCalculationAddress: string;
  distanceManuallyOverridden: boolean;
  buildingSquareFeet: number;
  cleanupSquareFeet: number;
  cleanupFeeOverride: number | null;
  architecturalFeeOverride: number | null;
};

export type EstimateData = {
  templateVersion: string;
  status: "Draft" | "Ready For Review" | "Approved" | "Awarded";
  entries: Record<string, EstimateEntry>;
  entryOverrides: Record<string, Array<keyof EstimateEntry>>;
  settings: EstimateSettings;
  projectInputs: EstimateProjectInputs;
  cellFormulas: Record<string, string>;
  notes: string;
  savedAt?: string;
  savedBy?: string;
  submittedAt?: string;
  submittedOverrideReport?: EstimateOverrideReportItem[];
  approvedAt?: string;
  approvedBy?: string;
  awardedProjectNumber?: string;
};

export type EstimateOverrideReportItem = {
  lineKey: string;
  code: string;
  description: string;
  changedFields: string[];
  automaticAmount: number;
  enteredAmount: number;
  difference: number;
};

export type EstimateRollup = {
  code: string;
  description: string;
  division: string;
  budgetable: boolean;
  amount: number;
};

export type EstimateSummary = {
  directJobCost: number;
  contractOnlyFees: number;
  baseProfit: number;
  performanceBond: number;
  technologyFee: number;
  materialMarkup: number;
  originalBudget: number;
  contractValue: number;
  grossProfit: number;
  grossMargin: number;
  constructionManagementFees: number;
  insuranceFees: number;
  totalContractorFees: number;
  totalContractorFeeRate: number;
  costPerSquareFoot: number;
  budgetRollups: EstimateRollup[];
  reconciliationDifference: number;
};

export const emptyEstimateEntry = (
  quantity = 1,
  unit = "LS",
): EstimateEntry => ({
  quantity,
  unit,
  material: 0,
  labor: 0,
  equipment: 0,
  subcontract: 0,
  other: 0,
});

export function newEstimateData(): EstimateData {
  return {
    templateVersion: ESTIMATE_TEMPLATE_VERSION,
    status: "Draft",
    entries: {},
    entryOverrides: {},
    settings: {
      baseProfitRate: ESTIMATE_BASE_PROFIT_RATE,
      includeBaseProfit: true,
      includePerformanceBond: false,
      projectManagerBillableRate: 120,
      projectManagerCostRate: 65,
      superintendentBillableRate: 85,
      superintendentCostRate: 45,
    },
    projectInputs: {
      projectDurationMonths: 0,
      distanceToFromJobMiles: 0,
      distanceCalculatedMiles: null,
      distanceCalculationAddress: "",
      distanceManuallyOverridden: false,
      buildingSquareFeet: 0,
      cleanupSquareFeet: 0,
      cleanupFeeOverride: null,
      architecturalFeeOverride: null,
    },
    cellFormulas: {},
    notes: "",
  };
}

function safeAmount(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function estimateEntryTotal(entry?: Partial<EstimateEntry>) {
  return roundMoney(
    safeAmount(entry?.material) +
    safeAmount(entry?.labor) +
    safeAmount(entry?.equipment) +
    safeAmount(entry?.subcontract) +
    safeAmount(entry?.other)
  );
}

export type EstimateFormulaResult = {
  entry: EstimateEntry;
  readOnlyFields: Array<keyof EstimateEntry>;
  formula: string;
};

function withFormula(
  entry: EstimateEntry,
  values: Partial<EstimateEntry>,
  readOnlyFields: Array<keyof EstimateEntry>,
  formula: string,
): EstimateFormulaResult {
  const resolved = { ...entry, ...values };
  resolved.material = roundMoney(resolved.material);
  resolved.labor = roundMoney(resolved.labor);
  resolved.equipment = roundMoney(resolved.equipment);
  resolved.subcontract = roundMoney(resolved.subcontract);
  resolved.other = roundMoney(resolved.other);
  return { entry: resolved, readOnlyFields, formula };
}

const SUBCONTRACT_ROLLUP_FROM_CHILD_OTHER = new Set([
  "0158.00",
  "0300.00",
  "0400.00",
  "0550.00",
  "0611.00",
  "0929.00",
  "2100.00",
  "2200.00",
  "2300.00",
  "2600.00",
  "3212.16",
]);

function calculateSubcontractInsuranceBase(estimate: EstimateData) {
  let total = 0;
  for (const line of ESTIMATE_TEMPLATE_COST_CODES) {
    if (line.calculation !== "direct_cost" || line.code === "0172.00") continue;
    const entries = [
      calculateEstimateEntry(estimate, line.code, undefined, {
        quantity: line.defaultQuantity,
        unit: line.defaultUnit,
      }).entry,
      ...line.children.map((child) => {
        if (line.code === "0142.00" && child.code === "100") {
          return estimate.entries[`${line.code}:${child.code}`]
            ?? emptyEstimateEntry(child.defaultQuantity ?? 0, child.defaultUnit || "LS");
        }
        return calculateEstimateEntry(
          estimate,
          line.code,
          child.code,
          { quantity: child.defaultQuantity, unit: child.defaultUnit },
        ).entry;
      }),
    ];
    entries.forEach((resolved, index) => {
      total += safeAmount(resolved.subcontract);
      if (index > 0 && SUBCONTRACT_ROLLUP_FROM_CHILD_OTHER.has(line.code)) {
        total += safeAmount(resolved.other);
      }
    });
  }
  return total;
}

function calculateConstructionCostBeforeArchitecturalFee(estimate: EstimateData) {
  let total = 0;
  for (const line of ESTIMATE_TEMPLATE_COST_CODES) {
    if (line.calculation !== "direct_cost" || line.code === "0172.00") continue;
    const parent = calculateEstimateEntry(estimate, line.code, undefined, {
      quantity: line.defaultQuantity,
      unit: line.defaultUnit,
    }).entry;
    total += estimateEntryTotal(parent);
    for (const child of line.children) {
      total += estimateEntryTotal(calculateEstimateEntry(estimate, line.code, child.code, {
        quantity: child.defaultQuantity,
        unit: child.defaultUnit,
      }).entry);
    }
  }
  return total;
}

export const ESTIMATE_ENTRY_FIELDS: Array<keyof EstimateEntry> = ["quantity", "unit", "material", "labor", "equipment", "subcontract", "other"];

export function estimateManualFields(estimate: EstimateData, key: string) {
  if (!estimate.entries[key]) return [];
  // Existing saved rows were intentionally treated as complete manual overrides.
  // Preserve those prices until an estimator explicitly restores the formula.
  return estimate.entryOverrides?.[key] ?? ESTIMATE_ENTRY_FIELDS;
}

export function calculateEstimateEntry(
  estimate: EstimateData,
  parentCode: string,
  childCode: string | undefined,
  defaults: { quantity: number | null; unit: string | null },
): EstimateFormulaResult {
  const key = childCode ? `${parentCode}:${childCode}` : parentCode;
  const stored = estimate.entries[key];
  const feeLine = !childCode && ESTIMATE_TEMPLATE_COST_CODES.find(line => line.code === parentCode && line.calculation !== "direct_cost");
  if (feeLine) {
    const summary = calculateEstimateSummary(estimate);
    const total = feeLine.calculation === "base_profit" ? summary.baseProfit : feeLine.calculation === "performance_bond" ? summary.performanceBond : summary.technologyFee;
    const entry = { ...emptyEstimateEntry(defaults.quantity ?? 1, defaults.unit || "LS") };
    for (const field of estimateManualFields(estimate, key)) {
      if (field === "unit") entry.unit = stored.unit;
      else entry[field] = stored[field];
    }
    entry.other = roundMoney(total - feeDetailAmount(estimate, feeLine) - entry.material - entry.labor - entry.equipment - entry.subcontract);
    return { entry, readOnlyFields: [], formula: feeLine.calculation === "base_profit" ? "Cost Subtotal × Base Profit Rate" : feeLine.calculation === "performance_bond" ? "Tiered Bond Rate × Selling Price Before Bond" : "Selling Price Including Bond × Technology Rate" };
  }
  if (stored && !estimate.entryOverrides?.[key]) {
    return { entry: stored, readOnlyFields: [], formula: "Manual Override · Reset To Restore Automatic Formula" };
  }
  const result = calculateAutomaticEntry(estimate, parentCode, childCode, defaults);
  const entry = { ...result.entry };
  for (const field of estimateManualFields(estimate, key)) {
    if (field === "unit") entry.unit = stored.unit;
    else entry[field] = stored[field];
  }
  return { ...result, entry };
}

export function updateEstimateCell(estimate: EstimateData, parentCode: string, childCode: string | undefined,
  defaults: { quantity: number | null; unit: string | null }, field: keyof EstimateEntry, value: string | number): EstimateData {
  const key = childCode ? `${parentCode}:${childCode}` : parentCode;
  const current = { ...calculateEstimateEntry(estimate, parentCode, childCode, defaults).entry };
  if (current[field] === value) return estimate;
  return { ...estimate, entries: { ...estimate.entries, [key]: { ...current, [field]: value } },
    entryOverrides: { ...estimate.entryOverrides, [key]: [...new Set([...estimateManualFields(estimate, key), field])] } };
}

function calculateAutomaticEntry(
  estimate: EstimateData, parentCode: string, childCode: string | undefined,
  defaults: { quantity: number | null; unit: string | null },
): EstimateFormulaResult {
  const key = childCode ? `${parentCode}:${childCode}` : parentCode;
  const stored = estimate.entries[key];
  const entry = emptyEstimateEntry(defaults.quantity ?? 0, defaults.unit || "LS");
  const manualQuantity = estimateManualFields(estimate, key).includes("quantity");
  if (manualQuantity) entry.quantity = stored.quantity;
  const quantityOr = (automatic: number) => manualQuantity ? entry.quantity : automatic;
  const months = safeAmount(estimate.projectInputs.projectDurationMonths);
  const distance = safeAmount(estimate.projectInputs.distanceToFromJobMiles);
  const cleanupSquareFeet = safeAmount(estimate.projectInputs.cleanupSquareFeet);
  const pmBillable = safeAmount(estimate.settings.projectManagerBillableRate);
  const pmCost = safeAmount(estimate.settings.projectManagerCostRate);
  const superBillable = safeAmount(estimate.settings.superintendentBillableRate);
  const superCost = safeAmount(estimate.settings.superintendentCostRate);

  if (key === "0131.00:100") {
    const quantity = quantityOr(months * 80);
    return withFormula(entry, {
      quantity,
      unit: "HR",
      material: 0,
      labor: pmCost * quantity,
      equipment: 0,
      subcontract: 0,
      other: (pmBillable - pmCost) * quantity,
    }, ["quantity", "unit", "material", "labor", "equipment", "subcontract", "other"], "80 Hours × Project Months × Project Manager Rate");
  }
  if (key === "0131.00:200") {
    const quantity = quantityOr((months / 12) * 2080);
    return withFormula(entry, {
      quantity,
      unit: "HR",
      material: 0,
      labor: superCost * quantity,
      equipment: 0,
      subcontract: 0,
      other: (superBillable - superCost) * quantity,
    }, ["quantity", "unit", "material", "labor", "equipment", "subcontract", "other"], "2,080 Annual Hours ÷ 12 × Project Months × Superintendent Rate");
  }
  if (key === "3400.00:100") {
    return withFormula(entry, {
      quantity: 1,
      unit: "LS",
      other: distance * (0.6 * 20 * months) + 1000,
    }, ["quantity", "unit", "other"], "Distance × $0.60 × 20 Trips Per Month × Project Months + $1,000.00");
  }
  if (key === "3400.00:200") {
    return withFormula(entry, { other: safeAmount(entry.quantity) * 250 }, ["other"], "Quantity × $250.00 Lodging Rate");
  }
  if (key === "3400.00:300") {
    return withFormula(entry, { other: safeAmount(entry.quantity) * 65 }, ["other"], "Quantity × $65.00 Meal Rate");
  }
  if (key === "0142.00:100") {
    return withFormula(
      entry,
      { quantity: 1, unit: "LS", other: calculateSubcontractInsuranceBase(estimate) * 0.01 },
      ["quantity", "unit", "other"],
      "1% Of Subcontract Costs",
    );
  }

  const monthlyOtherRates: Record<string, { rate: number; multiplier?: number; label: string }> = {
    "0151.00:100": { rate: 100, label: "Project Months × $100.00 Internet Rate" },
    "0151.00:200": { rate: 250, label: "Project Months × $250.00 Electric Rate" },
    "0151.00:300": { rate: 100, label: "Project Months × $100.00 Water Rate" },
    "0151.00:400": { rate: 500, label: "Project Months × $500.00 Temporary Heat Rate" },
    "0152.00:100": { rate: 1800, label: "Project Months × $1,800.00 Job Trailer Rate" },
    "0152.00:200": { rate: 500, multiplier: 0.5, label: "Project Months ÷ 2 × $500.00 Storage Rate" },
  };
  const monthlyRule = monthlyOtherRates[key];
  if (monthlyRule) {
    const quantity = quantityOr(months * (monthlyRule.multiplier ?? 1));
    return withFormula(entry, { quantity, unit: "MO", other: quantity * monthlyRule.rate }, ["quantity", "unit", "other"], monthlyRule.label);
  }
  if (key === "0152.19") {
    return withFormula(entry, { quantity: quantityOr(months), unit: "MO", other: quantityOr(months) * 120 }, ["quantity", "unit", "other"], "Project Months × $120.00 Temporary Toilet Rate");
  }
  if (key === "0153.00:100") {
    return withFormula(entry, { material: safeAmount(entry.quantity) * 200 }, ["material"], "Quantity × $200.00 Sticky Mat Rate");
  }
  if (key === "0154.00") {
    return withFormula(entry, { material: 1000 }, [], "$1,000.00 Workbook Starting Allowance");
  }
  if (key === "0158.00:100") {
    return withFormula(entry, { other: 400 }, [], "$400.00 Workbook Starting Allowance");
  }
  if (key === "0158.00:200") {
    return withFormula(entry, { other: 250 }, [], "$250.00 Workbook Starting Allowance");
  }
  if (key === "0172.00") {
    const constructionCost = calculateConstructionCostBeforeArchitecturalFee(estimate);
    const override = estimate.projectInputs.architecturalFeeOverride;
    const architecturalFee = override === null ? constructionCost * 0.04 : safeAmount(override);
    return withFormula(
      entry,
      { quantity: 1, unit: "LS", material: 0, labor: 0, equipment: 0, subcontract: 0, other: architecturalFee },
      ["quantity", "unit", "material", "labor", "equipment", "subcontract", "other"],
      override === null
        ? "4% Of Construction Cost Before Architectural Fee"
        : "Authorized Architectural Fee Override",
    );
  }
  if (key === "0174.19") {
    return withFormula(entry, { material: safeAmount(entry.quantity) * 1200 }, ["material"], "Quantity × $1,200.00 Dumpster Rate");
  }
  if (key === "0174.23") {
    const cleanupOverride = estimate.projectInputs.cleanupFeeOverride ?? null;
    const automaticTotal = cleanupSquareFeet * 2;
    const cleanupTotal = cleanupOverride === null ? automaticTotal : safeAmount(cleanupOverride);
    return withFormula(entry, {
      quantity: 1,
      unit: "LS",
      labor: cleanupTotal * 0.75,
      subcontract: cleanupTotal * 0.25,
    }, ["quantity", "unit", "labor", "subcontract"], cleanupOverride === null
      ? "Cleanup Square Feet × $1.50 Labor + $0.50 Subcontract"
      : "Authorized Cleanup Fee Override · 75% Labor / 25% Subcontract");
  }
  if (["0813.00:100", "0813.00:200", "0814.00:100", "0814.00:200"].includes(key)) {
    return withFormula(entry, { labor: safeAmount(entry.quantity) * 97.5 }, ["labor"], "Quantity × $97.50 Mefford Labor Rate");
  }
  if (["0871.00:100", "0871.00:200"].includes(key)) {
    return withFormula(entry, { labor: safeAmount(entry.quantity) * 45 }, ["labor"], "Quantity × $45.00 Mefford Labor Rate");
  }

  return { entry, readOnlyFields: [], formula: "" };
}

export function normalizeEstimateData(value: unknown): EstimateData {
  const incoming = value && typeof value === "object"
    ? (value as Partial<EstimateData>)
    : {};
  const sourceEntries = incoming.entries && typeof incoming.entries === "object"
    ? incoming.entries
    : {};
  const entries = Object.fromEntries(
    Object.entries(sourceEntries).map(([id, rawEntry]) => {
      const entry = rawEntry && typeof rawEntry === "object"
        ? (rawEntry as Partial<EstimateEntry>)
        : {};
      return [id, {
        quantity: safeAmount(entry.quantity),
        unit: String(entry.unit || "LS"),
        material: roundMoney(safeAmount(entry.material)),
        labor: roundMoney(safeAmount(entry.labor)),
        equipment: roundMoney(safeAmount(entry.equipment)),
        subcontract: roundMoney(safeAmount(entry.subcontract)),
        other: roundMoney(safeAmount(entry.other)),
      }];
    }),
  );
  const settings = incoming.settings && typeof incoming.settings === "object"
    ? incoming.settings as Partial<EstimateSettings>
    : {};
  const projectInputs = incoming.projectInputs && typeof incoming.projectInputs === "object"
    ? incoming.projectInputs as Partial<EstimateProjectInputs>
    : {};
  const rawCellFormulas = incoming.cellFormulas && typeof incoming.cellFormulas === "object" && !Array.isArray(incoming.cellFormulas)
    ? incoming.cellFormulas as Record<string, unknown>
    : {};
  const cellFormulas = Object.fromEntries(Object.entries(rawCellFormulas)
    .filter(([key, expression]) => key.length <= 120 && typeof expression === "string" && expression.trim().length > 0)
    .slice(0, 2_000)
    .map(([key, expression]) => [key, String(expression).trim().slice(0, 120)]));
  const status = ["Draft", "Ready For Review", "Approved", "Awarded"].includes(
    String(incoming.status),
  )
    ? incoming.status as EstimateData["status"]
    : "Draft";
  return {
    ...newEstimateData(),
    ...incoming,
    templateVersion: String(incoming.templateVersion || ESTIMATE_TEMPLATE_VERSION),
    status,
    entries,
    entryOverrides: Object.fromEntries(Object.entries(incoming.entryOverrides || {}).filter(([key, fields]) => Boolean(entries[key]) && Array.isArray(fields)).map(([key, fields]) => [key, [...new Set(fields.filter(field => ESTIMATE_ENTRY_FIELDS.includes(field)))]])),
    cellFormulas,
    settings: {
      baseProfitRate: safeAmount(settings.baseProfitRate ?? ESTIMATE_BASE_PROFIT_RATE),
      includeBaseProfit: settings.includeBaseProfit !== false,
      includePerformanceBond: settings.includePerformanceBond === true,
      projectManagerBillableRate: roundMoney(safeAmount(settings.projectManagerBillableRate ?? 120)),
      projectManagerCostRate: roundMoney(safeAmount(settings.projectManagerCostRate ?? 65)),
      superintendentBillableRate: roundMoney(safeAmount(settings.superintendentBillableRate ?? 85)),
      superintendentCostRate: roundMoney(safeAmount(settings.superintendentCostRate ?? 45)),
    },
    projectInputs: {
      projectDurationMonths: safeAmount(projectInputs.projectDurationMonths),
      distanceToFromJobMiles: safeAmount(projectInputs.distanceToFromJobMiles),
      distanceCalculatedMiles:
        projectInputs.distanceCalculatedMiles === null || projectInputs.distanceCalculatedMiles === undefined
          ? null
          : safeAmount(projectInputs.distanceCalculatedMiles),
      distanceCalculationAddress: String(projectInputs.distanceCalculationAddress || "").slice(0, 300),
      distanceManuallyOverridden: projectInputs.distanceManuallyOverridden === true || (
        safeAmount(projectInputs.distanceToFromJobMiles) > 0 &&
        (projectInputs.distanceCalculatedMiles === null || projectInputs.distanceCalculatedMiles === undefined) &&
        !String(projectInputs.distanceCalculationAddress || "").trim()
      ),
      buildingSquareFeet: safeAmount(projectInputs.buildingSquareFeet),
      cleanupSquareFeet: safeAmount(projectInputs.cleanupSquareFeet),
      cleanupFeeOverride:
        projectInputs.cleanupFeeOverride === null || projectInputs.cleanupFeeOverride === undefined
          ? null
          : roundMoney(safeAmount(projectInputs.cleanupFeeOverride)),
      architecturalFeeOverride:
        projectInputs.architecturalFeeOverride === null || projectInputs.architecturalFeeOverride === undefined
          ? null
          : roundMoney(safeAmount(projectInputs.architecturalFeeOverride)),
    },
    notes: String(incoming.notes || ""),
  };
}

export function performanceBondAmount(subtotal: number) {
  const value = safeAmount(subtotal);
  if (value <= 100_000) return roundMoney(value * 0.025);
  if (value <= 500_000) return roundMoney(2_500 + (value - 100_000) * 0.015);
  return roundMoney(8_500 + (value - 500_000) * 0.01);
}

function feeDetailAmount(estimate: EstimateData, line: EstimateTemplateCostCode) {
  // Previously saved fee detail rows were ignored by the old engine. Keep their
  // approved price unchanged until a person edits that detail in the new editor.
  return roundMoney(line.children.reduce((total, child) => {
    const key = `${line.code}:${child.code}`;
    return total + (estimate.entryOverrides[key] ? estimateEntryTotal(calculateEstimateEntry(estimate, line.code, child.code, { quantity: child.defaultQuantity, unit: child.defaultUnit }).entry) : 0);
  }, 0));
}

function resolveFeeAmount(estimate: EstimateData, calculation: string, automatic: number) {
  const line = ESTIMATE_TEMPLATE_COST_CODES.find(item => item.calculation === calculation);
  if (!line) return automatic;
  const stored = estimate.entries[line.code];
  const manual = estimateManualFields(estimate, line.code);
  return roundMoney(feeDetailAmount(estimate, line) + ["material", "labor", "equipment", "subcontract", "other"].reduce((total, field) =>
    total + (manual.includes(field as keyof EstimateEntry) ? safeAmount(stored?.[field as keyof EstimateEntry]) : field === "other" ? automatic : 0), 0));
}

export function calculateEstimateSummary(value: unknown): EstimateSummary {
  const estimate = normalizeEstimateData(value);
  const rollups: EstimateRollup[] = [];
  let directJobCost = 0;
  let contractOnlyFees = 0;
  let materialMarkupBase = 0;

  for (const line of ESTIMATE_TEMPLATE_COST_CODES) {
    if (line.calculation !== "direct_cost") continue;
    const entryIds = [
      { key: line.code, childCode: undefined, quantity: line.defaultQuantity, unit: line.defaultUnit },
      ...line.children.map((child) => ({ key: `${line.code}:${child.code}`, childCode: child.code, quantity: child.defaultQuantity, unit: child.defaultUnit })),
    ];
    const resolvedEntries = entryIds.map((item) => calculateEstimateEntry(
        estimate,
        line.code,
        item.childCode,
        { quantity: item.quantity, unit: item.unit },
      ).entry);
    const amount = roundMoney(resolvedEntries.reduce(
      (total, entry) => total + estimateEntryTotal(entry),
      0,
    ));
    if (line.divisionCode !== "01") {
      materialMarkupBase = roundMoney(materialMarkupBase + resolvedEntries.reduce(
        (total, entry) => total + safeAmount(entry.material),
        0,
      ));
    }
    if (line.budgetable) directJobCost = roundMoney(directJobCost + amount);
    else contractOnlyFees = roundMoney(contractOnlyFees + amount);
    if (amount !== 0 && line.budgetable) {
      rollups.push({
        code: line.code,
        description: line.description,
        division: `${line.divisionCode.padStart(3, "0")} - ${line.division}`,
        budgetable: true,
        amount,
      });
    }
  }

  const baseProfit = resolveFeeAmount(estimate, "base_profit", estimate.settings.includeBaseProfit
      ? roundMoney((directJobCost + contractOnlyFees) * estimate.settings.baseProfitRate)
      : 0);
  const preBondSellingPrice = roundMoney(directJobCost + contractOnlyFees + baseProfit);
  const performanceBond = resolveFeeAmount(estimate, "performance_bond", estimate.settings.includePerformanceBond
      ? performanceBondAmount(preBondSellingPrice)
      : 0);
  const technologyRate = estimate.settings.includePerformanceBond
    ? ESTIMATE_TECHNOLOGY_RULES.withBondRate
    : ESTIMATE_TECHNOLOGY_RULES.withoutBondRate;
  const technologyBase = roundMoney(preBondSellingPrice + performanceBond);
  const technologyFee = resolveFeeAmount(estimate, "technology_fee", roundMoney(technologyBase * technologyRate));
  const materialMarkup = roundMoney(materialMarkupBase * 0.1);
  const originalBudget = roundMoney(directJobCost + performanceBond);
  if (performanceBond !== 0) {
    const bondLine = ESTIMATE_TEMPLATE_COST_CODES.find(
      (line) => line.calculation === "performance_bond",
    );
    if (bondLine) {
      rollups.push({
        code: bondLine.code,
        description: bondLine.description,
        division: `${bondLine.divisionCode.padStart(3, "0")} - ${bondLine.division}`,
        budgetable: true,
        amount: performanceBond,
      });
    }
  }
  const contractValue = roundMoney(originalBudget + contractOnlyFees + baseProfit + technologyFee);
  const grossProfit = roundMoney(contractValue - originalBudget);
  const grossMargin = contractValue > 0 ? grossProfit / contractValue : 0;
  const constructionManagementFees = rollups.find((rollup) => rollup.code === "0131.00")?.amount || 0;
  const insuranceFees = rollups.find((rollup) => rollup.code === "0142.00")?.amount || 0;
  const totalContractorFees = roundMoney(baseProfit + technologyFee + constructionManagementFees + insuranceFees);
  const totalContractorFeeRate = contractValue > 0 ? totalContractorFees / contractValue : 0;
  const costPerSquareFoot = estimate.projectInputs.buildingSquareFeet > 0
    ? roundMoney(contractValue / estimate.projectInputs.buildingSquareFeet)
    : 0;
  const rollupTotal = rollups.reduce((total, rollup) => total + rollup.amount, 0);

  return {
    directJobCost,
    contractOnlyFees,
    baseProfit,
    performanceBond,
    technologyFee,
    materialMarkup,
    originalBudget,
    contractValue,
    grossProfit,
    grossMargin,
    constructionManagementFees,
    insuranceFees,
    totalContractorFees,
    totalContractorFeeRate,
    costPerSquareFoot,
    budgetRollups: rollups,
    reconciliationDifference: roundMoney(originalBudget - rollupTotal),
  };
}

export function estimateOverrideReport(value: unknown): EstimateOverrideReportItem[] {
  const estimate = normalizeEstimateData(value);
  const report: EstimateOverrideReportItem[] = [];
  const amountFields: Array<"material" | "labor" | "equipment" | "subcontract" | "other"> = ["material", "labor", "equipment", "subcontract", "other"];
  const fieldLabel: Record<keyof EstimateEntry, string> = {
    quantity: "Quantity",
    unit: "Unit",
    material: "Material",
    labor: "Mefford Labor",
    equipment: "Equipment",
    subcontract: "Subcontract",
    other: "Other",
  };

  for (const line of ESTIMATE_TEMPLATE_COST_CODES) {
    const rows = [
      { key: line.code, code: line.code, description: line.description, childCode: undefined, quantity: line.defaultQuantity, unit: line.defaultUnit },
      ...line.children.map((child) => ({ key: `${line.code}:${child.code}`, code: `${line.code} · ${child.code}`, description: child.description, childCode: child.code, quantity: child.defaultQuantity, unit: child.defaultUnit })),
    ];
    for (const row of rows) {
      if (!estimate.entries[row.key]) continue;
      const entered = calculateEstimateEntry(estimate, line.code, row.childCode, { quantity: row.quantity, unit: row.unit }).entry;
      const entries = { ...estimate.entries };
      delete entries[row.key];
      const automaticEstimate = { ...estimate, entries };
      const automaticFormula = calculateEstimateEntry(automaticEstimate, line.code, row.childCode, { quantity: row.quantity, unit: row.unit });
      const automatic = automaticFormula.entry;
      const isAutomatic = Boolean(automaticFormula.formula);
      if (!isAutomatic) continue;
      const changedFields: string[] = [];
      if (entered.quantity !== automatic.quantity) changedFields.push(fieldLabel.quantity);
      if (entered.unit !== automatic.unit) changedFields.push(fieldLabel.unit);
      for (const field of amountFields) {
        if (Math.abs(entered[field] - automatic[field]) > 0.005) changedFields.push(fieldLabel[field]);
      }
      if (!changedFields.length) continue;
      const automaticAmount = estimateEntryTotal(automatic);
      const enteredAmount = estimateEntryTotal(entered);
      report.push({
        lineKey: row.key,
        code: row.code,
        description: row.description,
        changedFields,
        automaticAmount,
        enteredAmount,
        difference: roundMoney(enteredAmount - automaticAmount),
      });
    }
  }
  for (const [field, code, description] of [
    ["cleanupFeeOverride", "0174.23", "Cleanup Fee Override"],
    ["architecturalFeeOverride", "0172.00", "Architectural Fee Override"],
  ] as const) {
    if (estimate.projectInputs[field] === null) continue;
    const baseline = { ...estimate, projectInputs: { ...estimate.projectInputs, [field]: null } };
    const automaticAmount = estimateEntryTotal(calculateEstimateEntry(baseline, code, undefined, { quantity: 1, unit: "LS" }).entry);
    const enteredAmount = estimateEntryTotal(calculateEstimateEntry(estimate, code, undefined, { quantity: 1, unit: "LS" }).entry);
    report.push({ lineKey: `projectInputs.${field}`, code, description, changedFields: ["Fee Setting"], automaticAmount, enteredAmount, difference: roundMoney(enteredAmount - automaticAmount) });
  }
  const defaults = newEstimateData().settings;
  for (const field of ["projectManagerBillableRate", "projectManagerCostRate", "superintendentBillableRate", "superintendentCostRate", "baseProfitRate"] as const) {
    if (estimate.settings[field] === defaults[field]) continue;
    const automaticAmount = calculateEstimateSummary({ ...estimate, settings: { ...estimate.settings, [field]: defaults[field] } }).contractValue;
    const enteredAmount = calculateEstimateSummary(estimate).contractValue;
    report.push({ lineKey: `settings.${field}`, code: "SETUP", description: `${field.replace(/([A-Z])/g, " $1")} · contract impact`, changedFields: [`${defaults[field]} → ${estimate.settings[field]}`], automaticAmount, enteredAmount, difference: roundMoney(enteredAmount - automaticAmount) });
  }
  return report;
}
