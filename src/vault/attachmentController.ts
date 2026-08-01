import { createSignal, onCleanup, type Accessor, type Setter } from "solid-js";
import type {
  VaultAttachment,
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
  createId,
  createImageThumb,
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
      identity.attachments.map((attachment) =>
        cleanupAttachmentRemote(attachment.id, authToken),
      ),
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
      setUploadProgress({ ...progressBase, percent: 0 });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const thumb = await createImageThumb(file);
        const envelope = await uploadAttachmentBytes(
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
          ...envelope,
          thumb,
          createdAt: Date.now(),
        };

        if (!options.vault().identities.some((item) => item.id === identityId)) {
          void cleanupAttachmentRemote(fileId, currentSession.authToken);
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
    await cleanupAttachmentRemote(attachment.id, authToken, true);
  };

  const resetAttachments = () => {
    closeAttachmentPreview();
    setUploadProgress(null);
    setAttachmentError("");
    setAttachmentBusyId("");
  };

  onCleanup(() => closeAttachmentPreview());

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
    resetAttachments,
  };
}
