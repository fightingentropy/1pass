import { createSignal, onMount } from "solid-js";
import { ModalShell } from "./Modals";

export type PasswordChangeDraft = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type ChangePasswordModalProps = {
  draft: PasswordChangeDraft;
  error: string;
  onChange: (patch: Partial<PasswordChangeDraft>) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function ChangePasswordModal(props: ChangePasswordModalProps) {
  const [showPasswords, setShowPasswords] = createSignal(false);
  let firstInputRef: HTMLInputElement | undefined;
  onMount(() => firstInputRef?.focus());

  return (
    <ModalShell
      title="Change master password"
      description="Every vault record and attachment will be re-encrypted. Keep this tab open until it finishes."
      error={props.error}
      submitLabel="Change password"
      onSubmit={props.onSubmit}
      onClose={props.onClose}
    >
      <label class="field full">
        <span class="field-label">Current password</span>
        <input
          ref={firstInputRef}
          type={showPasswords() ? "text" : "password"}
          autocomplete="current-password"
          value={props.draft.currentPassword}
          onInput={(event) =>
            props.onChange({ currentPassword: event.currentTarget.value })
          }
          required
        />
      </label>
      <label class="field full">
        <span class="field-label">New password</span>
        <input
          type={showPasswords() ? "text" : "password"}
          autocomplete="new-password"
          minlength="12"
          value={props.draft.newPassword}
          onInput={(event) =>
            props.onChange({ newPassword: event.currentTarget.value })
          }
          required
        />
      </label>
      <label class="field full">
        <span class="field-label">Confirm new password</span>
        <input
          type={showPasswords() ? "text" : "password"}
          autocomplete="new-password"
          minlength="12"
          value={props.draft.confirmPassword}
          onInput={(event) =>
            props.onChange({ confirmPassword: event.currentTarget.value })
          }
          required
        />
      </label>
      <label class="field full maintenance-checkbox">
        <input
          type="checkbox"
          checked={showPasswords()}
          onChange={(event) => setShowPasswords(event.currentTarget.checked)}
        />
        <span>Show passwords</span>
      </label>
    </ModalShell>
  );
}

type ImportBackupModalProps = {
  fileName: string;
  password: string;
  error: string;
  onPasswordChange: (password: string) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function ImportBackupModal(props: ImportBackupModalProps) {
  const [showPassword, setShowPassword] = createSignal(false);
  let passwordRef: HTMLInputElement | undefined;
  onMount(() => passwordRef?.focus());

  return (
    <ModalShell
      title="Import encrypted backup"
      description={`Restore ${props.fileName}. This replaces the current vault only after every attachment is safely staged.`}
      error={props.error}
      submitLabel="Restore backup"
      onSubmit={props.onSubmit}
      onClose={props.onClose}
    >
      <label class="field full">
        <span class="field-label">Backup master password</span>
        <div class="password-input-wrap">
          <input
            ref={passwordRef}
            type={showPassword() ? "text" : "password"}
            autocomplete="current-password"
            value={props.password}
            onInput={(event) =>
              props.onPasswordChange(event.currentTarget.value)
            }
            required
          />
          <button
            class="password-reveal"
            type="button"
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword() ? "Hide" : "Show"}
          </button>
        </div>
      </label>
      <p class="maintenance-warning full">
        Existing vault items will be replaced. A failed restore leaves the current vault unchanged.
      </p>
    </ModalShell>
  );
}
