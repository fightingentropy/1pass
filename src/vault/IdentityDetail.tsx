import { createEffect, createSignal, For, on, Show } from "solid-js";
import type {
  VaultAttachment,
  VaultCredential,
  VaultIdentityItem,
} from "../../functions/api/vault/schema";
import type { UploadProgress } from "./types";
import {
  formatBytes,
  formatTimestamp,
  IDENTITY_DETAIL_FIELDS,
  isImageAttachment,
  isPdfAttachment,
} from "./types";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  ImageIcon,
  KeyIcon,
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

export default function IdentityDetail(props: IdentityDetailProps) {
  const [dragActive, setDragActive] = createSignal(false);
  const [visibleCredentialId, setVisibleCredentialId] = createSignal("");
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
      },
      { defer: true },
    ),
  );

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
          <p class="muted">Identity record</p>
        </div>
        <div class="detail-actions">
          <span class="pill">Private</span>
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

      <div class="detail-grid">
        <For each={IDENTITY_DETAIL_FIELDS}>
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
        <div>
          <span class="meta-label">Notes</span>
          <p class="notes-content">
            {props.identity.notes.trim() || "Not provided"}
          </p>
        </div>
      </div>

      <div class="credentials-block">
        <div class="attachments-header">
          <span class="meta-label">
            Passwords
            <Show when={props.identity.credentials.length > 0}>
              {" "}
              ({props.identity.credentials.length})
            </Show>
          </span>
          <button
            class="secret-toggle"
            type="button"
            onClick={props.onAddCredential}
          >
            + Add password
          </button>
        </div>
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
                      <button
                        class="icon-button icon-only"
                        type="button"
                        aria-label="Edit password"
                        title="Edit"
                        onClick={() => props.onEditCredential(credential)}
                      >
                        <PencilIcon />
                      </button>
                      <button
                        class="icon-button icon-only"
                        type="button"
                        aria-label="Delete password"
                        title="Delete"
                        onClick={() => props.onDeleteCredential(credential)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>

      <div
        class={`attachments-block ${dragActive() ? "drag-active" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        <div class="attachments-header">
          <span class="meta-label">
            Attachments
            <Show when={props.identity.attachments.length > 0}>
              {" "}
              ({props.identity.attachments.length})
            </Show>
          </span>
          <button
            class="secret-toggle"
            type="button"
            disabled={Boolean(props.uploadProgress)}
            onClick={() => fileInputRef?.click()}
          >
            + Add file
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
              No files yet. Add passport scans, photos or PDFs — drag & drop or
              paste works too. Everything is encrypted before upload.
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

      <div class="detail-footer">
        <span class="meta-label">Created</span>
        <strong>{formatTimestamp(props.identity.createdAt)}</strong>
      </div>
    </div>
  );
}
