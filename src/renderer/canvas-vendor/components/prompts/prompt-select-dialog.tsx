import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Collapse, Empty, Input, Modal, Spin, Tag } from "antd";
import { useTranslation } from "react-i18next";

import { useGroupedPromptList } from "./use-prompt-list";
import { PromptCard } from "./prompt-card";

export function PromptSelectDialog({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const { query, groups } = useGroupedPromptList({ keyword, enabled: open });
    const selectPrompt = (prompt: string) => {
        onSelect(prompt);
        onOpenChange(false);
    };

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : t("prompts.loadFailed"));
    }, [message, query.error, query.isError, t]);

    return (
        <Modal title={t("prompts.library")} open={open} onCancel={() => onOpenChange(false)} footer={null} width={880} centered>
            <div className="grid h-[62dvh] min-h-0 gap-5" data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                <section className="flex min-h-0 min-w-0 flex-col">
                    <Input size="large" prefix={<Search className="size-4 text-stone-400" />} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t("prompts.searchTitle")} />
                    <div className="thin-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-2">
                        {query.isLoading ? (
                            <div className="flex h-40 items-center justify-center">
                                <Spin />
                            </div>
                        ) : null}
                        {!query.isLoading && groups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("prompts.empty")} className="py-8" /> : null}
                        <Collapse
                            defaultActiveKey={groups.map((group) => group.category)}
                            bordered={false}
                            items={groups.map((group) => ({
                                key: group.category,
                                label: (
                                    <span className="flex items-center gap-2">
                                        <span className="font-semibold text-stone-800 dark:text-stone-200">{group.category}</span>
                                        <Tag className="m-0 text-[11px]">{group.items.length}</Tag>
                                    </span>
                                ),
                                children: (
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                        {group.items.map((item) => (
                                            <PromptCard key={item.id} item={item} onOpen={() => selectPrompt(item.prompt)} onCopy={() => selectPrompt(item.prompt)} compact />
                                        ))}
                                    </div>
                                ),
                            }))}
                        />
                    </div>
                </section>
            </div>
        </Modal>
    );
}
