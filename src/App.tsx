import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import {
  isVaultEncryptedPayload,
  type VaultAttachment,
  type VaultCredential,
  type VaultEncryptedPayload,
  type VaultIdentityItem,
  type VaultApiKeyItem,
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
import {
  deleteAttachmentRemote,
  downloadAttachmentBlob,
  initVault,
  isUnauthorizedError,
  loadVaultRecord,
  migrateAttachmentEncryption,
  readVaultMeta,
  saveVaultRecord,
  uploadAttachmentBytes,
} from "./vault/api";
import {
  ATTACHMENT_MAX_BYTES,
  AUTO_LOCK_MS,
  CLIPBOARD_CLEAR_MS,
  SAVE_DEBOUNCE_MS,
  createApiKeyDraft,
  createCredentialDraft,
  createId,
  createIdentityDraft,
  createImageThumb,
  createVaultDefault,
  identityInitials,
  normalizeVault,
  triggerBlobDownload,
  type ApiKeyDraft,
  type AttachmentPreviewState,
  type ConfirmRequest,
  type CredentialDraft,
  type CredentialModalState,
  type EditingTarget,
  type IdentityDraft,
  type SyncState,
  type UploadProgress,
  type VaultSection,
} from "./vault/types";
import Gate from "./vault/Gate";
import ConfirmDialog from "./vault/ConfirmDialog";
import AttachmentPreviewOverlay from "./vault/AttachmentPreviewOverlay";
import IdentityDetail from "./vault/IdentityDetail";
import ApiKeyDetail from "./vault/ApiKeyDetail";
import { ApiKeyModal, CredentialModal, IdentityModal } from "./vault/Modals";
import { KeyIcon, PaperclipIcon } from "./vault/icons";

const LEGACY_STORAGE_KEYS = {
  passwordHash: "vault.password.hash",
  passwordSalt: "vault.password.salt",
};

type GateView = "loading" | "setup" | "locked" | "unlocked";

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

function readPendingMigrationKdf(
  decrypted: unknown,
): VaultEncryptedPayload["kdf"] | null {
  if (!decrypted || typeof decrypted !== "object") return null;
  const pending = (decrypted as Partial<VaultPayload>).pendingMigration;
  const kdf = pending?.kdf;
  if (
    kdf &&
    kdf.name === "PBKDF2" &&
    kdf.hash === "SHA-256" &&
    typeof kdf.iterations === "number" &&
    kdf.iterations > 0 &&
    typeof kdf.salt === "string" &&
    kdf.salt.length > 0
  ) {
    return kdf;
  }
  return null;
}

// Re-encrypts every attachment chunk from the old key to the new one.
// Per-chunk this is idempotent (old-key decrypt, falling back to new-key for
// chunks an earlier interrupted run already converted). Returns the number of
// attachments that could not be migrated instead of throwing, so a broken
// file can never brick the unlock flow.
async function reencryptAllAttachments(
  vault: VaultPayload,
  oldSession: VaultSession,
  newSession: VaultSession,
  onProgress: (label: string) => void,
): Promise<number> {
  const attachments = vault.identities.flatMap(
    (identity) => identity.attachments,
  );
  let failed = 0;
  for (const [index, attachment] of attachments.entries()) {
    onProgress(`Re-encrypting files (${index + 1}/${attachments.length})…`);
    try {
      await migrateAttachmentEncryption(attachment, oldSession, newSession);
    } catch (migrateError) {
      console.error(
        `Attachment migration failed for "${attachment.name}"`,
        migrateError,
      );
      failed += 1;
    }
  }
  return failed;
}

// Two-phase v1→v2 upgrade. The new KDF salt is persisted (inside the v2
// envelope, alongside a pendingMigration marker holding the old KDF) BEFORE
// any attachment chunk is touched — so every key that ever encrypts a chunk
// is durably stored first, and an interrupted migration resumes losslessly
// on the next unlock instead of stranding chunks under a lost key.
async function migrateVaultToV2(
  password: string,
  vault: VaultPayload,
  oldSession: VaultSession,
  onProgress: (label: string) => void,
): Promise<VaultSession> {
  onProgress("Upgrading vault security…");
  const nextSession = await createVaultSession(password);

  // Phase 1: persist the new envelope with a resume marker.
  const markedPayload = await encryptVaultPayload(
    { ...vault, pendingMigration: { kdf: oldSession.kdf } },
    nextSession,
  );
  await saveVaultRecord(markedPayload, nextSession.authToken);

  // Phase 2: re-encrypt attachment chunks under the new key.
  const failed = await reencryptAllAttachments(
    vault,
    oldSession,
    nextSession,
    onProgress,
  );

  // Phase 3: clear the marker — but only once every attachment made it, so a
  // partial failure keeps the marker and the next unlock retries.
  onProgress("Upgrading vault security…");
  if (failed === 0) {
    const cleanPayload = await encryptVaultPayload(vault, nextSession);
    await saveVaultRecord(cleanPayload, nextSession.authToken);
  }
  return nextSession;
}

async function unlockVaultWithPassword(
  password: string,
  onProgress: (label: string) => void,
  confirmLegacyAdoption: () => Promise<boolean>,
): Promise<{ session: VaultSession; vault: VaultPayload; migrated: boolean }> {
  const meta = await readVaultMeta();
  if (!meta.exists) {
    throw new Error("No vault exists yet. Reload the page to set one up.");
  }

  if (typeof meta.version === "number" && meta.version >= 1 && meta.kdf) {
    const session = await restoreVaultSession(password, {
      version: meta.version,
      kdf: meta.kdf,
    });

    let storedPayload: unknown;
    try {
      storedPayload = await loadVaultRecord(session.authToken);
    } catch (loadError) {
      if (isUnauthorizedError(loadError)) {
        throw new Error("Incorrect password. Try again.");
      }
      throw loadError;
    }

    if (!isVaultEncryptedPayload(storedPayload)) {
      throw new Error("Vault data is corrupted.");
    }

    let decrypted: unknown;
    try {
      decrypted = await decryptVaultPayload(storedPayload, session);
    } catch {
      throw new Error("Incorrect password. Try again.");
    }

    const pendingKdf = readPendingMigrationKdf(decrypted);
    const vault = normalizeVault(decrypted);

    if (session.version >= 2) {
      if (pendingKdf) {
        // A previous v1→v2 upgrade was interrupted mid-way; both KDFs are
        // durably stored, so finish re-encrypting the remaining chunks.
        onProgress("Finishing security upgrade…");
        const oldSession = await restoreVaultSession(password, {
          version: 1,
          kdf: pendingKdf,
        });
        const failed = await reencryptAllAttachments(
          vault,
          oldSession,
          session,
          onProgress,
        );
        if (failed === 0) {
          const cleanPayload = await encryptVaultPayload(vault, session);
          await saveVaultRecord(cleanPayload, session.authToken);
        }
        return { session, vault, migrated: true };
      }
      return { session, vault, migrated: false };
    }

    // v1 vault: upgrade to the v2 scheme (stronger KDF + server auth token).
    const nextSession = await migrateVaultToV2(
      password,
      vault,
      session,
      onProgress,
    );
    clearLegacyPasswordMeta();
    return { session: nextSession, vault, migrated: true };
  }

  // Legacy plaintext vault from before client-side encryption.
  const storedPayload = await loadVaultRecord("");
  const legacyMeta = readLegacyPasswordMeta();
  if (legacyMeta) {
    const hash = await hashLegacyPassword(password, legacyMeta.salt);
    if (hash !== legacyMeta.hash) {
      throw new Error("Incorrect password. Try again.");
    }
  } else {
    // No local record of the legacy password exists on this device, so the
    // password just typed would silently become the vault's master password.
    // Make that adoption explicit instead of silent.
    const confirmed = await confirmLegacyAdoption();
    if (!confirmed) {
      throw new Error("Unlock cancelled.");
    }
  }

  const vault = normalizeVault(storedPayload);
  const session = await createVaultSession(password);
  const encryptedPayload = await encryptVaultPayload(vault, session);
  await saveVaultRecord(encryptedPayload, session.authToken);
  clearLegacyPasswordMeta();
  return { session, vault, migrated: true };
}

export default function App() {
  let copiedSecretResetTimer: number | undefined;
  let copiedFieldResetTimer: number | undefined;
  let clipboardClearTimer: number | undefined;
  let saveTimer: number | undefined;
  let autoLockTimer: number | undefined;
  let saveVersion = 0;
  let lastActivityAt = Date.now();
  let searchInputRef: HTMLInputElement | undefined;

  const [view, setView] = createSignal<GateView>("loading");
  const [vault, setVault] = createSignal<VaultPayload>(createVaultDefault());
  const [activeSection, setActiveSection] = createSignal<VaultSection>("apiKeys");
  const [busy, setBusy] = createSignal(false);
  const [busyLabel, setBusyLabel] = createSignal("");
  const [error, setError] = createSignal("");
  const [lastSaved, setLastSaved] = createSignal<number | null>(null);
  const [syncState, setSyncState] = createSignal<SyncState>("idle");
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
  const [uploadProgress, setUploadProgress] = createSignal<UploadProgress | null>(
    null,
  );
  const [attachmentError, setAttachmentError] = createSignal("");
  const [attachmentBusyId, setAttachmentBusyId] = createSignal("");
  const [attachmentPreview, setAttachmentPreview] =
    createSignal<AttachmentPreviewState | null>(null);
  const [credentialModal, setCredentialModal] =
    createSignal<CredentialModalState | null>(null);
  const [credentialDraft, setCredentialDraft] = createSignal<CredentialDraft>(
    createCredentialDraft(),
  );
  const [credentialError, setCredentialError] = createSignal("");
  const [confirmRequest, setConfirmRequest] = createSignal<ConfirmRequest | null>(
    null,
  );

  const isEditing = createMemo(() => editingTarget() !== null);

  const requestConfirm = (options: Omit<ConfirmRequest, "resolve">) =>
    new Promise<boolean>((resolve) => {
      setConfirmRequest({ ...options, resolve });
    });

  const resolveConfirm = (confirmed: boolean) => {
    const current = confirmRequest();
    setConfirmRequest(null);
    current?.resolve(confirmed);
  };

  onMount(() => {
    void (async () => {
      setBusy(true);
      setError("");

      try {
        const meta = await readVaultMeta();
        setView(meta.exists ? "locked" : "setup");
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
        item.utr,
        item.govGatewayId,
        item.notes,
        ...item.credentials.flatMap((credential) => [
          credential.label,
          credential.username,
          credential.website,
        ]),
        ...item.attachments.map((attachment) => attachment.name),
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
      const haystack = [item.label, item.service, item.environment, item.notes]
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

  const scheduleSave = () => {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      void persistVault();
    }, SAVE_DEBOUNCE_MS);
  };

  const doPersistVault = async (): Promise<boolean> => {
    const currentSession = session();
    if (!currentSession || !syncEnabled()) return false;
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = undefined;
    }

    const nextVault = vault();
    const nextVaultJson = JSON.stringify(nextVault);
    if (nextVaultJson === persistedVaultJson()) {
      if (syncState() === "dirty" || syncState() === "error") {
        setSyncState("idle");
      }
      return true;
    }

    const thisVersion = ++saveVersion;
    setSyncState("saving");
    try {
      const encryptedPayload = await encryptVaultPayload(nextVault, currentSession);
      if (thisVersion !== saveVersion) return true;
      await saveVaultRecord(encryptedPayload, currentSession.authToken);
      if (thisVersion !== saveVersion) return true;
      setPersistedVaultJson(nextVaultJson);
      setLastSaved(Date.now());
      if (JSON.stringify(vault()) === nextVaultJson) {
        setSyncState("idle");
      }
      return true;
    } catch (saveError) {
      if (thisVersion !== saveVersion) return true;
      console.error(saveError);
      setSyncState("error");
      return false;
    }
  };

  // Saves are serialized through a promise chain so overlapping triggers
  // (debounce, manual retry, lock flush) can never race an in-flight request
  // and land a stale payload after a newer one.
  let saveQueue: Promise<boolean> = Promise.resolve(true);
  const persistVault = (): Promise<boolean> => {
    const run = saveQueue.then(() => doPersistVault());
    saveQueue = run.catch(() => false);
    return run;
  };

  createEffect(() => {
    const currentSession = session();
    if (view() !== "unlocked" || !syncEnabled() || !currentSession) return;

    const nextVaultJson = JSON.stringify(vault());
    if (nextVaultJson === persistedVaultJson()) {
      // Content reverted to the persisted state (e.g. an edit was undone
      // after a failed save) — nothing is unsaved, clear stale indicators.
      const state = untrack(syncState);
      if (state === "dirty" || state === "error") setSyncState("idle");
      return;
    }
    setSyncState("dirty");
    scheduleSave();
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

  const handleSetup = async (password: string) => {
    setError("");
    setBusy(true);
    try {
      const freshVault = createVaultDefault();
      const nextSession = await createVaultSession(password);
      const encryptedPayload = await encryptVaultPayload(freshVault, nextSession);
      await initVault(encryptedPayload, nextSession.authToken);
      clearLegacyPasswordMeta();
      setVault(freshVault);
      setSession(nextSession);
      setPersistedVaultJson(JSON.stringify(freshVault));
      setSyncEnabled(true);
      setSyncState("idle");
      setLastSaved(Date.now());
      setView("unlocked");
      lastActivityAt = Date.now();
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

  const handleUnlock = async (password: string) => {
    setError("");
    setBusy(true);
    setBusyLabel("");
    try {
      const {
        session: nextSession,
        vault: remoteVault,
        migrated,
      } = await unlockVaultWithPassword(password, setBusyLabel, () =>
        requestConfirm({
          title: "Set master password?",
          message:
            "This vault predates encryption and this device has no record of its password. The password you just entered will become the vault's master password.",
          confirmLabel: "Use this password",
          danger: false,
        }),
      );
      setSession(nextSession);
      setVault(remoteVault);
      setPersistedVaultJson(JSON.stringify(remoteVault));
      setSyncEnabled(true);
      setSyncState("idle");
      setLastSaved(migrated ? Date.now() : null);
      setView("unlocked");
      lastActivityAt = Date.now();
    } catch (unlockError) {
      console.error(unlockError);
      setError(
        unlockError instanceof Error
          ? unlockError.message
          : "Unable to unlock. Please retry.",
      );
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const closeAttachmentPreview = () => {
    const preview = attachmentPreview();
    if (preview) URL.revokeObjectURL(preview.url);
    setAttachmentPreview(null);
  };

  const handleLock = async (options?: { auto?: boolean }) => {
    if (view() !== "unlocked") return;

    const flushed = await persistVault();
    if (!flushed && syncState() === "error") {
      if (options?.auto) return;
      const proceed = await requestConfirm({
        title: "Sync failed",
        message:
          "Your latest changes could not be saved to the server. Lock anyway and discard them?",
        confirmLabel: "Lock anyway",
        danger: true,
      });
      if (!proceed) return;
    }

    saveVersion += 1;
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    closeAttachmentPreview();
    setUploadProgress(null);
    setAttachmentError("");
    setAttachmentBusyId("");
    setCredentialModal(null);
    setConfirmRequest(null);
    setSyncEnabled(false);
    setSession(null);
    setView("locked");
    setVault(createVaultDefault());
    setActiveSection("apiKeys");
    setQuery("");
    setSelectedIdentityId("");
    setSelectedApiKeyId("");
    setIsApiKeyVisible(false);
    setLastSaved(null);
    setSyncState("idle");
    setPersistedVaultJson(JSON.stringify(createVaultDefault()));
    setIsModalOpen(false);
    setEditingTarget(null);
    setError("");
  };

  const handleExport = async () => {
    const currentSession = session();
    if (!currentSession) return;
    try {
      const encryptedPayload = await encryptVaultPayload(vault(), currentSession);
      const exportData = {
        app: "1pass-vault-backup",
        exportedAt: new Date().toISOString(),
        note: "Encrypted with your master password. Attachment files are not included.",
        payload: encryptedPayload,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      triggerBlobDownload(
        url,
        `1pass-backup-${new Date().toISOString().slice(0, 10)}.json`,
      );
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (exportError) {
      console.error(exportError);
    }
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
      utr: identity.utr,
      govGatewayId: identity.govGatewayId,
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

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setModalError("");
    setEditingTarget(null);
  };

  const handleSaveIdentity = () => {
    setModalError("");

    const current = draft();
    if (!current.firstName.trim() || !current.lastName.trim()) {
      setModalError("First name and last name are required.");
      return;
    }

    const now = Date.now();
    const patch = {
      firstName: current.firstName.trim(),
      lastName: current.lastName.trim(),
      email: current.email.trim(),
      phone: current.phone.trim(),
      address: current.address.trim(),
      nino: current.nino.trim(),
      nhsNumber: current.nhsNumber.trim(),
      passNumber: current.passNumber.trim(),
      utr: current.utr.trim(),
      govGatewayId: current.govGatewayId.trim(),
      notes: current.notes.trim(),
    };
    const currentTarget = editingTarget();
    const activeEditingId =
      currentTarget?.section === "identities" ? currentTarget.id : null;

    if (activeEditingId) {
      setVault((currentVault) => ({
        ...currentVault,
        identities: currentVault.identities.map((item) =>
          item.id === activeEditingId
            ? { ...item, ...patch, updatedAt: now }
            : item,
        ),
      }));
      setSelectedIdentityId(activeEditingId);
    } else {
      const identity: VaultIdentityItem = {
        id: createId(),
        ...patch,
        attachments: [],
        credentials: [],
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

  const handleSaveApiKey = () => {
    setModalError("");

    const current = apiKeyDraft();
    if (!current.label.trim() || !current.key.trim()) {
      setModalError("Label and API key are required.");
      return;
    }

    const now = Date.now();
    const patch = {
      label: current.label.trim(),
      service: current.service.trim(),
      key: current.key.trim(),
      environment: current.environment.trim(),
      notes: current.notes.trim(),
    };
    const currentTarget = editingTarget();
    const activeEditingId =
      currentTarget?.section === "apiKeys" ? currentTarget.id : null;

    if (activeEditingId) {
      setVault((currentVault) => ({
        ...currentVault,
        apiKeys: currentVault.apiKeys.map((item) =>
          item.id === activeEditingId
            ? { ...item, ...patch, updatedAt: now }
            : item,
        ),
      }));
      setSelectedApiKeyId(activeEditingId);
    } else {
      const apiKey: VaultApiKeyItem = {
        id: createId(),
        ...patch,
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

  const handleOpenCredentialModal = (
    identityId: string,
    credential: VaultCredential | null,
  ) => {
    setCredentialDraft(
      credential
        ? {
            label: credential.label,
            username: credential.username,
            password: credential.password,
            website: credential.website,
            notes: credential.notes,
          }
        : createCredentialDraft(),
    );
    setCredentialError("");
    setCredentialModal({ identityId, credential });
  };

  const handleCloseCredentialModal = () => {
    setCredentialModal(null);
    setCredentialError("");
  };

  const handleSaveCredential = () => {
    const state = credentialModal();
    if (!state) return;
    setCredentialError("");

    const current = credentialDraft();
    if (!current.label.trim() || !current.password) {
      setCredentialError("Label and password are required.");
      return;
    }

    const now = Date.now();
    const patch = {
      label: current.label.trim(),
      username: current.username.trim(),
      password: current.password,
      website: current.website.trim(),
      notes: current.notes.trim(),
    };

    setVault((currentVault) => ({
      ...currentVault,
      identities: currentVault.identities.map((item) => {
        if (item.id !== state.identityId) return item;
        if (state.credential) {
          return {
            ...item,
            credentials: item.credentials.map((existing) =>
              existing.id === state.credential!.id
                ? { ...existing, ...patch, updatedAt: now }
                : existing,
            ),
            updatedAt: now,
          };
        }
        const credential: VaultCredential = {
          id: createId(),
          ...patch,
          createdAt: now,
          updatedAt: now,
        };
        return {
          ...item,
          credentials: [...item.credentials, credential],
          updatedAt: now,
        };
      }),
    }));

    setCredentialModal(null);
  };

  const handleDeleteCredential = async (
    identityId: string,
    credential: VaultCredential,
  ) => {
    const confirmed = await requestConfirm({
      title: "Delete password",
      message: `Delete "${credential.label || "this password"}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;

    setVault((currentVault) => ({
      ...currentVault,
      identities: currentVault.identities.map((item) =>
        item.id === identityId
          ? {
              ...item,
              credentials: item.credentials.filter(
                (existing) => existing.id !== credential.id,
              ),
              updatedAt: Date.now(),
            }
          : item,
      ),
    }));
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

  // Best effort: clears the clipboard after a delay, but only when it still
  // holds the copied secret (skips silently where reading is not permitted).
  const scheduleClipboardClear = (copied: string) => {
    if (clipboardClearTimer) window.clearTimeout(clipboardClearTimer);
    clipboardClearTimer = window.setTimeout(() => {
      void (async () => {
        try {
          const current = await navigator.clipboard.readText();
          if (current === copied) {
            await navigator.clipboard.writeText("");
          }
        } catch {
          // Clipboard read not available; leave it untouched.
        }
      })();
    }, CLIPBOARD_CLEAR_MS);
  };

  const handleCopyApiKey = async (item: VaultApiKeyItem) => {
    const key = item.key.trim();
    if (!key) return;

    try {
      await copyToClipboard(key);
      scheduleClipboardClear(key);
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

  const markFieldCopied = (fieldKey: string) => {
    setCopiedField(fieldKey);
    if (copiedFieldResetTimer) window.clearTimeout(copiedFieldResetTimer);
    copiedFieldResetTimer = window.setTimeout(() => {
      setCopiedField((current) => (current === fieldKey ? "" : current));
    }, 1800);
  };

  const handleCopyField = async (value: string, fieldKey: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      await copyToClipboard(trimmed);
      markFieldCopied(fieldKey);
    } catch {
      setError("Unable to copy to clipboard.");
    }
  };

  const handleCopySecret = async (value: string, fieldKey: string) => {
    if (!value) return;
    try {
      await copyToClipboard(value);
      scheduleClipboardClear(value);
      markFieldCopied(fieldKey);
    } catch {
      setError("Unable to copy to clipboard.");
    }
  };

  const handleDeleteIdentity = async (identity: VaultIdentityItem) => {
    const confirmed = await requestConfirm({
      title: "Delete identity",
      message: `Delete "${identity.firstName} ${identity.lastName}" and its ${identity.attachments.length} file(s)? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;

    const authToken = session()?.authToken ?? "";
    setVault((currentVault) => ({
      ...currentVault,
      identities: currentVault.identities.filter((item) => item.id !== identity.id),
    }));
    identity.attachments.forEach((attachment) => {
      void deleteAttachmentRemote(attachment.id, authToken);
    });
    if (selectedIdentityId() === identity.id) {
      setSelectedIdentityId("");
    }
  };

  const handleDeleteApiKey = async (item: VaultApiKeyItem) => {
    const confirmed = await requestConfirm({
      title: "Delete API key",
      message: `Delete "${item.label}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;

    setVault((currentVault) => ({
      ...currentVault,
      apiKeys: currentVault.apiKeys.filter((existing) => existing.id !== item.id),
    }));
    if (selectedApiKeyId() === item.id) {
      setSelectedApiKeyId("");
    }
  };

  const handleAddAttachments = async (identityId: string, files: File[]) => {
    const currentSession = session();
    if (!currentSession || files.length === 0) return;
    // Drag-drop and paste bypass the disabled "+ Add file" button — reject
    // re-entrant uploads instead of interleaving progress state.
    if (uploadProgress()) return;

    setAttachmentError("");
    for (const [fileIndex, file] of files.entries()) {
      const progressBase = {
        name: file.name,
        fileIndex: fileIndex + 1,
        fileCount: files.length,
      };
      if (file.size === 0) {
        setAttachmentError(`"${file.name}" is empty and was skipped.`);
        continue;
      }
      if (file.size > ATTACHMENT_MAX_BYTES) {
        setAttachmentError(
          `"${file.name}" is larger than 25 MB and was skipped.`,
        );
        continue;
      }

      const fileId = createId();
      setUploadProgress({ ...progressBase, percent: 0 });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const thumb = await createImageThumb(file);
        const chunks = await uploadAttachmentBytes(
          fileId,
          bytes,
          currentSession,
          (percent) => setUploadProgress({ ...progressBase, percent }),
        );

        const attachment: VaultAttachment = {
          id: fileId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          chunks,
          thumb,
          createdAt: Date.now(),
        };

        if (!vault().identities.some((item) => item.id === identityId)) {
          void deleteAttachmentRemote(fileId, currentSession.authToken);
          setAttachmentError("The identity no longer exists.");
          break;
        }

        setVault((currentVault) => ({
          ...currentVault,
          identities: currentVault.identities.map((item) =>
            item.id === identityId
              ? {
                  ...item,
                  attachments: [...item.attachments, attachment],
                  updatedAt: Date.now(),
                }
              : item,
          ),
        }));
      } catch (uploadError) {
        console.error(uploadError);
        void deleteAttachmentRemote(fileId, currentSession.authToken);
        setAttachmentError(
          uploadError instanceof Error
            ? `Upload of "${file.name}" failed: ${uploadError.message}`
            : `Upload of "${file.name}" failed.`,
        );
      }
    }
    setUploadProgress(null);
  };

  const handleOpenAttachment = async (attachment: VaultAttachment) => {
    const currentSession = session();
    if (!currentSession || attachmentBusyId()) return;

    setAttachmentError("");
    setAttachmentBusyId(attachment.id);
    try {
      const blob = await downloadAttachmentBlob(attachment, currentSession);
      const url = URL.createObjectURL(blob);
      if (
        attachment.mimeType.startsWith("image/") ||
        attachment.mimeType === "application/pdf"
      ) {
        closeAttachmentPreview();
        setAttachmentPreview({ attachment, url });
      } else {
        triggerBlobDownload(url, attachment.name);
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (openError) {
      console.error(openError);
      setAttachmentError(
        openError instanceof Error ? openError.message : "Unable to open the file.",
      );
    } finally {
      setAttachmentBusyId("");
    }
  };

  const handleDownloadAttachment = async (attachment: VaultAttachment) => {
    const currentSession = session();
    if (!currentSession || attachmentBusyId()) return;

    setAttachmentError("");
    setAttachmentBusyId(attachment.id);
    try {
      const blob = await downloadAttachmentBlob(attachment, currentSession);
      const url = URL.createObjectURL(blob);
      triggerBlobDownload(url, attachment.name);
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (downloadError) {
      console.error(downloadError);
      setAttachmentError(
        downloadError instanceof Error
          ? downloadError.message
          : "Unable to download the file.",
      );
    } finally {
      setAttachmentBusyId("");
    }
  };

  const handleDeleteAttachment = async (
    identityId: string,
    attachment: VaultAttachment,
  ) => {
    const confirmed = await requestConfirm({
      title: "Delete file",
      message: `Delete "${attachment.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;

    const authToken = session()?.authToken ?? "";
    setAttachmentError("");
    setVault((currentVault) => ({
      ...currentVault,
      identities: currentVault.identities.map((item) =>
        item.id === identityId
          ? {
              ...item,
              attachments: item.attachments.filter(
                (existing) => existing.id !== attachment.id,
              ),
              updatedAt: Date.now(),
            }
          : item,
      ),
    }));
    void deleteAttachmentRemote(attachment.id, authToken);
  };

  const handleKeydown = (event: KeyboardEvent) => {
    // Escape during IME composition cancels the composition, not the overlay.
    if (event.isComposing) return;
    if (event.key === "Escape") {
      if (attachmentPreview()) {
        closeAttachmentPreview();
        return;
      }
      if (confirmRequest()) {
        resolveConfirm(false);
        return;
      }
      if (credentialModal()) {
        handleCloseCredentialModal();
        return;
      }
      if (isModalOpen()) {
        handleCloseModal();
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      if (view() !== "unlocked") return;
      event.preventDefault();
      searchInputRef?.focus();
      searchInputRef?.select();
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (view() !== "unlocked" || activeSection() !== "identities") return;
    if (
      isModalOpen() ||
      credentialModal() ||
      confirmRequest() ||
      attachmentPreview()
    ) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
    ) {
      return;
    }
    const identity = selectedIdentity();
    if (!identity) return;
    const files = event.clipboardData?.files
      ? Array.from(event.clipboardData.files)
      : [];
    if (files.length > 0) {
      event.preventDefault();
      void handleAddAttachments(identity.id, files);
    }
  };

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (
      syncState() === "dirty" ||
      syncState() === "saving" ||
      syncState() === "error"
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  };

  const markActivity = () => {
    lastActivityAt = Date.now();
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("paste", handlePaste);
    window.addEventListener("beforeunload", handleBeforeUnload);
    const activityEvents: (keyof WindowEventMap)[] = [
      "pointerdown",
      "pointermove",
      "keydown",
      "wheel",
      "touchstart",
    ];
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, markActivity, { passive: true }),
    );
    autoLockTimer = window.setInterval(() => {
      if (view() === "unlocked" && Date.now() - lastActivityAt >= AUTO_LOCK_MS) {
        void handleLock({ auto: true });
      }
    }, 30_000);

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("paste", handlePaste);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      activityEvents.forEach((eventName) =>
        window.removeEventListener(eventName, markActivity),
      );
      if (autoLockTimer) window.clearInterval(autoLockTimer);
    });
  });

  onCleanup(() => {
    if (copiedSecretResetTimer) window.clearTimeout(copiedSecretResetTimer);
    if (copiedFieldResetTimer) window.clearTimeout(copiedFieldResetTimer);
    if (clipboardClearTimer) window.clearTimeout(clipboardClearTimer);
    if (saveTimer) window.clearTimeout(saveTimer);
    const preview = attachmentPreview();
    if (preview) URL.revokeObjectURL(preview.url);
  });

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
              <Show
                when={syncState() === "error"}
                fallback={
                  <span
                    class={`status-pill sync-pill ${
                      syncState() === "idle" ? "" : "busy"
                    }`}
                    title={
                      lastSaved()
                        ? `Last saved ${new Date(lastSaved()!).toLocaleTimeString()}`
                        : "All changes encrypted & synced"
                    }
                  >
                    <Show when={syncState() === "idle"} fallback={"Saving…"}>
                      Saved
                    </Show>
                  </span>
                }
              >
                <button
                  class="status-pill sync-pill error"
                  type="button"
                  title="Saving failed. Click to retry."
                  onClick={() => void persistVault()}
                >
                  Sync failed — Retry
                </button>
              </Show>
              <button class="btn ghost" type="button" onClick={() => void handleExport()}>
                Export
              </button>
              <a class="btn ghost" href="/tax">
                Tax tools
              </a>
              <button class="btn ghost" type="button" onClick={() => void handleLock()}>
                Lock
              </button>
            </div>
          </header>
        </Show>

        <Show when={view() !== "unlocked"}>
          <Gate
            mode={view() as "loading" | "setup" | "locked"}
            busy={busy()}
            busyLabel={busyLabel()}
            error={error()}
            onSetup={(password) => void handleSetup(password)}
            onUnlock={(password) => void handleUnlock(password)}
          />
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
                  class={`nav-item ${activeSection() === "apiKeys" ? "active" : ""}`}
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
                      ref={searchInputRef}
                      type="search"
                      placeholder={
                        activeSection() === "identities"
                          ? "Search identities (⌘K)"
                          : "Search API keys (⌘K)"
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
                          fallback={
                            <div class="empty-state">
                              <p class="empty">
                                {query().trim()
                                  ? "No API keys match your search."
                                  : "No API keys yet."}
                              </p>
                              <Show when={!query().trim()}>
                                <button
                                  class="btn ghost"
                                  type="button"
                                  onClick={handleOpenApiKeyModal}
                                >
                                  Add your first API key
                                </button>
                              </Show>
                            </div>
                          }
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
                        fallback={
                          <div class="empty-state">
                            <p class="empty">
                              {query().trim()
                                ? "No identities match your search."
                                : "No identities yet."}
                            </p>
                            <Show when={!query().trim()}>
                              <button
                                class="btn ghost"
                                type="button"
                                onClick={handleOpenIdentityModal}
                              >
                                Create your first identity
                              </button>
                            </Show>
                          </div>
                        }
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
                              <span class="avatar" aria-hidden="true">
                                {identityInitials(item)}
                              </span>
                              <div>
                                <strong>
                                  {item.firstName} {item.lastName}
                                </strong>
                                <span class="muted">
                                  {item.email || item.phone || "No contact details"}
                                </span>
                              </div>
                              <span class="list-item-end">
                                <Show when={item.credentials.length > 0}>
                                  <span
                                    class="count-badge"
                                    title={`${item.credentials.length} password(s)`}
                                  >
                                    <KeyIcon />
                                    {item.credentials.length}
                                  </span>
                                </Show>
                                <Show when={item.attachments.length > 0}>
                                  <span
                                    class="count-badge"
                                    title={`${item.attachments.length} file(s)`}
                                  >
                                    <PaperclipIcon />
                                    {item.attachments.length}
                                  </span>
                                </Show>
                              </span>
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
                          <ApiKeyDetail
                            item={item()}
                            isKeyVisible={isApiKeyVisible()}
                            isCopied={copiedApiKeyId() === item().id}
                            onToggleVisible={() =>
                              setIsApiKeyVisible((current) => !current)
                            }
                            onCopyKey={() => void handleCopyApiKey(item())}
                            onEdit={() => handleOpenEditApiKeyModal(item())}
                            onDelete={() => void handleDeleteApiKey(item())}
                          />
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
                        <IdentityDetail
                          identity={identity()}
                          copiedField={copiedField()}
                          attachmentBusyId={attachmentBusyId()}
                          uploadProgress={uploadProgress()}
                          attachmentError={attachmentError()}
                          onCopyField={(value, key) =>
                            void handleCopyField(value, key)
                          }
                          onCopySecret={(value, key) =>
                            void handleCopySecret(value, key)
                          }
                          onEdit={() => handleOpenEditIdentityModal(identity())}
                          onDelete={() => void handleDeleteIdentity(identity())}
                          onAddFiles={(files) =>
                            void handleAddAttachments(identity().id, files)
                          }
                          onOpenAttachment={(attachment) =>
                            void handleOpenAttachment(attachment)
                          }
                          onDownloadAttachment={(attachment) =>
                            void handleDownloadAttachment(attachment)
                          }
                          onDeleteAttachment={(attachment) =>
                            void handleDeleteAttachment(identity().id, attachment)
                          }
                          onAddCredential={() =>
                            handleOpenCredentialModal(identity().id, null)
                          }
                          onEditCredential={(credential) =>
                            handleOpenCredentialModal(identity().id, credential)
                          }
                          onDeleteCredential={(credential) =>
                            void handleDeleteCredential(identity().id, credential)
                          }
                        />
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
        <Show
          when={
            activeSection() === "identities" ||
            editingTarget()?.section === "identities"
          }
          fallback={
            <ApiKeyModal
              draft={apiKeyDraft()}
              isEditing={isEditing()}
              error={modalError()}
              onChange={(patch) =>
                setApiKeyDraft((current) => ({ ...current, ...patch }))
              }
              onSubmit={handleSaveApiKey}
              onClose={handleCloseModal}
            />
          }
        >
          <IdentityModal
            draft={draft()}
            isEditing={isEditing()}
            error={modalError()}
            onChange={(patch) =>
              setDraft((current) => ({ ...current, ...patch }))
            }
            onSubmit={handleSaveIdentity}
            onClose={handleCloseModal}
          />
        </Show>
      </Show>

      <Show when={credentialModal()}>
        {(state) => (
          <CredentialModal
            draft={credentialDraft()}
            isEditing={Boolean(state().credential)}
            error={credentialError()}
            onChange={(patch) =>
              setCredentialDraft((current) => ({ ...current, ...patch }))
            }
            onSubmit={handleSaveCredential}
            onClose={handleCloseCredentialModal}
          />
        )}
      </Show>

      <Show when={attachmentPreview()}>
        {(preview) => (
          <AttachmentPreviewOverlay
            preview={preview()}
            onClose={closeAttachmentPreview}
          />
        )}
      </Show>

      <Show when={confirmRequest()}>
        {(request) => (
          <ConfirmDialog request={request()} onClose={resolveConfirm} />
        )}
      </Show>
    </div>
  );
}
