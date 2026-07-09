import { createSignal, onCleanup, type Setter } from "solid-js";
import type { VaultApiKeyItem } from "../../functions/api/vault/schema";
import { CLIPBOARD_CLEAR_MS } from "./types";

export function createClipboardController(setError: Setter<string>) {
  let copiedSecretResetTimer: number | undefined;
  let copiedFieldResetTimer: number | undefined;
  let clipboardClearTimer: number | undefined;
  const [copiedApiKeyId, setCopiedApiKeyId] = createSignal("");
  const [copiedField, setCopiedField] = createSignal("");

  const copyToClipboard = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the restricted-context fallback.
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  const scheduleClipboardClear = (copied: string) => {
    if (clipboardClearTimer) window.clearTimeout(clipboardClearTimer);
    clipboardClearTimer = window.setTimeout(() => {
      void (async () => {
        try {
          const current = await navigator.clipboard.readText();
          if (current === copied) await navigator.clipboard.writeText("");
        } catch {
          // Clipboard read is not available in every browser context.
        }
      })();
    }, CLIPBOARD_CLEAR_MS);
  };

  const handleCopyApiKey = async (item: VaultApiKeyItem) => {
    const key = item.key.trim();
    if (!key) return;
    try {
      await copyToClipboard(key);
      scheduleClipboardClear(key);
      setCopiedApiKeyId(item.id);
      if (copiedSecretResetTimer) window.clearTimeout(copiedSecretResetTimer);
      copiedSecretResetTimer = window.setTimeout(() => {
        setCopiedApiKeyId((current) => (current === item.id ? "" : current));
      }, 1800);
    } catch (copyError) {
      console.error(copyError);
      setError("Unable to copy the API key.");
    }
  };

  const markFieldCopied = (fieldKey: string) => {
    setCopiedField(fieldKey);
    if (copiedFieldResetTimer) window.clearTimeout(copiedFieldResetTimer);
    copiedFieldResetTimer = window.setTimeout(() => {
      setCopiedField((current) => (current === fieldKey ? "" : current));
    }, 1800);
  };

  const handleCopyField = async (value: string, fieldKey: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      await copyToClipboard(trimmed);
      markFieldCopied(fieldKey);
    } catch {
      setError("Unable to copy to clipboard.");
    }
  };

  const handleCopySecret = async (value: string, fieldKey: string) => {
    if (!value) return;
    try {
      await copyToClipboard(value);
      scheduleClipboardClear(value);
      markFieldCopied(fieldKey);
    } catch {
      setError("Unable to copy to clipboard.");
    }
  };

  onCleanup(() => {
    if (copiedSecretResetTimer) window.clearTimeout(copiedSecretResetTimer);
    if (copiedFieldResetTimer) window.clearTimeout(copiedFieldResetTimer);
    if (clipboardClearTimer) window.clearTimeout(clipboardClearTimer);
  });

  return {
    copiedApiKeyId,
    copiedField,
    handleCopyApiKey,
    handleCopyField,
    handleCopySecret,
  };
}
