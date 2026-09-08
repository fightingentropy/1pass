import { createEffect, createSignal, Show } from "solid-js";
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  ShieldIcon,
} from "./icons";

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
    if (props.mode === "loading") return "Connecting to your personal vault…";
    if (props.mode === "setup") {
      return "Choose a master password. Everything is encrypted in the browser — there is no recovery.";
    }
    return "Enter your master password to open your personal vault.";
  };

  return (
    <section class="gate">
      <header class="gate-topbar">
        <div class="brand brand-row">
          <span class="brand-logo" aria-hidden="true" />
          <span class="brand-mark">
            1Pass<span class="brand-period">.</span>
          </span>
        </div>
        <span class="gate-topbar-label">
          <LockIcon />
          Personal vault
        </span>
      </header>
      <div class="gate-center">
        <div class="gate-card" data-mode={props.mode}>
          <div class="gate-emblem" aria-hidden="true">
            <LockIcon />
            <span class="gate-emblem-status">
              <ShieldIcon />
            </span>
          </div>
          <div class="gate-heading">
            <span class="detail-kicker">Personal vault</span>
            <h1>
              {props.mode === "setup"
                ? "Create your vault."
                : props.mode === "loading"
                  ? "A moment, please."
                  : "Welcome back."}
            </h1>
            <p class="subtitle">{subtitle()}</p>
          </div>
          <Show
            when={props.mode !== "loading"}
            fallback={
              <p class="gate-status" aria-live="polite">
                Checking vault…
              </p>
            }
          >
            <form class="gate-form" onSubmit={handleSubmit}>
              <label class="field">
                <span class="field-label">Master password</span>
                <div class="password-input-wrap">
                  <input
                    ref={passwordInputRef}
                    type={showPassword() ? "text" : "password"}
                    autocomplete={
                      props.mode === "setup"
                        ? "new-password"
                        : "current-password"
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
                    aria-label={
                      showPassword() ? "Hide password" : "Show password"
                    }
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
                <div class="form-error" role="alert">
                  {visibleError()}
                </div>
              </Show>
              <button class="btn primary" type="submit" disabled={props.busy}>
                {props.busy
                  ? props.busyLabel || "Working…"
                  : props.mode === "setup"
                    ? "Create vault"
                    : "Unlock vault"}
                <Show when={!props.busy}>
                  <ArrowRightIcon />
                </Show>
              </button>
            </form>
          </Show>
          <p class="gate-security">
            <ShieldIcon />
            Encrypted on your device. Accessible only to you.
          </p>
        </div>
      </div>
      <footer class="gate-footer">
        <span>1Pass Personal Vault</span>
        <span>End-to-end encrypted.</span>
      </footer>
    </section>
  );
}
