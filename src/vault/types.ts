import type {
  VaultAttachment,
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
export const ATTACHMENT_THUMB_MAX_EDGE = 320;
export const ATTACHMENT_THUMB_MAX_CHARS = 80_000;
export const AUTO_LOCK_MS = 15 * 60 * 1000;
export const CLIPBOARD_CLEAR_MS = 60 * 1000;
export const SAVE_DEBOUNCE_MS = 600;

export const IDENTITY_DETAIL_FIELDS = [
  { label: "Email", field: "email" },
  { label: "Phone", field: "phone" },
  { label: "Address", field: "address" },
  { label: "NINO", field: "nino" },
  { label: "NHS Number", field: "nhsNumber" },
  { label: "Pass No", field: "passNumber" },
  { label: "UTR", field: "utr" },
  { label: "Gov Gateway ID", field: "govGatewayId" },
] as const;

export function createId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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

function normalizeAttachment(raw: unknown): VaultAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const partial = raw as Partial<VaultAttachment>;
  if (typeof partial.id !== "string" || partial.id.length === 0) return null;
  return {
    id: partial.id,
    name:
      typeof partial.name === "string" && partial.name.length > 0
        ? partial.name
        : "file",
    mimeType:
      typeof partial.mimeType === "string" && partial.mimeType.length > 0
        ? partial.mimeType
        : "application/octet-stream",
    size: typeof partial.size === "number" && partial.size > 0 ? partial.size : 0,
    chunks:
      typeof partial.chunks === "number" && partial.chunks > 0
        ? Math.floor(partial.chunks)
        : 1,
    thumb: typeof partial.thumb === "string" ? partial.thumb : "",
    createdAt:
      typeof partial.createdAt === "number" ? partial.createdAt : Date.now(),
  };
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
      apiKeys: Array.isArray(partial.apiKeys)
        ? partial.apiKeys.map((item) =>
            normalizeApiKeyItem(item as Partial<VaultApiKeyItem>),
          )
        : [],
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
  return {
    identities: [
      normalizeIdentityItem({
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
      }),
    ],
    apiKeys: [],
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
  return "*".repeat(Math.max(12, Math.min(trimmed.length, 24)));
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

export async function createImageThumb(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return "";
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
      ATTACHMENT_THUMB_MAX_EDGE /
        Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.drawImage(image, 0, 0, width, height);
    const thumb = canvas.toDataURL("image/jpeg", 0.72);
    return thumb.length <= ATTACHMENT_THUMB_MAX_CHARS ? thumb : "";
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(url);
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
