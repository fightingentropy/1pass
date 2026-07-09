import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import {
  type VaultPayload,
} from "../functions/api/vault/schema";
import "./app.css";
import {
  createVaultSession,
  decryptVaultPayload,
  encryptVaultPayload,
  type VaultSession,
} from "./vaultCrypto";
import {
  initVault,
  isConflictError,
  readVaultMeta,
  saveVaultRecord,
} from "./vault/api";
import {
  AUTO_LOCK_MS,
  SAVE_DEBOUNCE_MS,
  createVaultDefault,
  normalizeVault,
  triggerBlobDownload,
  type ConfirmRequest,
  type SyncState,
  type VaultSection,
} from "./vault/types";
import Gate from "./vault/Gate";
import ConfirmDialog from "./vault/ConfirmDialog";
import AttachmentPreviewOverlay from "./vault/AttachmentPreviewOverlay";
import { ApiKeyModal, CredentialModal, IdentityModal } from "./vault/Modals";
import VaultWorkspace from "./vault/VaultWorkspace";
import {
  clearLegacyPasswordMeta,
  clearPendingRecovery,
  readPendingRecovery,
  storePendingRecovery,
  unlockVaultWithPassword,
} from "./vault/lifecycle";
import {
  buildCompleteBackup,
  restoreCompleteBackup,
  rotateMasterPassword,
} from "./vault/maintenance";
import {
  ChangePasswordModal,
  ImportBackupModal,
  type PasswordChangeDraft,
} from "./vault/MaintenanceModals";
import { createVaultCrudController } from "./vault/crudController";
import { createClipboardController } from "./vault/clipboardController";
import { createAttachmentController } from "./vault/attachmentController";

type GateView = "loading" | "setup" | "locked" | "unlocked";
export default function App() {
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
  const [syncEnabled, setSyncEnabled] = createSignal(false);
  const [session, setSession] = createSignal<VaultSession | null>(null);
  const [serverRevision, setServerRevision] = createSignal(0);
  const [requiresBootstrap, setRequiresBootstrap] = createSignal(true);
  const [persistedVaultJson, setPersistedVaultJson] = createSignal(
    JSON.stringify(createVaultDefault()),
  );
  const [confirmRequest, setConfirmRequest] = createSignal<ConfirmRequest | null>(
    null,
  );
  const [maintenanceLabel, setMaintenanceLabel] = createSignal("");
  const [passwordModalOpen, setPasswordModalOpen] = createSignal(false);
  const [passwordDraft, setPasswordDraft] = createSignal<PasswordChangeDraft>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = createSignal("");
  const [importFile, setImportFile] = createSignal<File | null>(null);
  const [importPassword, setImportPassword] = createSignal("");
  const [importError, setImportError] = createSignal("");

  const requestConfirm = (options: Omit<ConfirmRequest, "resolve">) =>
    new Promise<boolean>((resolve) => {
      setConfirmRequest({ ...options, resolve });
    });

  const resolveConfirm = (confirmed: boolean) => {
    const current = confirmRequest();
    setConfirmRequest(null);
    current?.resolve(confirmed);
  };

  const {
    isModalOpen,
    draft,
    setDraft,
    apiKeyDraft,
    setApiKeyDraft,
    modalError,
    editingTarget,
    credentialModal,
    credentialDraft,
    setCredentialDraft,
    credentialError,
    isEditing,
    handleOpenIdentityModal,
    handleOpenApiKeyModal,
    handleOpenEditIdentityModal,
    handleOpenEditApiKeyModal,
    handleCloseModal,
    handleSaveIdentity,
    handleSaveApiKey,
    handleOpenCredentialModal,
    handleCloseCredentialModal,
    handleSaveCredential,
    handleDeleteCredential,
    handleDeleteApiKey,
    resetDialogs,
  } = createVaultCrudController({
    vault,
    setVault,
    setSelectedIdentityId,
    setSelectedApiKeyId,
    requestConfirm,
  });

  const {
    copiedApiKeyId,
    copiedField,
    handleCopyApiKey,
    handleCopyField,
    handleCopySecret,
  } = createClipboardController(setError);

  onMount(() => {
    void (async () => {
      setBusy(true);
      setError("");

      try {
        const meta = await readVaultMeta();
        setRequiresBootstrap(Boolean(meta.requiresBootstrap));
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
      clearPendingRecovery();
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
      const revision = await saveVaultRecord(
        encryptedPayload,
        currentSession.authToken,
        serverRevision(),
      );
      if (thisVersion !== saveVersion) return true;
      setPersistedVaultJson(nextVaultJson);
      setServerRevision(revision);
      clearPendingRecovery();
      setLastSaved(Date.now());
      setError("");
      if (JSON.stringify(vault()) === nextVaultJson) {
        setSyncState("idle");
      }
      return true;
    } catch (saveError) {
      if (thisVersion !== saveVersion) return true;
      console.error(saveError);
      if (isConflictError(saveError)) {
        setError(
          "This vault changed in another tab or device. Lock and unlock again before saving.",
        );
      }
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

  const {
    uploadProgress,
    attachmentError,
    setAttachmentError,
    attachmentBusyId,
    attachmentPreview,
    closeAttachmentPreview,
    handleDeleteIdentity,
    handleAddAttachments,
    handleOpenAttachment,
    handleDownloadAttachment,
    handleDeleteAttachment,
    resetAttachments,
  } = createAttachmentController({
    vault,
    setVault,
    session,
    selectedIdentityId,
    setSelectedIdentityId,
    persistVault,
    requestConfirm,
  });

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

  const handleSetup = async (password: string, bootstrapSecret: string) => {
    setError("");
    setBusy(true);
    try {
      const freshVault = createVaultDefault();
      const nextSession = await createVaultSession(password);
      const encryptedPayload = await encryptVaultPayload(freshVault, nextSession);
      const revision = await initVault(
        encryptedPayload,
        nextSession.authToken,
        bootstrapSecret,
      );
      clearLegacyPasswordMeta();
      setVault(freshVault);
      setSession(nextSession);
      setServerRevision(revision);
      setRequiresBootstrap(false);
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

  const handleUnlock = async (password: string, bootstrapSecret: string) => {
    setError("");
    setBusy(true);
    setBusyLabel("");
    try {
      const {
        session: nextSession,
        vault: remoteVault,
        migrated,
        revision,
      } = await unlockVaultWithPassword(password, bootstrapSecret, setBusyLabel, () =>
        requestConfirm({
          title: "Set master password?",
          message:
            "This vault predates encryption and this device has no record of its password. The password you just entered will become the vault's master password.",
          confirmLabel: "Use this password",
          danger: false,
        }),
      );
      let vaultToOpen = remoteVault;
      const pendingRecovery = readPendingRecovery();
      if (pendingRecovery) {
        try {
          const recovered = normalizeVault(
            await decryptVaultPayload(pendingRecovery.payload, nextSession),
          );
          const remoteChanged = pendingRecovery.baseRevision !== revision;
          const restore = await requestConfirm({
            title: "Restore unsynced changes?",
            message: remoteChanged
              ? "This browser preserved encrypted unsynced changes, but the server changed afterward. Restore the local copy and replace the server version on the next save?"
              : "This browser preserved encrypted changes when it auto-locked offline. Restore them now?",
            confirmLabel: "Restore changes",
            danger: remoteChanged,
          });
          if (restore) vaultToOpen = recovered;
          else clearPendingRecovery();
        } catch {
          clearPendingRecovery();
        }
      }
      setSession(nextSession);
      setServerRevision(revision);
      setRequiresBootstrap(false);
      setVault(vaultToOpen);
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

  const handleLock = async (options?: { auto?: boolean }) => {
    if (view() !== "unlocked" || maintenanceLabel()) return;

    const flushed = await persistVault();
    let lockNotice = "";
    if (!flushed && syncState() === "error") {
      if (options?.auto) {
        const currentSession = session();
        if (currentSession) {
          try {
            await storePendingRecovery(
              vault(),
              currentSession,
              serverRevision(),
            );
            lockNotice =
              "Auto-locked. Unsynced changes were preserved encrypted in this browser.";
          } catch (recoveryError) {
            console.error("Unable to preserve pending vault changes", recoveryError);
            lockNotice =
              "Auto-locked after sync failed. Some unsynced changes could not be preserved.";
          }
        }
      } else {
        const proceed = await requestConfirm({
          title: "Sync failed",
          message:
            "Your latest changes could not be saved to the server. Lock anyway and discard them?",
          confirmLabel: "Lock anyway",
          danger: true,
        });
        if (!proceed) return;
        clearPendingRecovery();
      }
    }

    saveVersion += 1;
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    resetAttachments();
    resetDialogs();
    setConfirmRequest(null);
    setSyncEnabled(false);
    setSession(null);
    setServerRevision(0);
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
    setPasswordModalOpen(false);
    setImportFile(null);
    setImportPassword("");
    setError(lockNotice);
  };

  const handleExport = async () => {
    const currentSession = session();
    if (!currentSession || maintenanceLabel()) return;
    setMaintenanceLabel("Preparing backup…");
    setError("");
    try {
      if (!(await persistVault())) {
        throw new Error("The latest vault changes must sync before exporting.");
      }
      const backup = await buildCompleteBackup(
        vault(),
        currentSession,
        setMaintenanceLabel,
      );
      const blob = new Blob([JSON.stringify(backup)], {
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
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Unable to create the backup.",
      );
    } finally {
      setMaintenanceLabel("");
    }
  };

  const handleChooseImportFile = (file: File) => {
    if (maintenanceLabel()) return;
    setImportFile(file);
    setImportPassword("");
    setImportError("");
  };

  const handleImportBackup = async () => {
    const file = importFile();
    const password = importPassword();
    const currentSession = session();
    if (!file || !currentSession || maintenanceLabel()) return;
    if (!password) {
      setImportError("Enter the master password used by this backup.");
      return;
    }

    let syncPaused = false;
    setImportError("");
    setMaintenanceLabel("Reading encrypted backup…");
    try {
      if (!(await persistVault())) {
        throw new Error("The current vault must sync before it can be replaced.");
      }
      setSyncEnabled(false);
      syncPaused = true;
      const restored = await restoreCompleteBackup({
        file,
        password,
        currentVault: vault(),
        currentSession,
        revision: serverRevision(),
        onProgress: setMaintenanceLabel,
      });

      const nextJson = JSON.stringify(restored.vault);
      setVault(restored.vault);
      setPersistedVaultJson(nextJson);
      setServerRevision(restored.revision);
      setLastSaved(Date.now());
      setSyncState("idle");
      clearPendingRecovery();
      setSelectedIdentityId("");
      setSelectedApiKeyId("");
      setImportFile(null);
      setImportPassword("");
      setSyncEnabled(true);
      syncPaused = false;

      if (restored.cleanupFailures > 0) {
        setAttachmentError(
          "The backup was restored, but some replaced encrypted files could not be cleaned up.",
        );
      }
    } catch (restoreError) {
      console.error(restoreError);
      setImportError(
        restoreError instanceof Error
          ? restoreError.message
          : "Unable to restore this backup.",
      );
    } finally {
      if (syncPaused) setSyncEnabled(true);
      setMaintenanceLabel("");
    }
  };

  const openPasswordModal = () => {
    if (maintenanceLabel()) return;
    setPasswordDraft({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setPasswordError("");
    setPasswordModalOpen(true);
  };

  const handleChangePassword = async () => {
    const currentSession = session();
    const current = passwordDraft();
    if (!currentSession || maintenanceLabel()) return;
    if (!current.currentPassword) {
      setPasswordError("Enter your current master password.");
      return;
    }
    if (current.newPassword.length < 12) {
      setPasswordError("The new master password must be at least 12 characters.");
      return;
    }
    if (current.newPassword !== current.confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }
    if (current.currentPassword === current.newPassword) {
      setPasswordError("Choose a different master password.");
      return;
    }

    let syncPaused = false;
    setPasswordError("");
    setPasswordModalOpen(false);
    setMaintenanceLabel("Verifying current password…");
    try {
      if (!(await persistVault())) {
        throw new Error("The vault must sync before changing its password.");
      }
      setSyncEnabled(false);
      syncPaused = true;
      const rotated = await rotateMasterPassword({
        currentPassword: current.currentPassword,
        newPassword: current.newPassword,
        vault: vault(),
        currentSession,
        revision: serverRevision(),
        onProgress: setMaintenanceLabel,
      });

      const nextJson = JSON.stringify(rotated.vault);
      setSession(rotated.session);
      setVault(rotated.vault);
      setPersistedVaultJson(nextJson);
      setServerRevision(rotated.revision);
      setLastSaved(Date.now());
      setSyncState("idle");
      clearPendingRecovery();
      setPasswordDraft({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setSyncEnabled(true);
      syncPaused = false;

      if (rotated.cleanupFailures > 0) {
        setAttachmentError(
          "The password changed, but some old encrypted file copies could not be cleaned up.",
        );
      }
      setError("Master password changed successfully.");
    } catch (changeError) {
      console.error(changeError);
      setPasswordError(
        changeError instanceof Error
          ? changeError.message
          : "Unable to change the master password.",
      );
      setPasswordModalOpen(true);
    } finally {
      if (syncPaused) setSyncEnabled(true);
      setMaintenanceLabel("");
    }
  };
  const handleKeydown = (event: KeyboardEvent) => {
    // Escape during IME composition cancels the composition, not the overlay.
    if (event.isComposing) return;
    if (event.key === "Escape") {
      if (maintenanceLabel()) return;
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
      if (passwordModalOpen()) {
        setPasswordModalOpen(false);
        setPasswordError("");
        return;
      }
      if (importFile()) {
        setImportFile(null);
        setImportPassword("");
        setImportError("");
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
      passwordModalOpen() ||
      importFile() ||
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
      syncState() === "error" ||
      Boolean(maintenanceLabel())
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  };

  const markActivity = () => {
    lastActivityAt = Date.now();
  };

  const handleVisibilityChange = () => {
    if (
      document.visibilityState === "visible" &&
      view() === "unlocked" &&
      !maintenanceLabel() &&
      Date.now() - lastActivityAt >= AUTO_LOCK_MS
    ) {
      void handleLock({ auto: true });
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("visibilitychange", handleVisibilityChange);
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
      if (
        view() === "unlocked" &&
        !maintenanceLabel() &&
        Date.now() - lastActivityAt >= AUTO_LOCK_MS
      ) {
        void handleLock({ auto: true });
      }
    }, 30_000);

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      activityEvents.forEach((eventName) =>
        window.removeEventListener(eventName, markActivity),
      );
      if (autoLockTimer) window.clearInterval(autoLockTimer);
    });
  });

  onCleanup(() => {
    if (saveTimer) window.clearTimeout(saveTimer);
  });

  return (
    <div class="app" data-view={view()}>
      <div class="shell">
        <Show when={view() === "unlocked"}>
          <VaultWorkspace
            vault={vault()}
            activeSection={activeSection()}
            syncState={syncState()}
            syncError={error()}
            lastSaved={lastSaved()}
            maintenanceLabel={maintenanceLabel()}
            query={query()}
            filteredIdentities={filteredIdentities()}
            filteredApiKeys={filteredApiKeys()}
            selectedIdentity={selectedIdentity()}
            selectedApiKey={selectedApiKey()}
            isApiKeyVisible={isApiKeyVisible()}
            copiedApiKeyId={copiedApiKeyId()}
            copiedField={copiedField()}
            attachmentBusyId={attachmentBusyId()}
            uploadProgress={uploadProgress()}
            attachmentError={attachmentError()}
            onSectionChange={(section) => {
              setActiveSection(section);
              setQuery("");
            }}
            onQueryChange={setQuery}
            onSearchRef={(element) => {
              searchInputRef = element;
            }}
            onRetrySync={() => {
              if (error().includes("another tab or device")) {
                void handleLock({ auto: true });
              } else {
                void persistVault();
              }
            }}
            onExport={() => void handleExport()}
            onImportFile={handleChooseImportFile}
            onChangePassword={openPasswordModal}
            onLock={() => void handleLock()}
            onNewIdentity={handleOpenIdentityModal}
            onNewApiKey={handleOpenApiKeyModal}
            onSelectIdentity={setSelectedIdentityId}
            onSelectApiKey={setSelectedApiKeyId}
            onToggleApiKeyVisible={() =>
              setIsApiKeyVisible((current) => !current)
            }
            onCopyApiKey={(item) => void handleCopyApiKey(item)}
            onEditApiKey={handleOpenEditApiKeyModal}
            onDeleteApiKey={(item) => void handleDeleteApiKey(item)}
            onCopyField={(value, key) => void handleCopyField(value, key)}
            onCopySecret={(value, key) => void handleCopySecret(value, key)}
            onEditIdentity={handleOpenEditIdentityModal}
            onDeleteIdentity={(identity) =>
              void handleDeleteIdentity(identity)
            }
            onAddFiles={(identityId, files) =>
              void handleAddAttachments(identityId, files)
            }
            onOpenAttachment={(attachment) =>
              void handleOpenAttachment(attachment)
            }
            onDownloadAttachment={(attachment) =>
              void handleDownloadAttachment(attachment)
            }
            onDeleteAttachment={(identityId, attachment) =>
              void handleDeleteAttachment(identityId, attachment)
            }
            onAddCredential={(identityId) =>
              handleOpenCredentialModal(identityId, null)
            }
            onEditCredential={handleOpenCredentialModal}
            onDeleteCredential={(identityId, credential) =>
              void handleDeleteCredential(identityId, credential)
            }
          />
        </Show>

        <Show when={view() !== "unlocked"}>
          <Gate
            mode={view() as "loading" | "setup" | "locked"}
            busy={busy()}
            busyLabel={busyLabel()}
            error={error()}
            requiresBootstrap={requiresBootstrap()}
            onSetup={(password, bootstrapSecret) =>
              void handleSetup(password, bootstrapSecret)
            }
            onUnlock={(password, bootstrapSecret) =>
              void handleUnlock(password, bootstrapSecret)
            }
          />
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

      <Show when={passwordModalOpen() && !maintenanceLabel()}>
        <ChangePasswordModal
          draft={passwordDraft()}
          error={passwordError()}
          onChange={(patch) =>
            setPasswordDraft((current) => ({ ...current, ...patch }))
          }
          onSubmit={() => void handleChangePassword()}
          onClose={() => {
            setPasswordModalOpen(false);
            setPasswordError("");
          }}
        />
      </Show>

      <Show when={!maintenanceLabel() ? importFile() : null}>
        {(file) => (
          <ImportBackupModal
            fileName={file().name}
            password={importPassword()}
            error={importError()}
            onPasswordChange={setImportPassword}
            onSubmit={() => void handleImportBackup()}
            onClose={() => {
              setImportFile(null);
              setImportPassword("");
              setImportError("");
            }}
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
