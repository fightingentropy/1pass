import { createSignal, onCleanup, type Accessor, type Setter } from "solid-js";
import type {
  VaultAttachment,
  VaultAttachmentPreview,
  VaultIdentityItem,
  VaultPayload,
} from "../../functions/api/vault/schema";
import type { VaultSession } from "../vaultCrypto";
import {
  deleteAttachmentRemote,
  downloadAttachmentBlob,
  uploadAttachmentBytes,
} from "./api";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_PREVIEW_MIME,
  attachmentFileIds,
  createId,
  createImagePreview,
  inlineThumbToBytes,
  triggerBlobDownload,
  type AttachmentPreviewState,
  type ConfirmRequest,
  type UploadProgress,
} from "./types";

type AttachmentControllerOptions = {
  vault: Accessor<VaultPayload>;
  setVault: Setter<VaultPayload>;
  session: Accessor<VaultSession | null>;
  selectedIdentityId: Accessor<string>;
  setSelectedIdentityId: Setter<string>;
  persistVault: () => Promise<boolean>;
  requestConfirm: (
    options: Omit<ConfirmRequest, "resolve">,
  ) => Promise<boolean>;
};

export function createAttachmentController(options: AttachmentControllerOptions) {
  const [uploadProgress, setUploadProgress] = createSignal<UploadProgress | null>(
    null,
  );
  const [attachmentError, setAttachmentError] = createSignal("");
  const [attachmentBusyId, setAttachmentBusyId] = createSignal("");
  const [attachmentPreview, setAttachmentPreview] =
    createSignal<AttachmentPreviewState | null>(null);

  const closeAttachmentPreview = () => {
    const preview = attachmentPreview();
    if (preview) URL.revokeObjectURL(preview.url);
    setAttachmentPreview(null);
  };

  // Decrypted thumbnail object URLs for the file grid, keyed by preview file
  // id. Scoped to one unlocked session and revoked on lock.
  const previewUrls = new Map<string, Promise<string | null>>();
  const previewObjectUrls = new Set<string>();

  const clearPreviewUrls = () => {
    for (const url of previewObjectUrls) URL.revokeObjectURL(url);
    previewObjectUrls.clear();
    previewUrls.clear();
  };

  const loadPreviewUrl = (attachment: VaultAttachment) => {
    const preview = attachment.preview;
    const currentSession = options.session();
    if (!preview || !currentSession) return Promise.resolve(null);
    let pending = previewUrls.get(preview.id);
    if (!pending) {
      pending = downloadAttachmentBlob(preview, currentSession)
        .then((blob) => {
          // The vault may have locked while this was in flight.
          if (options.session() !== currentSession) return null;
          const url = URL.createObjectURL(blob);
          previewObjectUrls.add(url);
          return url;
        })
        .catch((previewError) => {
          console.error("Preview load failed", previewError);
          return null;
        });
      previewUrls.set(preview.id, pending);
    }
    return pending;
  };

  // Encrypts and uploads an image's thumbnail as its own one-chunk file.
  // Thumbnails are optional, so any failure just means no preview.
  const uploadPreview = async (
    bytes: Uint8Array<ArrayBuffer>,
    mimeType: string,
    session: VaultSession,
  ): Promise<VaultAttachmentPreview | undefined> => {
    const previewId = createId();
    try {
      const manifest = await uploadAttachmentBytes(previewId, bytes, session);
      return { id: previewId, mimeType, size: bytes.length, ...manifest };
    } catch (previewError) {
      console.error("Preview upload failed", previewError);
      return undefined;
    }
  };

  const cleanupAttachmentRemote = async (
    fileId: string,
    authToken: string,
    reportFailure = false,
  ) => {
    try {
      await deleteAttachmentRemote(fileId, authToken);
      return true;
    } catch (deleteError) {
      console.error("Attachment cleanup failed", deleteError);
      if (reportFailure) {
        setAttachmentError(
          "The vault was updated, but encrypted file cleanup failed. It is safe to retry later.",
        );
      }
      return false;
    }
  };

  const handleDeleteIdentity = async (identity: VaultIdentityItem) => {
    const confirmed = await options.requestConfirm({
      title: "Delete identity",
      message: `Delete "${identity.firstName} ${identity.lastName}" and its ${identity.attachments.length} file(s)? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;

    const authToken = options.session()?.authToken ?? "";
    options.setVault((vault) => ({
      ...vault,
      identities: vault.identities.filter((item) => item.id !== identity.id),
    }));
    options.setSelectedIdentityId((selected) =>
      selected === identity.id ? "" : selected,
    );

    if (!(await options.persistVault())) {
      options.setVault((vault) =>
        vault.identities.some((item) => item.id === identity.id)
          ? vault
          : { ...vault, identities: [identity, ...vault.identities] },
      );
      options.setSelectedIdentityId(identity.id);
      setAttachmentError(
        "The identity could not be synced, so its encrypted files were not removed.",
      );
      return;
    }
    const cleanup = await Promise.all(
      identity.attachments
        .flatMap(attachmentFileIds)
        .map((fileId) => cleanupAttachmentRemote(fileId, authToken)),
    );
    if (cleanup.some((removed) => !removed)) {
      setAttachmentError(
        "The identity was deleted, but some encrypted file cleanup must be retried.",
      );
    }
  };

  const handleAddAttachments = async (identityId: string, files: File[]) => {
    const currentSession = options.session();
    if (!currentSession || files.length === 0 || uploadProgress()) return;

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
        setAttachmentError(`"${file.name}" is larger than 25 MB and was skipped.`);
        continue;
      }

      const fileId = createId();
      let preview: VaultAttachmentPreview | undefined;
      setUploadProgress({ ...progressBase, percent: 0 });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const envelope = await uploadAttachmentBytes(
          fileId,
          bytes,
          currentSession,
          (percent) => setUploadProgress({ ...progressBase, percent }),
        );
        const previewBytes = await createImagePreview(file);
        if (previewBytes) {
          preview = await uploadPreview(
            previewBytes,
            ATTACHMENT_PREVIEW_MIME,
            currentSession,
          );
        }
        const attachment: VaultAttachment = {
          id: fileId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          ...envelope,
          thumb: "",
          ...(preview ? { preview } : {}),
          createdAt: Date.now(),
        };

        if (!options.vault().identities.some((item) => item.id === identityId)) {
          for (const id of attachmentFileIds(attachment)) {
            void cleanupAttachmentRemote(id, currentSession.authToken);
          }
          setAttachmentError("The identity no longer exists.");
          break;
        }
        options.setVault((vault) => ({
          ...vault,
          identities: vault.identities.map((item) =>
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
        void cleanupAttachmentRemote(fileId, currentSession.authToken);
        if (preview) {
          void cleanupAttachmentRemote(preview.id, currentSession.authToken);
        }
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
    const currentSession = options.session();
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
    const currentSession = options.session();
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
    const confirmed = await options.requestConfirm({
      title: "Delete file",
      message: `Delete "${attachment.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;

    const authToken = options.session()?.authToken ?? "";
    setAttachmentError("");
    options.setVault((vault) => ({
      ...vault,
      identities: vault.identities.map((item) =>
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
    if (!(await options.persistVault())) {
      options.setVault((vault) => ({
        ...vault,
        identities: vault.identities.map((item) =>
          item.id === identityId &&
          !item.attachments.some((existing) => existing.id === attachment.id)
            ? {
                ...item,
                attachments: [...item.attachments, attachment],
                updatedAt: Date.now(),
              }
            : item,
        ),
      }));
      setAttachmentError(
        "The file removal could not be synced, so its encrypted data was kept.",
      );
      return;
    }
    for (const fileId of attachmentFileIds(attachment)) {
      await cleanupAttachmentRemote(fileId, authToken, true);
    }
  };

  // Moves thumbnails that older releases stored inline in the vault envelope
  // into their own encrypted preview files, one at a time. Each one lands
  // through a normal vault edit, so the usual debounced save shrinks the
  // envelope. `isCurrent` stops the work when the vault locks or maintenance
  // starts; anything uploaded but not saved is collected by the orphan sweep.
  const migrateInlineThumbnails = async (isCurrent: () => boolean) => {
    const currentSession = options.session();
    if (!currentSession) return { moved: 0, failed: 0 };
    const pending = options
      .vault()
      .identities.flatMap((identity) =>
        identity.attachments
          .filter((attachment) => attachment.thumb && !attachment.preview)
          .map((attachment) => ({ identityId: identity.id, attachment })),
      );
    let moved = 0;
    let failed = 0;
    for (const { identityId, attachment } of pending) {
      if (!isCurrent()) break;
      const decoded = inlineThumbToBytes(attachment.thumb);
      const preview = decoded
        ? await uploadPreview(decoded.bytes, decoded.mimeType, currentSession)
        : undefined;
      if (decoded && !preview) {
        failed += 1;
        continue;
      }
      if (!isCurrent()) {
        if (preview) {
          void cleanupAttachmentRemote(preview.id, currentSession.authToken);
        }
        break;
      }
      let applied = false;
      options.setVault((vault) => ({
        ...vault,
        identities: vault.identities.map((identity) =>
          identity.id !== identityId
            ? identity
            : {
                ...identity,
                attachments: identity.attachments.map((existing) => {
                  if (
                    existing.id !== attachment.id ||
                    existing.thumb !== attachment.thumb ||
                    existing.preview
                  ) {
                    return existing;
                  }
                  applied = true;
                  // An inline thumb that is not a valid image data URL is
                  // dropped; it could never have rendered.
                  return { ...existing, thumb: "", ...(preview ? { preview } : {}) };
                }),
              },
        ),
      }));
      if (!applied && preview) {
        void cleanupAttachmentRemote(preview.id, currentSession.authToken);
      }
      if (applied) moved += 1;
    }
    return { moved, failed };
  };

  const resetAttachments = () => {
    closeAttachmentPreview();
    clearPreviewUrls();
    setUploadProgress(null);
    setAttachmentError("");
    setAttachmentBusyId("");
  };

  onCleanup(() => {
    closeAttachmentPreview();
    clearPreviewUrls();
  });

  return {
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
    loadPreviewUrl,
    migrateInlineThumbnails,
    resetAttachments,
  };
}
