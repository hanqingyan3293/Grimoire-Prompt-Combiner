import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            setTheme: (theme) => set({ theme }),
        }),
        { name: "infinite-canvas:theme_store" },
    ),
);

function applyGrimoireAppearance() {
    if (!window.api?.settings?.getAll) return
    void window.api.settings.getAll().then((settings) => {
        const mode = settings.appearance_mode === "light" ? "light" : settings.appearance_mode === "dark" ? "dark" : "dark"
        useThemeStore.getState().setTheme(mode)
    }).catch(() => undefined)
}

if (typeof window !== "undefined") {
    applyGrimoireAppearance()
    window.api?.db?.onRefresh?.(applyGrimoireAppearance)
    window.api?.db?.onFocus?.(applyGrimoireAppearance)
}
