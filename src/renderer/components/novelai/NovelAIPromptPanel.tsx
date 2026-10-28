import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FileDown, FileUp, GitBranch, History, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { parsePromptDocument, type PromptBlock } from '../../../shared/prompt-blocks'
import { diffPromptVersions } from '../../../shared/prompt-diff'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState, PanelHeader } from '../ui/Feedback'

// NovelAI prompt workbench (M6 UI). The data rules (branching, revisions, recycle bin) live in
// the main-process service and are covered by tests; this component only presents them, and it
// parses the draft with the same pure parser so the block list can never disagree with the text.
type Work = { id: string; name: string; lastVersionId: string | null; revision: number; updatedAt?: string; lastUsedAt: string }
type Version = { id: string; workId: string; parentId: string | null; number: number; branchId: string; branchNumber: number; snapshot: string; source: 'user' | 'agent'; operation: string; createdAt: string; deletedAt: string | null }
type Branch = { id: string; name: string | null; branchNumber: number; number: number; tipVersionId: string; tipNumber: number; size: number }
type Bundle = { work: Work; line: Version[]; branchName: string | null; deleted: Version[]; branches: Branch[] }

const TYPE_LABEL: Record<PromptBlock['type'], string> = { tags: '标签块', paragraph: '段落块', random: '随机块' }
const TYPE_TONE: Record<PromptBlock['type'], 'neutral' | 'accent' | 'warning'> = { tags: 'accent', paragraph: 'neutral', random: 'warning' }

function weightLabel(block: PromptBlock): string | null {
  if (!block.weight) return null
  if (block.weight.kind === 'numeric') return '权重 ' + block.weight.value
  return (block.weight.kind === 'increase' ? '+' : '−') + Math.round(block.weight.value * 100) + '%'
}

export function NovelAIPromptPanel() {
  const [works, setWorks] = useState<Work[]>([])
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [draft, setDraft] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [newWorkName, setNewWorkName] = useState('')
  const [branchName, setBranchName] = useState('')
  // Saving from an older version is how a branch is started: the service forks when the parent
  // already has a child, so the UI only has to remember which version to branch from.
  const [branchFrom, setBranchFrom] = useState<Version | null>(null)
  // Assets are recorded against images and a version links to images, so this list is derived
  // server-side instead of being stored twice.
  const [versionAssets, setVersionAssets] = useState<Array<{ imageId: string; asset: { id: string; name: string } }>>([])
  // Diff against an older version: computed locally from the two snapshots, so no extra round trip and
  // no server-side state to keep in sync.
  const [compareBase, setCompareBase] = useState<Version | null>(null)
  // Recycle-bin multi-select: batch restore/delete is one user action and one revision bump.
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const api = (typeof window !== 'undefined' ? (window as unknown as { api?: { novelai?: Record<string, (...args: unknown[]) => Promise<unknown>> } }).api?.novelai : undefined)
  const metadataApi = (typeof window !== 'undefined' ? (window as unknown as { api?: { novelai?: { metadata?: { exportTo: (params: Record<string, unknown>) => Promise<{ canceled?: boolean; writtenPath?: string; error?: string }>; readFrom: () => Promise<{ canceled?: boolean; decoded?: { params: { prompt: string } } | null }> } } } }).api?.novelai?.metadata : undefined)

  const loadBundle = useCallback(async (workId: string, branchId?: string) => {
    if (!api) return
    const next = await api.bundle(branchId ? { workId, branchId } : { workId }) as Bundle | null
    setBundle(next)
    if (next) {
      const tip = next.line[next.line.length - 1]
      setSelectedVersionId(tip ? tip.id : null)
      setDraft(tip ? tip.snapshot : '')
      setBranchName(next.branchName ?? '')
    }
  }, [api])

  const refreshWorks = useCallback(async () => {
    if (!api) return
    const list = await api.listWorks() as Work[]
    setWorks(list ?? [])
    if (!bundle && list?.length) await loadBundle(list[0].id)
  }, [api, bundle, loadBundle])

  useEffect(() => { void refreshWorks().catch(cause => setError(String(cause))) }, [refreshWorks])

  const blocks = useMemo(() => parsePromptDocument(draft).blocks, [draft])
  const current = bundle?.line.find(version => version.id === selectedVersionId) ?? null
  const dirty = !!current && draft !== current.snapshot

  const createWork = async () => {
    if (!api || !newWorkName.trim()) return
    setBusy(true); setError(null)
    try {
      const created = await api.createWork({ name: newWorkName.trim(), snapshot: draft }) as { work: Work }
      setNewWorkName('')
      await refreshWorks()
      await loadBundle(created.work.id)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const saveVersion = async () => {
    if (!api || !bundle || !current) return
    setBusy(true); setError(null)
    try {
      await api.createVersion({ workId: bundle.work.id, parentVersionId: (branchFrom ?? current).id, snapshot: draft, expectedRevision: bundle.work.revision, operation: branchFrom ? '开分支' : '编辑' })
      setBranchFrom(null)
      await loadBundle(bundle.work.id)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const deleteVersion = async (mode: 'single' | 'branch') => {
    if (!api || !bundle || !current) return
    setBusy(true); setError(null)
    try {
      await api.deleteVersion({ workId: bundle.work.id, versionId: current.id, mode, expectedRevision: bundle.work.revision })
      await loadBundle(bundle.work.id)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const restore = async (versionId: string) => {
    if (!api || !bundle) return
    setBusy(true); setError(null)
    try { await api.restoreVersion(versionId); await loadBundle(bundle.work.id) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const exportMetadata = async () => {
    if (!metadataApi) return
    setBusy(true); setError(null)
    try {
      const result = await metadataApi.exportTo({ prompt: draft, model: 'novelai' })
      if (result?.error) setError('导出失败：' + result.error)
      else if (!result?.canceled) setNotice('已写入 ' + (result?.writtenPath ?? ''))
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const importMetadata = async () => {
    if (!metadataApi) return
    setBusy(true); setError(null)
    try {
      const result = await metadataApi.readFrom()
      if (result?.canceled) return
      if (!result?.decoded) { setError('这张图没有生成参数'); return }
      setDraft(result.decoded.params.prompt)
      setNotice('已从 PNG 读取参数')
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  // The active branch is the one the visible line ends on; the list comes from the same bundle call.
  // `branches` is optional: an older main process (or stale built bundle) returns a payload without
  // it, and a crash here took the whole panel down instead of just hiding the branch row.
  const branches = bundle?.branches ?? []
  const activeBranch = current ? branches.find(branch => branch.id === current.branchId) ?? null : null

  useEffect(() => {
    if (!api || !current) { setVersionAssets([]); return }
    let alive = true
    void (api.byVersion as ((id: string) => Promise<Array<{ imageId: string; asset: { id: string; name: string } }>>) | undefined)?.(current.id)
      .then(list => { if (alive) setVersionAssets(list ?? []) })
      .catch(() => { if (alive) setVersionAssets([]) })
    return () => { alive = false }
  }, [api, current?.id])

  const comparison = compareBase && current ? diffPromptVersions(compareBase.snapshot, current.snapshot) : null

  const togglePick = (id: string) => setPicked(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])

  const restorePicked = async () => {
    if (!api || !bundle || !picked.length) return
    setBusy(true); setError(null)
    try { await api.restoreVersions(picked); setPicked([]); await loadBundle(bundle.work.id) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  // The label says 永久删除, so it must actually purge. The previous handler called the SOFT delete and
  // left the rows in the recycle bin — the button promised something it did not do.
  const purgePicked = async () => {
    if (!api || !bundle || !picked.length) return
    setBusy(true); setError(null)
    try { await api.purgeVersions(picked); setPicked([]); await loadBundle(bundle.work.id) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  const renameBranch = async () => {
    if (!api || !bundle || !current || !branchName.trim()) return
    setBusy(true); setError(null)
    try { await api.renameBranch({ workId: bundle.work.id, branchId: current.branchId, name: branchName.trim() }); await loadBundle(bundle.work.id) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="提示词工作台" description="块解析 · 版本树 · 回收站（M6）" icon={GitBranch} />
      {/* Wrap instead of squeezing: a narrow panel used to shrink the middle column to a sliver
          and render every label vertically. */}
      <div className="flex min-h-0 flex-1 flex-wrap">
        <aside className="flex w-44 min-w-[9rem] shrink-0 flex-col gap-2 border-r border-[var(--color-border)] p-2">
          <div className="flex gap-1">
            <input value={newWorkName} onChange={event => setNewWorkName(event.target.value)} placeholder="新作品名" className="ui-field min-w-0 flex-1 px-2 py-1 text-xs" />
            <Button size="sm" variant="secondary" onClick={() => void createWork()} disabled={busy || !newWorkName.trim()} aria-label="新建作品"><Plus size={14} /></Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {works.length === 0 && <p className="p-2 text-xs text-[var(--color-text-secondary)]">还没有作品</p>}
            {works.map(work => (
              <button key={work.id} type="button" onClick={() => void loadBundle(work.id)}
                className={'ui-nav-tab block w-full overflow-hidden text-ellipsis whitespace-nowrap px-2 py-1.5 text-left text-xs ' + (bundle?.work.id === work.id ? 'ui-nav-tab-active' : '')}>
                {work.name}
              </button>
            ))}
          </div>
        </aside>
        <main className="flex min-h-0 min-w-[18rem] flex-1 flex-col">
          {!bundle ? (
            <EmptyState icon={GitBranch} title="选择或新建一个作品" description="每个作品有自己的版本线；回到旧版再改会自动拉分支。" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
                <span className="text-sm font-medium">{bundle.work.name}</span>
                <Badge tone="neutral">r{bundle.work.revision}</Badge>
                <input value={branchName} onChange={event => setBranchName(event.target.value)} placeholder="分支名" className="ui-field w-24 min-w-0 shrink px-2 py-1 text-xs" />
                <Button size="sm" variant="ghost" onClick={() => void renameBranch()} disabled={busy || !branchName.trim()}>命名分支</Button>
                {bundle && branches.length > 1 && (
                  <span className="flex flex-wrap items-center gap-1" aria-label="分支列表">
                    <span className="text-[11px] text-[var(--color-text-secondary)]">分支：</span>
                    {branches.map(branch => (
                      <button
                        key={branch.id}
                        type="button"
                        onClick={() => void loadBundle(bundle.work.id, branch.id)}
                        title={'分支 ' + branch.branchNumber + ' · ' + branch.size + ' 个版本（起于 v' + branch.number + '）'}
                        className={'rounded border px-1.5 py-0.5 text-[11px] ' + (activeBranch && activeBranch.id === branch.id ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')}
                      >
                        {branch.name || '分支 ' + branch.branchNumber}
                        <span className="ml-1 opacity-60">b{branch.branchNumber} · {branch.size} 版</span>
                      </button>
                    ))}
                  </span>
                )}
                <span className="ml-auto flex flex-wrap gap-1">
                  <Button size="sm" variant="primary" icon={Save} onClick={() => void saveVersion()} disabled={busy || !dirty}>保存为新版本</Button>
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void deleteVersion('single')} disabled={busy}>删此版本</Button>
                  <Button size="sm" variant="ghost" onClick={() => void deleteVersion('branch')} disabled={busy}>删整条分支</Button>
                  {branchFrom && (
                    <span className="flex items-center gap-1 text-[11px] text-[var(--color-accent-text)]">
                      将从 v{branchFrom.number} 开新分支
                      <button type="button" className="underline" onClick={() => setBranchFrom(null)}>取消</button>
                    </span>
                  )}
                  <Button size="sm" variant="ghost" icon={FileDown} onClick={() => void exportMetadata()} disabled={busy}>参数写入 PNG</Button>
                  <Button size="sm" variant="ghost" icon={FileUp} onClick={() => void importMetadata()} disabled={busy}>从 PNG 读取</Button>
                </span>
              </div>
              <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 w-1/2 flex-col gap-2 p-3">
                  <textarea value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false}
                    className="ui-field min-h-0 flex-1 resize-none px-2 py-2 font-mono text-xs" aria-label="提示词原文" />
                  <div className="text-[11px] text-[var(--color-text-secondary)]">共 {blocks.length} 块{dirty ? ' · 有未保存修改' : ''}</div>
                </div>
                <div className="flex min-h-0 w-1/2 flex-col gap-1 overflow-auto border-l border-[var(--color-border)] p-3">
                  {blocks.map((block, index) => (
                    <div key={index} className="flex flex-col gap-1 rounded px-2 py-1 text-xs odd:bg-[var(--color-bg-secondary)]">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[var(--color-text-secondary)]">{index + 1}</span>
                        <Badge tone={TYPE_TONE[block.type]}>{TYPE_LABEL[block.type]}</Badge>
                        {weightLabel(block) && <span className="text-[11px] text-[var(--color-text-secondary)]">{weightLabel(block)}</span>}
                      </span>
                      <span className="break-words font-mono leading-snug">{block.raw}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-[var(--color-border)] px-3 py-2">
                <div className="mb-1 flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)]"><History size={12} /> 当前这条线（{bundle.line.length} 版）</div>
                {current && (
                  <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
                    <span>这版用到的素材：</span>
                    {versionAssets.length === 0 ? <span>暂无</span> : versionAssets.map(item => (
                      <span key={item.asset.id + item.imageId} className="rounded border border-[var(--color-border)] px-1.5 py-0.5">{item.asset.name} · {item.imageId}</span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {bundle.line.map(version => (
                    <span key={version.id} className="inline-flex items-center gap-0.5">
                      <button type="button" onClick={() => { setSelectedVersionId(version.id); setDraft(version.snapshot) }}
                        className={'rounded border px-2 py-0.5 text-[11px] ' + (version.id === selectedVersionId ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]')}>
                        v{version.number} · {version.operation || '编辑'} · b{version.branchNumber}
                      </button>
                      <button type="button" title={'以 v' + version.number + ' 为基准对比'} aria-label={'对比 v' + version.number}
                        onClick={() => setCompareBase(compareBase?.id === version.id ? null : version)}
                        className={'rounded border px-1 py-0.5 text-[10px] ' + (compareBase?.id === version.id ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]' : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)]')}>
                        对比
                      </button>
                      <button type="button" title={'从 v' + version.number + ' 开新分支'} aria-label={'从 v' + version.number + ' 开新分支'}
                        onClick={() => { setBranchFrom(version); setSelectedVersionId(version.id); setDraft(version.snapshot) }}
                        className={'rounded border px-1 py-0.5 text-[10px] ' + (branchFrom?.id === version.id ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]' : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border)]')}>
                        开分支
                      </button>
                    </span>
                  ))}
                </div>
                {comparison && compareBase && current && (
                  <div className="mt-2 rounded border border-[var(--color-border)] p-2 text-[11px]" aria-label="版本对比">
                    <div className="text-[var(--color-text-secondary)]">v{compareBase.number} → v{current.number}：{comparison.summary}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {comparison.added.map(item => <span key={'a' + item.text} className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[var(--color-success)]">+ {item.text}</span>)}
                      {comparison.removed.map(item => <span key={'r' + item.text} className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[var(--color-danger)]">- {item.text}</span>)}
                      {comparison.reweighted.map(item => <span key={'w' + item.text} className="rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">~ {item.text} {item.before}→{item.after}</span>)}
                    </div>
                  </div>
                )}
                {bundle.deleted.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
                    回收站：
                    {bundle.deleted.map(version => (
                      <span key={version.id} className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-1.5 py-0.5">
                        <input type="checkbox" aria-label={'选择 v' + version.number} checked={picked.includes(version.id)} onChange={() => togglePick(version.id)} />
                        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void restore(version.id)} disabled={busy}>v{version.number}</Button>
                      </span>
                    ))}
                    {bundle.deleted.length > 1 && (
                      <span className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setPicked(bundle.deleted.map(version => version.id))} disabled={busy}>全选</Button>
                        <Button size="sm" variant="ghost" onClick={() => void restorePicked()} disabled={busy || !picked.length}>恢复选中（{picked.length}）</Button>
                        <Button size="sm" variant="ghost" onClick={() => void purgePicked()} disabled={busy || !picked.length}>永久删除选中</Button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          {error && <p role="alert" className="px-3 pb-2 text-xs text-[var(--color-danger)]">{error}</p>}
          {notice && <p className="px-3 pb-2 text-xs text-[var(--color-text-secondary)]">{notice}</p>}
        </main>
      </div>
    </div>
  )
}
