import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import type { VaultApiKeyItem } from "../../functions/api/vault/schema";
import { formatTimestamp, maskSecretValue } from "./types";
import { CheckIcon, CopyIcon, MoreIcon } from "./icons";

type ApiKeyDetailProps = {
  item: VaultApiKeyItem;
  isKeyVisible: boolean;
  isCopied: boolean;
  onToggleVisible: () => void;
  onCopyKey: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export default function ApiKeyDetail(props: ApiKeyDetailProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);

  createEffect(() => {
    if (!menuOpen()) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".overflow-menu")) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <div>
      <div class="detail-header">
        <div>
          <h2>{props.item.label}</h2>
          <p class="muted">API key</p>
        </div>
        <div class="detail-actions">
          <div class="overflow-menu">
            <button
              class="icon-button icon-only"
              type="button"
              aria-label="More actions"
              aria-expanded={menuOpen()}
              title="More"
              onClick={() => setMenuOpen((current) => !current)}
            >
              <MoreIcon />
            </button>
            <Show when={menuOpen()}>
              <div class="overflow-panel" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    props.onEdit();
                  }}
                >
                  Edit
                </button>
                <button
                  class="danger"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    props.onDelete();
                  }}
                >
                  Delete
                </button>
              </div>
            </Show>
          </div>
        </div>
      </div>
      <div class="detail-grid spaced">
        <div>
          <span class="meta-label">Environment</span>
          <p>{props.item.environment.trim() || "Not provided"}</p>
        </div>
        <div class="detail-span">
          <div class="secret-header">
            <span class="meta-label">API key</span>
            <div class="secret-actions">
              <button
                class={`secret-toggle icon-copy ${
                  props.isCopied ? "is-success" : ""
                }`}
                type="button"
                onClick={props.onCopyKey}
                disabled={!props.item.key.trim()}
                title={
                  props.isCopied ? "Copied!" : "Copy API key (clears after 60s)"
                }
              >
                <CopyIcon class="copy-icon" />
                <CheckIcon class="check-icon" />
              </button>
              <button
                class="secret-toggle"
                type="button"
                onClick={props.onToggleVisible}
                disabled={!props.item.key.trim()}
              >
                {props.isKeyVisible ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <p class={`secret-value ${props.isKeyVisible ? "" : "masked"}`}>
            {props.isKeyVisible
              ? props.item.key.trim() || "Not provided"
              : maskSecretValue(props.item.key)}
          </p>
        </div>
        <div class="detail-span">
          <span class="meta-label">Notes</span>
          <p class="notes-content">{props.item.notes.trim() || "Not provided"}</p>
        </div>
      </div>
      <div class="detail-footer">
        <span class="meta-label">Created</span>
        <strong>{formatTimestamp(props.item.createdAt)}</strong>
      </div>
    </div>
  );
}
