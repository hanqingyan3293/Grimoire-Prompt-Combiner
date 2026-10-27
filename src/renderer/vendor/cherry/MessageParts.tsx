import React, { useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bot, ChevronDown, ChevronRight, Copy, Download, FileText, Image as ImageIcon, Pencil, Quote, RotateCcw, ShieldAlert, Trash2, User, Wrench, X } from 'lucide-react'
import type { AiAttachmentRecord, AiMessageRecord, AiEventRecord } from '@shared/ai-types'
import type { AiMessagePart } from '@shared/ai-message-parts'
import { contentText, normalizeAiMessageParts } from '@shared/ai-message-parts'
import { replayAiEvents } from '@shared/ai-message-reducer'
import { IconButton, Button } from '../../components/ui/Button'
import { detectCherryHtmlArtifact } from '../../../integrations/cherry/markdown-artifacts'
import { getCherryHostBridge } from '../../services/cherry-host-bridge'

function partText(part: AiMessagePart) {
  if (typeof part.text === 'string') return part.text
  if (part.output !== undefined) return typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2)
  return ''
}

async function copyText(text: string) {
  try { await navigator.clipboard?.writeText(text) } catch { /* clipboard may be unavailable in tests */ }
}

function MarkdownContent({ value }: { value: string }) {
  const artifact = useMemo(() => detectCherryHtmlArtifact(value, false), [value])
  if (artifact) {
    return <div className="my-2 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-text-secondary)]"><span>Cherry HTML {artifact.kind === 'document' ? '文档' : '片段'}</span><span>源自 Vendor</span></div>
      <iframe title="HTML artifact preview" sandbox="allow-scripts" srcDoc={artifact.html} className="h-64 w-full bg-white" />
    </div>
  }
  return <div className="cherry-message-markdown prose prose-sm max-w-none break-words text-[var(--color-text-primary)] prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-pre:max-w-full prose-code:text-[var(--color-accent-text)]">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      pre: ({ children }: any) => <>{children}</>,
      code: ({ className, children, ...props }: any) => {
        const source = String(children).replace(/\n$/, '')
        const language = typeof className === 'string' ? className.match(/language-([\w-]+)/)?.[1] : undefined
        const block = Boolean(language || source.includes('\n'))
        if (!block) return <code className={className} {...props}>{children}</code>
        return <div className="my-2 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">
            <span className="min-w-0 flex-1 truncate">{language || 'code'}</span>
            <button type="button" className="ui-toolbar-button h-6 px-1.5" onClick={() => void copyText(source)} title="复制代码" aria-label="复制代码"><Copy size={12} /></button>
            <button type="button" className="ui-toolbar-button h-6 px-1.5" onClick={() => { const blob = new Blob([source], { type: 'text/plain;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'grimoire-code.' + (language || 'txt'); link.click(); URL.revokeObjectURL(link.href) }} title="下载代码" aria-label="下载代码"><Download size={12} /></button>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs"><code className={className} {...props}>{children}</code></pre>
        </div>
      },
    }}>{value}</ReactMarkdown>
  </div>
}

function Part({ part }: { part: AiMessagePart }) {
  const [open, setOpen] = useState(part.type === 'text' || part.type === 'error')
  const text = partText(part)
  if (part.type === 'text') return <MarkdownContent value={text} />
  if (part.type === 'reasoning') return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="rounded-lg border border-violet-500/25 bg-violet-500/5 text-xs"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-violet-600 dark:text-violet-300"><ChevronRight size={14} />思考过程</summary><div className="whitespace-pre-wrap px-3 pb-3 text-[var(--color-text-secondary)]">{text}</div></details>
  if (part.type === 'code') return <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs"><div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-[10px] text-[var(--color-text-secondary)]"><span className="min-w-0 flex-1 truncate">{part.language || 'code'}</span><button type="button" className="ui-toolbar-button h-6 px-1.5" onClick={() => void copyText(part.code || text)} aria-label="复制代码"><Copy size={12} /></button></div><pre className="max-h-96 overflow-auto whitespace-pre-wrap px-3 py-2 text-[11px]"><code>{part.code || text}</code></pre></div>
  if (part.type === 'tool-call' || part.type === 'tool-result') return <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-xs"><button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--color-text-secondary)]" onClick={() => setOpen(value => !value)} aria-expanded={open}><Wrench size={14} className="text-[var(--color-accent-text)]" /><span className="min-w-0 flex-1 truncate">{part.name || '工具调用'}{part.status ? ' · ' + part.status : ''}</span>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>{open && <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t border-[var(--color-border)] px-3 py-2 text-[10px] text-[var(--color-text-secondary)]">{JSON.stringify(part.type === 'tool-call' ? part.input : part.output, null, 2)}{part.error ? '\\n错误：' + part.error : ''}</pre>}</div>
  if (part.type === 'permission') return <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs"><div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300"><ShieldAlert size={14} />权限请求 · {part.permission || '需要确认'}</div>{part.detail !== undefined && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--color-text-secondary)]">{JSON.stringify(part.detail, null, 2)}</pre>}<div className="mt-1 text-[10px] text-[var(--color-text-secondary)]">状态：{part.status || 'pending'}</div></div>
  if (part.type === 'agent-status' || part.type === 'mcp') return <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-xs text-sky-700 dark:text-sky-300"><div className="font-semibold">{part.type === 'mcp' ? 'MCP 工具状态' : 'Agent 状态'}</div><div className="mt-1 whitespace-pre-wrap text-[var(--color-text-secondary)]">{text || part.status || JSON.stringify(part.metadata || {})}</div></div>
  if (part.type === 'image' && part.url) return <img src={part.url} alt={part.title || '消息图片'} className="max-h-80 max-w-full rounded-lg border border-[var(--color-border)] object-contain" />
  if (part.type === 'image' || part.type === 'file' || part.type === 'attachment') return <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs"><FileText size={14} className="text-[var(--color-accent-text)]" /><span className="min-w-0 flex-1 truncate">{part.fileName || part.title || part.attachmentId || '附件'}</span></div>
  if (part.type === 'error') return <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">{text}</div>
  if (part.type === 'citation') return <div className="rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-secondary)]">来源：{part.title || part.source || text}</div>
  return <div className="text-xs text-[var(--color-text-secondary)]">{text || part.status || ''}</div>
}

export function CherryAttachmentPreview({ attachment, onClose }: { attachment: AiAttachmentRecord; onClose: () => void }) {
  const [value, setValue] = useState<{ status: string; dataUrl?: string; text?: string } | null>(null)
  const [error, setError] = useState('')
  React.useEffect(() => { let active = true; void getCherryHostBridge().attachments.read(attachment.id).then(result => { if (active) setValue(result) }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '附件读取失败') }); return () => { active = false } }, [attachment.id])
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-5" role="dialog" aria-modal="true" aria-label={'预览附件 ' + attachment.original_name} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="flex max-h-[90vh] w-[min(900px,96vw)] flex-col overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-primary)] shadow-2xl">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 py-2"><FileText size={15} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.original_name}</span><IconButton icon={X} label="关闭附件预览" onClick={onClose} /></div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{error ? <div className="text-sm text-red-500">{error}</div> : !value ? <div className="text-sm text-[var(--color-text-secondary)]">读取中…</div> : value.status !== 'available' ? <div className="text-sm text-amber-500">附件不可用：{value.status}</div> : value.dataUrl && attachment.mime_type.startsWith('image/') ? <img src={value.dataUrl} alt={attachment.original_name} className="mx-auto max-h-[72vh] max-w-full object-contain" /> : value.dataUrl && attachment.mime_type === 'application/pdf' ? <iframe src={value.dataUrl} title={attachment.original_name} className="h-[72vh] w-full rounded border border-[var(--color-border)]" /> : <pre className="whitespace-pre-wrap break-words text-xs text-[var(--color-text-primary)]">{value.text || '此附件类型暂不支持内置预览，请使用原文件打开。'}</pre>}</div>
    </div>
  </div>
}

function MessageAttachment({ record, onPreview }: { record: AiAttachmentRecord; onPreview: (attachment: AiAttachmentRecord) => void }) {
  return <button type="button" onClick={() => onPreview(record)} className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-2 text-left text-xs hover:border-[var(--color-accent)]/60" title="预览附件"><FileText size={14} className="shrink-0 text-[var(--color-accent-text)]" /><span className="min-w-0 flex-1 truncate">{record.original_name}</span><span className="shrink-0 text-[10px] text-[var(--color-text-secondary)]">{record.status === 'available' ? '预览' : '失效'}</span></button>
}

function MessageImageAttachment({ imageId }: { imageId: number }) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState(false)
  React.useEffect(() => { let active = true; void getCherryHostBridge().context.images.readData(imageId).then(value => { if (active) setSrc(value) }).catch(() => { if (active) setError(true) }); return () => { active = false } }, [imageId])
  if (error) return <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-500">图片附件不可用（ID {imageId}）</div>
  if (!src) return <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]"><ImageIcon size={14} />读取图片附件…</div>
  return <a href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"><img src={src} alt={'图片附件 ' + imageId} className="max-h-72 max-w-full object-contain" /></a>
}

function MessageCard({ message, parts, attachments, retryId, onCopy, onEdit, onDelete, onRetry, onQuote }: { message: AiMessageRecord; parts: AiMessagePart[]; attachments: AiAttachmentRecord[]; retryId?: string; onCopy?: (text: string) => void; onEdit?: (id: string, text: string) => Promise<void> | void; onDelete?: (id: string) => Promise<void> | void; onRetry?: (id: string) => void; onQuote?: (text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => contentText(message.content))
  const [preview, setPreview] = useState<AiAttachmentRecord | null>(null)
  const text = parts.map(partText).join('')
  const linked = (message.attachments || []).map(item => typeof item === 'object' && item !== null ? String((item as Record<string, unknown>).attachmentId || '') : '').map(id => attachments.find(item => item.id === id)).filter((item): item is AiAttachmentRecord => Boolean(item))
  const linkedImages = (message.attachments || []).map(item => typeof item === 'object' && item !== null ? Number((item as Record<string, unknown>).imageId || 0) : 0).filter(imageId => Number.isInteger(imageId) && imageId > 0)
  return <>
    <article className={'group max-w-[94%] rounded-xl border px-4 py-3 shadow-sm ' + (message.role === 'user' ? 'ml-auto border-[var(--color-accent)]/25 bg-[var(--color-accent)]/10' : 'border-[var(--color-border)] bg-[var(--color-bg-primary)]')}>
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent-text)]"><span className={'grid size-6 shrink-0 place-items-center rounded-full ' + (message.role === 'user' ? 'bg-[var(--color-accent)]/15' : 'bg-[var(--color-bg-tertiary)]')}>{message.role === 'user' ? <User size={13} /> : <Bot size={13} />}</span><span className="flex-1">{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : message.role}</span><time className="font-normal normal-case tracking-normal text-[var(--color-text-secondary)]">{message.created_at ? new Date(message.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</time><div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">{onCopy && <IconButton icon={Copy} label="复制消息" className="h-6 w-6" onClick={() => onCopy(text)} />}{onQuote && <IconButton icon={Quote} label="引用消息" className="h-6 w-6" onClick={() => onQuote(text)} />}{message.role === 'user' && onEdit && <IconButton icon={Pencil} label="编辑消息" className="h-6 w-6" onClick={() => { setDraft(contentText(message.content)); setEditing(true) }} />}{message.role === 'assistant' && retryId && onRetry && <IconButton icon={RotateCcw} label="重试此回复" className="h-6 w-6" onClick={() => onRetry(retryId)} />}{onDelete && <IconButton icon={Trash2} label="删除消息" className="h-6 w-6 text-red-500" onClick={() => { if (window.confirm('确定删除这条消息吗？')) void onDelete(message.id) }} />}</div></div>
      {editing ? <div className="space-y-2"><textarea autoFocus className="ui-field min-h-24 w-full resize-y text-sm" value={draft} onChange={event => setDraft(event.target.value)} /><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>取消</Button><Button size="sm" variant="primary" onClick={async () => { await onEdit?.(message.id, draft); setEditing(false) }}>保存</Button></div></div> : <div className="space-y-2">{parts.map((part, index) => <Part key={part.id || message.id + '-' + index} part={part} />)}{linked.length > 0 && <div className="space-y-1 border-t border-[var(--color-border)] pt-2">{linked.map(item => <MessageAttachment key={item.id} record={item} onPreview={setPreview} />)}</div>}{linkedImages.length > 0 && <div className="space-y-2 border-t border-[var(--color-border)] pt-2">{linkedImages.map(imageId => <MessageImageAttachment key={imageId} imageId={imageId} />)}</div>}</div>}
    </article>
    {preview && <CherryAttachmentPreview attachment={preview} onClose={() => setPreview(null)} />}
  </>
}

export function CherryMessageList({ messages, events = [], streamingParts = [], attachments = [], onCopy, onEdit, onDelete, onRetry, onQuote }: { messages: AiMessageRecord[]; events?: AiEventRecord[]; streamingParts?: AiMessagePart[]; attachments?: AiAttachmentRecord[]; onCopy?: (text: string) => void; onEdit?: (id: string, text: string) => Promise<void> | void; onDelete?: (id: string) => Promise<void> | void; onRetry?: (id: string) => void; onQuote?: (text: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const rendered = useMemo(() => {
    const items = messages.map(message => ({ message, parts: normalizeAiMessageParts(message.content, message.role) }))
    const replayed = replayAiEvents(events).parts.filter(part => part.type !== 'status' || !['completed', 'compacted'].includes(part.status || ''))
    const lastAssistant = [...items].reverse().find(item => item.message.role === 'assistant')
    const eventParts = replayed.filter(part => !(part.type === 'text' || part.type === 'reasoning') || !lastAssistant)
    if (eventParts.length && items.length) items[items.length - 1] = { ...items[items.length - 1], parts: [...items[items.length - 1].parts, ...eventParts] }
    return items
  }, [messages, events])
  const useWindow = rendered.length > 250
  const estimate = 180
  const start = useWindow ? Math.max(0, Math.floor(scrollTop / estimate) - 8) : 0
  const end = useWindow ? Math.min(rendered.length, start + 34) : rendered.length
  const visible = rendered.slice(start, end)
  return <div ref={scrollRef} onScroll={event => { if (useWindow) setScrollTop(event.currentTarget.scrollTop) }} className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-5" aria-live="polite">{rendered.length === 0 && streamingParts.length === 0 ? <div className="flex h-full min-h-48 items-center justify-center text-center text-sm text-[var(--color-text-secondary)]"><div><div className="text-base font-semibold text-[var(--color-text-primary)]">开始新的 Agent 对话</div><div className="mt-1">支持 Markdown、代码块、工具调用和权限确认</div></div></div> : null}{useWindow && start > 0 && <div aria-hidden="true" style={{ height: start * estimate }} />}{visible.map(({ message, parts }, index) => { const absoluteIndex = start + index; const previousUser = message.role === 'assistant' ? [...rendered.slice(0, absoluteIndex)].reverse().find(item => item.message.role === 'user')?.message.id : undefined; return <MessageCard key={message.id} message={message} parts={parts} attachments={attachments} retryId={previousUser} onCopy={onCopy} onEdit={onEdit} onDelete={onDelete} onRetry={onRetry} onQuote={onQuote} /> })}{useWindow && end < rendered.length && <div aria-hidden="true" style={{ height: (rendered.length - end) * estimate }} />}{streamingParts.length > 0 && <article className="max-w-[94%] rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-bg-primary)] px-4 py-3 shadow-sm"><div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent-text)]">assistant · streaming</div><div className="space-y-2">{streamingParts.map((part, index) => <Part key={part.id || 'stream-' + index} part={part} />)}</div></article>}</div>
}

export function CherryAttachmentChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return <div className="inline-flex max-w-56 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]"><FileText size={12} /><span className="truncate">{name}</span>{onRemove && <button type="button" onClick={onRemove} aria-label={'移除附件 ' + name} className="ml-1 rounded p-0.5 hover:bg-[var(--color-bg-tertiary)]"><X size={12} /></button>}</div>
}
