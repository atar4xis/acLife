import { defineConfig, type ConfigEnv } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";

// https://vite.dev/config/
export default ({ mode }: ConfigEnv) => {
  return defineConfig({
    plugins: [react(), tailwindcss()],
    base: mode === "tauri" ? "./" : "/acLife/",
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  });
};
