import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The application version reaches presentation-package admission at build time
// (ADR-032, Stage 2a). Injecting it here keeps the client from reading
// package.json at runtime and from holding a second version source.
const applicationVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version as string;

export default defineConfig({
  plugins: [react()],
  define: {
    __CAIRN_APP_VERSION__: JSON.stringify(applicationVersion),
  },
  server: {
    port: 5173,
    // The browser client speaks only the daemon's typed loopback API. Keep
    // the development server convenient without adding a second backend.
    proxy: {
      "/api": {
        target: process.env.CAIRN_API_TARGET ?? "http://127.0.0.1:4534",
        changeOrigin: true,
      },
    },
  },
});
