import { createUniqueId, onMount, Show } from "solid-js";
import type { AttachmentPreviewState } from "./types";
import { formatBytes, isImageAttachment, triggerBlobDownload } from "./types";
import { CloseIcon } from "./icons";
import { trapFocus } from "./focus";

type AttachmentPreviewOverlayProps = {
  preview: AttachmentPreviewState;
  onClose: () => void;
};

export default function AttachmentPreviewOverlay(
  props: AttachmentPreviewOverlayProps,
) {
  const titleId = createUniqueId();
  let dialogRef: HTMLDivElement | undefined;
  let closeButtonRef: HTMLButtonElement | undefined;
  onMount(() => closeButtonRef?.focus());

  return (
    <div class="modal-backdrop preview-backdrop" onClick={props.onClose}>
      <div
        ref={dialogRef}
        class="preview-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => trapFocus(event, dialogRef)}
        onClick={(event) => event.stopPropagation()}
      >
        <div class="preview-header">
          <div class="preview-title">
            <strong id={titleId}>{props.preview.attachment.name}</strong>
            <span class="attachment-size">
              {formatBytes(props.preview.attachment.size)}
            </span>
          </div>
          <div class="preview-actions">
            <button
              class="secret-toggle"
              type="button"
              onClick={() =>
                triggerBlobDownload(
                  props.preview.url,
                  props.preview.attachment.name,
                )
              }
            >
              Download
            </button>
            <button
              ref={closeButtonRef}
              class="icon-button icon-only"
              type="button"
              aria-label="Close"
              onClick={props.onClose}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div class="preview-body">
          <Show
            when={isImageAttachment(props.preview.attachment)}
            fallback={
              <iframe
                class="preview-frame"
                src={props.preview.url}
                title={props.preview.attachment.name}
              />
            }
          >
            <img
              class="preview-image"
              src={props.preview.url}
              alt={props.preview.attachment.name}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}
