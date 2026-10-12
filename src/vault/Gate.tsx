import { createEffect, createSignal, Show } from "solid-js";
import { EyeIcon, EyeOffIcon } from "./icons";

type GateProps = {
  mode: "loading" | "setup" | "locked";
  busy: boolean;
  busyLabel?: string;
  error: string;
  onSetup: (password: string, bootstrapSecret: string) => void;
  onUnlock: (password: string) => void;
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

    props.onUnlock(password());
  };

  const visibleError = () => localError() || props.error;

  return (
    <section class="gate">
      <div class="gate-card" data-mode={props.mode}>
        <div class="gate-brand">
          <span class="brand-logo" aria-hidden="true" />
          <span class="brand-mark">1Pass</span>
        </div>
        <Show
          when={props.mode !== "loading"}
          fallback={
            <p class="gate-status" aria-live="polite">
              Connecting…
            </p>
          }
        >
          <h1>{props.mode === "setup" ? "Create your vault" : "Unlock"}</h1>
          <Show when={props.mode === "setup"}>
            <p class="subtitle">
              Choose a master password. It cannot be recovered.
            </p>
          </Show>
          <form class="gate-form" onSubmit={handleSubmit}>
            <label class="field">
              <span class="field-label">Master password</span>
              <div class="password-input-wrap">
                <input
                  ref={passwordInputRef}
                  type={showPassword() ? "text" : "password"}
                  autocomplete={
                    props.mode === "setup" ? "new-password" : "current-password"
                  }
                  autofocus
                  value={password()}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                />
                <button
                  class="password-reveal"
                  type="button"
                  aria-label={showPassword() ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  <Show when={showPassword()} fallback={<EyeIcon />}>
                    <EyeOffIcon />
                  </Show>
                </button>
              </div>
            </label>
            <Show when={props.mode === "setup"}>
              <label class="field">
                <span class="field-label">Confirm master password</span>
                <input
                  type={showPassword() ? "text" : "password"}
                  autocomplete="new-password"
                  value={confirmPassword()}
                  onInput={(event) =>
                    setConfirmPassword(event.currentTarget.value)
                  }
                />
              </label>
            </Show>
            <Show when={props.mode === "setup"}>
              <label class="field">
                <span class="field-label">Deployment bootstrap secret</span>
                <input
                  type="password"
                  autocomplete="off"
                  value={bootstrapSecret()}
                  onInput={(event) =>
                    setBootstrapSecret(event.currentTarget.value)
                  }
                  required
                />
                <span class="field-hint">
                  Needed once to set up this deployment.
                </span>
              </label>
            </Show>
            <Show when={Boolean(visibleError())}>
              <div class="form-error" role="alert">
                {visibleError()}
              </div>
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
