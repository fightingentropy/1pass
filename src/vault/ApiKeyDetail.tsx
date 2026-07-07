import { Show } from "solid-js";
import type { VaultApiKeyItem } from "../../functions/api/vault/schema";
import { formatTimestamp, maskSecretValue } from "./types";
import { CheckIcon, CopyIcon, PencilIcon, TrashIcon } from "./icons";

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
    <div>
      <div class="detail-header">
        <div>
          <h2>{props.item.label}</h2>
          <p class="muted">API key record</p>
        </div>
        <div class="detail-actions">
          <span class="pill">Secret</span>
          <button
            class="icon-button icon-only"
            type="button"
            aria-label="Edit API key"
            onClick={props.onEdit}
          >
            <PencilIcon />
          </button>
          <button
            class="icon-button icon-only"
            type="button"
            aria-label="Delete API key"
            onClick={props.onDelete}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <div class="detail-grid">
        <div>
          <span class="meta-label">Environment</span>
          <p>{props.item.environment.trim() || "Not provided"}</p>
        </div>
        <div class="detail-span">
          <div class="secret-header">
            <span class="meta-label">API Key</span>
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
