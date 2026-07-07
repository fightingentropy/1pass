import { createEffect, createSignal, Show } from "solid-js";

type GateProps = {
  mode: "loading" | "setup" | "locked";
  busy: boolean;
  busyLabel?: string;
  error: string;
  onSetup: (password: string) => void;
  onUnlock: (password: string) => void;
};

export default function Gate(props: GateProps) {
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [showPassword, setShowPassword] = createSignal(false);
  const [localError, setLocalError] = createSignal("");
  let passwordInputRef: HTMLInputElement | undefined;

  // The gate mounts in "loading" mode with no input rendered, so a plain
  // onMount focus would find nothing. Focus once the real form appears.
  createEffect(() => {
    if (props.mode === "loading") return;
    passwordInputRef?.focus();
  });

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    setLocalError("");

    if (props.mode === "setup") {
      if (password().length < 8) {
        setLocalError("Password must be at least 8 characters.");
        return;
      }
      if (password() !== confirmPassword()) {
        setLocalError("Passwords do not match.");
        return;
      }
      props.onSetup(password());
      return;
    }

    props.onUnlock(password());
  };

  const visibleError = () => localError() || props.error;

  return (
    <section class="gate minimal">
      <div class="gate-card minimal">
        <div class="brand-stack">
          <span class="brand-logo" aria-hidden="true" />
          <span class="brand-mark">1Pass</span>
          <span class="brand-subtitle">Personal Vault</span>
        </div>
        <p class="subtitle">
          {props.mode === "loading"
            ? "Checking vault status..."
            : props.mode === "setup"
              ? "Create a master password. Vault data is encrypted in the browser before sync. There is no recovery if you forget it."
              : "Enter your master password to decrypt the vault."}
        </p>
        <Show
          when={props.mode !== "loading"}
          fallback={
            <button class="btn primary" type="button" disabled>
              Loading...
            </button>
          }
        >
          <form class="gate-form minimal" onSubmit={handleSubmit}>
            <label class="field">
              <span class="field-label sr-only">Master password</span>
              <div class="password-input-wrap">
                <input
                  ref={passwordInputRef}
                  type={showPassword() ? "text" : "password"}
                  autocomplete={
                    props.mode === "setup" ? "new-password" : "current-password"
                  }
                  autofocus
                  placeholder={
                    props.mode === "setup"
                      ? "Create master password"
                      : "Enter master password"
                  }
                  value={password()}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                />
                <button
                  class="password-reveal"
                  type="button"
                  tabindex={-1}
                  aria-label={showPassword() ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword() ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <Show when={props.mode === "setup"}>
              <label class="field">
                <span class="field-label sr-only">Confirm master password</span>
                <input
                  type={showPassword() ? "text" : "password"}
                  autocomplete="new-password"
                  placeholder="Confirm master password"
                  value={confirmPassword()}
                  onInput={(event) =>
                    setConfirmPassword(event.currentTarget.value)
                  }
                />
              </label>
            </Show>
            <Show when={Boolean(visibleError())}>
              <div class="form-error">{visibleError()}</div>
            </Show>
            <button class="btn primary" type="submit" disabled={props.busy}>
              {props.busy
                ? props.busyLabel || "Working..."
                : props.mode === "setup"
                  ? "Create vault"
                  : "Unlock vault"}
            </button>
          </form>
        </Show>
      </div>
    </section>
  );
}
