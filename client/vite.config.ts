/// <reference types="vitest/config" />
import { defineConfig, type ConfigEnv, type Plugin } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { version } from "./package.json";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "media-src 'self' blob:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
].join("; ");

const cspPlugin = (): Plugin => ({
  name: "csp",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
      injectTo: "head-prepend",
    },
  ],
});

// https://vite.dev/config/
export default ({ mode }: ConfigEnv) => {
  return defineConfig({
    plugins: [react(), tailwindcss(), cspPlugin()],
    base: mode === "tauri" ? "./" : "/acLife/",
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __BUILD_NUMBER__: JSON.stringify(process.env.BUILD_NUMBER ?? ""),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./tests/setup.ts",
      env: { TZ: "UTC" },
      server: {
        deps: {
          inline: ["@mzattahri/srp"],
        },
      },
    },
  });
};
