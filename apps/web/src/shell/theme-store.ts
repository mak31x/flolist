import {
  applyTheme,
  readStoredTheme,
  storeTheme,
  watchSystemTheme,
  type ThemePreference,
} from "@flolist/ui/theme";
import { create } from "zustand";

type ThemeState = {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
};

/** Theme preference, cached in localStorage until it moves onto the user record (M1.1). */
export const useThemeStore = create<ThemeState>()((set) => ({
  preference: readStoredTheme(),
  setPreference: (preference) => {
    storeTheme(preference);
    applyTheme(preference);
    set({ preference });
  },
}));

/** Applies the theme on start and follows OS changes while "System preference" is selected. */
export function startThemeSync(): () => void {
  applyTheme(useThemeStore.getState().preference);
  return watchSystemTheme(() => {
    const { preference } = useThemeStore.getState();
    if (preference === "system") applyTheme(preference);
  });
}
