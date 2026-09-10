import { FolderPlus, Search } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Spin, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { PromptCard } from "@canvas/components/prompts/prompt-card";
import { usePromptList } from "@canvas/components/prompts/use-prompt-list";
import { PromptDetailDialog } from "./components/prompt-detail-dialog";
import { useCopyText } from "@canvas/hooks/use-copy-text";
import { cn } from "@canvas/lib/utils";
import { useAssetStore } from "@canvas/stores/use-asset-store";
import { ALL_PROMPTS_OPTION, getAllPrompts, type Prompt } from "@canvas/services/api/prompts";

export default function PromptsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const [allPromptItems, setAllPromptItems] = useState<Prompt[]>([]);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [categories, setCategories] = useState<Array<{ id: string; parentId: string | null; name: string; sourceScope: string; sortOrder: number; isBuiltin: boolean }>>([]);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const { query, items: promptItems, tags: promptTags, total: totalPrompts } = usePromptList({ keyword: titleKeyword, tags: selectedTags, category: ALL_PROMPTS_OPTION });
    const categoryItems = allPromptItems.length ? allPromptItems : promptItems;
    const promptGroups = useMemo(() => {
        const groups = new Map<string, Prompt[]>();
        categoryItems.forEach((item) => {
            const ids = item.categoryIds?.length ? item.categoryIds : ['uncategorized'];
            ids.forEach(id => groups.set(id, [...(groups.get(id) || []), item]));
        });
        return groups;
    }, [categoryItems]);
    const assetCategories = useMemo(() => categories.filter(item => String(item.sourceScope).toLowerCase() === 'asset'), [categories]);
    const rootCategories = useMemo(() => assetCategories.filter(item => !item.parentId), [assetCategories]);
    const categorizedIds = useMemo(() => new Set(assetCategories.map(item => item.id)), [assetCategories]);
    const uncategorizedItems = useMemo(() => promptItems.filter(item => !item.categoryIds?.some(id => categorizedIds.has(id))), [categorizedIds, promptItems]);

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : t("prompts.loadFailed"));
    }, [message, query.error, query.isError, t]);
    useEffect(() => {
        let disposed = false;
        const loadCategories = async () => {
            try {
                const result = await window.api.promptAssets.categories.list();
                if (!disposed) { setCategories(result); setCategoryError(null); }
            } catch (error) {
                if (!disposed) setCategoryError(error instanceof Error ? error.message : '分类加载失败');
            }
        };
        void loadCategories();
        const refresh = window.api.db.onRefresh(() => void loadCategories());
        const reload = window.api.db.onReload(() => void loadCategories());
        return () => { disposed = true; refresh(); reload(); };
    }, []);
    useEffect(() => {
        let disposed = false;
        void getAllPrompts().then(items => { if (!disposed) setAllPromptItems(items); }).catch(error => {
            if (!disposed) message.error(error instanceof Error ? error.message : '提示词资产加载失败');
        });
        return () => { disposed = true; };
    }, [message]);

    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };

    const savePromptAsset = (item: Prompt) => {
        addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl } });
        message.success(t("common.addedToAssets"));
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-4 py-6 [background-size:16px_16px] sm:px-6 lg:py-8 dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]" onScroll={handleListScroll}>
                <div className="mx-auto max-w-7xl">
                    <div className="text-center">
                        <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("prompts.title")}</h1>
                        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{t("prompts.total", { count: totalPrompts })}</p>
                    </div>
                    <div className="mt-5 grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
                        <aside className="thin-scrollbar max-h-72 overflow-y-auto border-b border-stone-200 pb-5 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-6rem)] lg:border-b-0 lg:border-r lg:pb-8 lg:pr-5 dark:border-stone-800">
                            <div className="mt-6">
                                <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">{t("prompts.tags")}</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {promptTags.map((tag) => {
                                        const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                                        return <Tag.CheckableTag key={tag} checked={active} className={cn("prompt-filter-tag", active && "is-active")} onChange={() => toggleTag(tag)}>{tag === ALL_PROMPTS_OPTION ? t("common.all") : tag}</Tag.CheckableTag>;
                                    })}
                                </div>
                            </div>
                        </aside>
                        <section className="min-w-0">
                            <Input size="large" prefix={<Search className="size-4 text-stone-400" />} value={titleKeyword} placeholder={t("prompts.search")} onChange={(event) => setTitleKeyword(event.target.value)} />
                            {query.isLoading ? <div className="flex h-60 items-center justify-center"><Spin /></div> : null}
                            {!query.isLoading ? <div className="mt-5 space-y-5">{categoryError ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{categoryError}</div> : null}{rootCategories.length ? <>{rootCategories.map(category => <PromptCategorySection key={category.id} category={category} categories={assetCategories} itemsByCategory={promptGroups} collapsedGroups={collapsedGroups} setCollapsedGroups={setCollapsedGroups} onOpen={setSelectedPrompt} onCopy={item => copyText(item.prompt, t("common.promptCopied"))} onSave={savePromptAsset} emptyText={t("prompts.empty")} />)}{uncategorizedItems.length > 0 ? <section className="rounded-xl border border-dashed border-stone-300 bg-white/50 p-3 dark:border-stone-700 dark:bg-stone-950/20"><button type="button" onClick={() => setCollapsedGroups(state => ({ ...state, uncategorized: !state.uncategorized }))} className="flex w-full items-center gap-2 text-left text-sm font-semibold"><span>{collapsedGroups.uncategorized ? '▸' : '▾'}</span><span className="min-w-0 flex-1 truncate">未分类</span><span className="text-xs font-normal opacity-55">{uncategorizedItems.length}</span></button>{!collapsedGroups.uncategorized && <div className="mt-3"><PromptGrid items={uncategorizedItems} onOpen={setSelectedPrompt} renderActions={(item) => <Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>加入资产</Button>} onCopy={(item) => copyText(item.prompt, t("common.promptCopied"))} emptyText={t("prompts.empty")} /></div>}</section> : null}</> : <PromptGrid items={promptItems} onOpen={setSelectedPrompt} renderActions={(item) => <Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>{t("common.addToAssets")}</Button>} onCopy={(item) => copyText(item.prompt, t("common.promptCopied"))} emptyText={t("prompts.empty")} />}</div> : null}
                            <div className="mt-5 flex justify-center">{query.hasNextPage ? <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t("prompts.loadMore")}</Button> : promptItems.length > 0 ? <span className="text-xs text-stone-400">{t("prompts.end")}</span> : null}</div>
                        </section>
                    </div>
                </div>
            </main>

            <PromptDetailDialog prompt={selectedPrompt} onClose={() => setSelectedPrompt(null)} onCopy={(prompt) => copyText(prompt, t("common.promptCopied"))} onSaveAsset={savePromptAsset} />
        </div>
    );
}

function PromptGrid({ items, onOpen, onCopy, renderActions, emptyText, onDragStart }: { items: Prompt[]; onOpen: (item: Prompt) => void; onCopy: (item: Prompt) => void; renderActions: (item: Prompt) => ReactNode; emptyText: string; onDragStart?: (item: Prompt) => (event: React.DragEvent) => void }) {
    return <div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{items.map((item) => <PromptCard key={`${item.sourceId}:${item.id}`} item={item} onOpen={() => onOpen(item)} onCopy={() => onCopy(item)} onDragStart={onDragStart?.(item)} extraAction={renderActions(item)} />)}</div>{items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} className="py-16" /> : null}</div>;
}

function PromptCategorySection({ category, categories, itemsByCategory, collapsedGroups, setCollapsedGroups, onOpen, onCopy, onSave, emptyText }: any) {
    const collapsed = collapsedGroups[category.id] === true;
    const items = itemsByCategory.get(category.id) || [];
    const children = categories.filter((item: any) => item.parentId === category.id);
    const descendantCount = items.length + children.reduce((total: number, child: any) => total + countCategoryItems(child, categories, itemsByCategory), 0);
    return <section className="col-span-full rounded-xl border border-stone-200 bg-white/60 p-3 dark:border-stone-800 dark:bg-stone-950/30" onDragOver={event => event.preventDefault()} onDrop={event => { const assetId = event.dataTransfer.getData('text/prompt-asset-id'); if (assetId) void window.api.promptAssets.categories.assign({ assetId, categoryId: category.id }) }}>
      <button type="button" onClick={() => setCollapsedGroups((state: Record<string, boolean>) => ({ ...state, [category.id]: !collapsed }))} className="flex w-full items-center gap-2 text-left text-sm font-semibold"><span>{collapsed ? '▸' : '▾'}</span><span className="min-w-0 flex-1 truncate">{category.name}</span><span className="text-xs font-normal opacity-55">{descendantCount}</span></button>
      {!collapsed && <div className="mt-3 space-y-3">{items.length ? <PromptGrid items={items} onOpen={onOpen} onDragStart={(item: Prompt) => event => { event.dataTransfer.setData('text/prompt-asset-id', item.assetId); event.dataTransfer.effectAllowed = 'move' }} renderActions={(item: Prompt) => <Button type="text" size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSave(item)}>加入资产</Button>} onCopy={onCopy} emptyText={emptyText} /> : null}{children.map((child: any) => <PromptCategorySection key={child.id} category={child} categories={categories} itemsByCategory={itemsByCategory} collapsedGroups={collapsedGroups} setCollapsedGroups={setCollapsedGroups} onOpen={onOpen} onCopy={onCopy} onSave={onSave} emptyText={emptyText} />)}</div>}
    </section>
}

function countCategoryItems(category: any, categories: any[], itemsByCategory: Map<string, Prompt[]>) {
    const children = categories.filter((item: any) => item.parentId === category.id);
    return (itemsByCategory.get(category.id)?.length || 0) + children.reduce((total: number, child: any) => total + countCategoryItems(child, categories, itemsByCategory), 0);
}
