import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import {
  DEFAULT_VAULT_PAYLOAD,
  isVaultEncryptedPayload,
  type VaultEncryptedPayload,
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
  };
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
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
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
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
  const [view, setView] = createSignal<GateView>("loading");
  const [vault, setVault] = createSignal<VaultPayload>(createVaultDefault());
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [lastSaved, setLastSaved] = createSignal<number | null>(null);
  const [query, setQuery] = createSignal("");
  const [selectedId, setSelectedId] = createSignal("");
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<IdentityDraft>(createIdentityDraft());
  const [modalError, setModalError] = createSignal("");
  const [syncEnabled, setSyncEnabled] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [session, setSession] = createSignal<VaultSession | null>(null);
  const [persistedVaultJson, setPersistedVaultJson] = createSignal(
    JSON.stringify(createVaultDefault()),
  );

  const isEditing = createMemo(() => editingId() !== null);

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

  const selectedIdentity = createMemo(() => {
    const items = filteredIdentities();
    if (!items.length) return null;
    return items.find((item) => item.id === selectedId()) ?? items[0];
  });

  createEffect(() => {
    const currentSession = session();
    if (view() !== "unlocked" || !syncEnabled() || !currentSession) return;

    const nextVault = vault();
    const nextVaultJson = JSON.stringify(nextVault);
    if (nextVaultJson === persistedVaultJson()) return;

    void (async () => {
      try {
        const encryptedPayload = await encryptVaultPayload(nextVault, currentSession);
        await saveVaultRecord(encryptedPayload);
        setPersistedVaultJson(nextVaultJson);
        setLastSaved(Date.now());
      } catch (saveError) {
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
    const items = filteredIdentities();
    if (items.length === 0) {
      setSelectedId("");
      return;
    }
    if (!items.find((item) => item.id === selectedId())) {
      setSelectedId(items[0].id);
    }
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
    setView("locked");
    setVault(createVaultDefault());
    setPassword("");
    setQuery("");
    setSyncEnabled(false);
    setSession(null);
    setSelectedId("");
    setLastSaved(null);
    setPersistedVaultJson(JSON.stringify(createVaultDefault()));
    setIsModalOpen(false);
    setEditingId(null);
  };

  const handleOpenModal = () => {
    setDraft(createIdentityDraft());
    setEditingId(null);
    setModalError("");
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (identity: VaultIdentityItem) => {
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
    setEditingId(identity.id);
    setModalError("");
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setModalError("");
    setEditingId(null);
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
    const activeEditingId = editingId();

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
      setSelectedId(activeEditingId);
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
      setSelectedId(identity.id);
    }

    setIsModalOpen(false);
    setEditingId(null);
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
                <button class="nav-item active" type="button">
                  All Items
                  <span>{vault().identities.length}</span>
                </button>
                <button class="nav-item" type="button">
                  Identities
                  <span>{vault().identities.length}</span>
                </button>
              </nav>
            </aside>

            <main class="main">
              <div class="main-header">
                <div>
                  <p class="eyebrow">Vault items</p>
                  <h1>Identities</h1>
                  <p class="subtitle">
                    Create and manage personal identities without a wizard.
                  </p>
                </div>
                <div class="action-row">
                  <label class="search-field">
                    <span class="sr-only">Search identities</span>
                    <input
                      type="search"
                      placeholder="Search identities"
                      value={query()}
                      onInput={(event) => setQuery(event.currentTarget.value)}
                    />
                  </label>
                  <button
                    class="btn primary icon"
                    type="button"
                    onClick={handleOpenModal}
                  >
                    + New
                  </button>
                </div>
              </div>

              <div class="items-grid">
                <div class="items-list">
                  <div class="list-header">
                    <span>{filteredIdentities().length} results</span>
                    <span class="muted">Sorted by newest</span>
                  </div>
                  <div class="list-body">
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
                            onClick={() => setSelectedId(item.id)}
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
                  </div>
                </div>

                <div class="detail-card">
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
                              onClick={() =>
                                handleOpenEditModal(identity())
                              }
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
                          </div>
                        </div>
                        <div class="detail-grid">
                          <div>
                            <span class="meta-label">Email</span>
                            <p>
                              {identity().email.trim().length > 0
                                ? identity().email
                                : "Not provided"}
                            </p>
                          </div>
                          <div>
                            <span class="meta-label">Phone</span>
                            <p>
                              {identity().phone.trim().length > 0
                                ? identity().phone
                                : "Not provided"}
                            </p>
                          </div>
                          <div>
                            <span class="meta-label">Address</span>
                            <p>
                              {identity().address.trim().length > 0
                                ? identity().address
                                : "Not provided"}
                            </p>
                          </div>
                          <div>
                            <span class="meta-label">NINO</span>
                            <p>
                              {identity().nino.trim().length > 0
                                ? identity().nino
                                : "Not provided"}
                            </p>
                          </div>
                          <div>
                            <span class="meta-label">NHS Number</span>
                            <p>
                              {identity().nhsNumber.trim().length > 0
                                ? identity().nhsNumber
                                : "Not provided"}
                            </p>
                          </div>
                          <div>
                            <span class="meta-label">Pass No</span>
                            <p>
                              {identity().passNumber.trim().length > 0
                                ? identity().passNumber
                                : "Not provided"}
                            </p>
                          </div>
                          <div>
                            <span class="meta-label">Notes</span>
                            <p class="notes-content">
                              {identity().notes.trim().length > 0
                                ? identity().notes
                                : "Not provided"}
                            </p>
                          </div>
                        </div>
                        <div class="detail-footer">
                          <span class="meta-label">Created</span>
                          <strong>
                            {formatTimestamp(identity().createdAt)}
                          </strong>
                        </div>
                      </div>
                    )}
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
          </div>
        </div>
      </Show>
    </div>
  );
}
