import type {
  VaultAttachment,
  VaultAttachmentPreview,
  VaultStoredFile,
  VaultCredential,
  VaultIdentityItem,
  VaultApiKeyItem,
  VaultPayload,
} from "../../functions/api/vault/schema";
import { DEFAULT_VAULT_PAYLOAD } from "../../functions/api/vault/schema";

export type VaultSection = "identities" | "apiKeys";

export type IdentityDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  nino: string;
  nhsNumber: string;
  passNumber: string;
  utr: string;
  govGatewayId: string;
  notes: string;
};

export type ApiKeyDraft = {
  label: string;
  service: string;
  key: string;
  environment: string;
  notes: string;
};

export type CredentialDraft = {
  label: string;
  username: string;
  password: string;
  website: string;
  notes: string;
};

export type EditingTarget =
  | { section: "identities"; id: string }
  | { section: "apiKeys"; id: string };

export type CredentialModalState = {
  identityId: string;
  credential: VaultCredential | null;
};

export type UploadProgress = {
  name: string;
  fileIndex: number;
  fileCount: number;
  percent: number;
};

export type AttachmentPreviewState = {
  attachment: VaultAttachment;
  url: string;
};

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (confirmed: boolean) => void;
};

export type SyncState = "idle" | "dirty" | "saving" | "error";

export const ATTACHMENT_CHUNK_SIZE = 1_000_000;
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_PREVIEW_MAX_EDGE = 480;
export const ATTACHMENT_PREVIEW_MAX_BYTES = 400_000;
export const ATTACHMENT_PREVIEW_MIME = "image/jpeg";
export const AUTO_LOCK_MS = 15 * 60 * 1000;
export const CLIPBOARD_CLEAR_MS = 60 * 1000;
export const SAVE_DEBOUNCE_MS = 600;

export const IDENTITY_CONTACT_FIELDS = [
  { label: "Email", field: "email" },
  { label: "Phone", field: "phone" },
  { label: "Address", field: "address" },
] as const;

export const IDENTITY_GOVERNMENT_FIELDS = [
  { label: "National Insurance number", field: "nino" },
  { label: "NHS number", field: "nhsNumber" },
  { label: "Passport number", field: "passNumber" },
  { label: "UTR", field: "utr" },
  { label: "Government Gateway ID", field: "govGatewayId" },
] as const;

export function createId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createVaultDefault(): VaultPayload {
  return JSON.parse(JSON.stringify(DEFAULT_VAULT_PAYLOAD)) as VaultPayload;
}

export function createIdentityDraft(): IdentityDraft {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    nino: "",
    nhsNumber: "",
    passNumber: "",
    utr: "",
    govGatewayId: "",
    notes: "",
  };
}

export function createApiKeyDraft(): ApiKeyDraft {
  return {
    label: "",
    service: "",
    key: "",
    environment: "",
    notes: "",
  };
}

export function createCredentialDraft(): CredentialDraft {
  return {
    label: "",
    username: "",
    password: "",
    website: "",
    notes: "",
  };
}

// Normalizes the storage fields shared by attachments and their previews. A
// v3 file with a malformed manifest keeps `envelopeVersion: 3` with empty
// manifest fields, so every later read fails closed instead of skipping checks.
function normalizeStoredFile(partial: Partial<VaultStoredFile>): VaultStoredFile {
  const chunks =
    typeof partial.chunks === "number" && partial.chunks > 0
      ? Math.min(64, Math.floor(partial.chunks))
      : 1;
  const hasV3Manifest =
    partial.envelopeVersion === 3 &&
    Array.isArray(partial.chunkHashes) &&
    partial.chunkHashes.length === chunks &&
    partial.chunkHashes.every(
      (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
    ) &&
    Array.isArray(partial.chunkSizes) &&
    partial.chunkSizes.length === chunks &&
    partial.chunkSizes.every(
      (size) => Number.isInteger(size) && size >= 0 && size <= 1_048_576,
    ) &&
    typeof partial.manifestMac === "string" &&
    /^[A-Za-z0-9+/]{43}=$/.test(partial.manifestMac);
  return {
    id: partial.id as string,
    chunks,
    ...(partial.envelopeVersion === 3
      ? {
          envelopeVersion: 3 as const,
          chunkHashes: hasV3Manifest ? partial.chunkHashes : [],
          chunkSizes: hasV3Manifest ? partial.chunkSizes : [],
          manifestMac: hasV3Manifest ? partial.manifestMac : "",
        }
      : {}),
  };
}

function normalizePreview(raw: unknown): VaultAttachmentPreview | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const partial = raw as Partial<VaultAttachmentPreview>;
  if (
    typeof partial.id !== "string" ||
    !/^[a-zA-Z0-9-]{1,64}$/.test(partial.id) ||
    partial.envelopeVersion !== 3
  ) {
    return undefined;
  }
  return {
    ...normalizeStoredFile(partial),
    mimeType:
      typeof partial.mimeType === "string" && partial.mimeType.startsWith("image/")
        ? partial.mimeType
        : ATTACHMENT_PREVIEW_MIME,
    size: typeof partial.size === "number" && partial.size > 0 ? partial.size : 0,
  };
}

function normalizeAttachment(raw: unknown): VaultAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const partial = raw as Partial<VaultAttachment>;
  if (typeof partial.id !== "string" || partial.id.length === 0) return null;
  const preview = normalizePreview(partial.preview);
  return {
    ...normalizeStoredFile(partial),
    name:
      typeof partial.name === "string" && partial.name.length > 0
        ? partial.name
        : "file",
    mimeType:
      typeof partial.mimeType === "string" && partial.mimeType.length > 0
        ? partial.mimeType
        : "application/octet-stream",
    size: typeof partial.size === "number" && partial.size > 0 ? partial.size : 0,
    thumb: typeof partial.thumb === "string" ? partial.thumb : "",
    ...(preview ? { preview } : {}),
    createdAt:
      typeof partial.createdAt === "number" ? partial.createdAt : Date.now(),
  };
}

// Every encrypted file an attachment owns on the server: the file itself and,
// for images, its separately stored preview.
export function attachmentFileIds(attachment: VaultAttachment) {
  return attachment.preview
    ? [attachment.id, attachment.preview.id]
    : [attachment.id];
}

function normalizeCredential(raw: unknown): VaultCredential | null {
  if (!raw || typeof raw !== "object") return null;
  const partial = raw as Partial<VaultCredential>;
  if (typeof partial.id !== "string" || partial.id.length === 0) return null;
  const now = Date.now();
  return {
    id: partial.id,
    label: typeof partial.label === "string" ? partial.label : "",
    username: typeof partial.username === "string" ? partial.username : "",
    password: typeof partial.password === "string" ? partial.password : "",
    website: typeof partial.website === "string" ? partial.website : "",
    notes: typeof partial.notes === "string" ? partial.notes : "",
    createdAt: typeof partial.createdAt === "number" ? partial.createdAt : now,
    updatedAt: typeof partial.updatedAt === "number" ? partial.updatedAt : now,
  };
}

export function normalizeIdentityItem(
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
    utr: typeof raw.utr === "string" ? raw.utr : "",
    govGatewayId: typeof raw.govGatewayId === "string" ? raw.govGatewayId : "",
    notes: typeof raw.notes === "string" ? raw.notes : "",
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments
          .map(normalizeAttachment)
          .filter((item): item is VaultAttachment => item !== null)
      : [],
    credentials: Array.isArray(raw.credentials)
      ? raw.credentials
          .map(normalizeCredential)
          .filter((item): item is VaultCredential => item !== null)
      : [],
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

export function normalizeApiKeyItem(
  raw: Partial<VaultApiKeyItem>,
): VaultApiKeyItem {
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

export function normalizeVault(payload: unknown): VaultPayload {
  if (!payload || typeof payload !== "object") {
    return createVaultDefault();
  }

  const partial = payload as Partial<VaultPayload>;
  return {
    identities: Array.isArray(partial.identities)
      ? partial.identities.map((item) =>
          normalizeIdentityItem(item as Partial<VaultIdentityItem>),
        )
      : [],
    apiKeys: Array.isArray(partial.apiKeys)
      ? partial.apiKeys.map((item) =>
          normalizeApiKeyItem(item as Partial<VaultApiKeyItem>),
        )
      : [],
  };
}

export function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

export function formatBytes(value: number) {
  if (!value) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function maskSecretValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "Not provided";
  return "•".repeat(Math.max(12, Math.min(trimmed.length, 24)));
}

export function identityInitials(identity: VaultIdentityItem) {
  const first = identity.firstName.trim().charAt(0);
  const last = identity.lastName.trim().charAt(0);
  return `${first}${last}`.toUpperCase() || "?";
}

export function isImageAttachment(attachment: VaultAttachment) {
  return attachment.mimeType.startsWith("image/");
}

export function isPdfAttachment(attachment: VaultAttachment) {
  return attachment.mimeType === "application/pdf";
}

const PASSWORD_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,.?";

export function generatePassword(length = 20) {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(
    values,
    (value) => PASSWORD_CHARSET[value % PASSWORD_CHARSET.length],
  ).join("");
}

// Renders a small JPEG for the file list. It is uploaded as its own encrypted
// file; null for non-images, undecodable images, or an oversized result.
export async function createImagePreview(
  file: Blob,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!file.type.startsWith("image/")) return null;
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Unable to decode image"));
      element.src = url;
    });

    const scale = Math.min(
      1,
      ATTACHMENT_PREVIEW_MAX_EDGE /
        Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, ATTACHMENT_PREVIEW_MIME, 0.8),
    );
    if (!blob || blob.size === 0 || blob.size > ATTACHMENT_PREVIEW_MAX_BYTES) {
      return null;
    }
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Decodes an inline thumbnail written by older releases (a base64 image data
// URL) so it can be moved into its own encrypted preview file.
export function inlineThumbToBytes(
  thumb: string,
): { bytes: Uint8Array<ArrayBuffer>; mimeType: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(
    thumb,
  );
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (bytes.length === 0 || bytes.length > ATTACHMENT_PREVIEW_MAX_BYTES) {
      return null;
    }
    return { bytes, mimeType: match[1].toLowerCase() };
  } catch {
    return null;
  }
}

export function triggerBlobDownload(url: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
