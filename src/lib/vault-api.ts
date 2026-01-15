import type { EncryptedPayload } from "@/lib/crypto";

type VaultStatusResponse = {
  exists: boolean;
};

type VaultPayloadResponse = {
  payload: EncryptedPayload;
};

type ErrorResponse = {
  error?: string;
};

const BASE_PATH = "/api/vault";

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const errorPayload = await parseJsonSafe<ErrorResponse>(response);
    const message =
      errorPayload?.error ??
      `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  const data = await parseJsonSafe<T>(response);
  if (!data) {
    throw new Error("Unexpected response from vault storage.");
  }

  return data;
}

export async function fetchVaultStatus(): Promise<VaultStatusResponse> {
  return requestJson<VaultStatusResponse>(`${BASE_PATH}/status`);
}

export async function initializeVault(payload: EncryptedPayload): Promise<void> {
  await requestJson(`${BASE_PATH}/init`, {
    method: "POST",
    body: JSON.stringify({ payload }),
  });
}

export async function loadVaultPayload(): Promise<EncryptedPayload> {
  const data = await requestJson<VaultPayloadResponse>(`${BASE_PATH}/load`);
  return data.payload;
}

export async function saveVaultPayload(payload: EncryptedPayload): Promise<void> {
  await requestJson(`${BASE_PATH}/save`, {
    method: "POST",
    body: JSON.stringify({ payload }),
  });
}
