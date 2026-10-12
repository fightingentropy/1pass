import { Show } from "solid-js";
import { CloseIcon } from "./icons";
import type { Notice } from "./noticeController";

type ToastProps = {
  notice: Notice | null;
  onDismiss: () => void;
};

export default function Toast(props: ToastProps) {
  return (
    <Show when={props.notice}>
      {(notice) => (
        <div
          class={`toast ${notice().tone}`}
          role={notice().tone === "error" ? "alert" : "status"}
        >
          <span class="toast-message">{notice().message}</span>
          <button
            class="icon-button icon-only"
            type="button"
            aria-label="Dismiss notice"
            onClick={props.onDismiss}
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </Show>
  );
}
