import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Image, LoaderCircle, Palette, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, ProgressBar, StatusBadge } from '../ui/Feedback'

type Appearance = 'light' | 'dark'
type ThemeKey = 'neon' | 'clean' | 'gold' | 'midnight' | 'sakura' | 'forest' | 'sunset'

const THEMES: Array<{ key: ThemeKey; label: string; color: string }> = [
  { key: 'neon', label: '霓虹', color: '#a855f7' },
  { key: 'clean', label: '澄蓝', color: '#3b82f6' },
  { key: 'gold', label: '金色', color: '#f59e0b' },
  { key: 'midnight', label: '靛蓝', color: '#6366f1' },
  { key: 'sakura', label: '樱花', color: '#ec4899' },
  { key: 'forest', label: '森林', color: '#22c55e' },
  { key: 'sunset', label: '日落', color: '#f97316' },
]

function readInitialState(): { appearance: Appearance; theme: ThemeKey } {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const appearance = params.get('appearance') === 'dark' ? 'dark' : 'light'
  const requestedTheme = params.get('theme')
  const theme = THEMES.some(item => item.key === requestedTheme) ? requestedTheme as ThemeKey : 'neon'
  return { appearance, theme }
}

export function ThemePreview() {
  const initial = useMemo(readInitialState, [])
  const [appearance, setAppearance] = useState<Appearance>(initial.appearance)
  const [theme, setTheme] = useState<ThemeKey>(initial.theme)
  const selectedTheme = THEMES.find(item => item.key === theme) || THEMES[0]

  useEffect(() => {
    document.documentElement.setAttribute('data-appearance', appearance)
    document.documentElement.setAttribute('data-appearance-mode', appearance)
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.removeProperty('--color-accent')
    document.documentElement.style.removeProperty('--color-accent-hover')
  }, [appearance, theme])

  return (
    <main className='theme-preview min-h-screen overflow-auto bg-[var(--color-bg-primary)] p-4 text-[var(--color-text-primary)] sm:p-6' data-testid='theme-preview' data-appearance={appearance} data-theme-key={theme}>
      <div className='mx-auto max-w-6xl space-y-4'>
        <PanelHeader
          icon={Palette}
          title='设计系统视觉验收'
          description='固定数据样本，不访问数据库或外部服务'
          actions={<Badge tone='accent'>{appearance === 'dark' ? '深色' : '浅色'} · {selectedTheme.label}</Badge>}
        />

        <section className='ui-list-card ui-list-card-no-hover grid gap-4 p-3 lg:grid-cols-[220px_1fr]'>
          <fieldset>
            <legend className='mb-2 text-xs font-medium text-[var(--color-text-secondary)]'>外观</legend>
            <div className='ui-segmented grid grid-cols-2'>
              {(['light', 'dark'] as const).map(value => <button key={value} className={`ui-segmented-item ${appearance === value ? 'ui-segmented-item-active' : ''}`} aria-pressed={appearance === value} onClick={() => setAppearance(value)}>{value === 'light' ? '浅色' : '深色'}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend className='mb-2 text-xs font-medium text-[var(--color-text-secondary)]'>七种强调色</legend>
            <div className='grid grid-cols-4 gap-2 sm:grid-cols-7'>
              {THEMES.map(item => <button key={item.key} className={`ui-theme-preview-choice ${theme === item.key ? 'ui-theme-preview-choice-active' : ''}`} aria-label={item.label} aria-pressed={theme === item.key} onClick={() => setTheme(item.key)}><span style={{ backgroundColor: item.color }} /><small>{item.label}</small></button>)}
            </div>
          </fieldset>
        </section>

        <div className='grid gap-4 lg:grid-cols-2'>
          <section className='space-y-3'>
            <h2 className='text-sm font-semibold'>控件与状态</h2>
            <div className='ui-list-card ui-list-card-no-hover space-y-4 p-4'>
              <div className='flex flex-wrap gap-2'>
                <Button variant='primary' icon={CheckCircle2}>主要操作</Button>
                <Button icon={RefreshCw}>次要操作</Button>
                <Button variant='ghost'>弱操作</Button>
                <Button variant='danger' icon={Trash2}>危险操作</Button>
                <IconButton icon={Search} label='搜索' />
                <Button disabled>禁用状态</Button>
              </div>
              <div className='flex flex-wrap gap-2'>
                <StatusBadge tone='success'>运行正常</StatusBadge>
                <StatusBadge tone='warning'>需要处理</StatusBadge>
                <StatusBadge tone='danger'>执行失败</StatusBadge>
                <StatusBadge tone='accent'>运行中</StatusBadge>
                <Badge>普通标签</Badge>
              </div>
              <label className='block text-xs text-[var(--color-text-secondary)]'>搜索字段<input className='ui-field mt-1' defaultValue='long-model-name-that-must-not-break-the-layout-v2.safetensors' /></label>
              <label className='block text-xs text-[var(--color-text-secondary)]'>选项<select className='ui-field mt-1' defaultValue='current'><option value='current'>当前主题选项</option></select></label>
              <ProgressBar value={0.68} label='视觉验收任务进度' />
              <div className='ui-inline-note ui-inline-note-success text-xs'><CheckCircle2 size={15} aria-hidden='true' />保存成功，状态可被清晰识别</div>
              <div className='ui-inline-note ui-inline-note-warning text-xs'><AlertTriangle size={15} aria-hidden='true' />工作流包含未识别节点，但原始数据仍会保留</div>
              <div className='ui-inline-note ui-inline-note-danger text-xs' role='alert'><AlertTriangle size={15} aria-hidden='true' />连接失败，请检查本地服务地址</div>
            </div>
          </section>

          <section className='space-y-3'>
            <h2 className='text-sm font-semibold'>列表、加载与空态</h2>
            <div className='space-y-2'>
              <article className='ui-list-card flex items-center justify-between gap-3 p-3'>
                <div className='min-w-0'><div className='truncate text-sm font-medium'>wd-vit-large-tagger-v3.onnx</div><div className='mt-1 truncate text-xs text-[var(--color-text-secondary)]'>D:/models/a-very-long-directory-name-used-for-overflow-validation/model.onnx</div></div>
                <StatusBadge tone='success'>模型就绪</StatusBadge>
              </article>
              <article className='ui-list-card p-3'>
                <div className='flex items-start justify-between gap-3'><div className='min-w-0'><div className='truncate text-sm font-medium'>ComfyUI 生成任务</div><div className='mt-1 text-xs text-[var(--color-text-secondary)]'>task_01J8LONGIDENTIFIERFORLAYOUTCHECK</div></div><Button size='sm'>取消</Button></div>
                <div className='mt-3'><ProgressBar value={0.42} label='生成任务进度' /></div>
              </article>
              <div className='ui-empty-state flex-col gap-2 text-sm' role='status'><LoaderCircle size={20} className='ui-spin text-[var(--color-accent)]' aria-hidden='true' />正在加载资源</div>
              <EmptyState icon={Image} title='没有可用图片' description='导入图片后可用于反推提示词、画布编排和生成参考' />
            </div>
          </section>
        </div>

        <section className='ui-list-card ui-list-card-no-hover p-4'>
          <h2 className='text-sm font-semibold'>布局边界样本</h2>
          <div className='mt-3 grid min-w-0 gap-3 sm:grid-cols-3'>
            {['提示词组合与权重控制', '资源库托管副本与外部链接状态', '这是用于验证超长中文字段不会遮挡后续按钮或突破容器宽度的固定文本样本'].map(label => <div key={label} className='min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3'><div className='break-words text-sm font-medium'>{label}</div><div className='mt-2 text-xs text-[var(--color-text-secondary)]'>正文与边框应在两种外观和七种强调色中保持稳定。</div></div>)}
          </div>
        </section>
      </div>
    </main>
  )
}
