import { createMemo, createSignal, For, Show } from "solid-js";
import {
  calculate,
  DEFAULT_INPUT,
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  type CalculatorInput,
  type ContributionBasis,
  type ContributionMethod,
  type EmploymentMode,
} from "./calculator";

const MODE_OPTIONS: { value: EmploymentMode; label: string; hint: string }[] = [
  {
    value: "employed",
    label: "Employed",
    hint: "PAYE salary with a workplace pension.",
  },
  {
    value: "selfEmployed",
    label: "Self-employed",
    hint: "Sole trader paying into a SIPP.",
  },
  {
    value: "cis",
    label: "CIS contractor",
    hint: "20% (or 30%) deducted at source by the contractor.",
  },
];

const METHOD_OPTIONS: { value: ContributionMethod; label: string; hint: string }[] = [
  {
    value: "ras",
    label: "Relief at source",
    hint: "You pay the net amount, the provider claims basic-rate relief.",
  },
  {
    value: "netPay",
    label: "Net pay arrangement",
    hint: "Contribution comes off your gross pay before income tax.",
  },
  {
    value: "salarySacrifice",
    label: "Salary sacrifice",
    hint: "Salary is reduced before income tax and National Insurance.",
  },
  {
    value: "sipp",
    label: "Manual SIPP",
    hint: "Personal SIPP — same mechanics as relief at source.",
  },
];

const BASIS_OPTIONS: { value: ContributionBasis; label: string }[] = [
  { value: "gross", label: "Gross (total going into pension)" },
  { value: "net", label: "Net (what you pay out of pocket)" },
];

const FALLBACK = (value: string, fallback: number) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

type ContribInputMode = "amount" | "percent";

export default function TaxCalculator() {
  const [input, setInput] = createSignal<CalculatorInput>({ ...DEFAULT_INPUT });
  const [contribInputMode, setContribInputMode] =
    createSignal<ContribInputMode>("amount");
  const [contribPercent, setContribPercent] = createSignal(5);

  const update = <K extends keyof CalculatorInput>(
    key: K,
    value: CalculatorInput[K],
  ) => setInput((prev) => ({ ...prev, [key]: value }));

  const updateBand = (key: keyof CalculatorInput["bands"], value: number) =>
    setInput((prev) => ({
      ...prev,
      bands: { ...prev.bands, [key]: value },
    }));

  const updateNI = (key: keyof CalculatorInput["niBands"], value: number) =>
    setInput((prev) => ({
      ...prev,
      niBands: { ...prev.niBands, [key]: value },
    }));

  const resetBands = () =>
    setInput((prev) => ({
      ...prev,
      bands: { ...DEFAULT_INPUT.bands },
    }));

  const resetNI = () =>
    setInput((prev) => ({
      ...prev,
      niBands: { ...DEFAULT_INPUT.niBands },
    }));

  const effectiveInput = createMemo<CalculatorInput>(() => {
    const base = input();
    if (contribInputMode() === "percent") {
      return {
        ...base,
        contributionAmount: base.grossIncome * (contribPercent() / 100),
      };
    }
    return base;
  });

  const result = createMemo(() => calculate(effectiveInput()));
  const isEmployed = () => input().mode === "employed";
  const isCIS = () => input().mode === "cis";
  const isSelfEmployedOrCIS = () =>
    input().mode === "selfEmployed" || input().mode === "cis";
  const isRASLike = () =>
    input().contributionMethod === "ras" ||
    input().contributionMethod === "sipp";

  const cashDelta = () =>
    result().scenarioWithSipp.netCashPosition -
    result().scenarioWithoutSipp.netCashPosition;
  const taxDelta = () =>
    result().scenarioWithSipp.incomeTax.total -
    result().scenarioWithoutSipp.incomeTax.total;
  const niDelta = () =>
    result().scenarioWithSipp.nationalInsurance -
    result().scenarioWithoutSipp.nationalInsurance;
  const refundDelta = () =>
    result().scenarioWithoutSipp.refundOrBalance -
    result().scenarioWithSipp.refundOrBalance;

  return (
    <div class="tax-page">
      <header class="tax-header">
        <a class="tax-back" href="/">← Vault</a>
        <h1>UK Pension &amp; Tax Relief Calculator</h1>
        <p class="subtitle">
          Compare your tax position with and without a SIPP or workplace pension
          contribution. Models PAYE salaries, sole traders, and CIS subcontractors,
          plus a retirement drawdown projection.
        </p>
        <div class="tax-warning">
          <strong>Estimate only — not financial advice.</strong> Workplace schemes
          vary; check whether yours uses relief at source, net pay, or salary
          sacrifice. Tax bands and rates are editable below — update them when HMRC
          changes the rules.
        </div>
      </header>

      <div class="tax-layout">
        <section class="tax-inputs">
          <div class="tax-card">
            <h2>1. Employment</h2>
            <div class="tax-mode-row">
              <For each={MODE_OPTIONS}>
                {(option) => (
                  <button
                    type="button"
                    class={`tax-mode ${input().mode === option.value ? "active" : ""}`}
                    onClick={() => update("mode", option.value)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.hint}</span>
                  </button>
                )}
              </For>
            </div>

            <div class="tax-grid">
              <label class="field">
                <span class="field-label">
                  {isCIS() ? "Annual gross CIS income" : "Annual gross income"}
                </span>
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

              <Show when={isSelfEmployedOrCIS()}>
                <label class="field">
                  <span class="field-label">Business expenses</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={input().businessExpenses}
                    onInput={(e) =>
                      update(
                        "businessExpenses",
                        FALLBACK(e.currentTarget.value, 0),
                      )
                    }
                  />
                  <span class="field-hint">
                    Allowable expenses reduce your taxable profit.
                  </span>
                </label>
              </Show>

              <Show when={isCIS()}>
                <label class="field">
                  <span class="field-label">CIS deduction rate</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={(input().cisDeductionRate * 100).toFixed(2).replace(/\.?0+$/, "")}
                    onInput={(e) =>
                      update(
                        "cisDeductionRate",
                        FALLBACK(e.currentTarget.value, 20) / 100,
                      )
                    }
                  />
                  <span class="field-hint">
                    20% for registered, 30% if unregistered. Payment on account, not
                    final tax.
                  </span>
                </label>
              </Show>
            </div>
          </div>

          <div class="tax-card">
            <h2>2. Pension contribution</h2>

            <label class="field">
              <span class="field-label">Method</span>
              <select
                value={input().contributionMethod}
                onChange={(e) =>
                  update(
                    "contributionMethod",
                    e.currentTarget.value as ContributionMethod,
                  )
                }
              >
                <For each={METHOD_OPTIONS}>
                  {(option) => (
                    <option value={option.value}>{option.label}</option>
                  )}
                </For>
              </select>
              <span class="field-hint">
                {METHOD_OPTIONS.find(
                  (m) => m.value === input().contributionMethod,
                )?.hint}
              </span>
            </label>

            <div class="tax-grid">
              <label class="field">
                <span class="field-label">Contribute by</span>
                <select
                  value={contribInputMode()}
                  onChange={(e) =>
                    setContribInputMode(e.currentTarget.value as ContribInputMode)
                  }
                >
                  <option value="amount">£ per year</option>
                  <option value="percent">% of income</option>
                </select>
              </label>

              <Show
                when={contribInputMode() === "amount"}
                fallback={
                  <label class="field">
                    <span class="field-label">Contribution percent</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={contribPercent()}
                      onInput={(e) =>
                        setContribPercent(FALLBACK(e.currentTarget.value, 0))
                      }
                    />
                    <span class="field-hint">
                      = {formatCurrency(effectiveInput().contributionAmount)} per
                      year
                    </span>
                  </label>
                }
              >
                <label class="field">
                  <span class="field-label">Contribution amount</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={input().contributionAmount}
                    onInput={(e) =>
                      update(
                        "contributionAmount",
                        FALLBACK(e.currentTarget.value, 0),
                      )
                    }
                  />
                </label>
              </Show>

              <Show when={isRASLike()}>
                <label class="field">
                  <span class="field-label">Amount entered as</span>
                  <select
                    value={input().contributionBasis}
                    onChange={(e) =>
                      update(
                        "contributionBasis",
                        e.currentTarget.value as ContributionBasis,
                      )
                    }
                  >
                    <For each={BASIS_OPTIONS}>
                      {(option) => (
                        <option value={option.value}>{option.label}</option>
                      )}
                    </For>
                  </select>
                  <span class="field-hint">
                    Net = you pay this from take-home; provider grosses up by ÷ (1 −
                    basic rate). Gross = total reaching the pension.
                  </span>
                </label>
              </Show>
            </div>
          </div>

          <Show when={isEmployed()}>
            <div class="tax-card">
              <h2>3. Employer contribution</h2>
              <div class="tax-grid">
                <label class="field">
                  <span class="field-label">Employer percent</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={input().employerContributionPercent}
                    onInput={(e) =>
                      update(
                        "employerContributionPercent",
                        FALLBACK(e.currentTarget.value, 0),
                      )
                    }
                  />
                  <span class="field-hint">
                    {formatCurrency(
                      input().grossIncome *
                        (input().employerContributionPercent / 100),
                    )}{" "}
                    per year
                  </span>
                </label>
                <label class="field">
                  <span class="field-label">Employer match cap (info)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={input().employerMatchPercent}
                    onInput={(e) =>
                      update(
                        "employerMatchPercent",
                        FALLBACK(e.currentTarget.value, 0),
                      )
                    }
                  />
                  <span class="field-hint">
                    Used as a reference cap (e.g. employer matches up to 5%).
                  </span>
                </label>
              </div>
            </div>
          </Show>

          <details class="tax-card tax-collapsible">
            <summary>
              <h2>4. Tax bands &amp; rates</h2>
              <span>Edit these if HMRC changes anything.</span>
            </summary>
            <div class="tax-grid">
              <label class="field">
                <span class="field-label">Personal allowance</span>
                <input
                  type="number"
                  value={input().bands.personalAllowance}
                  onInput={(e) =>
                    updateBand(
                      "personalAllowance",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Basic rate threshold</span>
                <input
                  type="number"
                  value={input().bands.basicRateThreshold}
                  onInput={(e) =>
                    updateBand(
                      "basicRateThreshold",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Higher rate threshold</span>
                <input
                  type="number"
                  value={input().bands.higherRateThreshold}
                  onInput={(e) =>
                    updateBand(
                      "higherRateThreshold",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Additional rate threshold</span>
                <input
                  type="number"
                  value={input().bands.additionalRateThreshold}
                  onInput={(e) =>
                    updateBand(
                      "additionalRateThreshold",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Basic rate</span>
                <input
                  type="number"
                  step={0.01}
                  value={input().bands.basicRate}
                  onInput={(e) =>
                    updateBand("basicRate", FALLBACK(e.currentTarget.value, 0))
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Higher rate</span>
                <input
                  type="number"
                  step={0.01}
                  value={input().bands.higherRate}
                  onInput={(e) =>
                    updateBand("higherRate", FALLBACK(e.currentTarget.value, 0))
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Additional rate</span>
                <input
                  type="number"
                  step={0.01}
                  value={input().bands.additionalRate}
                  onInput={(e) =>
                    updateBand(
                      "additionalRate",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">PA taper start</span>
                <input
                  type="number"
                  value={input().bands.paTaperStart}
                  onInput={(e) =>
                    updateBand(
                      "paTaperStart",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">PA taper rate (£ lost per £1 over)</span>
                <input
                  type="number"
                  step={0.05}
                  value={input().bands.paTaperRate}
                  onInput={(e) =>
                    updateBand(
                      "paTaperRate",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
              </label>
            </div>
            <div class="tax-row-actions">
              <button class="btn ghost" type="button" onClick={resetBands}>
                Reset to UK 2024–25 defaults
              </button>
            </div>
          </details>

          <Show when={isEmployed()}>
            <details class="tax-card tax-collapsible">
              <summary>
                <h2>5. National Insurance</h2>
                <span>Affects salary sacrifice savings.</span>
              </summary>
              <label class="tax-checkbox">
                <input
                  type="checkbox"
                  checked={input().includeNI}
                  onChange={(e) =>
                    update("includeNI", e.currentTarget.checked)
                  }
                />
                <span>Include employee National Insurance in calculations</span>
              </label>
              <div class="tax-grid">
                <label class="field">
                  <span class="field-label">Primary threshold</span>
                  <input
                    type="number"
                    value={input().niBands.primaryThreshold}
                    onInput={(e) =>
                      updateNI(
                        "primaryThreshold",
                        FALLBACK(e.currentTarget.value, 0),
                      )
                    }
                  />
                </label>
                <label class="field">
                  <span class="field-label">Upper earnings limit</span>
                  <input
                    type="number"
                    value={input().niBands.upperEarningsLimit}
                    onInput={(e) =>
                      updateNI(
                        "upperEarningsLimit",
                        FALLBACK(e.currentTarget.value, 0),
                      )
                    }
                  />
                </label>
                <label class="field">
                  <span class="field-label">Main rate</span>
                  <input
                    type="number"
                    step={0.01}
                    value={input().niBands.mainRate}
                    onInput={(e) =>
                      updateNI("mainRate", FALLBACK(e.currentTarget.value, 0))
                    }
                  />
                </label>
                <label class="field">
                  <span class="field-label">Upper rate</span>
                  <input
                    type="number"
                    step={0.01}
                    value={input().niBands.upperRate}
                    onInput={(e) =>
                      updateNI("upperRate", FALLBACK(e.currentTarget.value, 0))
                    }
                  />
                </label>
              </div>
              <div class="tax-row-actions">
                <button class="btn ghost" type="button" onClick={resetNI}>
                  Reset NI defaults
                </button>
              </div>
            </details>
          </Show>

          <details class="tax-card tax-collapsible">
            <summary>
              <h2>6. Retirement &amp; withdrawal</h2>
              <span>Project tax on the way out.</span>
            </summary>
            <div class="tax-grid">
              <label class="field">
                <span class="field-label">Pension pot value</span>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={input().potValue}
                  onInput={(e) =>
                    update("potValue", FALLBACK(e.currentTarget.value, 0))
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Tax-free lump sum %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={(input().taxFreeLumpSumPercent * 100).toFixed(2).replace(/\.?0+$/, "")}
                  onInput={(e) =>
                    update(
                      "taxFreeLumpSumPercent",
                      FALLBACK(e.currentTarget.value, 25) / 100,
                    )
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Annual withdrawal</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={input().annualWithdrawal}
                  onInput={(e) =>
                    update(
                      "annualWithdrawal",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Other taxable income</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={input().otherRetirementIncome}
                  onInput={(e) =>
                    update(
                      "otherRetirementIncome",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
                <span class="field-hint">
                  e.g. State Pension, rental, part-time work.
                </span>
              </label>
              <label class="field">
                <span class="field-label">Personal allowance in retirement</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={input().retirementPersonalAllowance}
                  onInput={(e) =>
                    update(
                      "retirementPersonalAllowance",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Current age</span>
                <input
                  type="number"
                  min={16}
                  max={120}
                  step={1}
                  value={input().age}
                  onInput={(e) =>
                    update("age", FALLBACK(e.currentTarget.value, 0))
                  }
                />
              </label>
            </div>
          </details>
        </section>

        <section class="tax-results">
          <div class="tax-card highlight">
            <h2>Pension contribution</h2>
            <dl class="tax-defs">
              <div>
                <dt>Net contribution (out of pocket)</dt>
                <dd>{formatCurrency(result().contribution.netContribution)}</dd>
              </div>
              <div>
                <dt>Government top-up (basic-rate at source)</dt>
                <dd>{formatCurrency(result().contribution.governmentTopUp)}</dd>
              </div>
              <div>
                <dt>Gross contribution</dt>
                <dd>
                  <strong>
                    {formatCurrency(result().contribution.grossContribution)}
                  </strong>
                </dd>
              </div>
              <div>
                <dt>Higher/additional-rate relief (claim via Self Assessment)</dt>
                <dd>{formatCurrency(result().contribution.higherRateRelief)}</dd>
              </div>
              <Show when={isEmployed()}>
                <div>
                  <dt>Employer contribution</dt>
                  <dd>
                    {formatCurrency(result().contribution.employerContribution)}
                  </dd>
                </div>
              </Show>
              <div class="tax-defs-row total">
                <dt>Total added to pension this year</dt>
                <dd>
                  <strong>
                    {formatCurrency(result().contribution.totalAddedToPension)}
                  </strong>
                </dd>
              </div>
              <div>
                <dt>Effective cost to you (cash given up)</dt>
                <dd>{formatCurrency(result().contribution.effectiveCost)}</dd>
              </div>
              <div>
                <dt>Pension £ per £ of cost</dt>
                <dd>
                  {Number.isFinite(result().contribution.valueRatio)
                    ? `${result().contribution.valueRatio.toFixed(2)}×`
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>

          <div class="tax-card">
            <h2>Comparison this year</h2>
            <table class="tax-table">
              <thead>
                <tr>
                  <th />
                  <th>No SIPP</th>
                  <th>With SIPP</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Gross income</th>
                  <td>
                    {formatCurrency(result().scenarioWithoutSipp.grossIncome)}
                  </td>
                  <td>
                    {formatCurrency(result().scenarioWithSipp.grossIncome)}
                  </td>
                  <td class="muted">—</td>
                </tr>
                <Show when={isSelfEmployedOrCIS()}>
                  <tr>
                    <th scope="row">Business expenses</th>
                    <td>
                      {formatCurrency(
                        result().scenarioWithoutSipp.businessExpenses,
                      )}
                    </td>
                    <td>
                      {formatCurrency(
                        result().scenarioWithSipp.businessExpenses,
                      )}
                    </td>
                    <td class="muted">—</td>
                  </tr>
                </Show>
                <tr>
                  <th scope="row">
                    {isSelfEmployedOrCIS() ? "Taxable profit" : "Taxable income"}
                  </th>
                  <td>
                    {formatCurrency(result().scenarioWithoutSipp.taxableIncome)}
                  </td>
                  <td>
                    {formatCurrency(result().scenarioWithSipp.taxableIncome)}
                  </td>
                  <td>
                    {formatSignedCurrency(
                      result().scenarioWithSipp.taxableIncome -
                        result().scenarioWithoutSipp.taxableIncome,
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Personal allowance used</th>
                  <td>
                    {formatCurrency(result().scenarioWithoutSipp.effectivePA)}
                  </td>
                  <td>
                    {formatCurrency(result().scenarioWithSipp.effectivePA)}
                  </td>
                  <td>
                    {formatSignedCurrency(
                      result().scenarioWithSipp.effectivePA -
                        result().scenarioWithoutSipp.effectivePA,
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Income tax</th>
                  <td>
                    {formatCurrency(
                      result().scenarioWithoutSipp.incomeTax.total,
                    )}
                  </td>
                  <td>
                    {formatCurrency(result().scenarioWithSipp.incomeTax.total)}
                  </td>
                  <td>{formatSignedCurrency(taxDelta())}</td>
                </tr>
                <Show when={isEmployed() && input().includeNI}>
                  <tr>
                    <th scope="row">National Insurance</th>
                    <td>
                      {formatCurrency(
                        result().scenarioWithoutSipp.nationalInsurance,
                      )}
                    </td>
                    <td>
                      {formatCurrency(
                        result().scenarioWithSipp.nationalInsurance,
                      )}
                    </td>
                    <td>{formatSignedCurrency(niDelta())}</td>
                  </tr>
                </Show>
                <Show when={isCIS()}>
                  <tr>
                    <th scope="row">CIS deducted at source</th>
                    <td>
                      {formatCurrency(result().scenarioWithoutSipp.cisDeducted)}
                    </td>
                    <td>
                      {formatCurrency(result().scenarioWithSipp.cisDeducted)}
                    </td>
                    <td class="muted">—</td>
                  </tr>
                  <tr>
                    <th scope="row">SA balance (refund − / owed +)</th>
                    <td>
                      {formatSignedCurrency(
                        result().scenarioWithoutSipp.refundOrBalance,
                      )}
                    </td>
                    <td>
                      {formatSignedCurrency(
                        result().scenarioWithSipp.refundOrBalance,
                      )}
                    </td>
                    <td>{formatSignedCurrency(-refundDelta())}</td>
                  </tr>
                </Show>
                <tr>
                  <th scope="row">Pension paid out of pocket</th>
                  <td>
                    {formatCurrency(
                      result().scenarioWithoutSipp.pensionOutOfPocket,
                    )}
                  </td>
                  <td>
                    {formatCurrency(
                      result().scenarioWithSipp.pensionOutOfPocket,
                    )}
                  </td>
                  <td>
                    {formatSignedCurrency(
                      result().scenarioWithSipp.pensionOutOfPocket -
                        result().scenarioWithoutSipp.pensionOutOfPocket,
                    )}
                  </td>
                </tr>
                <tr class="total-row">
                  <th scope="row">Net cash in pocket</th>
                  <td>
                    {formatCurrency(
                      result().scenarioWithoutSipp.netCashPosition,
                    )}
                  </td>
                  <td>
                    {formatCurrency(result().scenarioWithSipp.netCashPosition)}
                  </td>
                  <td>{formatSignedCurrency(cashDelta())}</td>
                </tr>
                <tr class="total-row">
                  <th scope="row">Pension pot added</th>
                  <td>{formatCurrency(0)}</td>
                  <td>
                    {formatCurrency(result().contribution.totalAddedToPension)}
                  </td>
                  <td>
                    {formatSignedCurrency(
                      result().contribution.totalAddedToPension,
                    )}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Tax band</th>
                  <td>
                    {result().scenarioWithoutSipp.incomeTax.inAdditional > 0
                      ? "Additional rate"
                      : result().scenarioWithoutSipp.inHigherBand
                        ? "Higher rate"
                        : "Basic rate"}
                  </td>
                  <td>
                    {result().scenarioWithSipp.incomeTax.inAdditional > 0
                      ? "Additional rate"
                      : result().scenarioWithSipp.inHigherBand
                        ? "Higher rate"
                        : "Basic rate"}
                  </td>
                  <td class="muted">—</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="tax-card">
            <h2>Retirement projection</h2>
            <dl class="tax-defs">
              <div>
                <dt>Total pension pot</dt>
                <dd>{formatCurrency(result().withdrawal.totalPot)}</dd>
              </div>
              <div>
                <dt>
                  Tax-free lump sum (
                  {formatPercent(input().taxFreeLumpSumPercent, 0)})
                </dt>
                <dd>
                  <strong>
                    {formatCurrency(result().withdrawal.taxFreeLumpSum)}
                  </strong>
                </dd>
              </div>
              <div>
                <dt>Remaining taxable pot</dt>
                <dd>{formatCurrency(result().withdrawal.taxablePot)}</dd>
              </div>
              <div>
                <dt>Annual withdrawal (gross)</dt>
                <dd>{formatCurrency(result().withdrawal.annualWithdrawal)}</dd>
              </div>
              <div>
                <dt>Other taxable income</dt>
                <dd>{formatCurrency(result().withdrawal.otherIncome)}</dd>
              </div>
              <div>
                <dt>Personal allowance applied</dt>
                <dd>{formatCurrency(result().withdrawal.effectivePA)}</dd>
              </div>
              <div>
                <dt>Tax on the withdrawal portion</dt>
                <dd>
                  {formatCurrency(
                    result().withdrawal.incrementalTaxFromWithdrawal,
                  )}
                </dd>
              </div>
              <div>
                <dt>Net annual withdrawal</dt>
                <dd>
                  <strong>
                    {formatCurrency(result().withdrawal.netAnnualWithdrawal)}
                  </strong>
                </dd>
              </div>
              <div>
                <dt>Effective tax rate on the withdrawal</dt>
                <dd>
                  {formatPercent(result().withdrawal.effectiveTaxRate, 1)}
                </dd>
              </div>
              <div>
                <dt>UFPLS view (per £1 withdrawn)</dt>
                <dd>
                  {formatPercent(input().taxFreeLumpSumPercent, 0)} tax-free,{" "}
                  {formatPercent(1 - input().taxFreeLumpSumPercent, 0)} taxable
                </dd>
              </div>
            </dl>

            <div
              class={`tax-banner ${
                result().withdrawal.ageAccessAvailable ? "info" : "warn"
              }`}
            >
              {result().withdrawal.ageAccessAvailable ? (
                <>
                  At {input().age}, pension access may be available now (currently
                  age {result().withdrawal.ageThreshold}). Watch out for the Money
                  Purchase Annual Allowance (MPAA) once you take taxable pension
                  income — your future contribution allowance drops sharply.
                </>
              ) : (
                <>
                  At {input().age}, pension access is not normally available yet.
                  Minimum pension age is {result().withdrawal.ageThreshold} today
                  and rises to 57 from April 2028.
                </>
              )}
            </div>
          </div>

          <div class="tax-card">
            <h2>In plain English</h2>
            <ul class="tax-summary">
              <li>
                You contribute{" "}
                <strong>
                  {formatCurrency(result().contribution.netContribution)}
                </strong>{" "}
                out of pocket.{" "}
                <Show
                  when={result().contribution.governmentTopUp > 0}
                  fallback={
                    <>
                      Tax relief is applied automatically by reducing your taxable
                      pay
                      {input().contributionMethod === "salarySacrifice"
                        ? " and National Insurance"
                        : ""}
                      .
                    </>
                  }
                >
                  <>
                    The provider claims back{" "}
                    <strong>
                      {formatCurrency(result().contribution.governmentTopUp)}
                    </strong>{" "}
                    in basic-rate relief at source — this is the government top-up.
                  </>
                </Show>
              </li>
              <Show when={result().contribution.higherRateRelief > 0}>
                <li>
                  Because part of your income is in the higher- or additional-rate
                  band, you can claim a further{" "}
                  <strong>
                    {formatCurrency(result().contribution.higherRateRelief)}
                  </strong>{" "}
                  through Self Assessment. This usually arrives as a refund or a
                  reduction in your next tax bill — it does not go into the pension
                  itself.
                </li>
              </Show>
              <Show when={result().contribution.employerContribution > 0}>
                <li>
                  Your employer adds{" "}
                  <strong>
                    {formatCurrency(result().contribution.employerContribution)}
                  </strong>{" "}
                  on top.
                </li>
              </Show>
              <li>
                Total going into the pension this year:{" "}
                <strong>
                  {formatCurrency(result().contribution.totalAddedToPension)}
                </strong>
                . Cash you give up to do that:{" "}
                <strong>
                  {formatCurrency(result().contribution.effectiveCost)}
                </strong>
                .
              </li>
              <Show when={isCIS()}>
                <li>
                  CIS deductions of{" "}
                  <strong>
                    {formatCurrency(result().scenarioWithSipp.cisDeducted)}
                  </strong>{" "}
                  are payments on account, not your final tax bill. With the SIPP
                  your SA balance changes from{" "}
                  <strong>
                    {formatSignedCurrency(
                      result().scenarioWithoutSipp.refundOrBalance,
                    )}
                  </strong>{" "}
                  to{" "}
                  <strong>
                    {formatSignedCurrency(
                      result().scenarioWithSipp.refundOrBalance,
                    )}
                  </strong>{" "}
                  (negative = refund).
                </li>
              </Show>
              <Show
                when={
                  result().scenarioWithoutSipp.inHigherBand &&
                  !result().scenarioWithSipp.inHigherBand
                }
              >
                <li>
                  This contribution pulls all of your taxable income back below the
                  higher-rate threshold. Check whether other tapered allowances
                  (childcare, child benefit, personal allowance taper) now apply
                  differently.
                </li>
              </Show>
              <Show when={result().withdrawal.totalPot > 0}>
                <li>
                  Later, you could take{" "}
                  <strong>
                    {formatCurrency(result().withdrawal.taxFreeLumpSum)}
                  </strong>{" "}
                  tax-free, then draw{" "}
                  <strong>
                    {formatCurrency(result().withdrawal.annualWithdrawal)}
                  </strong>
                  /yr — netting{" "}
                  <strong>
                    {formatCurrency(result().withdrawal.netAnnualWithdrawal)}
                  </strong>{" "}
                  after tax.
                </li>
              </Show>
            </ul>
          </div>

          <div class="tax-card">
            <h2>Things to know</h2>
            <ul class="tax-notes">
              <li>
                CIS deductions are <em>payments on account</em>, not final tax.
                Your real tax bill depends on profit (income minus allowable
                expenses), not on gross CIS receipts.
              </li>
              <li>
                Allowable business expenses reduce your taxable profit directly.
                SIPP contributions paid personally do <em>not</em> reduce your
                self-employed profit — they extend the basic-rate band instead.
              </li>
              <li>
                Relief at source: net contribution ÷ (1 − basic rate) = gross
                contribution. The provider claims the difference from HMRC.
              </li>
              <li>
                Higher- and additional-rate taxpayers must claim the extra relief
                through Self Assessment — it does <em>not</em> appear in the
                pension automatically.
              </li>
              <li>
                Pension withdrawals: typically 25% tax-free (capped at the lump-sum
                allowance), 75% taxable as income. UFPLS applies the 25/75 split to
                each individual withdrawal instead of taking the lump sum upfront.
              </li>
              <li>
                Minimum access age is 55 today and rising to 57 from April 2028.
              </li>
              <li>
                <strong>MPAA &amp; recycling:</strong> taking taxable pension income
                triggers the Money Purchase Annual Allowance — your annual
                contribution allowance falls (currently £10,000). Withdrawing then
                immediately re-contributing can be treated as <em>pension
                recycling</em> by HMRC and unwound.
              </li>
              <li>
                Workplace pension schemes vary. Check with your scheme whether it
                uses relief at source, net pay, or salary sacrifice — the cash
                effects differ.
              </li>
              <li>
                This is an estimate. It does not model dividend income, savings
                income, Scottish/Welsh rates, the High Income Child Benefit Charge,
                self-employed Class 2/4 NI, or annual/lifetime allowance limits.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
