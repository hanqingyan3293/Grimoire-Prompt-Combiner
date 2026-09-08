import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createPromptSource, type PromptSource } from "@canvas/services/api/prompt-source-presets";

export type PromptSourceSchedule = {
    intervalMinutes: number;
    lastFetchedAt: string;
};

const PROMPT_SOURCE_STORE_KEY = "infinite-canvas:prompt_source_store_v2";

const defaultSchedule: PromptSourceSchedule = {
    intervalMinutes: 30,
    lastFetchedAt: "",
};

export const PROMPT_SOURCE_INTERVALS = [0, 30, 60, 360, 1440];
const GRIMOIRE_SOURCE: PromptSource = { id: 'grimoire-assets', name: '魔导书提示词资产', url: '', homepage: '', enabled: true, builtIn: true };

type PromptSourceStore = {
    sources: PromptSource[];
    schedule: PromptSourceSchedule;
    addSource: () => PromptSource;
    saveSource: (source: PromptSource) => void;
    removeSource: (id: string) => void;
    toggleSource: (id: string, enabled: boolean) => void;
    updateSchedule: <K extends keyof PromptSourceSchedule>(key: K, value: PromptSourceSchedule[K]) => void;
};

export const usePromptSourceStore = create<PromptSourceStore>()(
    persist(
        (set) => ({
            sources: [GRIMOIRE_SOURCE],
            schedule: defaultSchedule,
            addSource: () => createPromptSource(),
            saveSource: (source) =>
                set((state) => ({
                    sources: state.sources.some((item) => item.id === source.id)
                        ? state.sources.map((item) => (item.id === source.id && !item.builtIn ? createPromptSource(source) : item))
                        : [...state.sources, createPromptSource(source)],
                })),
            removeSource: (id) => set((state) => ({ sources: state.sources.filter((item) => item.id !== id || item.builtIn) })),
            toggleSource: (id, enabled) => set((state) => ({ sources: state.sources.map((item) => (item.id === id ? { ...item, enabled } : item)) })),
            updateSchedule: (key, value) => set((state) => ({ schedule: { ...state.schedule, [key]: value } })),
        }),
        {
            name: PROMPT_SOURCE_STORE_KEY,
            partialize: (state) => ({ sources: state.sources, schedule: state.schedule }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<PromptSourceStore>;
                const savedSources = Array.isArray(persistedState.sources) ? persistedState.sources : [];
                const enabledById = new Map(savedSources.map((source) => [source.id, source.enabled]));
                const builtIn = [{ ...GRIMOIRE_SOURCE, enabled: enabledById.get(GRIMOIRE_SOURCE.id) ?? true }];
                // The desktop build owns its prompt catalog in SQLite. Do not resurrect
                // remote sources from an older browser build.
                return { ...current, sources: builtIn, schedule: { ...defaultSchedule, ...(persistedState.schedule || {}) } };
            },
        },
    ),
);

if (typeof window !== 'undefined') {
  window.addEventListener('grimoire:refresh', () => {
    usePromptSourceStore.setState({ sources: [{ ...GRIMOIRE_SOURCE }], schedule: defaultSchedule })
  })
}
