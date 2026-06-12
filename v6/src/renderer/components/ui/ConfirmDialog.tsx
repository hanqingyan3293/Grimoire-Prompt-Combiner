import React from "react"
import { useI18n } from "../../i18n/context"

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "danger" | "warning" | "info"
  onConfirm: () => void
  onCancel: () => void
}

const ICONS: Record<string, string> = {
  danger: "⚠️",
  warning: "⚠️",
  info: "ℹ️",
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open, title, message,
  confirmLabel, cancelLabel,
  variant = "info",
  onConfirm, onCancel,
}) => {
  const { t } = useI18n()

  if (!open) return null

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          padding: 24,
          minWidth: 360,
          maxWidth: 480,
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 28, flexShrink: 0 }}>{ICONS[variant] || ICONS.info}</span>
          <div>
            <h3 style={{
              fontSize: 15, fontWeight: 600,
              color: "var(--color-text-primary)",
              margin: "0 0 4px 0",
            }}>{title}</h3>
            <p style={{
              fontSize: 13, lineHeight: 1.5,
              color: "var(--color-text-secondary)",
              margin: 0,
            }}>{message}</p>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            className="ps-btn ps-btn--sm"
            style={{ minWidth: 72 }}
          >
            {cancelLabel || t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className={"ps-btn ps-btn--sm" + (variant === "danger" ? " ps-btn--danger" : " ps-btn--primary")}
            style={{ minWidth: 72 }}
          >
            {confirmLabel || t("common.yes")}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
