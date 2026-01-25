export type VaultIdentityItem = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  nino: string;
  nhsNumber: string;
  passNumber: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
};

export type VaultPayload = {
  identities: VaultIdentityItem[];
};

export const DEFAULT_VAULT_PAYLOAD: VaultPayload = {
  identities: [],
};
