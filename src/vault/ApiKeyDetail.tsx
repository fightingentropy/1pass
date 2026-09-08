import { Show } from "solid-js";
import ItemActions from "./ItemActions";
import type { VaultApiKeyItem } from "../../functions/api/vault/schema";
import { formatTimestamp, maskSecretValue } from "./types";
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  LockIcon,
} from "./icons";

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
  return (
    <div class="detail-content">
      <div class="detail-header">
        <div class="detail-heading">
          <span class="detail-emblem" aria-hidden="true">
            <KeyIcon />
          </span>
          <span class="detail-kicker">API key</span>
          <h2>{props.item.label}</h2>
          <p class="muted">{props.item.service.trim() || "Personal vault"}</p>
        </div>
        <ItemActions
          itemId={props.item.id}
          itemType="API key"
          onEdit={props.onEdit}
          onDelete={props.onDelete}
        />
      </div>
      <div class="secret-block">
        <div class="secret-header">
          <span class="meta-label">API key</span>
          <span class="encrypted-label">
            <LockIcon />
            Encrypted
          </span>
        </div>
        <div class="secret-input-row">
          <code class={`secret-value ${props.isKeyVisible ? "" : "masked"}`}>
            {props.isKeyVisible
              ? props.item.key.trim() || "Not provided"
              : maskSecretValue(props.item.key)}
          </code>
          <button
            class="icon-button icon-only"
            type="button"
            aria-label={props.isKeyVisible ? "Hide API key" : "Show API key"}
            onClick={props.onToggleVisible}
            disabled={!props.item.key.trim()}
            title={props.isKeyVisible ? "Hide API key" : "Show API key"}
          >
            <Show when={props.isKeyVisible} fallback={<EyeIcon />}>
              <EyeOffIcon />
            </Show>
          </button>
          <button
            class={`icon-button icon-only ${props.isCopied ? "is-success" : ""}`}
            type="button"
            aria-label={props.isCopied ? "API key copied" : "Copy API key"}
            onClick={props.onCopyKey}
            disabled={!props.item.key.trim()}
            title="Copy API key (clears after 60s)"
          >
            <Show when={props.isCopied} fallback={<CopyIcon />}>
              <CheckIcon />
            </Show>
          </button>
        </div>
        <span class="secret-hint" role="status">
          {props.isCopied
            ? "Copied to clipboard. Clears after 60 seconds."
            : "Hidden until you need it."}
        </span>
      </div>
      <div class="detail-properties">
        <div class="property-row">
          <span class="meta-label">Service</span>
          <span>
            {props.item.service.trim() || (
              <span class="muted">Not provided</span>
            )}
          </span>
        </div>
        <div class="property-row">
          <span class="meta-label">Environment</span>
          <span>
            <Show
              when={props.item.environment.trim()}
              fallback={<span class="muted">Not provided</span>}
            >
              <span class="environment-badge">
                <span />
                {props.item.environment}
              </span>
            </Show>
          </span>
        </div>
      </div>
      <div class="detail-notes">
        <span class="meta-label">Notes</span>
        <p class={`notes-content ${props.item.notes.trim() ? "" : "muted"}`}>
          {props.item.notes.trim() || "No notes added."}
        </p>
      </div>
      <div class="detail-footer">
        <span class="meta-label">Created</span>
        <strong>{formatTimestamp(props.item.createdAt)}</strong>
      </div>
    </div>
  );
}
