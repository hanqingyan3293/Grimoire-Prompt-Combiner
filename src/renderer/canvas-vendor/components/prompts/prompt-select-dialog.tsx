import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Collapse, Empty, Input, Modal, Spin, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { PromptCard } from "./prompt-card";
import { usePagedGroupedPromptList } from "./use-prompt-list";
import { HoverPreview } from "@canvas/components/ui/hover-preview";
import type { Prompt } from "@canvas/services/api/prompts";

export function PromptSelectDialog({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
    const { query, groups } = usePagedGroupedPromptList({ keyword, enabled: open });

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : t("prompts.loadFailed"));
    }, [message, query.error, query.isError, t]);

    useEffect(() => {
        if (!keyword.trim() && groups.length && expandedCategories.length === 0) setExpandedCategories(groups.map((group) => group.category));
        if (keyword.trim()) setExpandedCategories(groups.map((group) => group.category));
    }, [expandedCategories.length, groups, keyword]);

    const selectPrompt = (prompt: string) => {
        onSelect(prompt);
        onOpenChange(false);
    };

    return (
        <Modal title={t("prompts.library")} open={open} onCancel={() => onOpenChange(false)} footer={null} width={980} centered>
            <div className="flex h-[68dvh] min-h-0 flex-col" data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                <Input size="large" prefix={<Search className="size-4 text-stone-400" />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("prompts.searchTitle")} />
                <div className="thin-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                    {query.isLoading ? <div className="flex h-40 items-center justify-center"><Spin /></div> : null}
                    {!query.isLoading && groups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("prompts.empty")} className="py-8" /> : null}
                    <Collapse
                        activeKey={expandedCategories}
                        onChange={(keys) => setExpandedCategories(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
                        bordered={false}
                        className="prompt-group-collapse"
                        items={groups.map((group) => ({
                            key: group.category,
                            label: (
                                <span className="flex min-w-0 items-center gap-2">
                                    <span className="min-w-0 truncate font-semibold text-stone-800 dark:text-stone-200">{group.category}</span>
                                    <Tag className="m-0 shrink-0 text-[11px]">{group.items.length}</Tag>
                                </span>
                            ),
                            children: (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                                        {group.items.map((item) => (
                                            <HoverPreview key={item.id} previewContent={<PromptPreview item={item} />}>
                                                <PromptCard item={item} onOpen={() => selectPrompt(item.prompt)} onCopy={() => selectPrompt(item.prompt)} compact />
                                            </HoverPreview>
                                        ))}
                                    </div>
                                    {query.hasNextPage ? (
                                        <div className="flex justify-center border-t border-stone-200/70 pt-3 dark:border-stone-800/70">
                                            <button type="button" className="rounded-md border border-stone-300 px-4 py-1.5 text-xs text-stone-600 transition hover:border-stone-500 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:text-white" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                                                {query.isFetchingNextPage ? "正在加载…" : "加载此分类的更多资产"}
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            ),
                        }))}
                    />
                </div>
            </div>
        </Modal>
    );
}

function PromptPreview({ item }: { item: Prompt }) {
    return (
        <div className="p-3">
            {item.coverUrl ? <img src={item.coverUrl} alt={item.title} className="mb-3 aspect-[4/3] w-full rounded-md object-cover" loading="lazy" /> : null}
            <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">{item.title}</div>
            <div className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs leading-5 text-stone-600 dark:text-stone-300">{item.prompt}</div>
            {item.tags.length ? <div className="mt-3 flex flex-wrap gap-1.5">{item.tags.map((tag) => <Tag key={tag} className="m-0 text-[11px]">{tag}</Tag>)}</div> : null}
        </div>
    );
}
