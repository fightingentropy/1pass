import { createMemo, createSignal } from "solid-js";
import {
  calculate,
  DEFAULT_INPUT,
  formatCurrency,
  formatPercent,
  type CalculatorInput,
} from "./calculator";

const FALLBACK = (value: string, fallback: number) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

function formatHmrcBalance(value: number): string {
  if (value < 0) return `${formatCurrency(Math.abs(value))} refund`;
  if (value > 0) return `${formatCurrency(value)} owed`;
  return `${formatCurrency(0)} settled`;
}

export default function TaxCalculator() {
  const [input, setInput] = createSignal<CalculatorInput>({
    ...DEFAULT_INPUT,
    mode: "cis",
    contributionMethod: "sipp",
    contributionBasis: "net",
  });

  const update = <K extends keyof CalculatorInput>(
    key: K,
    value: CalculatorInput[K],
  ) => setInput((prev) => ({ ...prev, [key]: value }));

  const result = createMemo(() => calculate(input()));
  const currentScenario = () => result().scenarioWithSipp;
  const beforePensionScenario = () => result().scenarioWithoutSipp;
  const contribution = () => result().contribution;
  const effectiveTaxRateBase = () =>
    Math.max(0, currentScenario().grossIncome);
  const effectiveTaxRateBeforePension = () =>
    effectiveTaxRateBase() > 0
      ? beforePensionScenario().totalTaxAndNI / effectiveTaxRateBase()
      : 0;
  const effectiveTaxRateAfterPension = () =>
    effectiveTaxRateBase() > 0
      ? Math.max(
          0,
          currentScenario().totalTaxAndNI - contribution().governmentTopUp,
        ) / effectiveTaxRateBase()
      : 0;
  const refundBeforeNI = () =>
    currentScenario().cisDeducted - currentScenario().incomeTax.total;
  const netCashTooltip = () =>
    [
      `${formatCurrency(currentScenario().grossIncome)} gross income`,
      `-${formatCurrency(currentScenario().businessExpenses)} business expenses`,
      `-${formatCurrency(currentScenario().totalTaxAndNI)} tax and NI`,
      `-${formatCurrency(currentScenario().pensionOutOfPocket)} pension contribution`,
      `= ${formatCurrency(currentScenario().netCashPosition)} net annual cash`,
    ].join("\n");

  return (
    <div class="tax-page">
      <header class="tax-header">
        <a class="tax-back" href="/">← Back to vault</a>
        <h1>CIS tax calculator</h1>
        <p class="subtitle">2026/27 tax year</p>
      </header>

      <div class="tax-layout">
        <section class="tax-inputs">
          <label class="field">
            <span class="field-label">Annual gross CIS income</span>
            <input
              type="number"
              min={0}
              step={500}
              value={input().grossIncome}
              onInput={(e) =>
                update("grossIncome", FALLBACK(e.currentTarget.value, 0))
              }
            />
          </label>

          <label class="field">
            <span class="field-label">Business expenses</span>
            <input
              type="number"
              min={0}
              step={100}
              value={input().businessExpenses}
              onInput={(e) =>
                update("businessExpenses", FALLBACK(e.currentTarget.value, 0))
              }
            />
          </label>

          <label class="field">
            <span class="field-label">
              Materials and VAT excluded from CIS deductions
            </span>
            <input
              type="number"
              min={0}
              step={100}
              value={input().cisDeductionExclusions}
              onInput={(e) =>
                update(
                  "cisDeductionExclusions",
                  FALLBACK(e.currentTarget.value, 0),
                )
              }
            />
          </label>

          <label class="field">
            <span class="field-label">Pension contribution</span>
            <input
              type="number"
              min={0}
              step={100}
              value={input().contributionAmount}
              onInput={(e) =>
                update("contributionAmount", FALLBACK(e.currentTarget.value, 0))
              }
            />
          </label>
        </section>

        <section class="tax-results">
          <div class="tax-card highlight">
            <h2>Tax calculation</h2>
            <p class="tax-receipt-meta">England · 2026/27</p>

            <dl class="tax-defs">
              <div>
                <dt>Gross income</dt>
                <dd>{formatCurrency(currentScenario().grossIncome)}</dd>
              </div>
              <div>
                <dt>Allowable expenses</dt>
                <dd>{formatCurrency(currentScenario().businessExpenses)}</dd>
              </div>
              <div>
                <dt>Taxable profit</dt>
                <dd>{formatCurrency(currentScenario().taxableIncome)}</dd>
              </div>
              <div>
                <dt>Tax-free Personal Allowance used</dt>
                <dd>{formatCurrency(currentScenario().effectivePA)}</dd>
              </div>
              <div>
                <dt>Income taxed after allowances</dt>
                <dd>{formatCurrency(currentScenario().taxableAfterAllowance)}</dd>
              </div>
              <div>
                <dt>Income tax due</dt>
                <dd>{formatCurrency(currentScenario().incomeTax.total)}</dd>
              </div>
              <div>
                <dt>Class 4 National Insurance due</dt>
                <dd>{formatCurrency(currentScenario().class4NI)}</dd>
              </div>
              <div class="total">
                <dt>Total tax and NI due</dt>
                <dd>
                  <strong>{formatCurrency(currentScenario().totalTaxAndNI)}</strong>
                </dd>
              </div>
              <div>
                <dt>Effective tax rate before pension relief</dt>
                <dd>{formatPercent(effectiveTaxRateBeforePension(), 1)}</dd>
              </div>
              <div>
                <dt>CIS deducted at source</dt>
                <dd>{formatCurrency(currentScenario().cisDeducted)}</dd>
              </div>
              <div>
                <dt>Refund before Class 4 NI</dt>
                <dd>{formatCurrency(refundBeforeNI())}</dd>
              </div>
              <div>
                <dt>Class 4 NI taken from refund</dt>
                <dd>{formatCurrency(-currentScenario().class4NI)}</dd>
              </div>
              <div class="total">
                <dt>Self Assessment refund</dt>
                <dd>
                  <strong>{formatCurrency(currentScenario().rebate)}</strong>
                </dd>
              </div>
              <div>
                <dt>
                  Net annual cash
                  <span
                    class="tax-tooltip"
                    tabindex="0"
                    aria-label={netCashTooltip()}
                    data-tooltip={netCashTooltip()}
                  >
                    ?
                  </span>
                </dt>
                <dd>{formatCurrency(currentScenario().netCashPosition)}</dd>
              </div>
            </dl>
          </div>

          <div class="tax-card highlight">
            <h2>Pension contribution</h2>
            {contribution().reliefLimited ? (
              <p class="tax-warning" role="status">
                Tax-relieved personal contributions are capped here at{" "}
                {formatCurrency(contribution().reliefLimit)} gross, based on the
                relevant earnings entered.
              </p>
            ) : null}
            <dl class="tax-defs">
              {contribution().grossContribution <= 0 ? (
                <>
                  <div>
                    <dt>Pension contribution</dt>
                    <dd>
                      <strong>{formatCurrency(0)}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Effective tax rate after pension relief</dt>
                    <dd>N/A</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>Net contribution (out of pocket)</dt>
                    <dd>{formatCurrency(contribution().netContribution)}</dd>
                  </div>
                  <div>
                    <dt>Government top-up (basic-rate at source)</dt>
                    <dd>{formatCurrency(contribution().governmentTopUp)}</dd>
                  </div>
                  <div>
                    <dt>Gross contribution</dt>
                    <dd>
                      <strong>{formatCurrency(contribution().grossContribution)}</strong>
                    </dd>
                  </div>
                  <div class="total">
                    <dt>Total pension tax relief</dt>
                    <dd>
                      <strong>{formatCurrency(contribution().totalSippTaxRelief)}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Effective tax rate after pension relief</dt>
                    <dd>
                      {contribution().totalSippTaxRelief > 0
                        ? formatPercent(effectiveTaxRateAfterPension(), 1)
                        : "N/A"}
                    </dd>
                  </div>
                  <div class="total">
                    <dt>Total added to pension this year</dt>
                    <dd>
                      <strong>{formatCurrency(contribution().totalAddedToPension)}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Effective cost to you (cash given up)</dt>
                    <dd>{formatCurrency(contribution().effectiveCost)}</dd>
                  </div>
                  <div>
                    <dt>Pension per GBP of cost</dt>
                    <dd>
                      {Number.isFinite(contribution().valueRatio)
                        ? `${contribution().valueRatio.toFixed(2)}x`
                        : "—"}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </div>
          <p class="tax-disclaimer">
            Estimate only. It does not include every Self Assessment adjustment,
            other income, student loans, or payments on account. Check the result
            against HMRC guidance or an accountant before filing.
          </p>
        </section>
      </div>
    </div>
  );
}
