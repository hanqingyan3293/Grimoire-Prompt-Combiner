import type { RawPrompt } from './prompt-source-runtime'
import type { PromptAssetPage } from '@shared/prompt-asset-types'

export type Prompt = RawPrompt & {
    sourceId: string;
    category: string;
    githubUrl: string;
};

export const ALL_PROMPTS_OPTION = "all";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
};

export type PromptSourceStatus = {
    sourceId: string;
    count: number;
    lastSuccessAt: string;
    lastError: string;
};

export type PromptSourceRefreshResult = PromptSourceStatus & {
    sourceName: string;
    success: boolean;
};

export type PromptSourceRefreshSummary = {
    results: PromptSourceRefreshResult[];
    total: number;
    successCount: number;
    failureCount: number;
};

type SourceCache = PromptSourceStatus & {
    items: Prompt[];
    fetchedAt: number;
    signature: string;
};

async function getAllPrompts(): Promise<Prompt[]> {
    const items: PromptAssetPage['items'] = [];
    const pageSize = 100;
    for (let offset = 0; offset < 10000; offset += pageSize) {
        const page = await window.api.promptAssets.list({ source: 'asset', limit: pageSize, offset });
        items.push(...page.items);
        if (!page.items.length || items.length >= page.total) break;
    }
    return items.map((item) => ({
        id: item.sourceRef,
        title: item.name,
        prompt: item.prompt,
        description: item.detail,
        coverUrl: '',
        referenceImageUrls: [],
        tags: [],
        preview: item.detail,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
        sourceId: 'grimoire-assets',
        category: item.detail || '魔导书提示词资产',
        githubUrl: '',
    }));
}

async function queryGrimoirePrompts(keyword: string, page: number, pageSize: number): Promise<PromptListResponse> {
    const result = await window.api.promptAssets.list({ query: keyword, source: 'asset', limit: pageSize, offset: Math.max(0, (page - 1) * pageSize) });
    const items = result.items.map((item) => ({ id: item.sourceRef, title: item.name, prompt: item.prompt, description: item.detail, coverUrl: '', referenceImageUrls: [], tags: [], preview: item.detail, createdAt: item.createdAt, updatedAt: item.createdAt, sourceId: 'grimoire-assets', category: item.detail || '魔导书提示词资产', githubUrl: '' }));
    return { items, tags: [], categories: Array.from(new Set(items.map(item => item.category))), total: result.total };
}

export async function fetchPrompts({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page = 1, pageSize = 20 }: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number } = {}) {
    if (!tag.length && (category === ALL_PROMPTS_OPTION || !category)) return queryGrimoirePrompts(keyword, page, pageSize);
    const items = await getAllPrompts();
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, Math.min(100, pageSize));
    const withoutTagFilter = filterPrompts(items, { keyword: normalizedKeyword, category, tags: [] });
    const filtered = filterPrompts(items, { keyword: normalizedKeyword, category, tags: tag });
    const categories = Array.from(new Set(items.map(item => item.category)));

    return {
        items: filtered.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize),
        tags: collectTags(withoutTagFilter),
        categories,
        total: filtered.length,
    };
}

export async function fetchSourcePrompts(sourceId: string): Promise<Prompt[]> {
    if (sourceId !== 'grimoire-assets') return [];
    return getAllPrompts();
}

export async function refreshSource(sourceId: string): Promise<PromptSourceRefreshResult> {
    const items = await fetchSourcePrompts(sourceId);
    return { sourceId, sourceName: sourceId, count: items.length, lastSuccessAt: new Date().toISOString(), lastError: '', success: true };
}

export async function refreshAllSources(): Promise<PromptSourceRefreshSummary> {
    const items = await getAllPrompts();
    return { results: [], total: items.length, successCount: 1, failureCount: 0 };
}

export async function refreshDueSources(maxAgeMs: number): Promise<PromptSourceRefreshSummary> {
    return refreshAllSources();
}

export async function fetchPromptSourceStatuses(): Promise<Record<string, PromptSourceStatus>> {
    const items = await getAllPrompts();
    return { 'grimoire-assets': { sourceId: 'grimoire-assets', count: items.length, lastSuccessAt: new Date().toISOString(), lastError: '' } };
}

function summarizeRefresh(results: PromptSourceRefreshResult[]): PromptSourceRefreshSummary {
    return {
        results,
        total: results.reduce((total, item) => total + item.count, 0),
        successCount: results.filter((item) => item.success).length,
        failureCount: results.filter((item) => !item.success).length,
    };
}

function filterPrompts(items: Prompt[], options: { keyword: string; category: string; tags: string[] }) {
    return items.filter((item) => {
        if (isActiveOption(options.category) && item.category !== options.category) return false;
        if (options.tags.length && !options.tags.some((tag) => item.tags.includes(tag))) return false;
        if (!options.keyword) return true;
        return [item.title, item.prompt, item.description, item.category, ...item.tags].join(" ").toLowerCase().includes(options.keyword);
    });
}

function collectTags(items: Prompt[]) {
    return Array.from(new Set(items.flatMap((item) => item.tags).filter(Boolean)));
}

function isActiveOption(value: string) {
    return value && value !== ALL_PROMPTS_OPTION && value !== "all";
}

export function formatPromptDate(value: string, locale?: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
