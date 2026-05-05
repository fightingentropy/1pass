// UK pension tax-relief calculator core.
//
// Pure functions — no DOM access, no I/O. The Solid UI feeds CalculatorInput
// in and renders CalculatorResult out. All tax bands and rates are inputs so
// the page stays correct when HMRC moves things.

export type EmploymentMode = "employed" | "selfEmployed" | "cis";

export type ContributionMethod =
  | "ras"              // Relief at source (workplace) — net out, provider grosses up
  | "netPay"           // Net pay arrangement — deducted from gross before income tax
  | "salarySacrifice"  // Salary sacrifice — gross pay reduced before income tax & NI
  | "sipp";            // Manual SIPP — same mechanics as RAS

export type ContributionBasis = "net" | "gross";

export type TaxBands = {
  personalAllowance: number;
  basicRateThreshold: number;        // income at which basic rate begins (= PA in UK)
  higherRateThreshold: number;       // income at which higher rate begins
  additionalRateThreshold: number;   // income at which additional rate begins
  basicRate: number;                 // 0..1
  higherRate: number;                // 0..1
  additionalRate: number;            // 0..1
  paTaperStart: number;              // income at which PA begins to taper (UK: £100k)
  paTaperRate: number;               // 0..1 — fraction of PA lost per £1 over taper start
};

export const DEFAULT_TAX_BANDS: TaxBands = {
  personalAllowance: 12_570,
  basicRateThreshold: 12_570,
  higherRateThreshold: 50_270,
  additionalRateThreshold: 125_140,
  basicRate: 0.2,
  higherRate: 0.4,
  additionalRate: 0.45,
  paTaperStart: 100_000,
  paTaperRate: 0.5,
};

export type NIBands = {
  primaryThreshold: number;
  upperEarningsLimit: number;
  mainRate: number;   // 0..1 — employee Class 1 main rate
  upperRate: number;  // 0..1 — rate above UEL
};

export const DEFAULT_NI_BANDS: NIBands = {
  primaryThreshold: 12_570,
  upperEarningsLimit: 50_270,
  mainRate: 0.08,
  upperRate: 0.02,
};

export type CalculatorInput = {
  mode: EmploymentMode;
  grossIncome: number;
  businessExpenses: number;          // self-employed/CIS only
  cisDeductionRate: number;          // 0..1 — CIS only
  contributionMethod: ContributionMethod;
  contributionBasis: ContributionBasis;
  contributionAmount: number;
  employerContributionPercent: number;  // 0..100
  employerMatchPercent: number;         // 0..100 — informational only
  bands: TaxBands;
  niBands: NIBands;
  includeNI: boolean;
  potValue: number;
  taxFreeLumpSumPercent: number;     // 0..1
  annualWithdrawal: number;
  otherRetirementIncome: number;
  retirementPersonalAllowance: number;
  age: number;
};

export const DEFAULT_INPUT: CalculatorInput = {
  mode: "employed",
  grossIncome: 70_000,
  businessExpenses: 0,
  cisDeductionRate: 0.2,
  contributionMethod: "ras",
  contributionBasis: "gross",
  contributionAmount: 3_500,
  employerContributionPercent: 3,
  employerMatchPercent: 5,
  bands: { ...DEFAULT_TAX_BANDS },
  niBands: { ...DEFAULT_NI_BANDS },
  includeNI: true,
  potValue: 100_000,
  taxFreeLumpSumPercent: 0.25,
  annualWithdrawal: 12_000,
  otherRetirementIncome: 0,
  retirementPersonalAllowance: 12_570,
  age: 40,
};

// PA tapers by £1 for every £2 over the taper start (UK default).
export function effectivePersonalAllowance(
  adjustedNetIncome: number,
  bands: TaxBands,
): number {
  if (adjustedNetIncome <= bands.paTaperStart) return bands.personalAllowance;
  const reduction =
    (adjustedNetIncome - bands.paTaperStart) * bands.paTaperRate;
  return Math.max(0, bands.personalAllowance - reduction);
}

export type IncomeTaxBreakdown = {
  total: number;
  inBasic: number;
  inHigher: number;
  inAdditional: number;
  effectivePA: number;
  basicTax: number;
  higherTax: number;
  additionalTax: number;
};

export type IncomeTaxOptions = {
  // Gross pension contribution that extends the basic-rate band (RAS/SIPP).
  bandExtension?: number;
  // Skip PA taper / use a fixed allowance (retirement scenarios).
  overridePA?: number;
};

export function calculateIncomeTax(
  taxableIncome: number,
  bands: TaxBands,
  options: IncomeTaxOptions = {},
): IncomeTaxBreakdown {
  const effectivePA =
    options.overridePA ?? effectivePersonalAllowance(taxableIncome, bands);
  const extension = options.bandExtension ?? 0;

  const basicBandSize =
    Math.max(0, bands.higherRateThreshold - bands.basicRateThreshold) +
    extension;
  const higherBandSize = Math.max(
    0,
    bands.additionalRateThreshold - bands.higherRateThreshold,
  );

  const afterPA = Math.max(0, taxableIncome - effectivePA);
  const inBasic = Math.min(afterPA, basicBandSize);
  const remainingAfterBasic = afterPA - inBasic;
  const inHigher = Math.min(remainingAfterBasic, higherBandSize);
  const inAdditional = Math.max(0, remainingAfterBasic - inHigher);

  const basicTax = inBasic * bands.basicRate;
  const higherTax = inHigher * bands.higherRate;
  const additionalTax = inAdditional * bands.additionalRate;

  return {
    total: basicTax + higherTax + additionalTax,
    inBasic,
    inHigher,
    inAdditional,
    effectivePA,
    basicTax,
    higherTax,
    additionalTax,
  };
}

export function calculateNI(income: number, niBands: NIBands): number {
  if (income <= niBands.primaryThreshold) return 0;
  const inMain = Math.min(
    income - niBands.primaryThreshold,
    Math.max(0, niBands.upperEarningsLimit - niBands.primaryThreshold),
  );
  const inUpper = Math.max(0, income - niBands.upperEarningsLimit);
  return inMain * niBands.mainRate + inUpper * niBands.upperRate;
}

export type ContributionBreakdown = {
  netContribution: number;     // out-of-pocket from take-home (RAS/SIPP) or 0 conceptually
  grossContribution: number;   // total reaching the pension pot from employee
  governmentTopUp: number;     // explicit RAS basic-rate top-up; 0 for NPA/SS
};

// Resolves the user's input amount + basis + method into a fully-grossed-up
// breakdown of net contribution / gross contribution / RAS top-up.
export function resolveContribution(
  method: ContributionMethod,
  basis: ContributionBasis,
  amount: number,
  basicRate: number,
): ContributionBreakdown {
  const safe = Math.max(0, amount);
  if (method === "ras" || method === "sipp") {
    if (basis === "net") {
      const net = safe;
      const gross = basicRate >= 1 ? net : net / (1 - basicRate);
      return {
        netContribution: net,
        grossContribution: gross,
        governmentTopUp: gross - net,
      };
    }
    const gross = safe;
    const net = gross * (1 - basicRate);
    return {
      netContribution: net,
      grossContribution: gross,
      governmentTopUp: gross - net,
    };
  }
  // Net pay / salary sacrifice — entered amount is the gross pre-tax deduction.
  return {
    netContribution: safe,
    grossContribution: safe,
    governmentTopUp: 0,
  };
}

export type ScenarioBreakdown = {
  grossIncome: number;
  businessExpenses: number;
  taxableIncome: number;          // figure the income-tax calc was run against
  effectivePA: number;
  incomeTax: IncomeTaxBreakdown;
  nationalInsurance: number;
  cisDeducted: number;
  refundOrBalance: number;        // negative = refund due back, positive = balance owed
  pensionOutOfPocket: number;     // money the user paid out of post/pre-tax pay
  netCashPosition: number;        // cash the user keeps in their pocket after everything
  inHigherBand: boolean;
};

function computeScenario(
  input: CalculatorInput,
  contribution: ContributionBreakdown | null,
): ScenarioBreakdown {
  const isSelfEmployedOrCIS =
    input.mode === "selfEmployed" || input.mode === "cis";
  const expenses = isSelfEmployedOrCIS ? Math.max(0, input.businessExpenses) : 0;

  let grossForTax = isSelfEmployedOrCIS
    ? input.grossIncome - expenses
    : input.grossIncome;
  let bandExtension = 0;
  let pensionOutOfPocket = 0;
  let niableAdjustment = 0;

  if (contribution) {
    if (
      input.contributionMethod === "netPay" ||
      input.contributionMethod === "salarySacrifice"
    ) {
      grossForTax -= contribution.grossContribution;
      pensionOutOfPocket = contribution.grossContribution;
      if (input.contributionMethod === "salarySacrifice") {
        niableAdjustment = contribution.grossContribution;
      }
    } else {
      // ras / sipp — gross contribution extends the basic-rate band.
      bandExtension = contribution.grossContribution;
      pensionOutOfPocket = contribution.netContribution;
    }
  }

  const taxableIncome = Math.max(0, grossForTax);
  const incomeTax = calculateIncomeTax(taxableIncome, input.bands, {
    bandExtension,
  });

  const niable = Math.max(0, input.grossIncome - niableAdjustment);
  const nationalInsurance =
    input.mode === "employed" && input.includeNI
      ? calculateNI(niable, input.niBands)
      : 0;

  const cisDeducted =
    input.mode === "cis"
      ? Math.max(0, input.grossIncome) * Math.max(0, input.cisDeductionRate)
      : 0;

  const refundOrBalance = incomeTax.total - cisDeducted;

  const netCashPosition =
    input.grossIncome -
    expenses -
    incomeTax.total -
    nationalInsurance -
    pensionOutOfPocket;

  return {
    grossIncome: input.grossIncome,
    businessExpenses: expenses,
    taxableIncome,
    effectivePA: incomeTax.effectivePA,
    incomeTax,
    nationalInsurance,
    cisDeducted,
    refundOrBalance,
    pensionOutOfPocket,
    netCashPosition,
    inHigherBand: incomeTax.inHigher > 0 || incomeTax.inAdditional > 0,
  };
}

// Self Assessment-claimable relief = tax saved by extending the basic-rate
// band. The basic-rate piece is already claimed at source by the provider, so
// what's left is the higher- and additional-rate uplift.
function computeHigherRateRelief(
  input: CalculatorInput,
  contribution: ContributionBreakdown,
): number {
  if (
    contribution.grossContribution === 0 ||
    (input.contributionMethod !== "ras" && input.contributionMethod !== "sipp")
  ) {
    return 0;
  }

  const isSelfEmployedOrCIS =
    input.mode === "selfEmployed" || input.mode === "cis";
  const expenses = isSelfEmployedOrCIS ? Math.max(0, input.businessExpenses) : 0;
  const grossForTax = isSelfEmployedOrCIS
    ? input.grossIncome - expenses
    : input.grossIncome;

  const taxWithout = calculateIncomeTax(grossForTax, input.bands);
  const taxWith = calculateIncomeTax(grossForTax, input.bands, {
    bandExtension: contribution.grossContribution,
  });

  return Math.max(0, taxWithout.total - taxWith.total);
}

export type ContributionResult = ContributionBreakdown & {
  higherRateRelief: number;        // SA-claimable HR/AR uplift
  employerContribution: number;
  totalAddedToPension: number;     // employee gross + employer
  effectiveCost: number;           // net out-of-pocket cost = withoutCash - withCash
  valueRatio: number;              // totalAddedToPension / effectiveCost (Infinity when free)
};

export type WithdrawalResult = {
  totalPot: number;
  taxFreeLumpSum: number;
  taxablePot: number;
  annualWithdrawal: number;
  annualTaxFreePortion: number;     // UFPLS view
  annualTaxablePortion: number;     // UFPLS view
  otherIncome: number;
  totalTaxableInRetirement: number;
  effectivePA: number;
  taxOnTotalRetirementIncome: number;
  incrementalTaxFromWithdrawal: number;  // tax attributable to the withdrawal alone
  netAnnualWithdrawal: number;
  effectiveTaxRate: number;
  ageAccessAvailable: boolean;
  ageThreshold: number;
};

function computeWithdrawal(input: CalculatorInput): WithdrawalResult {
  const totalPot = Math.max(0, input.potValue);
  const tflsRate = Math.min(1, Math.max(0, input.taxFreeLumpSumPercent));
  const taxFreeLumpSum = totalPot * tflsRate;
  const taxablePot = totalPot - taxFreeLumpSum;

  const annualWithdrawal = Math.max(0, input.annualWithdrawal);
  const otherIncome = Math.max(0, input.otherRetirementIncome);
  const totalTaxable = annualWithdrawal + otherIncome;

  const taxOnTotal = calculateIncomeTax(totalTaxable, input.bands, {
    overridePA: input.retirementPersonalAllowance,
  });
  const taxOnOtherAlone = calculateIncomeTax(otherIncome, input.bands, {
    overridePA: input.retirementPersonalAllowance,
  });

  const incrementalTax = Math.max(
    0,
    taxOnTotal.total - taxOnOtherAlone.total,
  );
  const netAnnualWithdrawal = annualWithdrawal - incrementalTax;
  const effectiveTaxRate =
    annualWithdrawal > 0 ? incrementalTax / annualWithdrawal : 0;

  return {
    totalPot,
    taxFreeLumpSum,
    taxablePot,
    annualWithdrawal,
    annualTaxFreePortion: annualWithdrawal * tflsRate,
    annualTaxablePortion: annualWithdrawal * (1 - tflsRate),
    otherIncome,
    totalTaxableInRetirement: totalTaxable,
    effectivePA: taxOnTotal.effectivePA,
    taxOnTotalRetirementIncome: taxOnTotal.total,
    incrementalTaxFromWithdrawal: incrementalTax,
    netAnnualWithdrawal,
    effectiveTaxRate,
    ageAccessAvailable: input.age >= 55,
    ageThreshold: 55,
  };
}

export type CalculatorResult = {
  contribution: ContributionResult;
  scenarioWithoutSipp: ScenarioBreakdown;
  scenarioWithSipp: ScenarioBreakdown;
  withdrawal: WithdrawalResult;
};

export function calculate(input: CalculatorInput): CalculatorResult {
  const contribution = resolveContribution(
    input.contributionMethod,
    input.contributionBasis,
    input.contributionAmount,
    input.bands.basicRate,
  );

  const employerContribution =
    input.mode === "employed"
      ? Math.max(0, input.grossIncome) *
        (Math.max(0, input.employerContributionPercent) / 100)
      : 0;

  const scenarioWithoutSipp = computeScenario(input, null);
  const scenarioWithSipp = computeScenario(input, contribution);

  const higherRateRelief = computeHigherRateRelief(input, contribution);

  const totalAddedToPension =
    contribution.grossContribution + employerContribution;
  const effectiveCost =
    scenarioWithoutSipp.netCashPosition - scenarioWithSipp.netCashPosition;
  const valueRatio = effectiveCost > 0 ? totalAddedToPension / effectiveCost : Infinity;

  const withdrawal = computeWithdrawal(input);

  return {
    contribution: {
      ...contribution,
      higherRateRelief,
      employerContribution,
      totalAddedToPension,
      effectiveCost,
      valueRatio,
    },
    scenarioWithoutSipp,
    scenarioWithSipp,
    withdrawal,
  };
}

// Formatting helpers used by the page.
const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const currencyFormatterPrecise = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number, precise = false): string {
  if (!Number.isFinite(value)) return "—";
  const fmt = precise ? currencyFormatterPrecise : currencyFormatter;
  return fmt.format(value);
}

export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatSignedCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return formatCurrency(0);
  const sign = value > 0 ? "+" : "−";
  return `${sign}${currencyFormatter.format(Math.abs(value))}`;
}
