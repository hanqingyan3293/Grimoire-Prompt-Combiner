import { useMemo } from "react";
import { Modal } from "antd";
import { Puzzle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@canvas/lib/canvas-theme";
import { useThemeStore } from "@canvas/stores/use-theme-store";

const BUNDLED_PLUGINS = ["HTML", "Markdown", "3D 全景", "便利贴", "SVG"];

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const plugins = useMemo(() => BUNDLED_PLUGINS, []);

    return (
        <Modal title={t("canvas.plugins.title")} open={open} onCancel={onClose} footer={null} centered width={560}>
            <div className="space-y-2">
                <div className="mb-3 text-xs leading-5" style={{ color: theme.node.muted }}>
                    画布扩展已随魔导书本地内置，启动时不会加载远程插件或远程代码。
                </div>
                {plugins.map((name) => (
                    <div key={name} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                            <Puzzle className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium" style={{ color: theme.node.text }}>{name}</div>
                            <div className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>本地内置扩展</div>
                        </div>
                    </div>
                ))}
            </div>
        </Modal>
    );
}
