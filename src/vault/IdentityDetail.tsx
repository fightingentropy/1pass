import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type {
  VaultAttachment,
  VaultCredential,
  VaultIdentityItem,
} from "../../functions/api/vault/schema";
import type { UploadProgress } from "./types";
import {
  formatBytes,
  formatTimestamp,
  IDENTITY_CONTACT_FIELDS,
  IDENTITY_GOVERNMENT_FIELDS,
  isImageAttachment,
  isPdfAttachment,
} from "./types";
import {
  CheckIcon,
  ChevronIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  ImageIcon,
  KeyIcon,
  MoreIcon,
  PencilIcon,
  TrashIcon,
} from "./icons";

type IdentityDetailProps = {
  identity: VaultIdentityItem;
  copiedField: string;
  attachmentBusyId: string;
  uploadProgress: UploadProgress | null;
  attachmentError: string;
  onCopyField: (value: string, key: string) => void;
  onCopySecret: (value: string, key: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddFiles: (files: File[]) => void;
  onOpenAttachment: (attachment: VaultAttachment) => void;
  onDownloadAttachment: (attachment: VaultAttachment) => void;
  onDeleteAttachment: (attachment: VaultAttachment) => void;
  onAddCredential: () => void;
  onEditCredential: (credential: VaultCredential) => void;
  onDeleteCredential: (credential: VaultCredential) => void;
};

function CopyableFields(props: {
  fields: readonly { label: string; field: keyof VaultIdentityItem }[];
  identity: VaultIdentityItem;
  copiedField: string;
  onCopyField: (value: string, key: string) => void;
}) {
  return (
    <div class="detail-grid">
      <For each={props.fields}>
        {(fieldDef) => {
          const value = () => props.identity[fieldDef.field] as string;
          return (
            <div
              class={`copyable-field ${value().trim() ? "" : "empty"}`}
              onClick={() => props.onCopyField(value(), fieldDef.field)}
              title={value().trim() ? "Click to copy" : undefined}
            >
              <span class="meta-label">{fieldDef.label}</span>
              <p>{value().trim() || "Not provided"}</p>
              <Show when={value().trim()}>
                <span
                  class={`copied-badge ${
                    props.copiedField === fieldDef.field ? "visible" : ""
                  }`}
                >
                  <CheckIcon />
                  Copied
                </span>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

function CollapsibleSection(props: {
  title: string;
  open: boolean;
  onToggle: () => void;
  meta?: string;
  actions?: any;
  children: any;
}) {
  return (
    <section class={`detail-section ${props.open ? "is-open" : "is-collapsed"}`}>
      <div class="detail-section-header">
        <button
          class="detail-section-toggle"
          type="button"
          aria-expanded={props.open}
          onClick={props.onToggle}
        >
          <ChevronIcon class="detail-section-chevron" />
          <span class="detail-section-title">
            {props.title}
            <Show when={props.meta}>
              {" "}
              <span class="detail-section-meta">{props.meta}</span>
            </Show>
          </span>
        </button>
        <Show when={props.actions}>
          <div class="detail-section-actions" onClick={(e) => e.stopPropagation()}>
            {props.actions}
          </div>
        </Show>
      </div>
      <Show when={props.open}>
        <div class="detail-section-body">{props.children}</div>
      </Show>
    </section>
  );
}

function hasAnyField(
  identity: VaultIdentityItem,
  fields: readonly { field: keyof VaultIdentityItem }[],
) {
  return fields.some((field) => String(identity[field.field] ?? "").trim());
}

export default function IdentityDetail(props: IdentityDetailProps) {
  const [dragActive, setDragActive] = createSignal(false);
  const [visibleCredentialId, setVisibleCredentialId] = createSignal("");
  const [openMenuId, setOpenMenuId] = createSignal("");
  const [contactOpen, setContactOpen] = createSignal(true);
  const [govOpen, setGovOpen] = createSignal(
    hasAnyField(props.identity, IDENTITY_GOVERNMENT_FIELDS),
  );
  const [loginsOpen, setLoginsOpen] = createSignal(
    props.identity.credentials.length > 0,
  );
  const [filesOpen, setFilesOpen] = createSignal(
    props.identity.attachments.length > 0,
  );
  let fileInputRef: HTMLInputElement | undefined;

  // The component instance survives identity switches (non-keyed Show), so
  // reset transient reveal/drag state when a different identity is shown —
  // otherwise a revealed password would still be revealed after switching
  // away and back.
  createEffect(
    on(
      () => props.identity.id,
      () => {
        setVisibleCredentialId("");
        setDragActive(false);
        setOpenMenuId("");
        setContactOpen(true);
        setGovOpen(hasAnyField(props.identity, IDENTITY_GOVERNMENT_FIELDS));
        setLoginsOpen(props.identity.credentials.length > 0);
        setFilesOpen(props.identity.attachments.length > 0);
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    if (!openMenuId()) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".overflow-menu")) return;
      setOpenMenuId("");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId("");
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  const handleFileInput = (input: HTMLInputElement) => {
    const files = input.files ? Array.from(input.files) : [];
    input.value = "";
    props.onAddFiles(files);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    const files = event.dataTransfer?.files
      ? Array.from(event.dataTransfer.files)
      : [];
    if (files.length > 0) props.onAddFiles(files);
  };

  return (
    <div>
      <div class="detail-header">
        <div>
          <h2>
            {props.identity.firstName} {props.identity.lastName}
          </h2>
          <p class="muted">Identity</p>
        </div>
        <div class="detail-actions">
          <button
            class="icon-button icon-only"
            type="button"
            aria-label="Edit identity"
            onClick={props.onEdit}
          >
            <PencilIcon />
          </button>
          <button
            class="icon-button icon-only"
            type="button"
            aria-label="Delete identity"
            onClick={props.onDelete}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <CollapsibleSection
        title="Contact"
        open={contactOpen()}
        onToggle={() => setContactOpen((current) => !current)}
      >
        <CopyableFields
          fields={IDENTITY_CONTACT_FIELDS}
          identity={props.identity}
          copiedField={props.copiedField}
          onCopyField={props.onCopyField}
        />
        <div>
          <span class="meta-label">Notes</span>
          <p class="notes-content">
            {props.identity.notes.trim() || "Not provided"}
          </p>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Government IDs"
        open={govOpen()}
        onToggle={() => setGovOpen((current) => !current)}
      >
        <CopyableFields
          fields={IDENTITY_GOVERNMENT_FIELDS}
          identity={props.identity}
          copiedField={props.copiedField}
          onCopyField={props.onCopyField}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Logins"
        open={loginsOpen()}
        onToggle={() => setLoginsOpen((current) => !current)}
        meta={
          props.identity.credentials.length > 0
            ? `(${props.identity.credentials.length})`
            : undefined
        }
        actions={
          <button
            class="secret-toggle"
            type="button"
            onClick={() => {
              setLoginsOpen(true);
              props.onAddCredential();
            }}
          >
            + Add
          </button>
        }
      >
        <Show
          when={props.identity.credentials.length > 0}
          fallback={
            <p class="attachments-empty">
              No passwords yet. Store logins that belong to this identity —
              they stay encrypted inside the vault.
            </p>
          }
        >
          <div class="credential-list">
            <For each={props.identity.credentials}>
              {(credential) => {
                const isVisible = () =>
                  visibleCredentialId() === credential.id;
                const menuOpen = () => openMenuId() === credential.id;
                const subtitle = () =>
                  credential.username.trim() ||
                  credential.website.trim() ||
                  "No username";
                return (
                  <div class="credential-row">
                    <span class="credential-icon" aria-hidden="true">
                      <KeyIcon />
                    </span>
                    <div
                      class="credential-info copyable-inline"
                      title={
                        credential.username.trim()
                          ? "Click to copy username"
                          : undefined
                      }
                      onClick={() =>
                        props.onCopyField(
                          credential.username,
                          `creduser:${credential.id}`,
                        )
                      }
                    >
                      <strong>{credential.label || "Untitled"}</strong>
                      <span class="muted">
                        {props.copiedField === `creduser:${credential.id}`
                          ? "Username copied"
                          : subtitle()}
                      </span>
                    </div>
                    <span
                      class={`credential-password ${isVisible() ? "" : "masked"}`}
                    >
                      {isVisible() ? credential.password : "••••••••••••"}
                    </span>
                    <div class="credential-actions">
                      <button
                        class="icon-button icon-only"
                        type="button"
                        aria-label={
                          isVisible() ? "Hide password" : "Show password"
                        }
                        title={isVisible() ? "Hide" : "Show"}
                        onClick={() =>
                          setVisibleCredentialId((current) =>
                            current === credential.id ? "" : credential.id,
                          )
                        }
                      >
                        <Show when={isVisible()} fallback={<EyeIcon />}>
                          <EyeOffIcon />
                        </Show>
                      </button>
                      <button
                        class={`icon-button icon-only ${
                          props.copiedField === `credpass:${credential.id}`
                            ? "is-success"
                            : ""
                        }`}
                        type="button"
                        aria-label="Copy password"
                        title="Copy password (clears after 60s)"
                        onClick={() =>
                          props.onCopySecret(
                            credential.password,
                            `credpass:${credential.id}`,
                          )
                        }
                      >
                        <Show
                          when={
                            props.copiedField === `credpass:${credential.id}`
                          }
                          fallback={<CopyIcon />}
                        >
                          <CheckIcon />
                        </Show>
                      </button>
                      <div class="overflow-menu">
                        <button
                          class="icon-button icon-only"
                          type="button"
                          aria-label="More actions"
                          aria-expanded={menuOpen()}
                          title="More"
                          onClick={() =>
                            setOpenMenuId((current) =>
                              current === credential.id ? "" : credential.id,
                            )
                          }
                        >
                          <MoreIcon />
                        </button>
                        <Show when={menuOpen()}>
                          <div class="overflow-panel" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuId("");
                                props.onEditCredential(credential);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              class="danger"
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuId("");
                                props.onDeleteCredential(credential);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </CollapsibleSection>

      <section
        class={`detail-section attachments-block ${filesOpen() ? "is-open" : "is-collapsed"} ${dragActive() ? "drag-active" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
          setFilesOpen(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        <div class="detail-section-header">
          <button
            class="detail-section-toggle"
            type="button"
            aria-expanded={filesOpen()}
            onClick={() => setFilesOpen((current) => !current)}
          >
            <ChevronIcon class="detail-section-chevron" />
            <span class="detail-section-title">
              Files
              <Show when={props.identity.attachments.length > 0}>
                {" "}
                <span class="detail-section-meta">
                  ({props.identity.attachments.length})
                </span>
              </Show>
            </span>
          </button>
          <div class="detail-section-actions">
            <button
              class="secret-toggle"
              type="button"
              disabled={Boolean(props.uploadProgress)}
              onClick={() => {
                setFilesOpen(true);
                fileInputRef?.click();
              }}
            >
              + Add
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              class="sr-only"
              tabindex={-1}
              onChange={(event) => handleFileInput(event.currentTarget)}
            />
          </div>
        </div>
        <Show when={filesOpen()}>
          <div class="detail-section-body">
            <Show when={props.uploadProgress}>
              {(progress) => (
                <div class="upload-progress">
                  <span class="upload-spinner" aria-hidden="true" />
                  Encrypting & uploading “{progress().name}”
                  <Show when={progress().fileCount > 1}>
                    {" "}
                    ({progress().fileIndex}/{progress().fileCount})
                  </Show>{" "}
                  — {progress().percent}%
                </div>
              )}
            </Show>
            <Show
              when={props.identity.attachments.length > 0}
              fallback={
                <p class="attachments-empty">
                  No files yet. Add passport scans, photos or PDFs — drag & drop
                  or paste works too. Everything is encrypted before upload.
                </p>
              }
            >
              <div class="attachment-grid">
                <For each={props.identity.attachments}>
                  {(attachment) => (
                    <div class="attachment-tile">
                      <button
                        class="attachment-preview"
                        type="button"
                        title={`Open ${attachment.name}`}
                        onClick={() => props.onOpenAttachment(attachment)}
                      >
                        <Show
                          when={attachment.thumb}
                          fallback={
                            <span class="attachment-glyph">
                              <Show
                                when={isPdfAttachment(attachment)}
                                fallback={
                                  <Show
                                    when={isImageAttachment(attachment)}
                                    fallback={<FileIcon />}
                                  >
                                    <ImageIcon />
                                  </Show>
                                }
                              >
                                <span class="attachment-badge">PDF</span>
                              </Show>
                            </span>
                          }
                        >
                          <img
                            src={attachment.thumb}
                            alt={attachment.name}
                            loading="lazy"
                          />
                        </Show>
                        <Show when={props.attachmentBusyId === attachment.id}>
                          <span class="attachment-loading">
                            <span class="upload-spinner" aria-hidden="true" />
                          </span>
                        </Show>
                      </button>
                      <div class="attachment-meta">
                        <span class="attachment-name" title={attachment.name}>
                          {attachment.name}
                        </span>
                        <span class="attachment-size">
                          {formatBytes(attachment.size)}
                        </span>
                      </div>
                      <div class="attachment-actions">
                        <button
                          class="icon-button icon-only"
                          type="button"
                          aria-label={`Download ${attachment.name}`}
                          title="Download"
                          disabled={Boolean(props.attachmentBusyId)}
                          onClick={() => props.onDownloadAttachment(attachment)}
                        >
                          <DownloadIcon />
                        </button>
                        <button
                          class="icon-button icon-only"
                          type="button"
                          aria-label={`Delete ${attachment.name}`}
                          title="Delete"
                          onClick={() => props.onDeleteAttachment(attachment)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={Boolean(props.attachmentError)}>
              <div class="form-error">{props.attachmentError}</div>
            </Show>
          </div>
        </Show>
      </section>

      <div class="detail-footer">
        <span class="meta-label">Created</span>
        <strong>{formatTimestamp(props.identity.createdAt)}</strong>
      </div>
    </div>
  );
}
