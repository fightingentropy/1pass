// One-off sanity check — not a real test, just runs the three example cases
// from the brief and prints expected vs. actual. Run with: bun run src/tax/calculator.sanity.ts
import {
  calculate,
  DEFAULT_INPUT,
  DEFAULT_TAX_BANDS,
  DEFAULT_NI_BANDS,
  formatCurrency,
  type CalculatorInput,
} from "./calculator";

function approxEq(a: number, b: number, tol = 0.5): boolean {
  return Math.abs(a - b) <= tol;
}

function check(label: string, actual: number, expected: number, tol = 0.5) {
  const ok = approxEq(actual, expected, tol);
  const status = ok ? "PASS" : "FAIL";
  console.log(
    `  [${status}] ${label}: got ${formatCurrency(actual, true)}, expected ${formatCurrency(expected, true)}`,
  );
  return ok;
}

let allPass = true;

// Case 1: Self-employed, £50k, £10k net into a SIPP. Defaults otherwise.
{
  console.log("\nCase 1: Self-employed £50k, £10k net SIPP");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "selfEmployed",
    grossIncome: 50_000,
    businessExpenses: 0,
    contributionMethod: "sipp",
    contributionBasis: "net",
    contributionAmount: 10_000,
    employerContributionPercent: 0,
    bands: { ...DEFAULT_TAX_BANDS },
    niBands: { ...DEFAULT_NI_BANDS },
  };
  const r = calculate(input);

  // Expected:
  //   gross = 10000 / 0.8 = 12500
  //   topup = 2500
  //   tax without SIPP on £50k profit = (50000 - 12570) * 20% = £7,486
  //   tax with SIPP — band extended by £12,500, but income still below higher threshold so same
  //   higher-rate relief = £0
  //   effective cost = £10,000 (net OOP)
  allPass = check("net contribution", r.contribution.netContribution, 10_000) && allPass;
  allPass = check("gross contribution", r.contribution.grossContribution, 12_500) && allPass;
  allPass = check("government top-up", r.contribution.governmentTopUp, 2_500) && allPass;
  allPass = check("higher-rate relief", r.contribution.higherRateRelief, 0) && allPass;
  allPass = check("tax without SIPP", r.scenarioWithoutSipp.incomeTax.total, 7_486) && allPass;
  allPass = check("tax with SIPP", r.scenarioWithSipp.incomeTax.total, 7_486) && allPass;
  allPass = check("effective cost", r.contribution.effectiveCost, 10_000) && allPass;
  allPass = check("total added to pension", r.contribution.totalAddedToPension, 12_500) && allPass;
}

// Case 2: Employed, £70k, 5% (= £3,500) RAS gross, employer 3% (= £2,100). Defaults.
{
  console.log("\nCase 2: Employed £70k, 5% RAS, employer 3%");
  const input: CalculatorInput = {
    ...DEFAULT_INPUT,
    mode: "employed",
    grossIncome: 70_000,
    businessExpenses: 0,
    contributionMethod: "ras",
    contributionBasis: "gross",
    contributionAmount: 3_500,
    employerContributionPercent: 3,
    includeNI: true,
    bands: { ...DEFAULT_TAX_BANDS },
    niBands: { ...DEFAULT_NI_BANDS },
  };
  const r = calculate(input);

  // Expected:
  //   gross contribution = 3500
  //   net contribution = 2800
  //   government top-up = 700
  //   employer contribution = 2100
  //   tax without SIPP on £70k = £37,700×20% + £19,730×40% = £7,540 + £7,892 = £15,432
  //   tax with SIPP (band extended +£3,500): £41,200×20% + £16,230×40% = £8,240 + £6,492 = £14,732
  //   higher-rate relief = £15,432 − £14,732 = £700
  //   NI = (£37,700×8%) + (£19,730×2%) = £3,016 + £394.60 = £3,410.60 (same with/without RAS)
  //   cash without = 70000 − 15432 − 3410.60 = £51,157.40
  //   cash with = 70000 − 14732 − 3410.60 − 2800 = £49,057.40
  //   effective cost = £2,100 (= 2800 OOP − 700 HR relief)
  //   total added = 3500 + 2100 = £5,600
  allPass = check("net contribution", r.contribution.netContribution, 2_800) && allPass;
  allPass = check("gross contribution", r.contribution.grossContribution, 3_500) && allPass;
  allPass = check("government top-up", r.contribution.governmentTopUp, 700) && allPass;
  allPass = check("employer contribution", r.contribution.employerContribution, 2_100) && allPass;
  allPass = check("higher-rate relief", r.contribution.higherRateRelief, 700) && allPass;
  allPass = check("tax without SIPP", r.scenarioWithoutSipp.incomeTax.total, 15_432) && allPass;
  allPass = check("tax with SIPP", r.scenarioWithSipp.incomeTax.total, 14_732) && allPass;
  allPass = check("NI without SIPP", r.scenarioWithoutSipp.nationalInsurance, 3_410.6, 0.6) && allPass;
  allPass = check("cash without SIPP", r.scenarioWithoutSipp.netCashPosition, 51_157.4, 1) && allPass;
  allPass = check("cash with SIPP", r.scenarioWithSipp.netCashPosition, 49_057.4, 1) && allPass;
  allPass = check("effective cost", r.contribution.effectiveCost, 2_100, 1) && allPass;
  allPass = check("total added to pension", r.contribution.totalAddedToPension, 5_600) && allPass;
}

// Case 3: Retirement — pot £100k, 25% TFLS, £12k withdrawal, no other income, PA £12,570
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

  // Expected:
  //   TFLS = £25,000
  //   taxable pot = £75,000
  //   total taxable in retirement = £12,000 (under PA)
  //   tax = £0
  //   net withdrawal = £12,000
  //   effective tax rate = 0%
  allPass = check("tax-free lump sum", r.withdrawal.taxFreeLumpSum, 25_000) && allPass;
  allPass = check("taxable pot", r.withdrawal.taxablePot, 75_000) && allPass;
  allPass = check("tax on withdrawal", r.withdrawal.incrementalTaxFromWithdrawal, 0) && allPass;
  allPass = check("net annual withdrawal", r.withdrawal.netAnnualWithdrawal, 12_000) && allPass;
}

// Case 4 (extra): CIS £70k gross, £5k expenses, £8k net SIPP — tests CIS refund mechanics
{
  console.log("\nCase 4 (extra): CIS £70k gross, £5k expenses, 20% deductions, £8k net SIPP");
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
    bands: { ...DEFAULT_TAX_BANDS },
  };
  const r = calculate(input);

  // Expected:
  //   profit = 70000 − 5000 = 65000
  //   tax without SIPP = £37,700×20% + £14,730×40% = £7,540 + £5,892 = £13,432
  //   CIS deducted = 70000 × 20% = £14,000
  //   refund without = £14,000 − £13,432 = £568 (negative refundOrBalance)
  //   gross SIPP = 8000 / 0.8 = 10000
  //   tax with SIPP (band extended +£10,000): £47,700×20% + £4,730×40% = £9,540 + £1,892 = £11,432
  //   refund with = £14,000 − £11,432 = £2,568
  //   higher-rate relief = £13,432 − £11,432 = £2,000
  //   effective cost = 8000 − 2000 = £6,000
  allPass = check("gross contribution", r.contribution.grossContribution, 10_000) && allPass;
  allPass = check("CIS deducted", r.scenarioWithSipp.cisDeducted, 14_000) && allPass;
  allPass = check("tax without SIPP", r.scenarioWithoutSipp.incomeTax.total, 13_432) && allPass;
  allPass = check("tax with SIPP", r.scenarioWithSipp.incomeTax.total, 11_432) && allPass;
  allPass = check("refund without (− = refund)", r.scenarioWithoutSipp.refundOrBalance, -568) && allPass;
  allPass = check("refund with (− = refund)", r.scenarioWithSipp.refundOrBalance, -2_568) && allPass;
  allPass = check("higher-rate relief", r.contribution.higherRateRelief, 2_000) && allPass;
  allPass = check("effective cost", r.contribution.effectiveCost, 6_000) && allPass;
}

console.log(allPass ? "\nAll cases passed." : "\nSome checks failed — see above.");
process.exit(allPass ? 0 : 1);
