import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export const isTauri = "__TAURI_INTERNALS__" in window;

export const checkNativeUpdate = (tag: string) =>
  invoke<boolean>("check_update", { tag });

export const installNativeUpdate = () => invoke<void>("install_update");

export const restartApp = () => invoke<void>("restart_app");

export const openExternal = (url: string) =>
  isTauri ? openUrl(url) : window.open(url, "_blank", "noopener");
