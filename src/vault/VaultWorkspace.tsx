import { For, Show } from "solid-js";
import type {
  VaultAttachment,
  VaultCredential,
  VaultIdentityItem,
  VaultApiKeyItem,
  VaultPayload,
} from "../../functions/api/vault/schema";
import ApiKeyDetail from "./ApiKeyDetail";
import IdentityDetail from "./IdentityDetail";
import { KeyIcon, PaperclipIcon } from "./icons";
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
  onSearchRef: (element: HTMLInputElement) => void;
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
  onDeleteAttachment: (
    identityId: string,
    attachment: VaultAttachment,
  ) => void;
  onAddCredential: (identityId: string) => void;
  onEditCredential: (
    identityId: string,
    credential: VaultCredential,
  ) => void;
  onDeleteCredential: (
    identityId: string,
    credential: VaultCredential,
  ) => void;
};

export default function VaultWorkspace(props: VaultWorkspaceProps) {
  let importInputRef: HTMLInputElement | undefined;
  const maintenanceBusy = () => Boolean(props.maintenanceLabel);

  return (
    <>
      <header class="topbar">
        <div class="brand brand-row">
          <span class="brand-logo" aria-hidden="true" />
          <div class="brand-text">
            <span class="brand-mark">1Pass</span>
            <span class="brand-subtitle">Personal vault</span>
          </div>
        </div>
        <div class="topbar-actions">
          <Show
            when={maintenanceBusy()}
            fallback={
              <Show
                when={props.syncState === "error"}
                fallback={
                  <span
                    class={`status-pill sync-pill ${
                      props.syncState === "idle" ? "" : "busy"
                    }`}
                    title={
                      props.lastSaved
                        ? `Last saved ${new Date(props.lastSaved).toLocaleTimeString()}`
                        : "All changes encrypted & synced"
                    }
                  >
                    <Show when={props.syncState === "idle"} fallback={"Saving…"}>
                      Saved
                    </Show>
                  </span>
                }
              >
                <button
                  class="status-pill sync-pill error"
                  type="button"
                  title={props.syncError || "Saving failed. Click to retry."}
                  onClick={props.onRetrySync}
                >
                  {props.syncError.includes("another tab or device")
                    ? "Conflict — Lock to reload"
                    : "Sync failed — Retry"}
                </button>
              </Show>
            }
          >
            <span class="status-pill sync-pill busy" role="status">
              {props.maintenanceLabel}
            </span>
          </Show>
          <button
            class="btn quiet"
            type="button"
            disabled={maintenanceBusy()}
            onClick={props.onExport}
          >
            Export backup
          </button>
          <button
            class="btn quiet"
            type="button"
            disabled={maintenanceBusy()}
            onClick={() => importInputRef?.click()}
          >
            Import backup
          </button>
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
          <button
            class="btn quiet"
            type="button"
            disabled={maintenanceBusy()}
            onClick={props.onChangePassword}
          >
            Change password
          </button>
          <button
            class="btn ghost lock"
            type="button"
            disabled={maintenanceBusy()}
            onClick={props.onLock}
          >
            Lock
          </button>
        </div>
      </header>

      <section
        class={`dashboard ${maintenanceBusy() ? "maintenance-active" : ""}`}
        aria-busy={maintenanceBusy()}
      >
        <aside class="vault-sidebar">
          <nav class="nav-list">
            <button
              class={`nav-item ${
                props.activeSection === "identities" ? "active" : ""
              }`}
              type="button"
              onClick={() => props.onSectionChange("identities")}
            >
              Identities
              <span>{props.vault.identities.length}</span>
            </button>
            <button
              class={`nav-item ${
                props.activeSection === "apiKeys" ? "active" : ""
              }`}
              type="button"
              onClick={() => props.onSectionChange("apiKeys")}
            >
              API Keys
              <span>{props.vault.apiKeys.length}</span>
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
                  ref={props.onSearchRef}
                  type="search"
                  placeholder={
                    props.activeSection === "identities"
                      ? "Search identities (⌘K)"
                      : "Search API keys (⌘K)"
                  }
                  value={props.query}
                  onInput={(event) =>
                    props.onQueryChange(event.currentTarget.value)
                  }
                />
              </label>
              <button
                class="btn primary icon"
                type="button"
                onClick={() =>
                  props.activeSection === "identities"
                    ? props.onNewIdentity()
                    : props.onNewApiKey()
                }
              >
                + New
              </button>
            </div>
          </div>

          <div class="items-grid">
            <div class="items-list">
              <div class="list-header">
                <span>
                  {props.activeSection === "identities"
                    ? props.filteredIdentities.length
                    : props.filteredApiKeys.length}{" "}
                  {props.activeSection === "identities"
                    ? props.filteredIdentities.length === 1
                      ? "identity"
                      : "identities"
                    : props.filteredApiKeys.length === 1
                      ? "key"
                      : "keys"}
                </span>
              </div>
              <div class="list-body">
                <Show
                  when={props.activeSection === "identities"}
                  fallback={
                    <Show
                      when={props.filteredApiKeys.length > 0}
                      fallback={
                        <div class="empty-state">
                          <p class="empty">
                            {props.query.trim()
                              ? "No API keys match your search."
                              : "No API keys yet."}
                          </p>
                          <Show when={!props.query.trim()}>
                            <button
                              class="btn ghost"
                              type="button"
                              onClick={props.onNewApiKey}
                            >
                              Add your first API key
                            </button>
                          </Show>
                        </div>
                      }
                    >
                      <For each={props.filteredApiKeys}>
                        {(item) => (
                          <button
                            class={`list-item ${
                              props.selectedApiKey?.id === item.id ? "active" : ""
                            }`}
                            type="button"
                            onClick={() => props.onSelectApiKey(item.id)}
                          >
                            <div>
                              <strong>{item.label}</strong>
                              <span class="muted">
                                {item.environment || "No details"}
                              </span>
                            </div>
                          </button>
                        )}
                      </For>
                    </Show>
                  }
                >
                  <Show
                    when={props.filteredIdentities.length > 0}
                    fallback={
                      <div class="empty-state">
                        <p class="empty">
                          {props.query.trim()
                            ? "No identities match your search."
                            : "No identities yet."}
                        </p>
                        <Show when={!props.query.trim()}>
                          <button
                            class="btn ghost"
                            type="button"
                            onClick={props.onNewIdentity}
                          >
                            Create your first identity
                          </button>
                        </Show>
                      </div>
                    }
                  >
                    <For each={props.filteredIdentities}>
                      {(item) => (
                        <button
                          class={`list-item ${
                            props.selectedIdentity?.id === item.id ? "active" : ""
                          }`}
                          type="button"
                          onClick={() => props.onSelectIdentity(item.id)}
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
                when={props.activeSection === "identities"}
                fallback={
                  <Show
                    when={props.selectedApiKey}
                    fallback={
                      <div class="empty-detail">
                        <p>Select an API key to view details.</p>
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
                      <p>Select an identity to view details.</p>
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
            </div>
          </div>
        </main>
      </section>
    </>
  );
}
