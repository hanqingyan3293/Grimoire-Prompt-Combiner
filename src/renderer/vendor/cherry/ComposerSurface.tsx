import { Braces, Eraser, Eye, Paperclip, Send, Square, WandSparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import type { AiAttachmentRecord } from '@shared/ai-types'
import { CherryAttachmentChip, CherryAttachmentPreview } from './MessageParts'

export function CherryComposer({ value, onChange, onSend, onStop, busy, attachments = [], onAttach, onRemoveAttachment, onOpenContext, onOpenTools, modelLabel }: { value: string; onChange: (value: string) => void; onSend: () => void; onStop?: () => void; busy: boolean; attachments?: AiAttachmentRecord[]; onAttach?: () => void; onRemoveAttachment?: (id: string) => void; onOpenContext?: () => void; onOpenTools?: () => void; modelLabel?: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState<AiAttachmentRecord | null>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = Math.min(220, Math.max(88, textarea.scrollHeight)) + 'px'
  }, [value])

  return <>
    <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3">
      <div className="mx-auto max-w-5xl rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-bg-primary)] shadow-sm focus-within:border-[var(--color-accent)]/60 focus-within:shadow-[0_0_0_3px_var(--color-accent)]/10">
        {attachments.length > 0 && <div className="flex flex-wrap gap-1.5 px-3 pt-2">{attachments.map(attachment => <div key={attachment.id} className="group relative"><CherryAttachmentChip name={attachment.original_name} onRemove={onRemoveAttachment ? () => onRemoveAttachment(attachment.id) : undefined} /><button type="button" onClick={() => setPreview(attachment)} className="absolute inset-y-0 right-5 hidden items-center rounded-r-md px-1 text-[var(--color-accent-text)] group-hover:flex" aria-label={'预览附件 ' + attachment.original_name} title="预览附件"><Eye size={12} /></button></div>)}</div>}
        <textarea ref={textareaRef} className="min-h-[88px] w-full resize-none overflow-auto border-0 bg-transparent px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]" value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey) return
          if (event.ctrlKey || event.metaKey || !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSend()
          }
        }} placeholder="给 Agent 发送消息…" aria-label="Agent 消息输入框" />
        <div className="flex items-center gap-1 border-t border-[var(--color-border)] px-3 py-2">
          <button type="button" className="ui-toolbar-button" onClick={onAttach} aria-label="添加附件" title="添加附件"><Paperclip size={15} /></button>
          <button type="button" className="ui-toolbar-button" onClick={onOpenContext} aria-label="插入上下文" title="插入上下文"><Braces size={15} /></button>
          <button type="button" className="ui-toolbar-button" onClick={onOpenTools} aria-label="Agent 工具" title="Agent 工具"><WandSparkles size={15} /></button>
          <button type="button" className="ui-toolbar-button" onClick={() => onChange('')} disabled={!value} aria-label="清空输入" title="清空输入"><Eraser size={15} /></button>
          <span className="ml-1 min-w-0 flex-1 truncate text-[10px] text-[var(--color-text-secondary)]">{modelLabel || '未选择模型'} · Enter 发送 · Shift+Enter 换行</span>
          {busy && onStop ? <Button size="sm" variant="secondary" icon={Square} onClick={onStop}>停止</Button> : <Button size="sm" variant="primary" icon={Send} onClick={onSend} disabled={busy || !value.trim()}>发送</Button>}
        </div>
      </div>
    </div>
    {preview && <CherryAttachmentPreview attachment={preview} onClose={() => setPreview(null)} />}
  </>
}
