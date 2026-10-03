import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { type Prompt, ALL_PROMPTS_OPTION, fetchPrompts } from "@canvas/services/api/prompts";

export const PROMPT_PAGE_SIZE = 20;

export function usePromptList({ keyword, tags, category, enabled = true }: { keyword: string; tags: string[]; category: string; enabled?: boolean }) {
    const [debouncedKeyword, setDebouncedKeyword] = useState(keyword);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
        return () => clearTimeout(timer);
    }, [keyword]);
    const query = useInfiniteQuery({
        queryKey: ["prompts", debouncedKeyword, tags, category],
        queryFn: ({ pageParam }) => fetchPrompts({ keyword: debouncedKeyword, tag: tags, category, page: pageParam, pageSize: PROMPT_PAGE_SIZE }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, pages) => (pages.reduce((total, page) => total + page.items.length, 0) < lastPage.total ? pages.length + 1 : undefined),
        enabled,
    });
    const firstPage = query.data?.pages[0];
    return {
        query,
        items: useMemo(() => query.data?.pages.flatMap((page) => page.items) || [], [query.data?.pages]),
        tags: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.tags || [])], [firstPage?.tags]),
        categories: useMemo(() => [ALL_PROMPTS_OPTION, ...(firstPage?.categories || [])], [firstPage?.categories]),
        total: firstPage?.total || 0,
    };
}

type PromptGroupList = { category: string; items: Prompt[]; total: number }[];

export function useGroupedPromptList({ keyword, enabled = true }: { keyword: string; enabled?: boolean }) {
    const [debouncedKeyword, setDebouncedKeyword] = useState(keyword);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
        return () => clearTimeout(timer);
    }, [keyword]);

    const query = useInfiniteQuery({
        queryKey: ["grouped-prompts", debouncedKeyword],
        queryFn: () => fetchPrompts({ keyword: debouncedKeyword, pageSize: 500 }),
        initialPageParam: 1,
        enabled,
    });

    const groups = useMemo<PromptGroupList>(() => {
        if (!query.data) return [];
        const map = new Map<string, Prompt[]>();
        for (const prompt of query.data.items) {
            const list = map.get(prompt.category) || [];
            list.push(prompt);
            map.set(prompt.category, list);
        }
        return Array.from(map, ([category, items]) => ({ category, items, total: items.length }));
    }, [query.data]);

    return { query, groups };
}

export function usePagedGroupedPromptList({ keyword, pageSize = 24, enabled = true }: { keyword: string; pageSize?: number; enabled?: boolean }) {
    const [debouncedKeyword, setDebouncedKeyword] = useState(keyword);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedKeyword(keyword), 300);
        return () => clearTimeout(timer);
    }, [keyword]);

    const query = useInfiniteQuery({
        queryKey: ["grouped-prompts", debouncedKeyword],
        queryFn: ({ pageParam }) => fetchPrompts({ keyword: debouncedKeyword, page: pageParam, pageSize }),
        initialPageParam: 1,
        getNextPageParam: (lastPage, pages) => (pages.reduce((total, page) => total + page.items.length, 0) < lastPage.total ? pages.length + 1 : undefined),
        enabled,
    });

    const groups = useMemo<PromptGroupList>(() => {
        if (!query.data) return [];
        const map = new Map<string, Prompt[]>();
        for (const prompt of query.data.pages.flatMap((page) => page.items)) {
            const list = map.get(prompt.category) || [];
            list.push(prompt);
            map.set(prompt.category, list);
        }
        return Array.from(map, ([category, items]) => ({ category, items, total: items.length }));
    }, [query.data]);

    return { query, groups };
}
