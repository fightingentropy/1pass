import { createEffect, createSignal, Show } from "solid-js";

type GateProps = {
  mode: "loading" | "setup" | "locked";
  busy: boolean;
  busyLabel?: string;
  error: string;
  requiresBootstrap: boolean;
  onSetup: (password: string, bootstrapSecret: string) => void;
  onUnlock: (password: string, bootstrapSecret: string) => void;
};

export default function Gate(props: GateProps) {
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [showPassword, setShowPassword] = createSignal(false);
  const [bootstrapSecret, setBootstrapSecret] = createSignal("");
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
      if (password().length < 12) {
        setLocalError("Use at least 12 characters for the master password.");
        return;
      }
      if (password() !== confirmPassword()) {
        setLocalError("Passwords do not match.");
        return;
      }
      if (!bootstrapSecret().trim()) {
        setLocalError("Enter the deployment bootstrap secret.");
        return;
      }
      props.onSetup(password(), bootstrapSecret());
      return;
    }

    if (props.requiresBootstrap && !bootstrapSecret().trim()) {
      setLocalError("Enter the deployment bootstrap secret.");
      return;
    }
    props.onUnlock(password(), bootstrapSecret());
  };

  const visibleError = () => localError() || props.error;
  const subtitle = () => {
    if (props.mode === "loading") return "Checking vault…";
    if (props.mode === "setup") {
      return "Choose a master password. Everything is encrypted in the browser — there is no recovery.";
    }
    return "Enter your master password.";
  };

  return (
    <section class="gate minimal">
      <div class="gate-card minimal" data-mode={props.mode}>
        <div class="brand-stack">
          <span class="brand-logo" aria-hidden="true" />
          <span class="brand-mark">1Pass</span>
          <span class="brand-subtitle">Personal vault</span>
        </div>
        <p class="subtitle">{subtitle()}</p>
        <Show
          when={props.mode !== "loading"}
          fallback={
            <p class="gate-status" aria-live="polite">
              Checking vault…
            </p>
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
                      : "Master password"
                  }
                  value={password()}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                />
                <button
                  class="password-reveal"
                  type="button"
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
                  placeholder="Confirm password"
                  value={confirmPassword()}
                  onInput={(event) =>
                    setConfirmPassword(event.currentTarget.value)
                  }
                />
              </label>
            </Show>
            <Show when={props.requiresBootstrap}>
              <label class="field">
                <span class="field-label">Deployment bootstrap secret</span>
                <input
                  type="password"
                  autocomplete="off"
                  placeholder="Bootstrap secret"
                  value={bootstrapSecret()}
                  onInput={(event) =>
                    setBootstrapSecret(event.currentTarget.value)
                  }
                  required
                />
                <span class="field-hint">
                  Required once to initialize or migrate this deployment.
                </span>
              </label>
            </Show>
            <Show when={Boolean(visibleError())}>
              <div class="form-error">{visibleError()}</div>
            </Show>
            <button class="btn primary" type="submit" disabled={props.busy}>
              {props.busy
                ? props.busyLabel || "Working…"
                : props.mode === "setup"
                  ? "Create vault"
                  : "Unlock"}
            </button>
          </form>
        </Show>
      </div>
    </section>
  );
}
