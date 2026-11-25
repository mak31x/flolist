import { useSyncExternalStore } from "react";

/** Subscribes to a CSS media query (available in every webview the app ships in). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => {
        mql.removeEventListener("change", onChange);
      };
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
