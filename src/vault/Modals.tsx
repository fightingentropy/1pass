import { createSignal, onMount, Show } from "solid-js";
import type { ApiKeyDraft, CredentialDraft, IdentityDraft } from "./types";
import { generatePassword } from "./types";

type ModalShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  error: string;
  submitLabel: string;
  onSubmit: () => void;
  onClose: () => void;
  children: any;
};

function ModalShell(props: ModalShellProps) {
  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div class="modal" onClick={(event) => event.stopPropagation()}>
        <div class="modal-header">
          <div>
            <p class="eyebrow">{props.eyebrow}</p>
            <h2>{props.title}</h2>
            <p class="muted">{props.description}</p>
          </div>
          <button class="icon-button" type="button" onClick={props.onClose}>
            Close
          </button>
        </div>
        <form
          class="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <div class="modal-grid">{props.children}</div>
          <Show when={Boolean(props.error)}>
            <div class="form-error">{props.error}</div>
          </Show>
          <div class="modal-actions">
            <button class="btn ghost" type="button" onClick={props.onClose}>
              Cancel
            </button>
            <button class="btn primary" type="submit">
              {props.submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type IdentityModalProps = {
  draft: IdentityDraft;
  isEditing: boolean;
  error: string;
  onChange: (patch: Partial<IdentityDraft>) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function IdentityModal(props: IdentityModalProps) {
  let firstInputRef: HTMLInputElement | undefined;

  onMount(() => {
    firstInputRef?.focus();
  });

  return (
    <ModalShell
      eyebrow={props.isEditing ? "Edit identity" : "New identity"}
      title={props.isEditing ? "Edit identity" : "Create identity"}
      description="First name and last name are required. Everything else is optional."
      error={props.error}
      submitLabel={props.isEditing ? "Save changes" : "Save identity"}
      onSubmit={props.onSubmit}
      onClose={props.onClose}
    >
      <label class="field">
        <span class="field-label">First name</span>
        <input
          ref={firstInputRef}
          type="text"
          value={props.draft.firstName}
          onInput={(event) =>
            props.onChange({ firstName: event.currentTarget.value })
          }
          required
        />
      </label>
      <label class="field">
        <span class="field-label">Last name</span>
        <input
          type="text"
          value={props.draft.lastName}
          onInput={(event) =>
            props.onChange({ lastName: event.currentTarget.value })
          }
          required
        />
      </label>
      <label class="field">
        <span class="field-label">Email</span>
        <input
          type="email"
          value={props.draft.email}
          onInput={(event) =>
            props.onChange({ email: event.currentTarget.value })
          }
        />
      </label>
      <label class="field">
        <span class="field-label">Phone</span>
        <input
          type="tel"
          value={props.draft.phone}
          onInput={(event) =>
            props.onChange({ phone: event.currentTarget.value })
          }
        />
      </label>
      <label class="field full">
        <span class="field-label">Address</span>
        <input
          type="text"
          value={props.draft.address}
          onInput={(event) =>
            props.onChange({ address: event.currentTarget.value })
          }
        />
      </label>
      <label class="field">
        <span class="field-label">NINO</span>
        <input
          type="text"
          value={props.draft.nino}
          onInput={(event) =>
            props.onChange({ nino: event.currentTarget.value })
          }
        />
      </label>
      <label class="field">
        <span class="field-label">NHS Number</span>
        <input
          type="text"
          value={props.draft.nhsNumber}
          onInput={(event) =>
            props.onChange({ nhsNumber: event.currentTarget.value })
          }
        />
      </label>
      <label class="field">
        <span class="field-label">Pass No</span>
        <input
          type="text"
          value={props.draft.passNumber}
          onInput={(event) =>
            props.onChange({ passNumber: event.currentTarget.value })
          }
        />
      </label>
      <label class="field">
        <span class="field-label">UTR</span>
        <input
          type="text"
          value={props.draft.utr}
          onInput={(event) => props.onChange({ utr: event.currentTarget.value })}
        />
      </label>
      <label class="field">
        <span class="field-label">Gov Gateway ID</span>
        <input
          type="text"
          value={props.draft.govGatewayId}
          onInput={(event) =>
            props.onChange({ govGatewayId: event.currentTarget.value })
          }
        />
      </label>
      <label class="field full">
        <span class="field-label">Notes</span>
        <textarea
          rows={3}
          value={props.draft.notes}
          onInput={(event) =>
            props.onChange({ notes: event.currentTarget.value })
          }
        />
      </label>
    </ModalShell>
  );
}

type ApiKeyModalProps = {
  draft: ApiKeyDraft;
  isEditing: boolean;
  error: string;
  onChange: (patch: Partial<ApiKeyDraft>) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function ApiKeyModal(props: ApiKeyModalProps) {
  let firstInputRef: HTMLInputElement | undefined;

  onMount(() => {
    firstInputRef?.focus();
  });

  return (
    <ModalShell
      eyebrow={props.isEditing ? "Edit API key" : "New API key"}
      title={props.isEditing ? "Edit API key" : "Create API key"}
      description="Label and API key are required. Environment and notes are optional."
      error={props.error}
      submitLabel={props.isEditing ? "Save changes" : "Save API key"}
      onSubmit={props.onSubmit}
      onClose={props.onClose}
    >
      <label class="field">
        <span class="field-label">Label</span>
        <input
          ref={firstInputRef}
          type="text"
          value={props.draft.label}
          onInput={(event) =>
            props.onChange({ label: event.currentTarget.value })
          }
          required
        />
      </label>
      <label class="field">
        <span class="field-label">Service</span>
        <input
          type="text"
          value={props.draft.service}
          onInput={(event) =>
            props.onChange({ service: event.currentTarget.value })
          }
        />
      </label>
      <label class="field full">
        <span class="field-label">API Key</span>
        <textarea
          rows={4}
          value={props.draft.key}
          onInput={(event) => props.onChange({ key: event.currentTarget.value })}
          required
        />
      </label>
      <label class="field">
        <span class="field-label">Environment</span>
        <input
          type="text"
          value={props.draft.environment}
          onInput={(event) =>
            props.onChange({ environment: event.currentTarget.value })
          }
        />
      </label>
      <label class="field full">
        <span class="field-label">Notes</span>
        <textarea
          rows={3}
          value={props.draft.notes}
          onInput={(event) =>
            props.onChange({ notes: event.currentTarget.value })
          }
        />
      </label>
    </ModalShell>
  );
}

type CredentialModalProps = {
  draft: CredentialDraft;
  isEditing: boolean;
  error: string;
  onChange: (patch: Partial<CredentialDraft>) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function CredentialModal(props: CredentialModalProps) {
  const [showPassword, setShowPassword] = createSignal(false);
  let firstInputRef: HTMLInputElement | undefined;

  onMount(() => {
    firstInputRef?.focus();
  });

  return (
    <ModalShell
      eyebrow={props.isEditing ? "Edit password" : "New password"}
      title={props.isEditing ? "Edit password" : "Add password"}
      description="Label and password are required. Username, website and notes are optional."
      error={props.error}
      submitLabel={props.isEditing ? "Save changes" : "Save password"}
      onSubmit={props.onSubmit}
      onClose={props.onClose}
    >
      <label class="field">
        <span class="field-label">Label</span>
        <input
          ref={firstInputRef}
          type="text"
          placeholder="e.g. iCloud, HMRC, Gmail"
          value={props.draft.label}
          onInput={(event) =>
            props.onChange({ label: event.currentTarget.value })
          }
          required
        />
      </label>
      <label class="field">
        <span class="field-label">Username</span>
        <input
          type="text"
          autocomplete="off"
          value={props.draft.username}
          onInput={(event) =>
            props.onChange({ username: event.currentTarget.value })
          }
        />
      </label>
      <label class="field full">
        <span class="field-label">Password</span>
        <div class="password-input-wrap">
          <input
            type={showPassword() ? "text" : "password"}
            autocomplete="new-password"
            value={props.draft.password}
            onInput={(event) =>
              props.onChange({ password: event.currentTarget.value })
            }
            required
          />
          <div class="password-input-actions">
            <button
              class="password-reveal"
              type="button"
              tabindex={-1}
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword() ? "Hide" : "Show"}
            </button>
            <button
              class="password-reveal"
              type="button"
              onClick={() => {
                props.onChange({ password: generatePassword() });
                setShowPassword(true);
              }}
            >
              Generate
            </button>
          </div>
        </div>
      </label>
      <label class="field full">
        <span class="field-label">Website</span>
        <input
          type="text"
          placeholder="https://"
          value={props.draft.website}
          onInput={(event) =>
            props.onChange({ website: event.currentTarget.value })
          }
        />
      </label>
      <label class="field full">
        <span class="field-label">Notes</span>
        <textarea
          rows={2}
          value={props.draft.notes}
          onInput={(event) =>
            props.onChange({ notes: event.currentTarget.value })
          }
        />
      </label>
    </ModalShell>
  );
}
