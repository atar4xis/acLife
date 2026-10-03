import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { applyLanguage } from "@/i18n";
import { SETTINGS_STORAGE_KEY } from "@/lib/settingsStore";
import { readJSON } from "@/lib/utils";

applyLanguage(
  readJSON<{ values?: { language?: string } } | null>(
    SETTINGS_STORAGE_KEY,
    null,
  )?.values?.language,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
