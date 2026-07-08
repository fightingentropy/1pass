import { defineConfig, loadEnv } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = (env.VITE_API_BASE || "https://1pass.pages.dev")
    .trim()
    .replace(/\/+$/, "");

  return {
    plugins: [solid()],
    server: {
      // In local dev the SPA talks to /api on the Vite origin. Proxy those
      // requests to the deployed Pages Functions so we avoid CORS failures
      // when ALLOWED_ORIGIN is production-only.
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
