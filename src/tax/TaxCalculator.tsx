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
  type Jurisdiction,
  type TaxRegime,
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

// Map a marginal tax rate back to a UK band label, given the regime that
// produced it. Falls back to a percentage if the rate doesn't match any
// known bracket.
function bandLabel(rate: number, regime: TaxRegime): string {
  if (rate === 0) return "Below allowance";
  const idx = regime.brackets.findIndex((b) => b.rate === rate);
  if (idx < 0) return formatPercent(rate, 0);
  if (regime.brackets.length === 3) {
    return ["Basic rate", "Higher rate", "Additional rate"][idx] ?? formatPercent(rate, 0);
  }
  if (regime.brackets.length === 6) {
    return (
      [
        "Starter rate",
        "Basic rate",
        "Intermediate rate",
        "Higher rate",
        "Advanced rate",
        "Top rate",
      ][idx] ?? formatPercent(rate, 0)
    );
  }
  return formatPercent(rate, 0);
}

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
    setInput((prev) => ({ ...prev, bands: { ...prev.bands, [key]: value } }));

  const updateScottishBand = (
    key: keyof CalculatorInput["scottishBands"],
    value: number,
  ) =>
    setInput((prev) => ({
      ...prev,
      scottishBands: { ...prev.scottishBands, [key]: value },
    }));

  const updateNI = (key: keyof CalculatorInput["niBands"], value: number) =>
    setInput((prev) => ({
      ...prev,
      niBands: { ...prev.niBands, [key]: value },
    }));

  const updateClass4 = (
    key: keyof CalculatorInput["class4NI"],
    value: number,
  ) =>
    setInput((prev) => ({
      ...prev,
      class4NI: { ...prev.class4NI, [key]: value },
    }));

  const updateAA = <K extends keyof CalculatorInput["annualAllowance"]>(
    key: K,
    value: CalculatorInput["annualAllowance"][K],
  ) =>
    setInput((prev) => ({
      ...prev,
      annualAllowance: { ...prev.annualAllowance, [key]: value },
    }));

  const updateLSA = (
    key: keyof CalculatorInput["lumpSumAllowance"],
    value: number,
  ) =>
    setInput((prev) => ({
      ...prev,
      lumpSumAllowance: { ...prev.lumpSumAllowance, [key]: value },
    }));

  const resetBands = () =>
    setInput((prev) => ({ ...prev, bands: { ...DEFAULT_INPUT.bands } }));
  const resetScottishBands = () =>
    setInput((prev) => ({
      ...prev,
      scottishBands: { ...DEFAULT_INPUT.scottishBands },
    }));
  const resetNI = () =>
    setInput((prev) => ({ ...prev, niBands: { ...DEFAULT_INPUT.niBands } }));
  const resetClass4 = () =>
    setInput((prev) => ({ ...prev, class4NI: { ...DEFAULT_INPUT.class4NI } }));
  const resetAA = () =>
    setInput((prev) => ({
      ...prev,
      annualAllowance: { ...DEFAULT_INPUT.annualAllowance },
    }));
  const resetLSA = () =>
    setInput((prev) => ({
      ...prev,
      lumpSumAllowance: { ...DEFAULT_INPUT.lumpSumAllowance },
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
  const isScotland = () => input().jurisdiction === "scotland";

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
          plus a retirement drawdown projection. Supports rest-of-UK and Scottish
          tax bands.
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
            <h2>Employment</h2>
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
                <span class="field-label">Tax jurisdiction</span>
                <select
                  value={input().jurisdiction}
                  onChange={(e) =>
                    update(
                      "jurisdiction",
                      e.currentTarget.value as Jurisdiction,
                    )
                  }
                >
                  <option value="rUK">England, Wales &amp; NI (rUK)</option>
                  <option value="scotland">Scotland</option>
                </select>
                <span class="field-hint">
                  Scotland uses 6 income-tax bands. RAS providers still claim 20%
                  at source — Scottish residents reconcile via SA.
                </span>
              </label>

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
            <h2>Pension contribution</h2>

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
              <h2>Employer contribution</h2>
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
              <h2>Tax bands &amp; rates</h2>
              <span>
                {isScotland() ? "Scottish 6-band" : "rUK 3-band"}
              </span>
            </summary>
            <Show
              when={!isScotland()}
              fallback={
                <>
                  <div class="tax-grid">
                    <label class="field">
                      <span class="field-label">Personal allowance</span>
                      <input
                        type="number"
                        value={input().scottishBands.personalAllowance}
                        onInput={(e) =>
                          updateScottishBand(
                            "personalAllowance",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">Starter band ends at</span>
                      <input
                        type="number"
                        value={input().scottishBands.starterRateUpper}
                        onInput={(e) =>
                          updateScottishBand(
                            "starterRateUpper",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">Basic band ends at</span>
                      <input
                        type="number"
                        value={input().scottishBands.basicRateUpper}
                        onInput={(e) =>
                          updateScottishBand(
                            "basicRateUpper",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">Intermediate band ends at</span>
                      <input
                        type="number"
                        value={input().scottishBands.intermediateRateUpper}
                        onInput={(e) =>
                          updateScottishBand(
                            "intermediateRateUpper",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">Higher band ends at</span>
                      <input
                        type="number"
                        value={input().scottishBands.higherRateUpper}
                        onInput={(e) =>
                          updateScottishBand(
                            "higherRateUpper",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">Advanced band ends at</span>
                      <input
                        type="number"
                        value={input().scottishBands.advancedRateUpper}
                        onInput={(e) =>
                          updateScottishBand(
                            "advancedRateUpper",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">Starter rate</span>
                      <input
                        type="number"
                        step={0.01}
                        value={input().scottishBands.starterRate}
                        onInput={(e) =>
                          updateScottishBand(
                            "starterRate",
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
                        value={input().scottishBands.basicRate}
                        onInput={(e) =>
                          updateScottishBand(
                            "basicRate",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">Intermediate rate</span>
                      <input
                        type="number"
                        step={0.01}
                        value={input().scottishBands.intermediateRate}
                        onInput={(e) =>
                          updateScottishBand(
                            "intermediateRate",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">Higher rate</span>
                      <input
                        type="number"
                        step={0.01}
                        value={input().scottishBands.higherRate}
                        onInput={(e) =>
                          updateScottishBand(
                            "higherRate",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">Advanced rate</span>
                      <input
                        type="number"
                        step={0.01}
                        value={input().scottishBands.advancedRate}
                        onInput={(e) =>
                          updateScottishBand(
                            "advancedRate",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">Top rate</span>
                      <input
                        type="number"
                        step={0.01}
                        value={input().scottishBands.topRate}
                        onInput={(e) =>
                          updateScottishBand(
                            "topRate",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">PA taper start</span>
                      <input
                        type="number"
                        value={input().scottishBands.paTaperStart}
                        onInput={(e) =>
                          updateScottishBand(
                            "paTaperStart",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                    <label class="field">
                      <span class="field-label">PA taper rate</span>
                      <input
                        type="number"
                        step={0.05}
                        value={input().scottishBands.paTaperRate}
                        onInput={(e) =>
                          updateScottishBand(
                            "paTaperRate",
                            FALLBACK(e.currentTarget.value, 0),
                          )
                        }
                      />
                    </label>
                  </div>
                  <div class="tax-row-actions">
                    <button
                      class="btn ghost"
                      type="button"
                      onClick={resetScottishBands}
                    >
                      Reset Scottish defaults
                    </button>
                  </div>
                </>
              }
            >
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
                      updateBand(
                        "higherRate",
                        FALLBACK(e.currentTarget.value, 0),
                      )
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
                  <span class="field-label">PA taper rate</span>
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
                  Reset rUK defaults
                </button>
              </div>
            </Show>
          </details>

          <Show when={isEmployed()}>
            <details class="tax-card tax-collapsible">
              <summary>
                <h2>Employee NI (Class 1)</h2>
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
                <span>Include employee Class 1 NI in calculations</span>
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

          <Show when={isSelfEmployedOrCIS()}>
            <details class="tax-card tax-collapsible">
              <summary>
                <h2>Self-employed NI (Class 4)</h2>
                <span>Paid on profit, on top of income tax.</span>
              </summary>
              <label class="tax-checkbox">
                <input
                  type="checkbox"
                  checked={input().includeClass4NI}
                  onChange={(e) =>
                    update("includeClass4NI", e.currentTarget.checked)
                  }
                />
                <span>Include Class 4 NI in calculations</span>
              </label>
              <div class="tax-grid">
                <label class="field">
                  <span class="field-label">Lower profits limit</span>
                  <input
                    type="number"
                    value={input().class4NI.lowerLimit}
                    onInput={(e) =>
                      updateClass4(
                        "lowerLimit",
                        FALLBACK(e.currentTarget.value, 0),
                      )
                    }
                  />
                </label>
                <label class="field">
                  <span class="field-label">Upper profits limit</span>
                  <input
                    type="number"
                    value={input().class4NI.upperLimit}
                    onInput={(e) =>
                      updateClass4(
                        "upperLimit",
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
                    value={input().class4NI.mainRate}
                    onInput={(e) =>
                      updateClass4(
                        "mainRate",
                        FALLBACK(e.currentTarget.value, 0),
                      )
                    }
                  />
                </label>
                <label class="field">
                  <span class="field-label">Upper rate</span>
                  <input
                    type="number"
                    step={0.01}
                    value={input().class4NI.upperRate}
                    onInput={(e) =>
                      updateClass4(
                        "upperRate",
                        FALLBACK(e.currentTarget.value, 0),
                      )
                    }
                  />
                </label>
              </div>
              <div class="tax-row-actions">
                <button class="btn ghost" type="button" onClick={resetClass4}>
                  Reset Class 4 defaults
                </button>
              </div>
            </details>
          </Show>

          <details class="tax-card tax-collapsible">
            <summary>
              <h2>Annual Allowance &amp; MPAA</h2>
              <span>Cap on tax-relievable contributions.</span>
            </summary>
            <label class="tax-checkbox">
              <input
                type="checkbox"
                checked={input().annualAllowance.mpaaActive}
                onChange={(e) => updateAA("mpaaActive", e.currentTarget.checked)}
              />
              <span>
                MPAA triggered (already taken flexible drawdown / UFPLS)
              </span>
            </label>
            <div class="tax-grid">
              <label class="field">
                <span class="field-label">Regular AA</span>
                <input
                  type="number"
                  value={input().annualAllowance.regularLimit}
                  onInput={(e) =>
                    updateAA(
                      "regularLimit",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">MPAA limit</span>
                <input
                  type="number"
                  value={input().annualAllowance.mpaaLimit}
                  onInput={(e) =>
                    updateAA("mpaaLimit", FALLBACK(e.currentTarget.value, 0))
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Taper start (adjusted income)</span>
                <input
                  type="number"
                  value={input().annualAllowance.taperStart}
                  onInput={(e) =>
                    updateAA("taperStart", FALLBACK(e.currentTarget.value, 0))
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Taper rate</span>
                <input
                  type="number"
                  step={0.05}
                  value={input().annualAllowance.taperRate}
                  onInput={(e) =>
                    updateAA("taperRate", FALLBACK(e.currentTarget.value, 0))
                  }
                />
              </label>
              <label class="field">
                <span class="field-label">Floor (tapered minimum)</span>
                <input
                  type="number"
                  value={input().annualAllowance.minimum}
                  onInput={(e) =>
                    updateAA("minimum", FALLBACK(e.currentTarget.value, 0))
                  }
                />
              </label>
            </div>
            <div class="tax-row-actions">
              <button class="btn ghost" type="button" onClick={resetAA}>
                Reset AA defaults
              </button>
            </div>
          </details>

          <details class="tax-card tax-collapsible">
            <summary>
              <h2>Lump Sum Allowance</h2>
              <span>Caps the tax-free portion of pension lump sums.</span>
            </summary>
            <div class="tax-grid">
              <label class="field">
                <span class="field-label">LSA cap (lifetime)</span>
                <input
                  type="number"
                  value={input().lumpSumAllowance.cap}
                  onInput={(e) =>
                    updateLSA("cap", FALLBACK(e.currentTarget.value, 0))
                  }
                />
                <span class="field-hint">
                  Default £268,275 — replaced the LTA in April 2024.
                </span>
              </label>
              <label class="field">
                <span class="field-label">Already used</span>
                <input
                  type="number"
                  value={input().lumpSumAllowance.alreadyUsed}
                  onInput={(e) =>
                    updateLSA(
                      "alreadyUsed",
                      FALLBACK(e.currentTarget.value, 0),
                    )
                  }
                />
                <span class="field-hint">
                  Tax-free lump sums you've already taken from any pension.
                </span>
              </label>
            </div>
            <div class="tax-row-actions">
              <button class="btn ghost" type="button" onClick={resetLSA}>
                Reset LSA defaults
              </button>
            </div>
          </details>

          <details class="tax-card tax-collapsible">
            <summary>
              <h2>Retirement &amp; withdrawal</h2>
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
              <div class="total">
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
            <h2>Annual Allowance</h2>
            <dl class="tax-defs">
              <div>
                <dt>Allowance for this year</dt>
                <dd>
                  <strong>
                    {formatCurrency(result().contribution.annualAllowance.limit)}
                  </strong>{" "}
                  <Show when={result().contribution.annualAllowance.mpaaActive}>
                    <span class="muted">(MPAA)</span>
                  </Show>
                  <Show when={result().contribution.annualAllowance.tapered}>
                    <span class="muted">(tapered)</span>
                  </Show>
                </dd>
              </div>
              <div>
                <dt>Total contributions counted (you + employer)</dt>
                <dd>{formatCurrency(result().contribution.annualAllowance.used)}</dd>
              </div>
              <div>
                <dt>Remaining headroom</dt>
                <dd>
                  {formatCurrency(result().contribution.annualAllowance.remaining)}
                </dd>
              </div>
            </dl>
            <Show when={result().contribution.annualAllowance.exceeded}>
              <div class="tax-banner warn">
                <strong>Annual Allowance exceeded by{" "}
                {formatCurrency(result().contribution.annualAllowance.excess)}.</strong>{" "}
                The excess is taxed at your marginal rate via the Annual Allowance
                charge — it cancels the relief on the over-payment. Consider
                carry-forward (up to 3 prior years of unused AA) or reducing this
                year's contribution.
              </div>
            </Show>
            <Show
              when={
                !result().contribution.annualAllowance.exceeded &&
                result().contribution.annualAllowance.tapered
              }
            >
              <div class="tax-banner info">
                Your AA is tapered because adjusted income exceeds the taper
                threshold. The figure above is the reduced limit; the standard AA
                no longer applies.
              </div>
            </Show>
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
                    <th scope="row">Class 1 NI</th>
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
                <Show when={isSelfEmployedOrCIS() && input().includeClass4NI}>
                  <tr>
                    <th scope="row">Class 4 NI</th>
                    <td>
                      {formatCurrency(result().scenarioWithoutSipp.class4NI)}
                    </td>
                    <td>
                      {formatCurrency(result().scenarioWithSipp.class4NI)}
                    </td>
                    <td class="muted">—</td>
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
                  <th scope="row">Top tax band reached</th>
                  <td>
                    {bandLabel(
                      result().scenarioWithoutSipp.incomeTax.topMarginalRate,
                      result().regime,
                    )}
                  </td>
                  <td>
                    {bandLabel(
                      result().scenarioWithSipp.incomeTax.topMarginalRate,
                      result().regime,
                    )}
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
              <Show when={result().withdrawal.lsaCapApplied}>
                <div>
                  <dt>Capped by LSA — TFLS reduced from</dt>
                  <dd>
                    {formatCurrency(
                      result().withdrawal.taxFreeLumpSumRequested,
                    )}{" "}
                    →{" "}
                    {formatCurrency(result().withdrawal.taxFreeLumpSum)}
                  </dd>
                </div>
              </Show>
              <div>
                <dt>LSA remaining after this</dt>
                <dd>
                  {formatCurrency(result().withdrawal.lsaRemainingAfter)}
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

            <Show when={result().withdrawal.lsaCapApplied}>
              <div class="tax-banner warn">
                <strong>Lump Sum Allowance reached.</strong> Anything above the LSA
                cap is paid as taxable income, not tax-free. £
                {formatCurrency(result().withdrawal.taxFreeLumpSumCapped, true)} of
                your requested lump sum becomes taxable.
              </div>
            </Show>

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
                  band
                  {isScotland() ? " (Scottish bands)" : ""}, you can claim a further{" "}
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
                <strong>Annual Allowance:</strong> contributions above the AA are
                taxed at your marginal rate via an AA charge — relief is clawed
                back. The AA tapers above adjusted income of £260k toward £10k
                minimum.
              </li>
              <li>
                <strong>MPAA:</strong> taking taxable pension income drops your AA
                to £10k. Withdrawing and immediately re-contributing can be
                treated as <em>pension recycling</em> and unwound by HMRC.
              </li>
              <li>
                <strong>Lump Sum Allowance (£268,275):</strong> caps the tax-free
                portion of pension lump sums across all your pensions. Anything
                above the LSA is paid as taxable income.
              </li>
              <li>
                Pension withdrawals: typically 25% tax-free up to the LSA, then 75%
                taxable. UFPLS applies the 25/75 split per withdrawal instead of
                taking the lump sum upfront.
              </li>
              <li>
                Minimum access age is 55 today and rising to 57 from April 2028.
              </li>
              <li>
                Workplace pension schemes vary. Check with your scheme whether it
                uses relief at source, net pay, or salary sacrifice — the cash
                effects differ.
              </li>
              <li>
                Self-employed pay Class 4 NI on profit (6% / 2% above the UEL) on
                top of income tax. Class 2 was made non-compulsory for most from
                April 2024.
              </li>
              <li>
                This is an estimate. It does not model dividend / savings income,
                the High Income Child Benefit Charge, marriage allowance, or
                carry-forward of unused AA from prior years.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
