import { createMemo, createSignal, type Accessor, type Setter } from "solid-js";
import type {
  VaultCredential,
  VaultIdentityItem,
  VaultApiKeyItem,
  VaultPayload,
} from "../../functions/api/vault/schema";
import {
  createApiKeyDraft,
  createCredentialDraft,
  createId,
  createIdentityDraft,
  type ApiKeyDraft,
  type ConfirmRequest,
  type CredentialDraft,
  type CredentialModalState,
  type EditingTarget,
  type IdentityDraft,
} from "./types";

type CrudControllerOptions = {
  vault: Accessor<VaultPayload>;
  setVault: Setter<VaultPayload>;
  setSelectedIdentityId: Setter<string>;
  setSelectedApiKeyId: Setter<string>;
  requestConfirm: (
    options: Omit<ConfirmRequest, "resolve">,
  ) => Promise<boolean>;
};

export function createVaultCrudController(options: CrudControllerOptions) {
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<IdentityDraft>(createIdentityDraft());
  const [apiKeyDraft, setApiKeyDraft] = createSignal<ApiKeyDraft>(
    createApiKeyDraft(),
  );
  const [modalError, setModalError] = createSignal("");
  const [editingTarget, setEditingTarget] = createSignal<EditingTarget | null>(
    null,
  );
  const [credentialModal, setCredentialModal] =
    createSignal<CredentialModalState | null>(null);
  const [credentialDraft, setCredentialDraft] = createSignal<CredentialDraft>(
    createCredentialDraft(),
  );
  const [credentialError, setCredentialError] = createSignal("");
  const isEditing = createMemo(() => editingTarget() !== null);

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
    const target = editingTarget();
    const editingId = target?.section === "identities" ? target.id : null;
    if (editingId) {
      options.setVault((vault) => ({
        ...vault,
        identities: vault.identities.map((item) =>
          item.id === editingId ? { ...item, ...patch, updatedAt: now } : item,
        ),
      }));
      options.setSelectedIdentityId(editingId);
    } else {
      const identity: VaultIdentityItem = {
        id: createId(),
        ...patch,
        attachments: [],
        credentials: [],
        createdAt: now,
        updatedAt: now,
      };
      options.setVault((vault) => ({
        ...vault,
        identities: [identity, ...vault.identities],
      }));
      options.setSelectedIdentityId(identity.id);
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
    const target = editingTarget();
    const editingId = target?.section === "apiKeys" ? target.id : null;
    if (editingId) {
      options.setVault((vault) => ({
        ...vault,
        apiKeys: vault.apiKeys.map((item) =>
          item.id === editingId ? { ...item, ...patch, updatedAt: now } : item,
        ),
      }));
      options.setSelectedApiKeyId(editingId);
    } else {
      const apiKey: VaultApiKeyItem = {
        id: createId(),
        ...patch,
        createdAt: now,
        updatedAt: now,
      };
      options.setVault((vault) => ({
        ...vault,
        apiKeys: [apiKey, ...vault.apiKeys],
      }));
      options.setSelectedApiKeyId(apiKey.id);
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
    options.setVault((vault) => ({
      ...vault,
      identities: vault.identities.map((item) => {
        if (item.id !== state.identityId) return item;
        if (state.credential) {
          return {
            ...item,
            credentials: item.credentials.map((credential) =>
              credential.id === state.credential!.id
                ? { ...credential, ...patch, updatedAt: now }
                : credential,
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
    const confirmed = await options.requestConfirm({
      title: "Delete password",
      message: `Delete "${credential.label || "this password"}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    options.setVault((vault) => ({
      ...vault,
      identities: vault.identities.map((item) =>
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

  const handleDeleteApiKey = async (item: VaultApiKeyItem) => {
    const confirmed = await options.requestConfirm({
      title: "Delete API key",
      message: `Delete "${item.label}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    options.setVault((vault) => ({
      ...vault,
      apiKeys: vault.apiKeys.filter((existing) => existing.id !== item.id),
    }));
    options.setSelectedApiKeyId((selected) =>
      selected === item.id ? "" : selected,
    );
  };

  const resetDialogs = () => {
    setIsModalOpen(false);
    setEditingTarget(null);
    setCredentialModal(null);
    setModalError("");
    setCredentialError("");
  };

  return {
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
  };
}
