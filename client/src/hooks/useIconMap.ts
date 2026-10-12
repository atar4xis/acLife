import { useEffect, useState } from "react";

export type IconMap = typeof import("@/lib/lucideIcons").icons;

let loaded: IconMap | undefined;
let loading: Promise<IconMap> | undefined;

export function useIconMap() {
  const [icons, setIcons] = useState(loaded);

  useEffect(() => {
    if (loaded) return;
    loading ??= import("@/lib/lucideIcons").then(
      (module) => {
        loaded = module.icons;
        return loaded;
      },
      (error) => {
        loading = undefined;
        throw error;
      },
    );
    loading.then(setIcons, () => {});
  }, []);

  return icons;
}
