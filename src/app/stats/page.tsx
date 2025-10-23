"use client"

import { useEffect, useMemo, useState } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const MS_PER_DAY = 1000 * 60 * 60 * 24

const ACCOUNTS = [
  {
    label: "Mom's savings",
    principal: 62000,
  },
  {
    label: "Dad's savings",
    principal: 76000,
  },
] as const

export default function StatsPage() {
  const [annualRate, setAnnualRate] = useState(3.75)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    let animationFrame: number
    const startTime = performance.now()

    const tick = (now: number) => {
      setElapsedMs(now - startTime)
      animationFrame = requestAnimationFrame(tick)
    }

    animationFrame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(animationFrame)
  }, [])

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    []
  )

  const elapsedDays = elapsedMs / MS_PER_DAY
  const dailyRate = annualRate / 100 / 365

  const accountSummaries = useMemo(() => {
    return ACCOUNTS.map((account) => {
      const currentBalance = account.principal * Math.pow(1 + dailyRate, elapsedDays)
      const interestEarned = currentBalance - account.principal

      return {
        ...account,
        currentBalance,
        interestEarned,
      }
    })
  }, [elapsedDays, dailyRate])

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Insights</p>
        <h1 className="text-4xl font-bold tracking-tight">Family savings growth</h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Track how mom and dad's balances grow over time with daily compounded interest. Adjust the annual
          interest rate to explore different scenarios.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Interest settings</CardTitle>
          <CardDescription>
            Daily compounding based on an annual rate of {annualRate.toFixed(2)}% ({(dailyRate * 100).toFixed(4)}% per day).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="annualRate">Annual interest rate</Label>
            <div className="flex items-center gap-3">
              <Input
                id="annualRate"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                className="max-w-[8rem]"
                value={Number.isFinite(annualRate) ? annualRate : ""}
                onChange={(event) => {
                  const nextValue = Number.parseFloat(event.target.value)
                  setAnnualRate(Number.isNaN(nextValue) ? 0 : nextValue)
                }}
              />
              <span className="text-sm text-muted-foreground">% per year</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-6 md:grid-cols-2">
        {accountSummaries.map(({ label, principal, currentBalance, interestEarned }) => (
          <Card key={label} className="border-2">
            <CardHeader>
              <CardTitle>{label}</CardTitle>
              <CardDescription>Starting balance: {currencyFormatter.format(principal)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-1">
                <p className="text-sm uppercase tracking-wide text-muted-foreground">Current balance</p>
                <p className="text-3xl font-semibold tracking-tight">
                  {currencyFormatter.format(currentBalance)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/40 p-4">
                <p className="text-sm text-muted-foreground">Interest earned</p>
                <p className="text-xl font-medium">{currencyFormatter.format(interestEarned)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  )
}
