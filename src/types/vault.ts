export type PasswordEntry = {
  id: string
  name: string
  username: string
  password: string
  url?: string
  notes?: string
}

export type CardEntry = {
  id: string
  name: string
  cardholder: string
  number: string
  expiryMonth: string
  expiryYear: string
  cvv: string
  notes?: string
}

export type IdentityEntry = {
  id: string
  name: string
  email?: string
  phone?: string
  nino?: string
  utr?: string
  nhsNumber?: string
  passportDetails?: string
  address?: string
  notes?: string
}

export type VaultData = {
  passwords: PasswordEntry[]
  cards: CardEntry[]
  identities: IdentityEntry[]
}

export type VaultCategory = keyof VaultData
