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

export type Jurisdiction = "rUK" | "scotland";

// Generic income-tax regime — works for any number of brackets.
export type TaxBracket = { upperBound: number; rate: number };
export type TaxRegime = {
  personalAllowance: number;
  paTaperStart: number;
  paTaperRate: number;
  brackets: TaxBracket[];   // ordered ascending by upperBound; final upperBound = Infinity
  reliefRate: number;       // RAS basic-rate relief (0.20 in UK, even for Scottish residents)
};

// rUK 3-band shape (England / Wales / NI). Editable in the UI.
export type TaxBands = {
  personalAllowance: number;
  basicRateThreshold: number;
  higherRateThreshold: number;
  additionalRateThreshold: number;
  basicRate: number;
  higherRate: number;
  additionalRate: number;
  paTaperStart: number;
  paTaperRate: number;
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

// Scottish 6-band shape. PA still UK-wide; bands and rates are Scotland-specific.
export type ScottishBands = {
  personalAllowance: number;
  paTaperStart: number;
  paTaperRate: number;
  starterRateUpper: number;
  basicRateUpper: number;
  intermediateRateUpper: number;
  higherRateUpper: number;
  advancedRateUpper: number;
  starterRate: number;
  basicRate: number;
  intermediateRate: number;
  higherRate: number;
  advancedRate: number;
  topRate: number;
};

export const DEFAULT_SCOTTISH_BANDS: ScottishBands = {
  personalAllowance: 12_570,
  paTaperStart: 100_000,
  paTaperRate: 0.5,
  starterRateUpper: 15_397,
  basicRateUpper: 27_491,
  intermediateRateUpper: 43_662,
  higherRateUpper: 75_000,
  advancedRateUpper: 125_140,
  starterRate: 0.19,
  basicRate: 0.2,
  intermediateRate: 0.21,
  higherRate: 0.42,
  advancedRate: 0.45,
  topRate: 0.48,
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

// Self-employed Class 4 NI — paid on profit, not reduced by personal pension
// contributions. Class 2 (£3.45/wk) was made non-compulsory for most from 2024
// so we don't model it here.
export type Class4NIBands = {
  lowerLimit: number;
  upperLimit: number;
  mainRate: number;
  upperRate: number;
};

export const DEFAULT_CLASS4_NI: Class4NIBands = {
  lowerLimit: 12_570,
  upperLimit: 50_270,
  mainRate: 0.06,
  upperRate: 0.02,
};

// Annual Allowance: cap on tax-relievable pension contributions per year.
// MPAA replaces the regular AA once you flexibly access taxable pension income.
// Adjusted income above taperStart reduces the AA toward `minimum`.
export type AnnualAllowanceConfig = {
  regularLimit: number;
  mpaaActive: boolean;
  mpaaLimit: number;
  taperStart: number;
  taperRate: number;
  minimum: number;
};

export const DEFAULT_ANNUAL_ALLOWANCE: AnnualAllowanceConfig = {
  regularLimit: 60_000,
  mpaaActive: false,
  mpaaLimit: 10_000,
  taperStart: 260_000,
  taperRate: 0.5,
  minimum: 10_000,
};

// Lump Sum Allowance: post-LTA cap on tax-free pension lump sums (most people:
// £268,275 lifetime). Applies across all pension pots.
export type LumpSumAllowanceConfig = {
  cap: number;
  alreadyUsed: number;
};

export const DEFAULT_LUMP_SUM_ALLOWANCE: LumpSumAllowanceConfig = {
  cap: 268_275,
  alreadyUsed: 0,
};

export type CalculatorInput = {
  mode: EmploymentMode;
  grossIncome: number;
  businessExpenses: number;
  cisDeductionRate: number;
  contributionMethod: ContributionMethod;
  contributionBasis: ContributionBasis;
  contributionAmount: number;
  employerContributionPercent: number;
  employerMatchPercent: number;
  jurisdiction: Jurisdiction;
  bands: TaxBands;
  scottishBands: ScottishBands;
  niBands: NIBands;
  includeNI: boolean;
  class4NI: Class4NIBands;
  includeClass4NI: boolean;
  annualAllowance: AnnualAllowanceConfig;
  lumpSumAllowance: LumpSumAllowanceConfig;
  potValue: number;
  taxFreeLumpSumPercent: number;
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
  jurisdiction: "rUK",
  bands: { ...DEFAULT_TAX_BANDS },
  scottishBands: { ...DEFAULT_SCOTTISH_BANDS },
  niBands: { ...DEFAULT_NI_BANDS },
  includeNI: true,
  class4NI: { ...DEFAULT_CLASS4_NI },
  includeClass4NI: true,
  annualAllowance: { ...DEFAULT_ANNUAL_ALLOWANCE },
  lumpSumAllowance: { ...DEFAULT_LUMP_SUM_ALLOWANCE },
  potValue: 100_000,
  taxFreeLumpSumPercent: 0.25,
  annualWithdrawal: 12_000,
  otherRetirementIncome: 0,
  retirementPersonalAllowance: 12_570,
  age: 40,
};

// ---- Regime helpers ----

export function rUKBandsToRegime(bands: TaxBands): TaxRegime {
  return {
    personalAllowance: bands.personalAllowance,
    paTaperStart: bands.paTaperStart,
    paTaperRate: bands.paTaperRate,
    brackets: [
      { upperBound: bands.higherRateThreshold, rate: bands.basicRate },
      { upperBound: bands.additionalRateThreshold, rate: bands.higherRate },
      { upperBound: Infinity, rate: bands.additionalRate },
    ],
    reliefRate: bands.basicRate,
  };
}

export function scottishBandsToRegime(bands: ScottishBands): TaxRegime {
  return {
    personalAllowance: bands.personalAllowance,
    paTaperStart: bands.paTaperStart,
    paTaperRate: bands.paTaperRate,
    brackets: [
      { upperBound: bands.starterRateUpper, rate: bands.starterRate },
      { upperBound: bands.basicRateUpper, rate: bands.basicRate },
      { upperBound: bands.intermediateRateUpper, rate: bands.intermediateRate },
      { upperBound: bands.higherRateUpper, rate: bands.higherRate },
      { upperBound: bands.advancedRateUpper, rate: bands.advancedRate },
      { upperBound: Infinity, rate: bands.topRate },
    ],
    // RAS providers claim 20% at source for Scottish residents too — Scottish
    // taxpayers reconcile the difference (19% / 21% / 42% / 45% / 48%) via SA.
    reliefRate: 0.2,
  };
}

export function regimeFor(input: CalculatorInput): TaxRegime {
  return input.jurisdiction === "scotland"
    ? scottishBandsToRegime(input.scottishBands)
    : rUKBandsToRegime(input.bands);
}

// PA tapers by £1 for every £2 over the taper start (UK default).
export function effectivePersonalAllowance(
  adjustedNetIncome: number,
  regime: TaxRegime,
): number {
  if (adjustedNetIncome <= regime.paTaperStart) return regime.personalAllowance;
  const reduction =
    (adjustedNetIncome - regime.paTaperStart) * regime.paTaperRate;
  return Math.max(0, regime.personalAllowance - reduction);
}

export type BracketBreakdown = {
  rate: number;
  amount: number;
  tax: number;
  upperBound: number;
};

export type IncomeTaxBreakdown = {
  total: number;
  effectivePA: number;
  perBracket: BracketBreakdown[];
  topMarginalRate: number;
};

export type IncomeTaxOptions = {
  // Gross pension contribution that extends the basic-rate band (RAS/SIPP).
  bandExtension?: number;
  // Skip PA taper / use a fixed allowance (retirement scenarios).
  overridePA?: number;
};

export function calculateIncomeTax(
  taxableIncome: number,
  regime: TaxRegime,
  options: IncomeTaxOptions = {},
): IncomeTaxBreakdown {
  const effectivePA =
    options.overridePA ?? effectivePersonalAllowance(taxableIncome, regime);
  const extension = options.bandExtension ?? 0;

  // Find the basic-rate bracket so we can extend it (and shift everything
  // above it up by the same amount). For Scotland the relief bracket is the
  // 20% band, not the starter rate.
  let extensionStart = regime.brackets.findIndex((b) => b.rate === regime.reliefRate);
  if (extensionStart < 0) extensionStart = 0;

  const effectiveBrackets = regime.brackets.map((b, i) => ({
    rate: b.rate,
    upperBound:
      i >= extensionStart && Number.isFinite(b.upperBound)
        ? b.upperBound + extension
        : b.upperBound,
  }));

  let remaining = Math.max(0, taxableIncome - effectivePA);
  let lowerBound = effectivePA;
  let totalTax = 0;
  const perBracket: BracketBreakdown[] = [];
  let topMarginalRate = 0;

  for (const b of effectiveBrackets) {
    if (remaining <= 0) break;
    const width = Math.max(0, b.upperBound - lowerBound);
    const inThis = Math.min(remaining, width);
    if (inThis > 0) {
      const tax = inThis * b.rate;
      perBracket.push({
        rate: b.rate,
        amount: inThis,
        tax,
        upperBound: b.upperBound,
      });
      totalTax += tax;
      topMarginalRate = b.rate;
      remaining -= inThis;
    }
    lowerBound = b.upperBound;
  }

  return {
    total: totalTax,
    effectivePA,
    perBracket,
    topMarginalRate,
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

export function calculateClass4NI(
  profit: number,
  bands: Class4NIBands,
): number {
  if (profit <= bands.lowerLimit) return 0;
  const inMain = Math.min(
    profit - bands.lowerLimit,
    Math.max(0, bands.upperLimit - bands.lowerLimit),
  );
  const inUpper = Math.max(0, profit - bands.upperLimit);
  return inMain * bands.mainRate + inUpper * bands.upperRate;
}

export type ContributionBreakdown = {
  netContribution: number;
  grossContribution: number;
  governmentTopUp: number;
};

export function resolveContribution(
  method: ContributionMethod,
  basis: ContributionBasis,
  amount: number,
  reliefRate: number,
): ContributionBreakdown {
  const safe = Math.max(0, amount);
  if (method === "ras" || method === "sipp") {
    if (basis === "net") {
      const net = safe;
      const gross = reliefRate >= 1 ? net : net / (1 - reliefRate);
      return {
        netContribution: net,
        grossContribution: gross,
        governmentTopUp: gross - net,
      };
    }
    const gross = safe;
    const net = gross * (1 - reliefRate);
    return {
      netContribution: net,
      grossContribution: gross,
      governmentTopUp: gross - net,
    };
  }
  return { netContribution: safe, grossContribution: safe, governmentTopUp: 0 };
}

export type ScenarioBreakdown = {
  grossIncome: number;
  businessExpenses: number;
  taxableIncome: number;
  effectivePA: number;
  incomeTax: IncomeTaxBreakdown;
  nationalInsurance: number;        // employee Class 1
  class4NI: number;                 // self-employed Class 4
  cisDeducted: number;
  refundOrBalance: number;
  pensionOutOfPocket: number;
  netCashPosition: number;
  inHigherBand: boolean;            // any income above the relief rate
};

function computeScenario(
  input: CalculatorInput,
  regime: TaxRegime,
  contribution: ContributionBreakdown | null,
): ScenarioBreakdown {
  const isSelfEmployedOrCIS =
    input.mode === "selfEmployed" || input.mode === "cis";
  const expenses = isSelfEmployedOrCIS ? Math.max(0, input.businessExpenses) : 0;
  const profitOrSalary = isSelfEmployedOrCIS
    ? input.grossIncome - expenses
    : input.grossIncome;

  let grossForTax = profitOrSalary;
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
      bandExtension = contribution.grossContribution;
      pensionOutOfPocket = contribution.netContribution;
    }
  }

  const taxableIncome = Math.max(0, grossForTax);
  const incomeTax = calculateIncomeTax(taxableIncome, regime, { bandExtension });

  const niable = Math.max(0, input.grossIncome - niableAdjustment);
  const nationalInsurance =
    input.mode === "employed" && input.includeNI
      ? calculateNI(niable, input.niBands)
      : 0;

  // Class 4 NI: based on profit before any pension contribution. RAS doesn't
  // reduce profit; NPA/SS aren't relevant for sole-trader personal SIPPs.
  const class4NI =
    isSelfEmployedOrCIS && input.includeClass4NI
      ? calculateClass4NI(Math.max(0, profitOrSalary), input.class4NI)
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
    class4NI -
    pensionOutOfPocket;

  return {
    grossIncome: input.grossIncome,
    businessExpenses: expenses,
    taxableIncome,
    effectivePA: incomeTax.effectivePA,
    incomeTax,
    nationalInsurance,
    class4NI,
    cisDeducted,
    refundOrBalance,
    pensionOutOfPocket,
    netCashPosition,
    inHigherBand: incomeTax.topMarginalRate > regime.reliefRate,
  };
}

// SA-claimable relief = total tax saved by extending the relief-rate band,
// minus the basic-rate piece already claimed at source.
function computeHigherRateRelief(
  input: CalculatorInput,
  regime: TaxRegime,
  contribution: ContributionBreakdown,
): number {
  if (
    contribution.grossContribution === 0 ||
    (input.contributionMethod !== "ras" && input.contributionMethod !== "sipp")
  ) {
    return 0;
  }

  const isSE = input.mode === "selfEmployed" || input.mode === "cis";
  const expenses = isSE ? Math.max(0, input.businessExpenses) : 0;
  const grossForTax = isSE ? input.grossIncome - expenses : input.grossIncome;

  const without = calculateIncomeTax(grossForTax, regime);
  const withExt = calculateIncomeTax(grossForTax, regime, {
    bandExtension: contribution.grossContribution,
  });
  return Math.max(0, without.total - withExt.total);
}

export type AnnualAllowanceUsage = {
  limit: number;
  used: number;
  remaining: number;
  excess: number;
  exceeded: boolean;
  tapered: boolean;
  mpaaActive: boolean;
};

function computeAnnualAllowance(
  input: CalculatorInput,
  contribution: ContributionBreakdown,
  employerContribution: number,
): AnnualAllowanceUsage {
  const used = contribution.grossContribution + employerContribution;

  if (input.annualAllowance.mpaaActive) {
    const limit = input.annualAllowance.mpaaLimit;
    const excess = Math.max(0, used - limit);
    return {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      excess,
      exceeded: excess > 0,
      tapered: false,
      mpaaActive: true,
    };
  }

  // Adjusted income for AA taper is broadly: gross income + employer
  // contribution. We don't model salary-sacrificed contributions added back —
  // a simplification, but close enough for ballpark figures.
  const adjustedIncome = input.grossIncome + employerContribution;
  let limit = input.annualAllowance.regularLimit;
  let tapered = false;
  if (adjustedIncome > input.annualAllowance.taperStart) {
    const reduction =
      (adjustedIncome - input.annualAllowance.taperStart) *
      input.annualAllowance.taperRate;
    limit = Math.max(
      input.annualAllowance.minimum,
      input.annualAllowance.regularLimit - reduction,
    );
    tapered = true;
  }

  const excess = Math.max(0, used - limit);
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    excess,
    exceeded: excess > 0,
    tapered,
    mpaaActive: false,
  };
}

export type ContributionResult = ContributionBreakdown & {
  higherRateRelief: number;
  employerContribution: number;
  totalAddedToPension: number;
  effectiveCost: number;
  valueRatio: number;
  annualAllowance: AnnualAllowanceUsage;
};

export type WithdrawalResult = {
  totalPot: number;
  taxFreeLumpSum: number;             // capped at LSA remaining
  taxFreeLumpSumRequested: number;    // before LSA cap
  taxFreeLumpSumCapped: number;       // amount cut off by the cap
  lsaRemainingBefore: number;
  lsaRemainingAfter: number;
  lsaCapApplied: boolean;
  taxablePot: number;
  annualWithdrawal: number;
  annualTaxFreePortion: number;
  annualTaxablePortion: number;
  otherIncome: number;
  totalTaxableInRetirement: number;
  effectivePA: number;
  taxOnTotalRetirementIncome: number;
  incrementalTaxFromWithdrawal: number;
  netAnnualWithdrawal: number;
  effectiveTaxRate: number;
  ageAccessAvailable: boolean;
  ageThreshold: number;
};

function computeWithdrawal(
  input: CalculatorInput,
  regime: TaxRegime,
): WithdrawalResult {
  const totalPot = Math.max(0, input.potValue);
  const tflsRate = Math.min(1, Math.max(0, input.taxFreeLumpSumPercent));
  const requested = totalPot * tflsRate;

  const lsaRemainingBefore = Math.max(
    0,
    input.lumpSumAllowance.cap - Math.max(0, input.lumpSumAllowance.alreadyUsed),
  );
  const taxFreeLumpSum = Math.min(requested, lsaRemainingBefore);
  const capped = Math.max(0, requested - taxFreeLumpSum);
  const taxablePot = totalPot - taxFreeLumpSum;

  const annualWithdrawal = Math.max(0, input.annualWithdrawal);
  const otherIncome = Math.max(0, input.otherRetirementIncome);
  const totalTaxable = annualWithdrawal + otherIncome;

  const taxOnTotal = calculateIncomeTax(totalTaxable, regime, {
    overridePA: input.retirementPersonalAllowance,
  });
  const taxOnOtherAlone = calculateIncomeTax(otherIncome, regime, {
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
    taxFreeLumpSumRequested: requested,
    taxFreeLumpSumCapped: capped,
    lsaRemainingBefore,
    lsaRemainingAfter: Math.max(0, lsaRemainingBefore - taxFreeLumpSum),
    lsaCapApplied: capped > 0,
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
  regime: TaxRegime;
};

export function calculate(input: CalculatorInput): CalculatorResult {
  const regime = regimeFor(input);

  const contribution = resolveContribution(
    input.contributionMethod,
    input.contributionBasis,
    input.contributionAmount,
    regime.reliefRate,
  );

  const employerContribution =
    input.mode === "employed"
      ? Math.max(0, input.grossIncome) *
        (Math.max(0, input.employerContributionPercent) / 100)
      : 0;

  const scenarioWithoutSipp = computeScenario(input, regime, null);
  const scenarioWithSipp = computeScenario(input, regime, contribution);

  const higherRateRelief = computeHigherRateRelief(input, regime, contribution);
  const annualAllowance = computeAnnualAllowance(
    input,
    contribution,
    employerContribution,
  );

  const totalAddedToPension =
    contribution.grossContribution + employerContribution;
  const effectiveCost =
    scenarioWithoutSipp.netCashPosition - scenarioWithSipp.netCashPosition;
  const valueRatio =
    effectiveCost > 0 ? totalAddedToPension / effectiveCost : Infinity;

  const withdrawal = computeWithdrawal(input, regime);

  return {
    contribution: {
      ...contribution,
      higherRateRelief,
      employerContribution,
      totalAddedToPension,
      effectiveCost,
      valueRatio,
      annualAllowance,
    },
    scenarioWithoutSipp,
    scenarioWithSipp,
    withdrawal,
    regime,
  };
}

// ---- Formatting helpers ----

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
