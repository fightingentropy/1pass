// Sanity check — runs documented example cases against the calculator and
// prints PASS/FAIL with expected vs. actual. Run with:
//   bun run src/tax/calculator.sanity.ts
import {
  calculate,
  DEFAULT_INPUT,
  formatCurrency,
  type CalculatorInput,
} from "./calculator";

function approxEq(a: number, b: number, tol = 0.5): boolean {
  return Math.abs(a - b) <= tol;
}

let allPass = true;

function check(label: string, actual: number, expected: number, tol = 0.5) {
  const ok = approxEq(actual, expected, tol);
  const status = ok ? "PASS" : "FAIL";
  console.log(
    `  [${status}] ${label}: got ${formatCurrency(actual, true)}, expected ${formatCurrency(expected, true)}`,
  );
  if (!ok) allPass = false;
}

function checkBool(label: string, actual: boolean, expected: boolean) {
  const ok = actual === expected;
  const status = ok ? "PASS" : "FAIL";
  console.log(`  [${status}] ${label}: got ${actual}, expected ${expected}`);
  if (!ok) allPass = false;
}

// Case 0 — App defaults match the first-run CIS + manual SIPP scenario.
{
  console.log("\nCase 0: Default app inputs");
  check("default gross income", DEFAULT_INPUT.grossIncome, 50_000);
  check("default expenses", DEFAULT_INPUT.businessExpenses, 5_000);
  checkBool("default mode is CIS", DEFAULT_INPUT.mode === "cis", true);
  checkBool("default method is manual SIPP", DEFAULT_INPUT.contributionMethod === "sipp", true);
  checkBool("default SIPP amount is net", DEFAULT_INPUT.contributionBasis === "net", true);
  check("default pension contribution", DEFAULT_INPUT.contributionAmount, 0);
}

// Case 1 — Self-employed, £50k, £10k net into a SIPP. Default Class 4 NI on.
{
  console.log("\nCase 1: Self-employed £50k, £10k net SIPP (Class 4 NI on)");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "selfEmployed",
    grossIncome: 50_000,
    businessExpenses: 0,
    contributionMethod: "sipp",
    contributionBasis: "net",
    contributionAmount: 10_000,
    employerContributionPercent: 0,
  };
  const r = calculate(input);

  // Income tax on £50,000 profit: (£50,000 - £12,570) × 20% = £7,486
  // Class 4 NI on £50,000 profit: (£50,000 - £12,570) × 6% = £2,245.80
  check("net contribution", r.contribution.netContribution, 10_000);
  check("gross contribution", r.contribution.grossContribution, 12_500);
  check("government top-up", r.contribution.governmentTopUp, 2_500);
  check("higher-rate relief", r.contribution.higherRateRelief, 0);
  check("tax without SIPP", r.scenarioWithoutSipp.incomeTax.total, 7_486);
  check("tax with SIPP", r.scenarioWithSipp.incomeTax.total, 7_486);
  check("Class 4 NI", r.scenarioWithSipp.class4NI, 2_245.8, 0.6);
  check("effective cost", r.contribution.effectiveCost, 10_000);
  check("total added to pension", r.contribution.totalAddedToPension, 12_500);
  check("AA used", r.contribution.annualAllowance.used, 12_500);
  check("AA limit", r.contribution.annualAllowance.limit, 60_000);
  checkBool("AA exceeded", r.contribution.annualAllowance.exceeded, false);
}

// Case 2 — Employed, £70k, 5% RAS (gross), employer 3%.
{
  console.log("\nCase 2: Employed £70k, 5% RAS gross, employer 3%");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "employed",
    grossIncome: 70_000,
    contributionMethod: "ras",
    contributionBasis: "gross",
    contributionAmount: 3_500,
    employerContributionPercent: 3,
    includeNI: true,
  };
  const r = calculate(input);

  check("net contribution", r.contribution.netContribution, 2_800);
  check("gross contribution", r.contribution.grossContribution, 3_500);
  check("government top-up", r.contribution.governmentTopUp, 700);
  check("employer contribution", r.contribution.employerContribution, 2_100);
  check("higher-rate relief", r.contribution.higherRateRelief, 700);
  check("tax without SIPP", r.scenarioWithoutSipp.incomeTax.total, 15_432);
  check("tax with SIPP", r.scenarioWithSipp.incomeTax.total, 14_732);
  check("Class 1 NI", r.scenarioWithSipp.nationalInsurance, 3_410.6, 0.6);
  check("cash without SIPP", r.scenarioWithoutSipp.netCashPosition, 51_157.4, 1);
  check("cash with SIPP", r.scenarioWithSipp.netCashPosition, 49_057.4, 1);
  check("effective cost", r.contribution.effectiveCost, 2_100, 1);
  check("total added to pension", r.contribution.totalAddedToPension, 5_600);
  check("AA used", r.contribution.annualAllowance.used, 5_600);
}

// Case 3 — Retirement: pot £100k, 25% TFLS, £12k/yr withdrawal.
{
  console.log("\nCase 3: Pot £100k, 25% TFLS, £12k/yr withdrawal");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    potValue: 100_000,
    taxFreeLumpSumPercent: 0.25,
    annualWithdrawal: 12_000,
    otherRetirementIncome: 0,
    retirementPersonalAllowance: 12_570,
  };
  const r = calculate(input);

  check("tax-free lump sum", r.withdrawal.taxFreeLumpSum, 25_000);
  check("taxable pot", r.withdrawal.taxablePot, 75_000);
  check("tax on withdrawal", r.withdrawal.incrementalTaxFromWithdrawal, 0);
  check("net annual withdrawal", r.withdrawal.netAnnualWithdrawal, 12_000);
  checkBool("LSA cap applied", r.withdrawal.lsaCapApplied, false);
}

// Case 4 — CIS £70k gross, £5k expenses, £8k net SIPP.
{
  console.log("\nCase 4: CIS £70k gross, £5k expenses, 20% deductions, £8k net SIPP");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "cis",
    grossIncome: 70_000,
    businessExpenses: 5_000,
    cisDeductionRate: 0.2,
    contributionMethod: "sipp",
    contributionBasis: "net",
    contributionAmount: 8_000,
    employerContributionPercent: 0,
  };
  const r = calculate(input);

  // Profit = £65,000.
  // Class 4: (£50,270 - £12,570) × 6% + (£65,000 - £50,270) × 2%
  //        = £37,700 × 0.06 + £14,730 × 0.02 = £2,262 + £294.60 = £2,556.60
  check("gross contribution", r.contribution.grossContribution, 10_000);
  check("CIS deducted", r.scenarioWithSipp.cisDeducted, 14_000);
  check("tax without SIPP", r.scenarioWithoutSipp.incomeTax.total, 13_432);
  check("tax with SIPP", r.scenarioWithSipp.incomeTax.total, 11_432);
  check("Class 4 NI", r.scenarioWithSipp.class4NI, 2_556.6, 0.6);
  // SA balance now includes Class 4 NI as well as income tax:
  //   Without SIPP: £13,432 + £2,556.60 − £14,000 = £1,988.60 owed
  //   With SIPP:    £11,432 + £2,556.60 − £14,000 = £11.40 refund
  check("SA balance without SIPP", r.scenarioWithoutSipp.refundOrBalance, 1_988.6);
  check("SA balance with SIPP", r.scenarioWithSipp.refundOrBalance, -11.4);
  check("higher-rate relief", r.contribution.higherRateRelief, 2_000);
  check("effective cost", r.contribution.effectiveCost, 6_000);
}

// Case 5 — AA exceeded with a large SIPP contribution.
{
  console.log("\nCase 5: AA breach — £80k contribution at £100k SE income");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "selfEmployed",
    grossIncome: 100_000,
    contributionMethod: "sipp",
    contributionBasis: "gross",
    contributionAmount: 80_000,
    employerContributionPercent: 0,
  };
  const r = calculate(input);

  check("AA limit", r.contribution.annualAllowance.limit, 60_000);
  check("AA used", r.contribution.annualAllowance.used, 80_000);
  check("AA excess", r.contribution.annualAllowance.excess, 20_000);
  checkBool("AA exceeded", r.contribution.annualAllowance.exceeded, true);
  checkBool("AA tapered", r.contribution.annualAllowance.tapered, false);
}

// Case 6 — LSA cap kicks in on a £1.5m pot.
{
  console.log("\nCase 6: LSA cap on £1.5m pot, 25% TFLS");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    potValue: 1_500_000,
    taxFreeLumpSumPercent: 0.25,
    annualWithdrawal: 0,
  };
  const r = calculate(input);

  // Requested TFLS = 25% × £1.5m = £375,000
  // LSA cap = £268,275, alreadyUsed = 0 → cap remaining = £268,275
  // Allowed TFLS = £268,275; capped portion = £106,725
  check("requested TFLS", r.withdrawal.taxFreeLumpSumRequested, 375_000);
  check("allowed TFLS", r.withdrawal.taxFreeLumpSum, 268_275);
  check("capped portion", r.withdrawal.taxFreeLumpSumCapped, 106_725);
  checkBool("LSA cap applied", r.withdrawal.lsaCapApplied, true);
}

// Case 7 — MPAA active should drop the AA to £10k.
{
  console.log("\nCase 7: MPAA active — AA drops to £10k");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    contributionMethod: "sipp",
    contributionBasis: "gross",
    contributionAmount: 15_000,
    employerContributionPercent: 0,
    annualAllowance: {
      ...DEFAULT_INPUT.annualAllowance,
      mpaaActive: true,
    },
  };
  const r = calculate(input);

  check("AA limit", r.contribution.annualAllowance.limit, 10_000);
  check("AA used", r.contribution.annualAllowance.used, 15_000);
  check("AA excess", r.contribution.annualAllowance.excess, 5_000);
  checkBool("AA exceeded", r.contribution.annualAllowance.exceeded, true);
  checkBool("MPAA flag", r.contribution.annualAllowance.mpaaActive, true);
}

// Case 8 — Carry-forward extends the AA limit.
{
  console.log("\nCase 8: AA + £30k carry-forward");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    grossIncome: 100_000,
    businessExpenses: 0,
    contributionMethod: "sipp",
    contributionBasis: "gross",
    contributionAmount: 80_000,
    employerContributionPercent: 0,
    annualAllowance: {
      ...DEFAULT_INPUT.annualAllowance,
      carryForwardUnused: 30_000,
    },
  };
  const r = calculate(input);

  check("AA base limit", r.contribution.annualAllowance.baseLimit, 60_000);
  check("AA carry-forward", r.contribution.annualAllowance.carryForward, 30_000);
  check("AA total available", r.contribution.annualAllowance.limit, 90_000);
  check("AA used", r.contribution.annualAllowance.used, 80_000);
  checkBool("AA exceeded", r.contribution.annualAllowance.exceeded, false);
}

// Case 9 — HICBC: £75k earner with 2 kids; SIPP recovers part of the benefit.
{
  console.log("\nCase 9: HICBC — £75k, 2 kids, £5k RAS gross recovers benefit");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "employed",
    grossIncome: 75_000,
    contributionMethod: "ras",
    contributionBasis: "gross",
    contributionAmount: 5_000,
    employerContributionPercent: 0,
    includeNI: false,
    hicbc: {
      enabled: true,
      childBenefitAnnual: 2_212.60,
      thresholdLow: 60_000,
      thresholdHigh: 80_000,
    },
  };
  const r = calculate(input);

  // Without SIPP: ANI = £75,000. Charge fraction = (75,000 - 60,000) / 20,000 = 0.75
  // HICBC = 0.75 × £2,212.60 = £1,659.45
  // With SIPP: gross contribution £5,000 reduces ANI to £70,000. Fraction = 0.5
  // HICBC = 0.5 × £2,212.60 = £1,106.30
  // SIPP recovers £553.15 of child benefit on top of normal HR relief.
  check("ANI without SIPP", r.scenarioWithoutSipp.adjustedNetIncome, 75_000);
  check("ANI with SIPP", r.scenarioWithSipp.adjustedNetIncome, 70_000);
  check("HICBC without SIPP", r.scenarioWithoutSipp.hicbc, 1_659.45, 0.05);
  check("HICBC with SIPP", r.scenarioWithSipp.hicbc, 1_106.30, 0.05);
  check(
    "Child benefit recovered by SIPP",
    r.scenarioWithoutSipp.hicbc - r.scenarioWithSipp.hicbc,
    553.15,
    0.05,
  );
}

// Case 10 — HICBC ceiling: full claw-back at/above £80k.
{
  console.log("\nCase 10: HICBC — £85k income, no SIPP, full claw-back");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "employed",
    grossIncome: 85_000,
    contributionAmount: 0,
    employerContributionPercent: 0,
    includeNI: false,
    hicbc: {
      enabled: true,
      childBenefitAnnual: 1_331.20,
      thresholdLow: 60_000,
      thresholdHigh: 80_000,
    },
  };
  const r = calculate(input);

  check("HICBC without SIPP", r.scenarioWithoutSipp.hicbc, 1_331.20, 0.05);
  check("HICBC with SIPP", r.scenarioWithSipp.hicbc, 1_331.20, 0.05);
}

// Case 11 — SIPP restores tapered Personal Allowance.
{
  console.log("\nCase 11: £110k employed, £10k gross SIPP restores PA");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "employed",
    grossIncome: 110_000,
    contributionMethod: "sipp",
    contributionBasis: "gross",
    contributionAmount: 10_000,
    employerContributionPercent: 0,
    includeNI: false,
  };
  const r = calculate(input);

  check("PA without SIPP", r.scenarioWithoutSipp.effectivePA, 7_570);
  check("PA with SIPP", r.scenarioWithSipp.effectivePA, 12_570);
  check("tax without SIPP", r.scenarioWithoutSipp.incomeTax.total, 33_432);
  check("tax with SIPP", r.scenarioWithSipp.incomeTax.total, 29_432);
  check("SA tax relief", r.contribution.higherRateRelief, 4_000);
  check("total SIPP tax relief", r.contribution.totalSippTaxRelief, 6_000);
}

// Case 12 — CIS exclusions reduce the withholding base, not taxable profit.
{
  console.log("\nCase 12: CIS £70k gross, £10k materials excluded from CIS base");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "cis",
    grossIncome: 70_000,
    businessExpenses: 5_000,
    cisDeductionExclusions: 10_000,
    cisDeductionRate: 0.2,
    contributionMethod: "sipp",
    contributionBasis: "net",
    contributionAmount: 8_000,
    employerContributionPercent: 0,
  };
  const r = calculate(input);

  check("CIS deduction base", r.scenarioWithSipp.cisDeductionBase, 60_000);
  check("CIS deducted", r.scenarioWithSipp.cisDeducted, 12_000);
  check("taxable profit", r.scenarioWithSipp.taxableIncome, 65_000);
  check("SA balance with SIPP", r.scenarioWithSipp.refundOrBalance, 1_988.6);
}

// Case 13 — personal pension relief cannot exceed relevant UK earnings.
{
  console.log("\nCase 13: SIPP relief capped by relevant earnings");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "cis",
    grossIncome: 50_000,
    businessExpenses: 5_000,
    contributionMethod: "sipp",
    contributionBasis: "net",
    contributionAmount: 50_000,
  };
  const r = calculate(input);

  check("requested gross contribution", r.contribution.requestedGrossContribution, 62_500);
  check("relief limit", r.contribution.reliefLimit, 45_000);
  check("capped gross contribution", r.contribution.grossContribution, 45_000);
  check("capped provider top-up", r.contribution.governmentTopUp, 9_000);
  checkBool("relief limited", r.contribution.reliefLimited, true);
}

// Case 14 — taper needs both threshold-income and adjusted-income tests.
{
  console.log("\nCase 14: AA taper does not apply at the threshold-income boundary");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "employed",
    grossIncome: 200_000,
    businessExpenses: 0,
    contributionMethod: "ras",
    contributionBasis: "gross",
    contributionAmount: 0,
    employerContributionPercent: 50,
  };
  const r = calculate(input);

  check("threshold income", r.contribution.annualAllowance.thresholdIncome, 200_000);
  check("adjusted income", r.contribution.annualAllowance.adjustedIncome, 300_000);
  check("untapered base AA", r.contribution.annualAllowance.baseLimit, 60_000);
  checkBool("AA tapered", r.contribution.annualAllowance.tapered, false);
}

console.log(allPass ? "\nAll cases passed." : "\nSome checks failed — see above.");
if (!allPass) {
  throw new Error("Sanity check failed");
}
