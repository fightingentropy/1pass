import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  DEFAULT_VAULT_PAYLOAD,
  isVaultEncryptedPayload,
  type VaultEncryptedPayload,
  type VaultApiKeyItem,
  type VaultIdentityItem,
  type VaultPayload,
} from "../functions/api/vault/schema";
import "./app.css";
import {
  createVaultSession,
  decryptVaultPayload,
  encryptVaultPayload,
  restoreVaultSession,
  type VaultSession,
} from "./vaultCrypto";

const LEGACY_STORAGE_KEYS = {
  passwordHash: "vault.password.hash",
  passwordSalt: "vault.password.salt",
};

type GateView = "loading" | "setup" | "locked" | "unlocked";
type VaultSection = "identities" | "apiKeys";

type IdentityDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  nino: string;
  nhsNumber: string;
  passNumber: string;
  notes: string;
};

type ApiKeyDraft = {
  label: string;
  service: string;
  key: string;
  environment: string;
  notes: string;
};

type EditingTarget =
  | { section: "identities"; id: string }
  | { section: "apiKeys"; id: string };

function createVaultDefault(): VaultPayload {
  return JSON.parse(JSON.stringify(DEFAULT_VAULT_PAYLOAD)) as VaultPayload;
}

function createId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function createIdentityDraft(): IdentityDraft {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    nino: "",
    nhsNumber: "",
    passNumber: "",
    notes: "",
  };
}

function createApiKeyDraft(): ApiKeyDraft {
  return {
    label: "",
    service: "",
    key: "",
    environment: "",
    notes: "",
  };
}

function normalizeIdentityItem(
  raw: Partial<VaultIdentityItem>,
): VaultIdentityItem {
  const now = Date.now();
  return {
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : createId(),
    firstName: typeof raw.firstName === "string" ? raw.firstName : "",
    lastName: typeof raw.lastName === "string" ? raw.lastName : "",
    email: typeof raw.email === "string" ? raw.email : "",
    phone: typeof raw.phone === "string" ? raw.phone : "",
    address: typeof raw.address === "string" ? raw.address : "",
    nino: typeof raw.nino === "string" ? raw.nino : "",
    nhsNumber: typeof raw.nhsNumber === "string" ? raw.nhsNumber : "",
    passNumber: typeof raw.passNumber === "string" ? raw.passNumber : "",
    notes: typeof raw.notes === "string" ? raw.notes : "",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

function normalizeApiKeyItem(raw: Partial<VaultApiKeyItem>): VaultApiKeyItem {
  const now = Date.now();
  return {
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : createId(),
    label: typeof raw.label === "string" ? raw.label : "",
    service: typeof raw.service === "string" ? raw.service : "",
    key: typeof raw.key === "string" ? raw.key : "",
    environment: typeof raw.environment === "string" ? raw.environment : "",
    notes: typeof raw.notes === "string" ? raw.notes : "",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

function normalizeVault(payload: unknown): VaultPayload {
  if (!payload || typeof payload !== "object") {
    return createVaultDefault();
  }

  const partial = payload as Partial<VaultPayload> & {
    profile?: {
      fullName?: string;
      preferredName?: string;
      primaryAddress?: string;
    };
    contacts?: { primaryEmail?: string; phone?: string };
  };

  if (Array.isArray(partial.identities)) {
    return {
      identities: partial.identities.map((item) =>
        normalizeIdentityItem(item as Partial<VaultIdentityItem>),
      ),
      apiKeys: Array.isArray(partial.apiKeys)
        ? partial.apiKeys.map((item) =>
            normalizeApiKeyItem(item as Partial<VaultApiKeyItem>),
          )
        : [],
    };
  }

  const legacyName =
    typeof partial.profile?.fullName === "string" &&
    partial.profile.fullName.trim().length > 0
      ? partial.profile.fullName.trim()
      : typeof partial.profile?.preferredName === "string"
        ? partial.profile.preferredName.trim()
        : "";

  if (!legacyName) {
    return createVaultDefault();
  }

  const [firstName, ...rest] = legacyName.split(/\s+/);
  const now = Date.now();
  return {
    identities: [
      {
        id: createId(),
        firstName: firstName ?? "",
        lastName: rest.join(" "),
        email:
          typeof partial.contacts?.primaryEmail === "string"
            ? partial.contacts.primaryEmail
            : "",
        phone:
          typeof partial.contacts?.phone === "string"
            ? partial.contacts.phone
            : "",
        address:
          typeof partial.profile?.primaryAddress === "string"
            ? partial.profile.primaryAddress
            : "",
        nino: "",
        nhsNumber: "",
        passNumber: "",
        notes: "",
        createdAt: now,
        updatedAt: now,
      },
    ],
    apiKeys: [],
  };
}

const IDENTITY_DETAIL_FIELDS = [
  { label: "Email", field: "email" },
  { label: "Phone", field: "phone" },
  { label: "Address", field: "address" },
  { label: "NINO", field: "nino" },
  { label: "NHS Number", field: "nhsNumber" },
  { label: "Pass No", field: "passNumber" },
] as const;

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

function maskSecretValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Not provided";
  return "*".repeat(Math.max(12, Math.min(trimmed.length, 24)));
}

async function hashLegacyPassword(password: string, salt: string) {
  const encoded = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readLegacyPasswordMeta() {
  const hash = localStorage.getItem(LEGACY_STORAGE_KEYS.passwordHash);
  const salt = localStorage.getItem(LEGACY_STORAGE_KEYS.passwordSalt);
  if (!hash || !salt) return null;
  return { hash, salt };
}

function clearLegacyPasswordMeta() {
  localStorage.removeItem(LEGACY_STORAGE_KEYS.passwordHash);
  localStorage.removeItem(LEGACY_STORAGE_KEYS.passwordSalt);
}

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)
  ?.trim()
  .replace(/\/+$/, "");

async function requestJson<T>(path: string, init?: RequestInit) {
  const url = apiBase ? `${apiBase}${path}` : path;
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (init?.body) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(url, {
    ...init,
    headers,
  });

  const text = await response.text();
  let data = null as T;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null as T;
    }
  }

  if (!response.ok) {
    const message =
      typeof (data as { error?: string } | null)?.error === "string"
        ? (data as { error: string }).error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

async function initVault(payload: VaultEncryptedPayload) {
  await requestJson("/api/vault/init", {
    method: "POST",
    body: JSON.stringify({ payload }),
  });
}

async function loadVaultRecord() {
  const data = await requestJson<{ payload: unknown }>("/api/vault/load");
  return data.payload;
}

async function saveVaultRecord(payload: VaultEncryptedPayload) {
  await requestJson("/api/vault/save", {
    method: "POST",
    body: JSON.stringify({ payload }),
  });
}

async function readVaultStatus() {
  const status = await requestJson<{ exists: boolean } | null>(
    "/api/vault/status",
  );
  if (!status || typeof status.exists !== "boolean") {
    throw new Error("Unable to read vault status.");
  }
  return status;
}

async function unlockVaultWithPassword(password: string) {
  const storedPayload = await loadVaultRecord();

  if (isVaultEncryptedPayload(storedPayload)) {
    const session = await restoreVaultSession(password, storedPayload);

    try {
      const decryptedPayload = await decryptVaultPayload(storedPayload, session);
      return { session, vault: normalizeVault(decryptedPayload), migrated: false };
    } catch {
      throw new Error("Incorrect password. Try again.");
    }
  }

  const legacyMeta = readLegacyPasswordMeta();
  if (legacyMeta) {
    const hash = await hashLegacyPassword(password, legacyMeta.salt);
    if (hash !== legacyMeta.hash) {
      throw new Error("Incorrect password. Try again.");
    }
  }

  const vault = normalizeVault(storedPayload);
  const session = await createVaultSession(password);
  const encryptedPayload = await encryptVaultPayload(vault, session);
  await saveVaultRecord(encryptedPayload);
  clearLegacyPasswordMeta();

  return { session, vault, migrated: true };
}

export default function App() {
  let copiedSecretResetTimer: number | undefined;
  let copiedFieldResetTimer: number | undefined;
  const [view, setView] = createSignal<GateView>("loading");
  const [vault, setVault] = createSignal<VaultPayload>(createVaultDefault());
  const [activeSection, setActiveSection] = createSignal<VaultSection>("apiKeys");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [lastSaved, setLastSaved] = createSignal<number | null>(null);
  const [query, setQuery] = createSignal("");
  const [selectedIdentityId, setSelectedIdentityId] = createSignal("");
  const [selectedApiKeyId, setSelectedApiKeyId] = createSignal("");
  const [isApiKeyVisible, setIsApiKeyVisible] = createSignal(false);
  const [copiedApiKeyId, setCopiedApiKeyId] = createSignal("");
  const [copiedField, setCopiedField] = createSignal("");
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<IdentityDraft>(createIdentityDraft());
  const [apiKeyDraft, setApiKeyDraft] = createSignal<ApiKeyDraft>(createApiKeyDraft());
  const [modalError, setModalError] = createSignal("");
  const [syncEnabled, setSyncEnabled] = createSignal(false);
  const [editingTarget, setEditingTarget] = createSignal<EditingTarget | null>(null);
  const [session, setSession] = createSignal<VaultSession | null>(null);
  const [persistedVaultJson, setPersistedVaultJson] = createSignal(
    JSON.stringify(createVaultDefault()),
  );

  const isEditing = createMemo(() => editingTarget() !== null);

  onMount(() => {
    void (async () => {
      setBusy(true);
      setError("");

      try {
        const status = await readVaultStatus();
        setView(status.exists ? "locked" : "setup");
      } catch (statusError) {
        console.error(statusError);
        setError(
          statusError instanceof Error
            ? statusError.message
            : "Unable to reach the vault service.",
        );
        setView("locked");
      } finally {
        setBusy(false);
      }
    })();
  });

  const filteredIdentities = createMemo(() => {
    const term = query().trim().toLowerCase();
    const items = vault().identities;
    if (!term) return items;
    return items.filter((item) => {
      const haystack = [
        item.firstName,
        item.lastName,
        item.email,
        item.phone,
        item.address,
        item.nino,
        item.nhsNumber,
        item.passNumber,
        item.notes,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  });

  const filteredApiKeys = createMemo(() => {
    const term = query().trim().toLowerCase();
    const items = vault().apiKeys;
    if (!term) return items;
    return items.filter((item) => {
      const haystack = [
        item.label,
        item.service,
        item.environment,
        item.notes,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  });

  const selectedIdentity = createMemo(() => {
    const items = filteredIdentities();
    if (!items.length) return null;
    return items.find((item) => item.id === selectedIdentityId()) ?? items[0];
  });

  const selectedApiKey = createMemo(() => {
    const items = filteredApiKeys();
    if (!items.length) return null;
    return items.find((item) => item.id === selectedApiKeyId()) ?? items[0];
  });

  const sectionTitle = createMemo(() =>
    activeSection() === "identities" ? "Identities" : "API Keys",
  );

  const sectionSubtitle = createMemo(() =>
    activeSection() === "identities"
      ? "Create and manage personal identities without a wizard."
      : "Store service tokens and API secrets inside the encrypted vault.",
  );

  let saveVersion = 0;
  createEffect(() => {
    const currentSession = session();
    if (view() !== "unlocked" || !syncEnabled() || !currentSession) return;

    const nextVault = vault();
    const nextVaultJson = JSON.stringify(nextVault);
    if (nextVaultJson === persistedVaultJson()) return;

    const thisVersion = ++saveVersion;
    void (async () => {
      try {
        const encryptedPayload = await encryptVaultPayload(nextVault, currentSession);
        if (thisVersion !== saveVersion) return;
        await saveVaultRecord(encryptedPayload);
        if (thisVersion !== saveVersion) return;
        setPersistedVaultJson(nextVaultJson);
        setLastSaved(Date.now());
      } catch (saveError) {
        if (thisVersion !== saveVersion) return;
        console.error(saveError);
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Unable to save the encrypted vault.",
        );
      }
    })();
  });

  createEffect(() => {
    if (view() !== "unlocked") return;
    if (activeSection() === "identities") {
      const items = filteredIdentities();
      if (items.length === 0) {
        setSelectedIdentityId("");
        return;
      }
      if (!items.find((item) => item.id === selectedIdentityId())) {
        setSelectedIdentityId(items[0].id);
      }
      return;
    }

    const items = filteredApiKeys();
    if (items.length === 0) {
      setSelectedApiKeyId("");
      return;
    }
    if (!items.find((item) => item.id === selectedApiKeyId())) {
      setSelectedApiKeyId(items[0].id);
    }
  });

  createEffect(() => {
    view();
    activeSection();
    selectedApiKeyId();
    setIsApiKeyVisible(false);
  });

  const handleSetup = async (event: Event) => {
    event.preventDefault();
    setError("");

    if (password().length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      const freshVault = createVaultDefault();
      const nextSession = await createVaultSession(password());
      const encryptedPayload = await encryptVaultPayload(freshVault, nextSession);
      await initVault(encryptedPayload);
      clearLegacyPasswordMeta();
      setVault(freshVault);
      setSession(nextSession);
      setPersistedVaultJson(JSON.stringify(freshVault));
      setSyncEnabled(true);
      setLastSaved(Date.now());
      setView("unlocked");
      setPassword("");
    } catch (setupError) {
      console.error(setupError);
      setError(
        setupError instanceof Error
          ? setupError.message
          : "Unable to initialize the vault. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async (event: Event) => {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const { session: nextSession, vault: remoteVault, migrated } =
        await unlockVaultWithPassword(password());
      setSession(nextSession);
      setVault(remoteVault);
      setPersistedVaultJson(JSON.stringify(remoteVault));
      setSyncEnabled(true);
      setLastSaved(migrated ? Date.now() : null);
      setView("unlocked");
      setPassword("");
    } catch (unlockError) {
      console.error(unlockError);
      setError(
        unlockError instanceof Error
          ? unlockError.message
          : "Unable to unlock. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLock = () => {
    setSyncEnabled(false);
    setSession(null);
    setView("locked");
    setVault(createVaultDefault());
    setActiveSection("apiKeys");
    setPassword("");
    setQuery("");
    setSelectedIdentityId("");
    setSelectedApiKeyId("");
    setIsApiKeyVisible(false);
    setLastSaved(null);
    setPersistedVaultJson(JSON.stringify(createVaultDefault()));
    setIsModalOpen(false);
    setEditingTarget(null);
  };

  const handleOpenIdentityModal = () => {
    setDraft(createIdentityDraft());
    setEditingTarget(null);
    setModalError("");
    setIsModalOpen(true);
  };

  const handleOpenApiKeyModal = () => {
    setApiKeyDraft(createApiKeyDraft());
    setEditingTarget(null);
    setModalError("");
    setIsModalOpen(true);
  };

  const handleOpenEditIdentityModal = (identity: VaultIdentityItem) => {
    setDraft({
      firstName: identity.firstName,
      lastName: identity.lastName,
      email: identity.email,
      phone: identity.phone,
      address: identity.address,
      nino: identity.nino,
      nhsNumber: identity.nhsNumber,
      passNumber: identity.passNumber,
      notes: identity.notes,
    });
    setEditingTarget({ section: "identities", id: identity.id });
    setModalError("");
    setIsModalOpen(true);
  };

  const handleOpenEditApiKeyModal = (item: VaultApiKeyItem) => {
    setApiKeyDraft({
      label: item.label,
      service: item.service,
      key: item.key,
      environment: item.environment,
      notes: item.notes,
    });
    setEditingTarget({ section: "apiKeys", id: item.id });
    setModalError("");
    setIsModalOpen(true);
  };

  onCleanup(() => {
    if (copiedSecretResetTimer) {
      window.clearTimeout(copiedSecretResetTimer);
    }
    if (copiedFieldResetTimer) {
      window.clearTimeout(copiedFieldResetTimer);
    }
  });

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setModalError("");
    setEditingTarget(null);
  };

  const handleSaveIdentity = (event: Event) => {
    event.preventDefault();
    setModalError("");

    const current = draft();
    if (!current.firstName.trim() || !current.lastName.trim()) {
      setModalError("First name and last name are required.");
      return;
    }

    const now = Date.now();
    const nextFirstName = current.firstName.trim();
    const nextLastName = current.lastName.trim();
    const nextEmail = current.email.trim();
    const nextPhone = current.phone.trim();
    const nextAddress = current.address.trim();
    const nextNino = current.nino.trim();
    const nextNhsNumber = current.nhsNumber.trim();
    const nextPassNumber = current.passNumber.trim();
    const nextNotes = current.notes.trim();
    const currentTarget = editingTarget();
    const activeEditingId =
      currentTarget?.section === "identities" ? currentTarget.id : null;

    if (activeEditingId) {
      setVault((currentVault) => ({
        ...currentVault,
        identities: currentVault.identities.map((item) =>
          item.id === activeEditingId
            ? {
                ...item,
                firstName: nextFirstName,
                lastName: nextLastName,
                email: nextEmail,
                phone: nextPhone,
                address: nextAddress,
                nino: nextNino,
                nhsNumber: nextNhsNumber,
                passNumber: nextPassNumber,
                notes: nextNotes,
                updatedAt: now,
              }
            : item,
        ),
      }));
      setSelectedIdentityId(activeEditingId);
    } else {
      const identity: VaultIdentityItem = {
        id: createId(),
        firstName: nextFirstName,
        lastName: nextLastName,
        email: nextEmail,
        phone: nextPhone,
        address: nextAddress,
        nino: nextNino,
        nhsNumber: nextNhsNumber,
        passNumber: nextPassNumber,
        notes: nextNotes,
        createdAt: now,
        updatedAt: now,
      };

      setVault((currentVault) => ({
        ...currentVault,
        identities: [identity, ...currentVault.identities],
      }));
      setSelectedIdentityId(identity.id);
    }

    setIsModalOpen(false);
    setEditingTarget(null);
  };

  const handleSaveApiKey = (event: Event) => {
    event.preventDefault();
    setModalError("");

    const current = apiKeyDraft();
    if (!current.label.trim() || !current.key.trim()) {
      setModalError("Label and API key are required.");
      return;
    }

    const now = Date.now();
    const nextLabel = current.label.trim();
    const nextService = current.service.trim();
    const nextKey = current.key.trim();
    const nextEnvironment = current.environment.trim();
    const nextNotes = current.notes.trim();
    const currentTarget = editingTarget();
    const activeEditingId =
      currentTarget?.section === "apiKeys" ? currentTarget.id : null;

    if (activeEditingId) {
      setVault((currentVault) => ({
        ...currentVault,
        apiKeys: currentVault.apiKeys.map((item) =>
          item.id === activeEditingId
            ? {
                ...item,
                label: nextLabel,
                service: nextService,
                key: nextKey,
                environment: nextEnvironment,
                notes: nextNotes,
                updatedAt: now,
              }
            : item,
        ),
      }));
      setSelectedApiKeyId(activeEditingId);
    } else {
      const apiKey: VaultApiKeyItem = {
        id: createId(),
        label: nextLabel,
        service: nextService,
        key: nextKey,
        environment: nextEnvironment,
        notes: nextNotes,
        createdAt: now,
        updatedAt: now,
      };

      setVault((currentVault) => ({
        ...currentVault,
        apiKeys: [apiKey, ...currentVault.apiKeys],
      }));
      setSelectedApiKeyId(apiKey.id);
    }

    setIsModalOpen(false);
    setEditingTarget(null);
  };

  const copyToClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fallback for restricted contexts
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  const handleCopyApiKey = async (item: VaultApiKeyItem) => {
    const key = item.key.trim();
    if (!key) return;

    try {
      await copyToClipboard(key);
      setCopiedApiKeyId(item.id);
      if (copiedSecretResetTimer) {
        window.clearTimeout(copiedSecretResetTimer);
      }
      copiedSecretResetTimer = window.setTimeout(() => {
        setCopiedApiKeyId((current) => (current === item.id ? "" : current));
      }, 1800);
    } catch (copyError) {
      console.error(copyError);
      setError("Unable to copy the API key.");
    }
  };

  const handleCopyField = async (value: string, fieldKey: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      await copyToClipboard(trimmed);
      setCopiedField(fieldKey);
      if (copiedFieldResetTimer) window.clearTimeout(copiedFieldResetTimer);
      copiedFieldResetTimer = window.setTimeout(() => {
        setCopiedField((c) => (c === fieldKey ? "" : c));
      }, 1800);
    } catch {
      setError("Unable to copy to clipboard.");
    }
  };

  const handleDeleteIdentity = (id: string) => {
    if (!window.confirm("Delete this identity? This cannot be undone.")) return;
    setVault((currentVault) => ({
      ...currentVault,
      identities: currentVault.identities.filter((item) => item.id !== id),
    }));
    if (selectedIdentityId() === id) {
      setSelectedIdentityId("");
    }
  };

  const handleDeleteApiKey = (id: string) => {
    if (!window.confirm("Delete this API key? This cannot be undone.")) return;
    setVault((currentVault) => ({
      ...currentVault,
      apiKeys: currentVault.apiKeys.filter((item) => item.id !== id),
    }));
    if (selectedApiKeyId() === id) {
      setSelectedApiKeyId("");
    }
  };

  return (
    <div class="app" data-view={view()}>
      <div class="shell">
        <Show when={view() === "unlocked"}>
          <header class="topbar">
            <div class="brand brand-row">
              <span class="brand-logo" aria-hidden="true" />
              <div class="brand-text">
                <span class="brand-mark">1Pass</span>
                <span class="brand-subtitle">Personal Vault</span>
              </div>
            </div>
            <div class="topbar-actions">
              <span class="status-pill">Unlocked</span>
              <button class="btn ghost" type="button" onClick={handleLock}>
                Lock
              </button>
            </div>
          </header>
        </Show>

        <Show when={view() !== "unlocked"}>
          <section class="gate minimal">
            <div class="gate-card minimal">
              <div class="brand-stack">
                <span class="brand-logo" aria-hidden="true" />
                <span class="brand-mark">1Pass</span>
                <span class="brand-subtitle">Personal Vault</span>
              </div>
              <p class="subtitle">
                {view() === "loading"
                  ? "Checking vault status..."
                  : view() === "setup"
                    ? "Create a master password. Vault data is encrypted in the browser before sync."
                    : "Enter your master password to decrypt the vault."}
              </p>
              <Show
                when={view() !== "loading"}
                fallback={<button class="btn primary" type="button" disabled>Loading...</button>}
              >
                <form
                  class="gate-form minimal"
                  onSubmit={(event) => {
                    if (view() === "setup") {
                      void handleSetup(event);
                    } else {
                      void handleUnlock(event);
                    }
                  }}
                >
                  <label class="field">
                    <span class="field-label sr-only">Master password</span>
                    <input
                      type="password"
                      autocomplete={
                        view() === "setup" ? "new-password" : "current-password"
                      }
                      placeholder={
                        view() === "setup"
                          ? "Create master password"
                          : "Enter master password"
                      }
                      value={password()}
                      onInput={(event) => setPassword(event.currentTarget.value)}
                    />
                  </label>
                  <Show when={Boolean(error())}>
                    <div class="form-error">{error()}</div>
                  </Show>
                  <button class="btn primary" type="submit" disabled={busy()}>
                    {busy()
                      ? "Working..."
                      : view() === "setup"
                        ? "Create vault"
                        : "Unlock vault"}
                  </button>
                </form>
              </Show>
            </div>
          </section>
        </Show>

        <Show when={view() === "unlocked"}>
          <section class="dashboard">
            <aside class="vault-sidebar">
              <nav class="nav-list">
                <button
                  class={`nav-item ${
                    activeSection() === "identities" ? "active" : ""
                  }`}
                  type="button"
                  onClick={() => {
                    setActiveSection("identities");
                    setQuery("");
                  }}
                >
                  Identities
                  <span>{vault().identities.length}</span>
                </button>
                <button
                  class={`nav-item ${
                    activeSection() === "apiKeys" ? "active" : ""
                  }`}
                  type="button"
                  onClick={() => {
                    setActiveSection("apiKeys");
                    setQuery("");
                  }}
                >
                  API Keys
                  <span>{vault().apiKeys.length}</span>
                </button>
              </nav>
            </aside>

            <main class="main">
              <div class="main-header">
                <div />
                <div class="action-row">
                  <label class="search-field">
                    <span class="sr-only">Search vault items</span>
                    <input
                      type="search"
                      placeholder={
                        activeSection() === "identities"
                          ? "Search identities"
                          : "Search API keys"
                      }
                      value={query()}
                      onInput={(event) => setQuery(event.currentTarget.value)}
                    />
                  </label>
                  <button
                    class="btn primary icon"
                    type="button"
                    onClick={() => {
                      if (activeSection() === "identities") {
                        handleOpenIdentityModal();
                      } else {
                        handleOpenApiKeyModal();
                      }
                    }}
                  >
                    + New
                  </button>
                </div>
              </div>

              <div class="items-grid">
                <div class="items-list">
                  <div class="list-header">
                    <span>
                      {activeSection() === "identities"
                        ? filteredIdentities().length
                        : filteredApiKeys().length}{" "}
                      results
                    </span>
                    <span class="muted">Sorted by newest</span>
                  </div>
                  <div class="list-body">
                    <Show
                      when={activeSection() === "identities"}
                      fallback={
                        <Show
                          when={filteredApiKeys().length > 0}
                          fallback={<p class="empty">No API keys yet.</p>}
                        >
                          <For each={filteredApiKeys()}>
                            {(item) => (
                              <button
                                class={`list-item ${
                                  selectedApiKey()?.id === item.id ? "active" : ""
                                }`}
                                type="button"
                                onClick={() => setSelectedApiKeyId(item.id)}
                              >
                                <div>
                                  <strong>{item.label}</strong>
                                  <span class="muted">
                                    {item.environment || "No details"}
                                  </span>
                                </div>
                                <span class="pill">API Key</span>
                              </button>
                            )}
                          </For>
                        </Show>
                      }
                    >
                      <Show
                        when={filteredIdentities().length > 0}
                        fallback={<p class="empty">No identities yet.</p>}
                      >
                        <For each={filteredIdentities()}>
                          {(item) => (
                            <button
                              class={`list-item ${
                                selectedIdentity()?.id === item.id ? "active" : ""
                              }`}
                              type="button"
                              onClick={() => setSelectedIdentityId(item.id)}
                            >
                              <div>
                                <strong>
                                  {item.firstName} {item.lastName}
                                </strong>
                                <span class="muted">
                                  {item.email ||
                                    item.phone ||
                                    "No contact details"}
                                </span>
                              </div>
                              <span class="pill">Identity</span>
                            </button>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                </div>

                <div class="detail-card">
                  <Show
                    when={activeSection() === "identities"}
                    fallback={
                      <Show
                        when={selectedApiKey()}
                        fallback={
                          <div class="empty-detail">
                            <p>Select an API key to view details.</p>
                          </div>
                        }
                      >
                        {(item) => (
                          <div>
                            <div class="detail-header">
                              <div>
                                <h2>{item().label}</h2>
                                <p class="muted">API key record</p>
                              </div>
                              <div class="detail-actions">
                                <span class="pill">Secret</span>
                                <button
                                  class="icon-button icon-only"
                                  type="button"
                                  aria-label="Edit API key"
                                  onClick={() => handleOpenEditApiKeyModal(item())}
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path
                                      d="M16.862 4.487a1.5 1.5 0 0 1 2.121 2.122l-9.9 9.9-3.36.39.39-3.36 9.9-9.9Zm-12.6 14.4h15.3"
                                      fill="none"
                                      stroke="currentColor"
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="1.6"
                                    />
                                  </svg>
                                </button>
                                <button
                                  class="icon-button icon-only"
                                  type="button"
                                  aria-label="Delete API key"
                                  onClick={() => handleDeleteApiKey(item().id)}
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path
                                      d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"
                                      fill="none"
                                      stroke="currentColor"
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="1.6"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            <div class="detail-grid">
                              <div>
                                <span class="meta-label">Environment</span>
                                <p>{item().environment.trim() || "Not provided"}</p>
                              </div>
                              <div class="detail-span">
                                <div class="secret-header">
                                  <span class="meta-label">API Key</span>
                                  <div class="secret-actions">
                                    <button
                                      class={`secret-toggle icon-copy ${
                                        copiedApiKeyId() === item().id ? "is-success" : ""
                                      }`}
                                      type="button"
                                      onClick={() => void handleCopyApiKey(item())}
                                      disabled={!item().key.trim()}
                                      title={copiedApiKeyId() === item().id ? "Copied!" : "Copy API key"}
                                    >
                                      <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                      </svg>
                                      <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M20 6 9 17l-5-5" />
                                      </svg>
                                    </button>
                                    <button
                                      class="secret-toggle"
                                      type="button"
                                      onClick={() =>
                                        setIsApiKeyVisible((current) => !current)
                                      }
                                      disabled={!item().key.trim()}
                                    >
                                      {isApiKeyVisible() ? "Hide" : "Show"}
                                    </button>
                                  </div>
                                </div>
                                <p
                                  class={`secret-value ${
                                    isApiKeyVisible() ? "" : "masked"
                                  }`}
                                >
                                  {isApiKeyVisible()
                                    ? item().key.trim() || "Not provided"
                                    : maskSecretValue(item().key)}
                                </p>
                              </div>
                              <div class="detail-span">
                                <span class="meta-label">Notes</span>
                                <p class="notes-content">
                                  {item().notes.trim() || "Not provided"}
                                </p>
                              </div>
                            </div>
                            <div class="detail-footer">
                              <span class="meta-label">Created</span>
                              <strong>{formatTimestamp(item().createdAt)}</strong>
                            </div>
                          </div>
                        )}
                      </Show>
                    }
                  >
                    <Show
                      when={selectedIdentity()}
                      fallback={
                        <div class="empty-detail">
                          <p>Select an identity to view details.</p>
                        </div>
                      }
                    >
                      {(identity) => (
                        <div>
                          <div class="detail-header">
                            <div>
                              <h2>
                                {identity().firstName} {identity().lastName}
                              </h2>
                              <p class="muted">Identity record</p>
                            </div>
                            <div class="detail-actions">
                              <span class="pill">Private</span>
                              <button
                                class="icon-button icon-only"
                                type="button"
                                aria-label="Edit identity"
                                onClick={() => handleOpenEditIdentityModal(identity())}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="M16.862 4.487a1.5 1.5 0 0 1 2.121 2.122l-9.9 9.9-3.36.39.39-3.36 9.9-9.9Zm-12.6 14.4h15.3"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="1.6"
                                  />
                                </svg>
                              </button>
                              <button
                                class="icon-button icon-only"
                                type="button"
                                aria-label="Delete identity"
                                onClick={() => handleDeleteIdentity(identity().id)}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="1.6"
                                  />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div class="detail-grid">
                            <For each={IDENTITY_DETAIL_FIELDS}>
                              {(fieldDef) => {
                                const value = () => identity()[fieldDef.field] as string;
                                return (
                                  <div
                                    class={`copyable-field ${value().trim() ? "" : "empty"}`}
                                    onClick={() => void handleCopyField(value(), fieldDef.field)}
                                    title={value().trim() ? "Click to copy" : undefined}
                                  >
                                    <span class="meta-label">{fieldDef.label}</span>
                                    <p>{value().trim() || "Not provided"}</p>
                                    <Show when={value().trim()}>
                                      <span class={`copied-badge ${copiedField() === fieldDef.field ? "visible" : ""}`}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                                        Copied
                                      </span>
                                    </Show>
                                  </div>
                                );
                              }}
                            </For>
                            <div>
                              <span class="meta-label">Notes</span>
                              <p class="notes-content">
                                {identity().notes.trim() || "Not provided"}
                              </p>
                            </div>
                          </div>
                          <div class="detail-footer">
                            <span class="meta-label">Created</span>
                            <strong>{formatTimestamp(identity().createdAt)}</strong>
                          </div>
                        </div>
                      )}
                    </Show>
                  </Show>
                </div>
              </div>
            </main>
          </section>
        </Show>
      </div>

      <Show when={isModalOpen()}>
        <div class="modal-backdrop" onClick={handleCloseModal}>
          <div class="modal" onClick={(event) => event.stopPropagation()}>
            <Show
              when={
                activeSection() === "identities" ||
                editingTarget()?.section === "identities"
              }
              fallback={
                <>
                  <div class="modal-header">
                    <div>
                      <p class="eyebrow">
                        {isEditing() ? "Edit API key" : "New API key"}
                      </p>
                      <h2>{isEditing() ? "Edit API key" : "Create API key"}</h2>
                      <p class="muted">
                        Label and API key are required. Environment and notes
                        are optional.
                      </p>
                    </div>
                    <button
                      class="icon-button"
                      type="button"
                      onClick={handleCloseModal}
                    >
                      Close
                    </button>
                  </div>
                  <form class="modal-form" onSubmit={handleSaveApiKey}>
                    <div class="modal-grid">
                      <label class="field">
                        <span class="field-label">Label</span>
                        <input
                          type="text"
                          value={apiKeyDraft().label}
                          onInput={(event) =>
                            setApiKeyDraft((current) => ({
                              ...current,
                              label: event.currentTarget.value,
                            }))
                          }
                          required
                        />
                      </label>
                      <label class="field">
                        <span class="field-label">Service</span>
                        <input
                          type="text"
                          value={apiKeyDraft().service}
                          onInput={(event) =>
                            setApiKeyDraft((current) => ({
                              ...current,
                              service: event.currentTarget.value,
                            }))
                          }
                        />
                      </label>
                      <label class="field full">
                        <span class="field-label">API Key</span>
                        <textarea
                          rows={4}
                          value={apiKeyDraft().key}
                          onInput={(event) =>
                            setApiKeyDraft((current) => ({
                              ...current,
                              key: event.currentTarget.value,
                            }))
                          }
                          required
                        />
                      </label>
                      <label class="field">
                        <span class="field-label">Environment</span>
                        <input
                          type="text"
                          value={apiKeyDraft().environment}
                          onInput={(event) =>
                            setApiKeyDraft((current) => ({
                              ...current,
                              environment: event.currentTarget.value,
                            }))
                          }
                        />
                      </label>
                      <label class="field full">
                        <span class="field-label">Notes</span>
                        <textarea
                          rows={3}
                          value={apiKeyDraft().notes}
                          onInput={(event) =>
                            setApiKeyDraft((current) => ({
                              ...current,
                              notes: event.currentTarget.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <Show when={Boolean(modalError())}>
                      <div class="form-error">{modalError()}</div>
                    </Show>
                    <div class="modal-actions">
                      <button
                        class="btn ghost"
                        type="button"
                        onClick={handleCloseModal}
                      >
                        Cancel
                      </button>
                      <button class="btn primary" type="submit">
                        {isEditing() ? "Save changes" : "Save API key"}
                      </button>
                    </div>
                  </form>
                </>
              }
            >
              <div class="modal-header">
                <div>
                  <p class="eyebrow">
                    {isEditing() ? "Edit identity" : "New identity"}
                  </p>
                  <h2>{isEditing() ? "Edit identity" : "Create identity"}</h2>
                  <p class="muted">
                    First name and last name are required. Everything else is
                    optional.
                  </p>
                </div>
                <button
                  class="icon-button"
                  type="button"
                  onClick={handleCloseModal}
                >
                  Close
                </button>
              </div>
              <form class="modal-form" onSubmit={handleSaveIdentity}>
                <div class="modal-grid">
                  <label class="field">
                    <span class="field-label">First name</span>
                    <input
                      type="text"
                      value={draft().firstName}
                      onInput={(event) =>
                        setDraft((current) => ({
                          ...current,
                          firstName: event.currentTarget.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label class="field">
                    <span class="field-label">Last name</span>
                    <input
                      type="text"
                      value={draft().lastName}
                      onInput={(event) =>
                        setDraft((current) => ({
                          ...current,
                          lastName: event.currentTarget.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label class="field">
                    <span class="field-label">Email</span>
                    <input
                      type="email"
                      value={draft().email}
                      onInput={(event) =>
                        setDraft((current) => ({
                          ...current,
                          email: event.currentTarget.value,
                        }))
                      }
                    />
                  </label>
                  <label class="field">
                    <span class="field-label">Phone</span>
                    <input
                      type="tel"
                      value={draft().phone}
                      onInput={(event) =>
                        setDraft((current) => ({
                          ...current,
                          phone: event.currentTarget.value,
                        }))
                      }
                    />
                  </label>
                  <label class="field full">
                    <span class="field-label">Address</span>
                    <input
                      type="text"
                      value={draft().address}
                      onInput={(event) =>
                        setDraft((current) => ({
                          ...current,
                          address: event.currentTarget.value,
                        }))
                      }
                    />
                  </label>
                  <label class="field">
                    <span class="field-label">NINO</span>
                    <input
                      type="text"
                      value={draft().nino}
                      onInput={(event) =>
                        setDraft((current) => ({
                          ...current,
                          nino: event.currentTarget.value,
                        }))
                      }
                    />
                  </label>
                  <label class="field">
                    <span class="field-label">NHS Number</span>
                    <input
                      type="text"
                      value={draft().nhsNumber}
                      onInput={(event) =>
                        setDraft((current) => ({
                          ...current,
                          nhsNumber: event.currentTarget.value,
                        }))
                      }
                    />
                  </label>
                  <label class="field">
                    <span class="field-label">Pass No</span>
                    <input
                      type="text"
                      value={draft().passNumber}
                      onInput={(event) =>
                        setDraft((current) => ({
                          ...current,
                          passNumber: event.currentTarget.value,
                        }))
                      }
                    />
                  </label>
                  <label class="field full">
                    <span class="field-label">Notes</span>
                    <textarea
                      rows={3}
                      value={draft().notes}
                      onInput={(event) =>
                        setDraft((current) => ({
                          ...current,
                          notes: event.currentTarget.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <Show when={Boolean(modalError())}>
                  <div class="form-error">{modalError()}</div>
                </Show>
                <div class="modal-actions">
                  <button
                    class="btn ghost"
                    type="button"
                    onClick={handleCloseModal}
                  >
                    Cancel
                  </button>
                  <button class="btn primary" type="submit">
                    {isEditing() ? "Save changes" : "Save identity"}
                  </button>
                </div>
              </form>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
