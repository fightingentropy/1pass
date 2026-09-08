import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type {
  VaultAttachment,
  VaultCredential,
  VaultIdentityItem,
  VaultApiKeyItem,
  VaultPayload,
} from "../../functions/api/vault/schema";
import ApiKeyDetail from "./ApiKeyDetail";
import IdentityDetail from "./IdentityDetail";
import {
  ArrowLeftIcon,
  ChevronIcon,
  DownloadIcon,
  IdentityIcon,
  KeyIcon,
  LockIcon,
  PaperclipIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  UploadIcon,
} from "./icons";
import {
  identityInitials,
  type SyncState,
  type UploadProgress,
  type VaultSection,
} from "./types";

type VaultWorkspaceProps = {
  vault: VaultPayload;
  activeSection: VaultSection;
  syncState: SyncState;
  syncError: string;
  lastSaved: number | null;
  maintenanceLabel: string;
  query: string;
  filteredIdentities: VaultIdentityItem[];
  filteredApiKeys: VaultApiKeyItem[];
  selectedIdentity: VaultIdentityItem | null;
  selectedApiKey: VaultApiKeyItem | null;
  isApiKeyVisible: boolean;
  copiedApiKeyId: string;
  copiedField: string;
  attachmentBusyId: string;
  uploadProgress: UploadProgress | null;
  attachmentError: string;
  onSectionChange: (section: VaultSection) => void;
  onQueryChange: (query: string) => void;
  onSearchReady: (focusSearch: (() => void) | undefined) => void;
  onRetrySync: () => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
  onChangePassword: () => void;
  onLock: () => void;
  onNewIdentity: () => void;
  onNewApiKey: () => void;
  onSelectIdentity: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onToggleApiKeyVisible: () => void;
  onCopyApiKey: (item: VaultApiKeyItem) => void;
  onEditApiKey: (item: VaultApiKeyItem) => void;
  onDeleteApiKey: (item: VaultApiKeyItem) => void;
  onCopyField: (value: string, key: string) => void;
  onCopySecret: (value: string, key: string) => void;
  onEditIdentity: (identity: VaultIdentityItem) => void;
  onDeleteIdentity: (identity: VaultIdentityItem) => void;
  onAddFiles: (identityId: string, files: File[]) => void;
  onOpenAttachment: (attachment: VaultAttachment) => void;
  onDownloadAttachment: (attachment: VaultAttachment) => void;
  onDeleteAttachment: (identityId: string, attachment: VaultAttachment) => void;
  onAddCredential: (identityId: string) => void;
  onEditCredential: (identityId: string, credential: VaultCredential) => void;
  onDeleteCredential: (identityId: string, credential: VaultCredential) => void;
};

export default function VaultWorkspace(props: VaultWorkspaceProps) {
  let listScrollY = 0;
  let searchInputRef: HTMLInputElement | undefined;
  let detailRef: HTMLElement | undefined;
  let listRef: HTMLDivElement | undefined;
  let importInputRef: HTMLInputElement | undefined;
  let settingsRef: HTMLDetailsElement | undefined;
  const [mobileDetailOpen, setMobileDetailOpen] = createSignal(false);
  const [sortOrder, setSortOrder] = createSignal("recent");
  const maintenanceBusy = () => Boolean(props.maintenanceLabel);
  const isIdentity = () => props.activeSection === "identities";
  const sectionTitle = () => (isIdentity() ? "Identities" : "API keys");
  const itemCount = () =>
    isIdentity()
      ? props.filteredIdentities.length
      : props.filteredApiKeys.length;
  const sortedKeys = createMemo(() =>
    [...props.filteredApiKeys].sort((a, b) =>
      sortOrder() === "name"
        ? a.label.localeCompare(b.label)
        : b.createdAt - a.createdAt,
    ),
  );
  const sortedIdentities = createMemo(() =>
    [...props.filteredIdentities].sort((a, b) =>
      sortOrder() === "name"
        ? `${a.firstName} ${a.lastName}`.localeCompare(
            `${b.firstName} ${b.lastName}`,
          )
        : b.createdAt - a.createdAt,
    ),
  );

  const closeSettings = () => {
    if (settingsRef) settingsRef.open = false;
  };
  createEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsRef?.contains(event.target as Node)) closeSettings();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && settingsRef?.open) {
        closeSettings();
        settingsRef.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  onMount(() => {
    props.onSearchReady(() => {
      setMobileDetailOpen(false);
      closeSettings();
      queueMicrotask(() => {
        searchInputRef?.focus();
        searchInputRef?.select();
      });
    });
    onCleanup(() => props.onSearchReady(undefined));
  });
  const openMobileDetail = () => {
    const isMobile = window.matchMedia("(max-width: 720px)").matches;
    if (isMobile) listScrollY = window.scrollY;
    setMobileDetailOpen(true);
    if (isMobile) {
      queueMicrotask(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
        detailRef?.focus({ preventScroll: true });
      });
    }
  };
  const backToList = () => {
    setMobileDetailOpen(false);
    queueMicrotask(() => {
      window.scrollTo({ top: listScrollY, behavior: "instant" });
      listRef
        ?.querySelector<HTMLButtonElement>('[aria-current="true"]')
        ?.focus({ preventScroll: true });
    });
  };
  const changeSection = (section: VaultSection) => {
    setMobileDetailOpen(false);
    props.onSectionChange(section);
  };
  const navigateList = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const current = event.target as HTMLButtonElement;
    const next =
      event.key === "ArrowDown"
        ? current.nextElementSibling
        : current.previousElementSibling;
    if (next instanceof HTMLButtonElement) {
      event.preventDefault();
      next.focus();
      next.click();
    }
  };
  const emptyList = () => (
    <div class="empty-state">
      <span class="empty-state-icon">
        <Show
          when={props.query.trim()}
          fallback={isIdentity() ? <IdentityIcon /> : <KeyIcon />}
        >
          <SearchIcon />
        </Show>
      </span>
      <h3>
        {props.query.trim()
          ? "No matches found"
          : isIdentity()
            ? "Your identities, together"
            : "A home for your API keys"}
      </h3>
      <p>
        {props.query.trim()
          ? "Try another name or keyword."
          : isIdentity()
            ? "Keep personal details, logins and documents in one place."
            : "Save the keys you use, ready when you need them."}
      </p>
      <button
        class="btn ghost"
        type="button"
        onClick={() =>
          props.query.trim()
            ? props.onQueryChange("")
            : isIdentity()
              ? props.onNewIdentity()
              : props.onNewApiKey()
        }
      >
        {props.query.trim()
          ? "Clear search"
          : isIdentity()
            ? "Add an identity"
            : "Add an API key"}
      </button>
    </div>
  );

  return (
    <div class="workspace">
      <aside class="vault-sidebar">
        <div class="brand brand-row">
          <span class="brand-logo" aria-hidden="true" />
          <span class="brand-mark">
            1Pass<span class="brand-period">.</span>
          </span>
        </div>
        <div class="vault-context">
          <span class="vault-context-icon">
            <ShieldIcon />
          </span>
          <div>
            <strong>Personal vault</strong>
            <span>Private</span>
          </div>
        </div>
        <span class="nav-label">Collections</span>
        <nav class="nav-list" aria-label="Vault collections">
          <button
            class={`nav-item ${isIdentity() ? "" : "active"}`}
            type="button"
            aria-current={!isIdentity() ? "page" : undefined}
            title="API keys"
            disabled={maintenanceBusy()}
            onClick={() => changeSection("apiKeys")}
          >
            <KeyIcon />
            <span class="nav-name">API keys</span>
            <span class="nav-count">{props.vault.apiKeys.length}</span>
          </button>
          <button
            class={`nav-item ${isIdentity() ? "active" : ""}`}
            type="button"
            aria-current={isIdentity() ? "page" : undefined}
            title="Identities"
            disabled={maintenanceBusy()}
            onClick={() => changeSection("identities")}
          >
            <IdentityIcon />
            <span class="nav-name">Identities</span>
            <span class="nav-count">{props.vault.identities.length}</span>
          </button>
        </nav>
        <div class="sidebar-bottom">
          <div class="sidebar-security">
            <ShieldIcon />
            <span>Encrypted on your device</span>
          </div>
          <div class="sidebar-tools">
            <details class="vault-settings" ref={settingsRef}>
              <summary title="Vault settings" aria-label="Vault settings">
                <SettingsIcon />
                <span>Vault settings</span>
                <ChevronIcon />
              </summary>
              <div class="settings-panel">
                <span class="menu-heading">Manage your vault</span>
                <button
                  type="button"
                  disabled={maintenanceBusy()}
                  onClick={() => {
                    closeSettings();
                    props.onExport();
                  }}
                >
                  <DownloadIcon />
                  Export backup
                </button>
                <button
                  type="button"
                  disabled={maintenanceBusy()}
                  onClick={() => {
                    closeSettings();
                    importInputRef?.click();
                  }}
                >
                  <UploadIcon />
                  Import backup
                </button>
                <div class="menu-divider" />
                <button
                  type="button"
                  disabled={maintenanceBusy()}
                  onClick={() => {
                    closeSettings();
                    props.onChangePassword();
                  }}
                >
                  <KeyIcon />
                  Change password
                </button>
              </div>
            </details>
            <button
              class="sidebar-lock"
              type="button"
              disabled={maintenanceBusy()}
              onClick={props.onLock}
              title="Lock vault"
              aria-label="Lock vault"
            >
              <LockIcon />
            </button>
          </div>
          <span class="sidebar-lock-hint">Auto-locks after 15 minutes</span>
        </div>
        <input
          ref={importInputRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) props.onImportFile(file);
          }}
        />
      </aside>

      <main class={`main ${mobileDetailOpen() ? "has-detail" : ""}`}>
        <header class="topbar">
          <div class="breadcrumb">
            <span>Personal vault</span>
            <span class="breadcrumb-slash">/</span>
            <strong>{sectionTitle()}</strong>
          </div>
          <Show
            when={maintenanceBusy()}
            fallback={
              <Show
                when={props.syncState === "error"}
                fallback={
                  <span
                    class={`sync-status ${props.syncState === "idle" ? "" : "busy"}`}
                    role="status"
                    title={
                      props.lastSaved
                        ? `Last saved ${new Date(props.lastSaved).toLocaleTimeString()}`
                        : "All changes encrypted and synced"
                    }
                  >
                    <span class="status-dot" />
                    {props.syncState === "idle"
                      ? "All changes saved"
                      : "Saving changes…"}
                  </span>
                }
              >
                <button
                  class="sync-status error"
                  type="button"
                  title={props.syncError}
                  onClick={props.onRetrySync}
                >
                  {props.syncError.includes("another tab or device")
                    ? "Sync conflict · Reload vault"
                    : "Sync failed · Retry"}
                </button>
              </Show>
            }
          >
            <span class="sync-status busy" role="status">
              <span class="upload-spinner" />
              {props.maintenanceLabel}
            </span>
          </Show>
        </header>
        <section
          class="workspace-content"
          inert={maintenanceBusy()}
          aria-busy={maintenanceBusy()}
        >
          <div class="main-header">
            <div>
              <div class="section-heading">
                <h1>{sectionTitle()}</h1>
                <span class="section-count">
                  {isIdentity()
                    ? props.vault.identities.length
                    : props.vault.apiKeys.length}
                </span>
              </div>
              <p>
                {isIdentity()
                  ? "Your personal details, logins and documents."
                  : "Manage the keys to your apps and services."}
              </p>
            </div>
            <button
              class="btn primary"
              type="button"
              onClick={() =>
                isIdentity() ? props.onNewIdentity() : props.onNewApiKey()
              }
            >
              <PlusIcon />
              <span>{isIdentity() ? "New identity" : "New API key"}</span>
            </button>
          </div>
          <div class="items-grid">
            <section class="items-list" aria-label={sectionTitle()}>
              <div class="list-search">
                <label class="search-field">
                  <SearchIcon />
                  <span class="sr-only">Search vault items</span>
                  <input
                    ref={searchInputRef}
                    type="search"
                    placeholder={
                      isIdentity() ? "Search identities" : "Search API keys"
                    }
                    value={props.query}
                    onFocus={() => setMobileDetailOpen(false)}
                    onInput={(event) =>
                      props.onQueryChange(event.currentTarget.value)
                    }
                  />
                  <kbd>⌘ K</kbd>
                </label>
              </div>
              <div class="list-header">
                <span aria-live="polite">
                  {itemCount()} {itemCount() === 1 ? "item" : "items"}
                </span>
                <label class="sort-control">
                  <span class="sr-only">Sort items</span>
                  <select
                    value={sortOrder()}
                    onChange={(event) =>
                      setSortOrder(event.currentTarget.value)
                    }
                  >
                    <option value="recent">Newest first</option>
                    <option value="name">Name A–Z</option>
                  </select>
                  <ChevronIcon />
                </label>
              </div>
              <div class="list-body" ref={listRef} onKeyDown={navigateList}>
                <Show
                  when={isIdentity()}
                  fallback={
                    <Show when={sortedKeys().length > 0} fallback={emptyList()}>
                      <For each={sortedKeys()}>
                        {(item) => (
                          <button
                            class={`list-item ${props.selectedApiKey?.id === item.id ? "active" : ""}`}
                            type="button"
                            aria-current={
                              props.selectedApiKey?.id === item.id
                                ? "true"
                                : undefined
                            }
                            onClick={() => {
                              props.onSelectApiKey(item.id);
                              openMobileDetail();
                            }}
                          >
                            <span class="item-monogram" aria-hidden="true">
                              {(item.service.trim() || item.label.trim())
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                            <span class="list-item-text">
                              <strong>{item.label}</strong>
                              <span class="muted">
                                {[item.service, item.environment]
                                  .filter(Boolean)
                                  .join(" · ") || "API key"}
                              </span>
                            </span>
                            <ChevronIcon class="list-chevron" />
                          </button>
                        )}
                      </For>
                    </Show>
                  }
                >
                  <Show
                    when={sortedIdentities().length > 0}
                    fallback={emptyList()}
                  >
                    <For each={sortedIdentities()}>
                      {(item) => (
                        <button
                          class={`list-item ${props.selectedIdentity?.id === item.id ? "active" : ""}`}
                          type="button"
                          aria-current={
                            props.selectedIdentity?.id === item.id
                              ? "true"
                              : undefined
                          }
                          onClick={() => {
                            props.onSelectIdentity(item.id);
                            openMobileDetail();
                          }}
                        >
                          <span class="avatar" aria-hidden="true">
                            {identityInitials(item)}
                          </span>
                          <span class="list-item-text">
                            <strong>
                              {item.firstName} {item.lastName}
                            </strong>
                            <span class="muted">
                              {item.email || item.phone || "Identity"}
                            </span>
                          </span>
                          <span class="list-item-end">
                            <Show when={item.credentials.length > 0}>
                              <span
                                class="count-badge"
                                title={`${item.credentials.length} passwords`}
                              >
                                <KeyIcon />
                                {item.credentials.length}
                              </span>
                            </Show>
                            <Show when={item.attachments.length > 0}>
                              <span
                                class="count-badge"
                                title={`${item.attachments.length} files`}
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
              <div class="list-footer">
                <span class="keyboard-keys" aria-hidden="true">
                  <kbd>↑</kbd>
                  <kbd>↓</kbd>
                </span>
                <span>Navigate items</span>
              </div>
            </section>
            <section
              class="detail-card"
              ref={detailRef}
              tabindex={-1}
              aria-label="Item details"
            >
              <button class="mobile-back" type="button" onClick={backToList}>
                <ArrowLeftIcon />
                All {isIdentity() ? "identities" : "API keys"}
              </button>
              <Show
                when={props.activeSection === "identities"}
                fallback={
                  <Show
                    when={props.selectedApiKey}
                    fallback={
                      <div class="empty-detail">
                        <span class="empty-detail-icon">
                          <KeyIcon />
                        </span>
                        <h2>No item selected</h2>
                        <p>
                          {props.query.trim()
                            ? "Matching items will appear in the list."
                            : "Choose an API key from the list to see its details."}
                        </p>
                      </div>
                    }
                  >
                    {(item) => (
                      <ApiKeyDetail
                        item={item()}
                        isKeyVisible={props.isApiKeyVisible}
                        isCopied={props.copiedApiKeyId === item().id}
                        onToggleVisible={props.onToggleApiKeyVisible}
                        onCopyKey={() => props.onCopyApiKey(item())}
                        onEdit={() => props.onEditApiKey(item())}
                        onDelete={() => props.onDeleteApiKey(item())}
                      />
                    )}
                  </Show>
                }
              >
                <Show
                  when={props.selectedIdentity}
                  fallback={
                    <div class="empty-detail">
                      <span class="empty-detail-icon">
                        <IdentityIcon />
                      </span>
                      <h2>No item selected</h2>
                      <p>
                        {props.query.trim()
                          ? "Matching items will appear in the list."
                          : "Choose an identity from the list to see its details."}
                      </p>
                    </div>
                  }
                >
                  {(identity) => (
                    <IdentityDetail
                      identity={identity()}
                      copiedField={props.copiedField}
                      attachmentBusyId={props.attachmentBusyId}
                      uploadProgress={props.uploadProgress}
                      attachmentError={props.attachmentError}
                      onCopyField={props.onCopyField}
                      onCopySecret={props.onCopySecret}
                      onEdit={() => props.onEditIdentity(identity())}
                      onDelete={() => props.onDeleteIdentity(identity())}
                      onAddFiles={(files) =>
                        props.onAddFiles(identity().id, files)
                      }
                      onOpenAttachment={props.onOpenAttachment}
                      onDownloadAttachment={props.onDownloadAttachment}
                      onDeleteAttachment={(attachment) =>
                        props.onDeleteAttachment(identity().id, attachment)
                      }
                      onAddCredential={() =>
                        props.onAddCredential(identity().id)
                      }
                      onEditCredential={(credential) =>
                        props.onEditCredential(identity().id, credential)
                      }
                      onDeleteCredential={(credential) =>
                        props.onDeleteCredential(identity().id, credential)
                      }
                    />
                  )}
                </Show>
              </Show>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
