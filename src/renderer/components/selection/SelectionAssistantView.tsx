import React, { useEffect, useState } from 'react'
import { Copy, Check, ClipboardList, Loader2, X } from 'lucide-react'

// Floating selection assistant (M3). Lives in its own frameless always-on-top window opened by the global
// shortcut; the captured text stays in the main process and this view only asks for it and applies an
// action, so a compromised renderer cannot invent a "selection" to act on.
const ACTIONS: Array<{ id: SelectionActionId; label: string; icon: React.ElementType }> = [
  { id: 'copy-as-tags', label: '复制为标签语法', icon: ClipboardList },
  { id: 'copy-normalized', label: '复制为单行', icon: Copy },
  { id: 'to-prompt-asset', label: '存为提示词素材', icon: Check },
]

type SelectionActionId = 'copy-as-tags' | 'copy-normalized' | 'to-prompt-asset'

export function SelectionAssistantView() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const current = await window.api.selection.current()
      if (!cancelled) setText(current?.text ?? '')
    })()
    return () => { cancelled = true }
  }, [])

  const apply = async (id: SelectionActionId) => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await window.api.selection.apply(id)
      if (!result?.ok) setStatus(result?.error === 'EMPTY_SELECTION' ? '剪贴板里没有内容' : String(result?.error ?? '操作失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex h-screen w-screen flex-col gap-2 bg-[var(--color-bg-secondary)] p-3 text-[var(--color-text-primary)]'>
      <div className='flex items-center justify-between text-xs text-[var(--color-text-secondary)]'>
        <span className='truncate'>划词助手 · {text ? text.length + ' 字符' : '未捕获内容'}</span>
        <button type='button' aria-label='关闭' className='rounded p-1 hover:bg-[var(--color-hover)]' onClick={() => void window.api.selection.close()}><X size={14} /></button>
      </div>
      <pre className='max-h-24 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2 text-[11px] leading-relaxed'>{text || '先在任意应用里选中文字并复制，再按快捷键'}</pre>
      <div className='flex flex-wrap gap-1.5'>
        {ACTIONS.map(action => {
          const Icon = action.icon
          return (
            <button
              key={action.id}
              type='button'
              disabled={busy || !text}
              onClick={() => void apply(action.id)}
              className='ui-button ui-button-sm inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-50'
            >
              {busy ? <Loader2 size={13} className='animate-spin' /> : <Icon size={13} />}
              {action.label}
            </button>
          )
        })}
      </div>
      {status ? <div className='text-[11px] text-[var(--color-warning)]' role='alert'>{status}</div> : null}
    </div>
  )
}
