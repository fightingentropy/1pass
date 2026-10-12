import { createSignal, onCleanup } from "solid-js";

export type NoticeTone = "info" | "error";

export type Notice = {
  message: string;
  tone: NoticeTone;
  // Sticky notices stay until dismissed or replaced, e.g. the lock notice
  // that must survive the user returning to a hidden tab.
  sticky: boolean;
};

export const NOTICE_INFO_MS = 6_000;
export const NOTICE_ERROR_MS = 10_000;

// One toast slot for transient feedback that is not tied to a form or to the
// sync indicator: clipboard failures, export failures, completed maintenance.
export function createNoticeController() {
  let timer: number | undefined;
  const [notice, setNotice] = createSignal<Notice | null>(null);

  const clearTimer = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };

  const dismissNotice = () => {
    clearTimer();
    setNotice(null);
  };

  const showNotice = (
    message: string,
    tone: NoticeTone = "info",
    options: { sticky?: boolean } = {},
  ) => {
    clearTimer();
    const sticky = Boolean(options.sticky);
    setNotice({ message, tone, sticky });
    if (!sticky) {
      timer = window.setTimeout(
        () => {
          timer = undefined;
          setNotice(null);
        },
        tone === "error" ? NOTICE_ERROR_MS : NOTICE_INFO_MS,
      );
    }
  };

  onCleanup(clearTimer);

  return { notice, showNotice, dismissNotice };
}
