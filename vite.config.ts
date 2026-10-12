import { defineConfig, loadEnv } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = (env.VITE_API_BASE || "http://localhost:8788")
    .trim()
    .replace(/\/+$/, "");

  return {
    plugins: [solid()],
    server: {
      // In local dev the SPA talks to /api on the Vite origin. By default the
      // proxy forwards those requests to the local Pages dev server
      // (`bun run pages-dev`, port 8788). Set VITE_API_BASE to point the proxy
      // at a deployed site explicitly.
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
