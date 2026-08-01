function safeOrigin(value: string | undefined, fallback: string): string {
  try {
    const url = new URL((value || fallback).trim());
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

export const VAULT_ORIGIN = safeOrigin(import.meta.env.VITE_VAULT_ORIGIN, "https://1pass.pages.dev");
export const TAX_ORIGIN = safeOrigin(import.meta.env.VITE_TAX_ORIGIN, "https://1pass-tax.pages.dev");
