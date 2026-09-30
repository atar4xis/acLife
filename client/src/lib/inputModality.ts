const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

let modality: "keyboard" | "pointer" = "pointer";

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => (modality = "pointer"), true);
  window.addEventListener(
    "keydown",
    (e) => {
      if (!MODIFIER_KEYS.has(e.key)) modality = "keyboard";
    },
    true,
  );
}

export const lastInputModality = () => modality;
