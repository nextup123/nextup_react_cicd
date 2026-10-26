import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The NextPLC pages run the same PLC engine as the server (parse, describe, ladder) in the browser.
const PLC_ENGINE = fileURLToPath(new URL("../backend/plc/engine/index.js", import.meta.url));

// Backend (Express + WebSocket) address used by the dev server proxy.
const BACKEND = process.env.NEXTUP_BACKEND || "http://localhost:3000";

// Every backend path prefix. The React routes (/points, /paths, /io, /tree,
// /client, /diagnostics, /projects) are deliberately different from these.
const API_PREFIXES = [
  "/api",
  "/point-planning",
  "/ws-calibration",
  "/path-planning",
  "/path-testing",
  "/io-control",
  "/settings",
  "/cycle",
  "/error-logs",
  "/main-tree",
  "/ros",
  "/ros-monitor",
  "/driver",
  "/robot",
  "/ui-prefs",
  "/uptime",
  "/start",
  "/stop",
  "/shutdown",
  "/reboot",
  "/force-shutdown",
  "/security",
  "/system",
  "/media",
  "/plc-api",
];

const proxy = Object.fromEntries(
  API_PREFIXES.map((p) => [p, { target: BACKEND, changeOrigin: true }])
);
// The backend WebSocket shares the HTTP port; the client connects to /ws in dev.
proxy["/ws"] = { target: BACKEND.replace(/^http/, "ws"), ws: true, rewrite: () => "/" };

// Lists every code chunk of the build (page-chunks.json) so the app can fetch all pages' code
// in the background once it runs (lib/preload.js): a page opened later never waits for, or
// fails on, a code download.
const pageChunks = () => ({
  name: "nextup-page-chunks",
  generateBundle(_, bundle) {
    const files = Object.values(bundle)
      .filter((f) => (f.type === "chunk" && !f.isEntry) || (f.type === "asset" && f.fileName.endsWith(".css")))
      .map((f) => f.fileName);
    this.emitFile({ type: "asset", fileName: "page-chunks.json", source: JSON.stringify(files) });
  },
});

export default defineConfig({
  plugins: [react(), pageChunks()],
  resolve: { alias: { "nextplc-engine": PLC_ENGINE }, dedupe: ["yaml"] },
  server: { port: 5173, host: true, proxy, fs: { allow: [".."] } },
  preview: { port: 4173, host: true, proxy },
  build: { outDir: "dist", chunkSizeWarningLimit: 1500 },
});
