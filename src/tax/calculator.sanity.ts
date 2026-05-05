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
  check("refund without (− = refund)", r.scenarioWithoutSipp.refundOrBalance, -568);
  check("refund with (− = refund)", r.scenarioWithSipp.refundOrBalance, -2_568);
  check("higher-rate relief", r.contribution.higherRateRelief, 2_000);
  check("effective cost", r.contribution.effectiveCost, 6_000);
}

// Case 5 — Scottish taxpayer, £70k, 5% RAS gross. Tests 6-band logic.
{
  console.log("\nCase 5: Scotland £70k, 5% RAS gross");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "employed",
    grossIncome: 70_000,
    jurisdiction: "scotland",
    contributionMethod: "ras",
    contributionBasis: "gross",
    contributionAmount: 3_500,
    employerContributionPercent: 0,
    includeNI: false,
  };
  const r = calculate(input);

  // Without SIPP on £70,000, PA £12,570, taxable £57,430:
  //   Starter:      £2,827  × 19% = £537.13
  //   Basic:        £12,094 × 20% = £2,418.80
  //   Intermediate: £16,171 × 21% = £3,395.91
  //   Higher:       £26,338 × 42% = £11,061.96
  //   Total = £17,413.80
  // With SIPP — basic band extended by £3,500, shifts intermediate/higher up:
  //   Starter:      £2,827  × 19% = £537.13
  //   Basic:        £15,594 × 20% = £3,118.80
  //   Intermediate: £16,171 × 21% = £3,395.91
  //   Higher:       £22,838 × 42% = £9,591.96
  //   Total = £16,643.80
  // HR relief = £17,413.80 − £16,643.80 = £770 (= £3,500 × (42% − 20%))
  check("tax without SIPP", r.scenarioWithoutSipp.incomeTax.total, 17_413.8, 0.6);
  check("tax with SIPP", r.scenarioWithSipp.incomeTax.total, 16_643.8, 0.6);
  check("higher-rate relief", r.contribution.higherRateRelief, 770, 0.6);
  check("gross contribution", r.contribution.grossContribution, 3_500);
  // RAS provider claims 20% at source even in Scotland
  check("government top-up", r.contribution.governmentTopUp, 700);
}

// Case 6 — AA exceeded with a large SIPP contribution.
{
  console.log("\nCase 6: AA breach — £80k contribution at £100k SE income");
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

// Case 7 — LSA cap kicks in on a £1.5m pot.
{
  console.log("\nCase 7: LSA cap on £1.5m pot, 25% TFLS");
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

// Case 8 — MPAA active should drop the AA to £10k.
{
  console.log("\nCase 8: MPAA active — AA drops to £10k");
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

console.log(allPass ? "\nAll cases passed." : "\nSome checks failed — see above.");
if (!allPass) {
  throw new Error("Sanity check failed");
}
