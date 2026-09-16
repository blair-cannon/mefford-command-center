import { currentAccountNumber, ACCOUNT_NUMBER_RANGES } from "../lib/accounting-numbering";

export type AccountingBalance = "Debit" | "Credit";

export type LedgerAccountSeed = {
  accountNumber: string;
  legacyAccountNumber?: string;
  isSystemControl?: boolean;
  legacyName: string;
  category: string;
  normalBalance: AccountingBalance;
  defaultStatus: "Pending Review" | "Inactive" | "Active";
};

type AccountGroup = {
  category: string;
  normalBalance: AccountingBalance;
  rows: string;
};

const inactiveLegacyAccounts = new Set(["103", "435", "655"]);

const commandCenterAccountGroups: AccountGroup[] = [
  { category: "System Control / Clearing", normalBalance: "Credit", rows: `
495|Owner Billing Control
498|Payroll Clearing` },
  {
    category: "Cash Accounts",
    normalBalance: "Debit",
    rows: `
100|Farmers Bank Checking
101|KY Bank Checking
102|Cash Clear
103|Do Not Use
104|Republic Checking
105|EJ Operating Acct
106|EJ Interest Acct
107|Heritage MM
108|CVNB Checking
109|Bank Of The Bluegrass
110|Heritage Bank`,
  },
  {
    category: "Current Assets",
    normalBalance: "Debit",
    rows: `
111|Accounts Receivable
114|Net Costs/Billings In Excess
115|Receivable EEAT
129|Receivable: Jordan Personal
130|Receivable: Rockhouse
131|Receivable: Redline
132|Inter-Company Receivables
133|Receivable: SubGrade
134|Receivable Exdredis
135|Employee Loans
136|Receivable: Blackwood
137|Receivable MPPM
138|Receivable Meffcomm
139|Receivable Mefford SP
140|Prepaid Taxes
141|Prepaid Insurance
142|Receivable 400 N Lime
143|Receivable Plan Accordingly
144|Receivable: M Stuff LLC
145|Receivable: BCSC
146|Investment: 109 Fieldview LLC
147|Receivable: VEIG
148|Receivable: Snakey Holler
149|Receivable: LJLI
150|Suspense
151|Escrow
152|Pre-Paid Legal
153|Investment: Rickhouse Hotel
154|R&S And SBG
155|Danville Hotel`,
  },
  {
    category: "WIP Assets",
    normalBalance: "Debit",
    rows: `
160|WIP Payroll
161|WIP 109 Fieldview`,
  },
  {
    category: "Other Assets",
    normalBalance: "Debit",
    rows: `
189|Investment In Horse
190|Investment In MPPM
191|Financing Fees
192|Investment In Rock House Brew
193|Investment In SBG
194|Investment: KY Indoor Soccer
195|Receivable MREH
196|Receivable: NRLI
197|Receivable: R Walsh Comm Adv
198|Receivable: 948 Enterprise LLC
199|Receivable: Stratin Forge`,
  },
  {
    category: "Fixed Assets",
    normalBalance: "Debit",
    rows: `
210|Construction Equipment
211|Company Vehicles
215|Office Equipment
220|Inventory
221|Land: 1585 Mercer Road
222|Building: 1585 Mercer Road
223|Land: 109 Fieldview Drive
224|Building: 109 Fieldview Drive
225|Land: Carrollton Office
226|Building: Carrollton Office
227|Improvements: Mercer Suite 120
260|Computers
270|Improvements: Mercer Suite 130
277|Land: 400 North Lime
278|Building: 400 North Lime
279|Improvements: 400 Lime
280|Land: Brannon Crossing
282|Land: Overlook Drive
283|Land: 222 Front Street
284|Building: 222 Front Street
285|Land: VEIG
286|Building: VEIG
298|Cardwell Apartments
299|Goodwill`,
  },
  {
    category: "Accumulated Depreciation",
    normalBalance: "Credit",
    rows: `
355|Accumulated Dep
356|Accum. Amortization`,
  },
  {
    category: "Current Liabilities",
    normalBalance: "Credit",
    rows: `
400|Nicholasville
402|Accounts Payable
403|Simple IRA
404|Social Security Payable
405|Federal Withheld
406|Kentucky Withheld
407|Lexington Withheld
408|Carrollton Withheld
409|Fayette Co Withheld
410|Simple Match Payable
411|FUTA Withheld
412|SUTA Withheld
413|Chase
414|IL Withholdings Payable
415|Ramp Credit Card
416|City Of Union
417|Jessamine Co
418|Louisville Withheld
419|Milton WH
420|Crestwood WH
421|Gallatin Co Withholding
422|Scott Co
423|Covington WH
424|Kenton County WH
425|Johnson County WH
426|Loan From Porchlight Properties
427|CUB LOC (Max 250K)
428|Clark Co WH (Was Lincoln)
429|Stanford WH
430|OH Garnishment
431|Wage Garnishment
432|Batavia
433|New Richmond WH
434|Boyle Co Withholding
435|Republic LOC (250,000)
436|City Of Danville Withholding
437|Boone Co Withheld
438|Boone Mental Health Tax
439|Mt Orab WH
440|Versailles Withheld
441|Woodford Co Withheld
442|Ohio
443|Indiana WH
444|Tenant Deposits
445|Payable MPPM
446|Bath County
447|Chris Lehmkuhl Loan
448|WC Payable
449|Payable Plan Accordingly`,
  },
  {
    category: "Long Term Liabilities",
    normalBalance: "Credit",
    rows: `
450|NP CUB Land
451|NP CUB (Mefford)
452|NP 5th 3rd
453|Republic Mercer Fit Up
454|NP Wells Fargo
455|PPP
456|Farmers
457|Republic 250,000
458|DJM Loan
459|Farmers Loan
460|Republic $206,000.00 Note
461|Farmers *6291
462|Lance Sizemore
463|SBA EIDL $500,000.00
464|Ally Bank NP *25004
465|Ally Bank NP *75075
466|Ally Bank NP *35812
467|CVNB LOC
468|Tesla Model Y
469|CVNB Loan
470|First National Loan
471|Loan: Huntington Bank (Piles)
472|NP: City Of Versailles
473|Loan: Cardwell Avenue
474|Payable: Jarrod Williams
475|Payable: Meffcon
476|Payable: MREH
477|Payable: LJLI
478|Loan: Front Street
479|Loan: Meffcomm
480|Loan: 400 N Lime
481|Payable: M Stuff
482|Ally Bank
483|Stellantis
484|Community Trust
485|Huntington Bank
486|Stellantis
487|Ally Bank (VIN 571880)
488|Ally Bank (VIN 596658)
489|Huntington Bank (VIN 73318)
490|Payable: 948 Enterprise Drive
491|Heritage LOC`,
  },
  {
    category: "Equity",
    normalBalance: "Credit",
    rows: `
550|DJM Equity
551|DRM Equity
552|ECM Equity
554|M Stuff Equity
555|Opening Balance Equity
560|Retained Earnings
561|Chris Lehmkuhl Equity
566|Single Barrel Group Equity`,
  },
  {
    category: "Owners Drawing",
    normalBalance: "Debit",
    rows: `
570|DJM Draws
571|DRM Draws
572|ECM Draws
574|M Stuff Draws
581|C Lehmkuhl Draws
586|Single Barrel Group Draws`,
  },
  {
    category: "Operating Income",
    normalBalance: "Credit",
    rows: `
601|Construction Income
602|Over/Under
603|Rental Income
604|Architectural Income
605|Leased Employee Income
606|Management Fees
640|Finance Charges
641|Discounts Given
642|Discounts Earned`,
  },
  {
    category: "Other Income",
    normalBalance: "Credit",
    rows: `
650|Forgiveness Of Debt
651|Subsidiary Profit/Loss - MPPM
652|Gain/Loss On Sale
653|CC Points
654|Interest Earned
655|Leased Employee Income
656|Rental Income
657|Dividend Income
658|Equity In MPPM Income`,
  },
  {
    category: "Direct Expense",
    normalBalance: "Debit",
    rows: `
702|Job Materials
703|Subcontractors
704|Other Construction Cost
705|Equipment Rental
706|Warranty
707|Fuel/Vehicle
709|COGS Officer Salary
710|COGS Commissions
711|Property Management
729|COGS Wages
730|COGS Benefits
731|COGS Bonus
787|COGS Payroll Taxes
788|COGS & W/C Insurance`,
  },
  {
    category: "Overhead Expense",
    normalBalance: "Debit",
    rows: `
809|Officer Salary
829|Salaries & Wages
830|Bonus
832|Simple Match
833|Contract Labor
834|Leased Employees
845|Bank Fees
848|Charity
849|Laborer Bonus
850|Consulting
851|Professional Fees
852|Fuel
853|Vehicles
854|Advertising
855|Payroll Services
856|Vehicle Lease
857|Commissions
858|Bid And Proposals
860|Service Charges
861|Life, LTD & STD
870|Training/Education
875|Bad Debt
878|Depreciation Expense
879|Amortization Expense
880|Dues & Subscriptions
883|Meals
884|Staff Events
887|Payroll Taxes
890|Charitable Contribution
904|EE Health Insurance
905|General Liability Insurance
906|Workers Comp Insurance
908|Property Insurance
910|License Fees & Permits
911|State Taxes
912|Local Taxes
913|Property Taxes
914|Fines
916|Lawn Services
917|Meetings & Corporate Events
918|Office Supplies
919|Software
923|Janitorial / Cleaning Fees
924|Postage
925|Hiring Fees
926|Moving
927|Leased Equipment
928|Rent
929|IT & Computer Repair
930|Repairs & Maintenance
932|Safety & OSHA Expense
935|Small Tools
938|Operating Supplies
941|Phone Expense
942|Travel
943|Unemployment Tax
945|Utilities
946|Dumpster
947|Pest Control
950|PO Sales Tax`,
  },
  {
    category: "Administrative Expense",
    normalBalance: "Debit",
    rows: `
955|Loss (Gain) On S-Corp
960|Misc Expense
961|Loss On Sale Of Equipment
975|Interest Expense`,
  },
  {
    category: "After Tax Income Expense",
    normalBalance: "Debit",
    rows: `
976|Penalty
977|Officer Life & Disability`,
  },
];

export const COMMAND_CENTER_CHART_OF_ACCOUNTS: LedgerAccountSeed[] =
  commandCenterAccountGroups.flatMap((group) =>
    group.rows
      .trim()
      .split("\n")
      .map((row) => {
        const [accountNumber, legacyName] = row.split("|");
        return {
          accountNumber: currentAccountNumber(accountNumber),
          legacyAccountNumber: accountNumber,
          isSystemControl: group.category === "System Control / Clearing",
          legacyName,
          category: group.category,
          normalBalance: group.normalBalance,
          defaultStatus: group.category === "System Control / Clearing" ? "Active" : inactiveLegacyAccounts.has(accountNumber)
            ? "Inactive"
            : "Pending Review",
        };
      }),
  );

export const ACCOUNTING_CATEGORIES = ACCOUNT_NUMBER_RANGES.map(range => range.category);

export const COMMAND_CENTER_ACCOUNT_TOTAL = COMMAND_CENTER_CHART_OF_ACCOUNTS.length;
