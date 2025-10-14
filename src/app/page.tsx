"use client"

import { memo, useCallback, useEffect, useMemo, useState, startTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { decryptData, encryptData, InvalidPasswordError, type EncryptedPayload } from "@/lib/crypto"
import { cn } from "@/lib/utils"
import type {
  CardEntry,
  IdentityEntry,
  PasswordEntry,
  VaultCategory,
  VaultData,
} from "@/types/vault"

const generateId = () => {
  const cryptoObj = globalThis.crypto as Crypto | undefined
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID()
  }

  return Math.random().toString(36).slice(2)
}

const formatCardNumberInput = (rawValue: string) => {
  const digitsOnly = rawValue.replace(/\D/g, "").slice(0, 16)
  return digitsOnly.replace(/(\d{4})(?=\d)/g, "$1 ")
}

type VaultItem = PasswordEntry | CardEntry | IdentityEntry

type DialogState = {
  category: VaultCategory
  mode: "create" | "edit"
  item?: VaultItem
}

type FeedbackState = {
  type: "success" | "error"
  message: string
}

type CategoryConfig<T extends VaultItem> = {
  title: string
  singular: string
  description: string
  fields: Array<{
    key: keyof T
    label: string
    placeholder?: string
    type?: string
    multiline?: boolean
  }>
}

const CATEGORY_CONFIG: {
  passwords: CategoryConfig<PasswordEntry>
  cards: CategoryConfig<CardEntry>
  identities: CategoryConfig<IdentityEntry>
} = {
  passwords: {
    title: "Passwords",
    singular: "Password",
    description: "Store credentials for websites and applications.",
    fields: [
      { key: "name", label: "Label", placeholder: "Email" },
      { key: "username", label: "Username", placeholder: "you@example.com" },
      { key: "password", label: "Password", type: "password" },
      { key: "url", label: "URL", placeholder: "https://" },
      { key: "notes", label: "Notes", multiline: true, placeholder: "Additional context" },
    ],
  },
  cards: {
    title: "Cards",
    singular: "Card",
    description: "Securely keep payment information on hand.",
    fields: [
      { key: "name", label: "Label", placeholder: "Personal Visa" },
      { key: "cardholder", label: "Cardholder Name" },
      { key: "number", label: "Number", placeholder: "0000 0000 0000 0000" },
      { key: "expiryMonth", label: "Expiry Month", placeholder: "MM" },
      { key: "expiryYear", label: "Expiry Year", placeholder: "YYYY" },
      { key: "cvv", label: "Security Code", placeholder: "123" },
      { key: "notes", label: "Notes", multiline: true, placeholder: "Usage notes" },
    ],
  },
  identities: {
    title: "Identities",
    singular: "Identity",
    description: "Keep track of personal profile details.",
    fields: [
      { key: "name", label: "Name" },
      { key: "email", label: "Email", placeholder: "you@example.com" },
      { key: "phone", label: "Phone" },
      { key: "nino", label: "National Insurance Number", placeholder: "QQ 12 34 56 C" },
      { key: "utr", label: "UTR", placeholder: "12345 67890" },
      { key: "nhsNumber", label: "NHS Number", placeholder: "123 456 7890" },
      {
        key: "passportDetails",
        label: "Passport Details",
        multiline: true,
        placeholder: "Number, expiry date, issuing country",
      },
      { key: "address", label: "Address", multiline: true },
      { key: "notes", label: "Notes", multiline: true },
    ],
  },
}

export default function Home() {
  const [vaultExists, setVaultExists] = useState<boolean | null>(null)
  const [vaultData, setVaultData] = useState<VaultData | null>(null)
  const [sessionPassword, setSessionPassword] = useState<string | null>(null)

  const [setupPassword, setSetupPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loginPassword, setLoginPassword] = useState("")

  const [isInitializing, setIsInitializing] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const [feedback, setFeedback] = useState<FeedbackState | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [dialogState, setDialogState] = useState<DialogState | null>(null)
  const [formState, setFormState] = useState<Record<string, string>>({})

  const [activeTab, setActiveTab] = useState<VaultCategory>("passwords")
  const unlocked = useMemo(() => vaultData !== null && sessionPassword !== null, [vaultData, sessionPassword])

  const showLoading = useMemo(() => vaultExists === null, [vaultExists])
  const showSetup = useMemo(() => vaultExists === false, [vaultExists])
  const showUnlock = useMemo(() => vaultExists === true && !unlocked, [vaultExists, unlocked])
  const shouldCenter = useMemo(() => showLoading || showSetup || showUnlock, [showLoading, showSetup, showUnlock])

  useEffect(() => {
    if (!dialogState) {
      setFormState({})
      return
    }

    const config = CATEGORY_CONFIG[dialogState.category]
    const initial: Record<string, string> = {}

    for (const field of config.fields) {
      let value = dialogState.item ? (dialogState.item as Record<string, string>)[field.key as string] ?? "" : ""

      if (dialogState.category === "cards" && field.key === "number") {
        value = formatCardNumberInput(String(value))
      }

      initial[field.key as string] = value
    }

    setFormState(initial)
  }, [dialogState])

  useEffect(() => {
    if (!feedback) {
      return
    }

    const timeout = window.setTimeout(() => {
      setFeedback(null)
    }, 4000)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [feedback])

  const checkVaultStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/status", {
        // Disable caching for vault status checks
        cache: 'no-store'
      })
      if (!res.ok) {
        throw new Error("Failed to determine vault status")
      }
      const payload = (await res.json()) as { exists: boolean }
      setVaultExists(payload.exists)
    } catch (error) {
      setPageError("Unable to reach the vault service. Refresh to try again.")
      console.error(error)
    }
  }, [])

  useEffect(() => {
    void checkVaultStatus()
  }, [checkVaultStatus])

  useEffect(() => {
    if (typeof window === "undefined" || !('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') {
      return
    }

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js')
      } catch (error) {
        console.error('Service worker registration failed', error)
      }
    }

    void register()
  }, [])

  const handleInitialize = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setFeedback(null)

      if (!setupPassword.trim()) {
        setFeedback({ type: "error", message: "Choose a master password." })
        return
      }

      if (setupPassword !== confirmPassword) {
        setFeedback({ type: "error", message: "Passwords do not match." })
        return
      }

      setIsInitializing(true)
      try {
        const emptyVault: VaultData = {
          passwords: [],
          cards: [],
          identities: [],
        }

        const payload = await encryptData(emptyVault, setupPassword)
        const res = await fetch("/api/vault/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload }),
        })

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(payload?.error ?? "Failed to initialize vault")
        }

        setVaultExists(true)
        setSetupPassword("")
        setConfirmPassword("")
        setFeedback({ type: "success", message: "Vault initialized. Unlock it with your master password." })
      } catch (error) {
        console.error(error)
        setFeedback({ type: "error", message: error instanceof Error ? error.message : "Unable to initialize vault." })
      } finally {
        setIsInitializing(false)
      }
    },
    [confirmPassword, setupPassword]
  )

  const unlockWithPassword = useCallback(
    async (password: string) => {
      const res = await fetch("/api/vault/load")
      const body = (await res.json().catch(() => null)) as { payload?: EncryptedPayload; error?: string } | null

      if (!res.ok || !body?.payload) {
        throw new Error(body?.error ?? "Failed to unlock vault")
      }

      const decrypted = await decryptData<VaultData>(body.payload, password)
      setVaultData(decrypted)
      setSessionPassword(password)
      setLoginPassword("")
      setFeedback({ type: "success", message: "Vault unlocked." })
    },
    []
  )

  const handleUnlock = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setFeedback(null)

      if (!loginPassword.trim()) {
        setFeedback({ type: "error", message: "Enter your master password." })
        return
      }

      setIsUnlocking(true)
      try {
        await unlockWithPassword(loginPassword)
      } catch (error) {
        console.error(error)
        if (error instanceof InvalidPasswordError) {
          setFeedback({ type: "error", message: "Invalid master password." })
        } else {
          setFeedback({ type: "error", message: error instanceof Error ? error.message : "Unable to unlock vault." })
        }
      } finally {
        setIsUnlocking(false)
      }
    },
    [loginPassword, unlockWithPassword]
  )

  const handleLock = useCallback(() => {
    setVaultData(null)
    setSessionPassword(null)
    setFeedback({ type: "success", message: "Vault locked." })
  }, [])

  const persistVault = useCallback(
    async (data: VaultData, successMessage: string) => {
      if (!sessionPassword) {
        setFeedback({ type: "error", message: "Unlock the vault to continue." })
        return false
      }

      setIsSaving(true)
      setFeedback(null)

      try {
        const payload = await encryptData(data, sessionPassword)
        const res = await fetch("/api/vault/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload }),
        })

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(payload?.error ?? "Failed to save vault")
        }

        setVaultData(data)
        setFeedback({ type: "success", message: successMessage })
        return true
      } catch (error) {
        console.error(error)
        setFeedback({ type: "error", message: error instanceof Error ? error.message : "Unable to save vault." })
        return false
      } finally {
        setIsSaving(false)
      }
    },
    [sessionPassword]
  )

  const handleDialogSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!dialogState || !vaultData) {
        return
      }

      const { category, mode, item } = dialogState
      const config = CATEGORY_CONFIG[category]
      const updatedVault: VaultData = structuredClone(vaultData)
      const entries = updatedVault[category]
      const base: Record<string, string> = mode === "edit" && item ? { ...item } : { id: generateId() }

      for (const field of config.fields) {
        const rawValue = (formState[field.key as string] ?? "").trim()

        if (dialogState.category === "cards" && field.key === "number") {
          base[field.key as string] = rawValue.replace(/\D/g, "").slice(0, 16)
        } else {
          base[field.key as string] = rawValue
        }
      }

      if (!base.name) {
        setFeedback({ type: "error", message: "A name or label is required." })
        return
      }

      const typedEntry = base as VaultItem

      if (mode === "edit" && item) {
        const idx = entries.findIndex((entry) => entry.id === item.id)
        if (idx !== -1) {
          entries[idx] = typedEntry as never
        }
      } else {
        entries.unshift(typedEntry as never)
      }

      const ok = await persistVault(updatedVault, mode === "edit" ? "Entry updated." : "Entry added.")
      if (ok) {
        setDialogState(null)
      }
    },
    [dialogState, formState, persistVault, vaultData]
  )

  const handleDelete = useCallback(
    async (category: VaultCategory, id: string) => {
      if (!vaultData) {
        return
      }

      const updatedVault: VaultData = structuredClone(vaultData)
      updatedVault[category] = updatedVault[category].filter((entry) => entry.id !== id) as never
      const ok = await persistVault(updatedVault, "Entry removed.")
      if (ok) {
        setDialogState(null)
      }
    },
    [persistVault, vaultData]
  )

  const handleCopy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setFeedback({ type: "success", message: "Copied to clipboard." })
    } catch (error) {
      console.error(error)
      setFeedback({ type: "error", message: "Clipboard copy failed." })
    }
  }, [])

  const handleFieldChange = useCallback(
    (fieldKey: string, rawValue: string) => {
      let value = rawValue

      if (dialogState?.category === "cards" && fieldKey === "number") {
        value = formatCardNumberInput(rawValue)
      }

      // Use startTransition for non-urgent state updates
      startTransition(() => {
        setFormState((prev) => ({ ...prev, [fieldKey]: value }))
      })
    },
    [dialogState]
  )

  const renderEmptyState = useCallback((category: VaultCategory) => {
    const config = CATEGORY_CONFIG[category]

    return (
      <div className="text-sm text-muted-foreground rounded-2xl border border-dashed border-border/70 bg-background/80 p-8 text-center shadow-inner">
        <p className="mb-2 text-base font-medium text-foreground">No {config.title.toLowerCase()} yet</p>
        <p className="mb-4 text-sm text-muted-foreground">Start by adding an entry – only encrypted data is saved to disk.</p>
        <Button variant="secondary" className="rounded-full px-4" onClick={() => setDialogState({ category, mode: "create" })}>
          Add {config.singular}
        </Button>
      </div>
    )
  }, [])

  const renderPasswordEntry = useCallback((entry: PasswordEntry) => (
    <Card key={entry.id} className="rounded-2xl border border-border/70 bg-background/70 shadow-sm backdrop-blur">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <CardTitle className="text-lg font-semibold">{entry.name}</CardTitle>
          <CardDescription>{entry.url || entry.username}</CardDescription>
        </div>
        <CardAction className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialogState({ category: "passwords", mode: "edit", item: entry })}
          >
            Edit
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void handleDelete("passwords", entry.id)}>
            Delete
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <DetailRow label="Username" value={entry.username} onCopy={handleCopy} />
        <DetailRow label="Password" value={entry.password} mask onCopy={handleCopy} />
        {entry.url ? <DetailRow label="URL" value={entry.url} /> : null}
        {entry.notes ? <DetailRow label="Notes" value={entry.notes} multiline /> : null}
      </CardContent>
    </Card>
  ), [handleCopy, handleDelete])

  const renderCardEntry = useCallback((entry: CardEntry) => {
    const expiry = [entry.expiryMonth, entry.expiryYear].filter(Boolean).join('/')

    return (
      <Card key={entry.id} className="rounded-2xl border border-border/70 bg-background/70 shadow-sm backdrop-blur">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <CardTitle className="text-lg font-semibold">{entry.name}</CardTitle>
            <CardDescription>{entry.cardholder}</CardDescription>
          </div>
          <CardAction className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialogState({ category: "cards", mode: "edit", item: entry })}
            >
              Edit
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void handleDelete("cards", entry.id)}>
              Delete
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <DetailRow label="Number" value={entry.number} mask onCopy={handleCopy} />
          {expiry ? <DetailRow label="Expiry" value={expiry} /> : null}
          <DetailRow label="CVV" value={entry.cvv} mask onCopy={handleCopy} />
          {entry.notes ? (
            <div className="sm:col-span-2">
              <DetailRow label="Notes" value={entry.notes} multiline />
            </div>
          ) : null}
        </CardContent>
      </Card>
    )
  }, [handleCopy, handleDelete])

  const renderIdentityEntry = useCallback((entry: IdentityEntry) => (
    <Card key={entry.id} className="rounded-2xl border border-border/70 bg-background/70 shadow-sm backdrop-blur">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <CardTitle className="text-lg font-semibold">{entry.name}</CardTitle>
          <CardDescription>{entry.email || entry.phone}</CardDescription>
        </div>
        <CardAction className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialogState({ category: "identities", mode: "edit", item: entry })}
          >
            Edit
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void handleDelete("identities", entry.id)}>
            Delete
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {entry.email ? <DetailRow label="Email" value={entry.email} onCopy={handleCopy} /> : null}
        {entry.phone ? <DetailRow label="Phone" value={entry.phone} onCopy={handleCopy} /> : null}
        {entry.nino ? (
          <DetailRow label="National Insurance Number" value={entry.nino} onCopy={handleCopy} />
        ) : null}
        {entry.utr ? <DetailRow label="UTR" value={entry.utr} onCopy={handleCopy} /> : null}
        {entry.nhsNumber ? <DetailRow label="NHS Number" value={entry.nhsNumber} onCopy={handleCopy} /> : null}
        {entry.passportDetails ? (
          <DetailRow label="Passport Details" value={entry.passportDetails} multiline />
        ) : null}
        {entry.address ? <DetailRow label="Address" value={entry.address} multiline /> : null}
        {entry.notes ? <DetailRow label="Notes" value={entry.notes} multiline /> : null}
      </CardContent>
    </Card>
  ), [handleCopy, handleDelete])

  return (
    <>
      <main
        className={cn(
          "flex w-full flex-1 flex-col gap-6 sm:gap-10",
          shouldCenter ? "items-center justify-center" : "pb-4"
        )}
      >
        <header
          className={cn(
            "flex w-full flex-col gap-4",
            !shouldCenter && "sm:flex-row sm:items-start sm:justify-between",
            shouldCenter ? "mx-auto max-w-sm items-center text-center sm:max-w-md" : "items-start text-left"
          )}
        >
          <div className="space-y-2 sm:max-w-xl">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">1Pass Vault</h1>
          </div>
        </header>

        {pageError ? (
          <div
            className={cn(
              "w-full rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive",
              shouldCenter && "max-w-xl"
            )}
          >
            {pageError}
          </div>
        ) : null}

        {showLoading ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            Loading vault status…
          </div>
        ) : null}

        {showSetup ? (
          <Card className="w-full max-w-xl rounded-2xl border border-border/70 bg-background/80 shadow-lg backdrop-blur">
            <CardHeader className="space-y-1">
              <CardTitle>Set up your vault</CardTitle>
              <CardDescription>
                Pick a strong master password. It is never sent anywhere, so store it safely – you will need it to unlock your data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-6" onSubmit={handleInitialize}>
                <div className="space-y-2">
                  <Label htmlFor="master">Master password</Label>
                  <Input
                    id="master"
                    type="password"
                    autoComplete="new-password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                  />
                </div>
                <Button className="w-full" size="lg" disabled={isInitializing}>
                  {isInitializing ? "Encrypting…" : "Create vault"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {showUnlock ? (
          <Card className="w-full max-w-xl rounded-2xl border border-border/70 bg-background/80 shadow-lg backdrop-blur">
            <CardHeader className="space-y-1">
              <CardTitle>Unlock vault</CardTitle>
              <CardDescription>Enter your master password to decrypt your entries.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleUnlock}>
                <div className="space-y-2">
                  <Label htmlFor="unlock">Master password</Label>
                  <Input
                    id="unlock"
                    type="password"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    required
                  />
                </div>
                <Button className="w-full" size="lg" disabled={isUnlocking}>
                  {isUnlocking ? "Decrypting…" : "Unlock"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {unlocked && vaultData ? (
          <section className="flex flex-1 flex-col gap-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-semibold text-foreground">Vault contents</h2>
                  <Button
                    variant="link"
                    size="sm"
                    asChild
                    className="text-sm"
                  >
                    <a href="/visa">Visa</a>
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">Your encrypted data stays on this device unless you export it.</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLock}
                  className="rounded-full border-border/60 bg-background/70 px-4"
                >
                  Lock
                </Button>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as VaultCategory)} className="flex-1">
              <TabsList className="w-full overflow-x-auto rounded-full border border-border/60 bg-muted/50 p-1 text-sm shadow-sm sm:w-auto gap-1">
                <TabsTrigger 
                  value="passwords" 
                  className="rounded-full px-4 py-2 text-xs font-medium sm:px-6 sm:text-sm"
                  onClick={() => startTransition(() => setActiveTab("passwords"))}
                >
                  Passwords
                </TabsTrigger>
                <TabsTrigger 
                  value="cards" 
                  className="rounded-full px-4 py-2 text-xs font-medium sm:px-6 sm:text-sm"
                  onClick={() => startTransition(() => setActiveTab("cards"))}
                >
                  Cards
                </TabsTrigger>
                <TabsTrigger 
                  value="identities" 
                  className="rounded-full px-4 py-2 text-xs font-medium sm:px-6 sm:text-sm"
                  onClick={() => startTransition(() => setActiveTab("identities"))}
                >
                  Identities
                </TabsTrigger>
              </TabsList>
              <TabsContent value="passwords" className="mt-6 space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">Credentials for logins and apps.</p>
                  <Button size="sm" className="rounded-full px-4" onClick={() => setDialogState({ category: "passwords", mode: "create" })}>
                    Add password
                  </Button>
                </div>
                <Separator className="bg-border/60" />
                {vaultData.passwords.length === 0
                  ? renderEmptyState("passwords")
                  : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {vaultData.passwords.map((entry) => renderPasswordEntry(entry))}
                      </div>
                    )}
              </TabsContent>
              <TabsContent value="cards" className="mt-6 space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">Payment cards stay encrypted at rest.</p>
                  <Button size="sm" className="rounded-full px-4" onClick={() => setDialogState({ category: "cards", mode: "create" })}>
                    Add card
                  </Button>
                </div>
                <Separator className="bg-border/60" />
                {vaultData.cards.length === 0
                  ? renderEmptyState("cards")
                  : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {vaultData.cards.map((entry) => renderCardEntry(entry))}
                      </div>
                    )}
              </TabsContent>
              <TabsContent value="identities" className="mt-6 space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">Profiles and address information.</p>
                  <Button size="sm" className="rounded-full px-4" onClick={() => setDialogState({ category: "identities", mode: "create" })}>
                    Add identity
                  </Button>
                </div>
                <Separator className="bg-border/60" />
                {vaultData.identities.length === 0
                  ? renderEmptyState("identities")
                  : (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {vaultData.identities.map((entry) => renderIdentityEntry(entry))}
                      </div>
                    )}
              </TabsContent>
            </Tabs>
          </section>
        ) : null}

        <Dialog open={Boolean(dialogState)} onOpenChange={(open) => !open && setDialogState(null)}>
        <DialogContent>
          {dialogState ? (
            <form className="space-y-6" onSubmit={handleDialogSubmit}>
              <DialogHeader>
                <DialogTitle>
                  {dialogState.mode === "edit"
                    ? `Edit ${CATEGORY_CONFIG[dialogState.category].singular}`
                    : `Add ${CATEGORY_CONFIG[dialogState.category].singular}`}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {CATEGORY_CONFIG[dialogState.category].fields.map((field) => (
                  <div key={String(field.key)} className="space-y-2">
                    <Label htmlFor={`field-${String(field.key)}`}>{field.label}</Label>
                    {field.multiline ? (
                      <Textarea
                        id={`field-${String(field.key)}`}
                        value={formState[String(field.key)] ?? ""}
                        onChange={(event) =>
                          setFormState((prev) => ({ ...prev, [String(field.key)]: event.target.value }))
                        }
                        placeholder={field.placeholder}
                        rows={4}
                      />
                    ) : (
                      <Input
                        id={`field-${String(field.key)}`}
                        type={field.type ?? "text"}
                        value={formState[String(field.key)] ?? ""}
                        onChange={(event) => handleFieldChange(String(field.key), event.target.value)}
                        placeholder={field.placeholder}
                      />
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogState(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
        </Dialog>
      </main>

      {feedback ? (
        <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-end sm:inset-x-auto sm:right-6 sm:bottom-auto sm:top-4">
          <div
            className={cn(
              "pointer-events-auto w-full max-w-sm rounded-lg px-4 py-3 text-sm shadow-lg",
              feedback.type === "success"
                ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                : "border border-destructive/40 bg-destructive/10 text-destructive"
            )}
            role="status"
            aria-live="polite"
          >
            {feedback.message}
          </div>
        </div>
      ) : null}
    </>
  )
}

type DetailRowProps = {
  label: string
  value?: string
  mask?: boolean
  multiline?: boolean
  onCopy?: (value: string) => void
}

const DetailRow = memo(function DetailRow({ label, value, mask, multiline, onCopy }: DetailRowProps) {
  if (!value) return null

  const displayValue = mask ? "••••••••" : value

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-background/80 p-4 text-sm shadow-inner">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground uppercase tracking-wide text-[11px]">{label}</span>
        {onCopy ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => onCopy(value)}
          >
            Copy
          </Button>
        ) : null}
      </div>
      <div className={cn("text-foreground", multiline ? "whitespace-pre-line" : "truncate font-medium")}>{displayValue}</div>
    </div>
  )
})
