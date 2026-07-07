import { onMount } from "solid-js";
import type { ConfirmRequest } from "./types";

type ConfirmDialogProps = {
  request: ConfirmRequest;
  onClose: (confirmed: boolean) => void;
};

export default function ConfirmDialog(props: ConfirmDialogProps) {
  let confirmButtonRef: HTMLButtonElement | undefined;

  onMount(() => {
    confirmButtonRef?.focus();
  });

  return (
    <div
      class="modal-backdrop confirm-backdrop"
      onClick={() => props.onClose(false)}
    >
      <div
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={props.request.title}
        onClick={(event) => event.stopPropagation()}
      >
        <h3>{props.request.title}</h3>
        <p>{props.request.message}</p>
        <div class="modal-actions">
          <button
            class="btn ghost"
            type="button"
            onClick={() => props.onClose(false)}
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            class={`btn primary ${props.request.danger ? "danger" : ""}`}
            type="button"
            onClick={() => props.onClose(true)}
          >
            {props.request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
