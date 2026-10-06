import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import logicalClasses from "./eslint-rules/logical-classes.js";

export default defineConfig([
  globalIgnores(["dist", "src-tauri"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "jsx-a11y/no-autofocus": ["error", { ignoreNonDOM: true }],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ["src/**/*.tsx"],
    plugins: { rtl: logicalClasses },
    rules: { "rtl/logical-classes": "error" },
  },
  {
    // always left-to-right (forced dir="ltr") or keyed by an explicit physical side
    files: [
      "src/components/calendar/{DragOverlay,ScrollThumb,GridFocus,TimezoneHeaderCell}.tsx",
      "src/components/ui/{sheet,sidebar,resizable}.tsx",
    ],
    rules: { "rtl/logical-classes": "off" },
  },
]);
