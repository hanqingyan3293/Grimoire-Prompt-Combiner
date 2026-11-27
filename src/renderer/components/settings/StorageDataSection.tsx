// 设置 → 数据 → 数据存储（P1.5：三级结构 + 悬停详情）。
//
// 结构：域（默认展开）→ 子组（默认折叠，头部显示条目数与体积）→ 条目。
// 之所以要子组：标签域 13 项、AI 域 25 项，二级列表一屏放不下，用户找不到东西。
//
// 约束：
//  * 数据来自主进程注册表（storage-registry），组件不硬编码表名/路径。
//  * bytes === null 渲染为「—」，绝不显示 0 —— 0 与未知是两件事。
//  * 窄容器（<780px）两行布局，宽度用 ResizeObserver 量自身（G9 禁止面板内用 sm:/md:）。
//  * P1.5 仍只暴露已实现的操作（打开目录 / 复制路径）；导出/迁移等按钮等 P2–P5 实现后再出现。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, FolderOpen, HardDrive, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button, IconButton } from '../ui/Button'
import { StorageEntryCard } from './StorageEntryCard'
import { StorageTransferActions } from './StorageTransferActions'
import { formatStorageBytes, type StorageDomain, type StorageEntry, type StorageInventory } from '../../../shared/storage-types'
import type { BootMetrics } from '../../../main/services/boot-metrics.service'

const DOMAIN_ACCENT: Record<StorageDomain, string> = {
  tags: 'var(--color-accent)',
  prompts: 'var(--color-info)',
  assets: 'var(--color-success)',
  media: 'var(--color-warning)',
  workspace: '#8b5cf6',
  ai: '#0ea5e9',
  runtime: 'var(--color-text-secondary)',
  other: 'var(--color-border-strong)',
}

const HOVER_DELAY_MS = 400

/** 启动阶段的中文名；顺序即 index.ts 里的打点顺序。 */
const BOOT_PHASE_LABELS: Record<string, string> = {
  'app-ready': '应用就绪',
  'db-ready': '数据库',
  'ipc-ready': '接口',
  'tags-seeded': '标签种子',
  'window-created': '窗口',
  'renderer-paint': '首帧',
}

export function StorageDataSection() {
  const [inventory, setInventory] = useState<StorageInventory | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsedDomains, setCollapsedDomains] = useState<Record<string, boolean>>({})
  const [openSubgroups, setOpenSubgroups] = useState<Record<string, boolean>>({})
  const [compact, setCompact] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [hover, setHover] = useState<{ entry: StorageEntry; x: number; y: number } | null>(null)
  const [boot, setBoot] = useState<BootMetrics | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const hoverTimer = useRef<number | null>(null)

  const load = useCallback(async (mode: 'load' | 'refresh') => {
    const api = window.api?.storage
    if (!api) { setError('当前窗口未加载存储接口，请完全重启应用'); return }
    if (mode === 'load') setLoading(true)
    else setRefreshing(true)
    try {
      const result = (mode === 'load' ? await api.inventory() : await api.scanSizes()) as StorageInventory
      setInventory(result)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取数据清单失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load('load') }, [load])

  // 启动耗时是诊断信息：拿不到就整行不显示，不留「—」占位。
  useEffect(() => {
    let disposed = false
    void window.api?.boot?.metrics?.().then((value) => { if (!disposed) setBoot(value) }).catch(() => {})
    return () => { disposed = true }
  }, [])

  // 依赖 inventory：首帧是 loading 早退（没有容器 ref），只在挂载时观察会永远拿不到元素。
  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const apply = (width: number) => setCompact(width > 0 && width < 780)
    apply(element.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [inventory])

  useEffect(() => () => { if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current) }, [])

  const scheduleHover = (entry: StorageEntry, x: number, y: number) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHover({ entry, x, y }), HOVER_DELAY_MS)
  }
  const cancelHover = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setHover(null)
  }

  const copyPath = async (entry: StorageEntry) => {
    try {
      await navigator.clipboard.writeText(entry.location)
      setCopied(entry.id)
      window.setTimeout(() => setCopied((current) => (current === entry.id ? null : current)), 1500)
    } catch {
      setCopied(null)
    }
  }

  const openPath = async (entry: StorageEntry) => {
    const target = entry.location.startsWith('db:') ? null : entry.location
    try {
      const api = (window.api as unknown as { file?: { openPath?: (path: string) => Promise<unknown> } }).file
      if (target && api?.openPath) await api.openPath(target)
    } catch {
      // 打开失败不阻塞面板
    }
  }

  const contributions = useMemo(() => {
    if (!inventory) return []
    const total = inventory.totalBytes || 1
    return inventory.groups
      .filter((group) => group.bytes > 0)
      .map((group) => ({ domain: group.domain, label: group.label, bytes: group.bytes, ratio: group.bytes / total }))
      .sort((left, right) => right.bytes - left.bytes)
  }, [inventory])

  if (loading && !inventory) {
    return (
      <div className="ui-empty-state flex-col gap-2 text-sm" role="status">
        <LoaderCircle size={18} className="ui-spin text-[var(--color-accent)]" aria-hidden="true" />
        正在统计数据占用
      </div>
    )
  }

  if (error && !inventory) {
    return (
      <div className="ui-inline-alert text-xs" role="alert">
        <span className="flex-1">{error}</span>
        <Button size="sm" variant="ghost" onClick={() => void load('refresh')}>重试</Button>
      </div>
    )
  }

  if (!inventory) return null

  return (
    <div ref={containerRef} className="space-y-3">
      {/* 总览 */}
      <section className="ui-list-card ui-list-card-no-hover space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <HardDrive size={16} className="text-[var(--color-accent-text)]" aria-hidden="true" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">数据存储</span>
          <span className="text-xs text-[var(--color-text-secondary)]">合计 {formatStorageBytes(inventory.totalBytes)}</span>
          {inventory.approximate && <span className="ui-badge text-[10px]">部分未知</span>}
          <StorageTransferActions onImported={() => void load('refresh')} />
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void load('refresh')} disabled={refreshing}>
            {refreshing ? '统计中' : '刷新'}
          </Button>
        </div>

        {contributions.length > 0 && (
          <>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]" role="img" aria-label="各域占用比例">
              {contributions.map((item) => (
                <span key={item.domain} title={`${item.label} ${formatStorageBytes(item.bytes)}`} style={{ width: `${Math.max(item.ratio * 100, 1)}%`, background: DOMAIN_ACCENT[item.domain] }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-secondary)]">
              {contributions.map((item) => (
                <span key={item.domain} className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: DOMAIN_ACCENT[item.domain] }} aria-hidden="true" />
                  {item.label} {formatStorageBytes(item.bytes)}
                </span>
              ))}
            </div>
          </>
        )}

        {inventory.unmappedTables.length > 0 && (
          <div className="ui-inline-note ui-inline-note-warning text-[11px]" role="status">
            有 {inventory.unmappedTables.length} 张表未归入任何分类：{inventory.unmappedTables.slice(0, 6).join('、')}
            {inventory.unmappedTables.length > 6 ? ' 等' : ''}
          </div>
        )}

        {boot && boot.marks.length > 0 && (
          <div className="text-[10px] leading-4 text-[var(--color-text-secondary)]" title={boot.marks.map((mark) => `${mark.name} ${mark.ms}ms`).join('\n')}>
            上次启动 {boot.totalMs}ms
            {boot.marks.map((mark) => ` · ${BOOT_PHASE_LABELS[mark.name] ?? mark.name} ${mark.ms}ms`).join('')}
          </div>
        )}
      </section>

      {/* 域 → 子组 → 条目 */}
      {inventory.groups.map((group) => {
        const domainCollapsed = collapsedDomains[group.domain] === true
        return (
          <section key={group.domain} className="ui-list-card ui-list-card-no-hover p-0">
            <button
              type="button"
              onClick={() => setCollapsedDomains((current) => ({ ...current, [group.domain]: !domainCollapsed }))}
              aria-expanded={!domainCollapsed}
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
            >
              {domainCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DOMAIN_ACCENT[group.domain] }} aria-hidden="true" />
              <span className="text-sm font-medium text-[var(--color-text-primary)]">{group.label}</span>
              <span className="text-[10px] text-[var(--color-text-secondary)]">{group.subgroups.length} 类 · {group.entries.length} 项</span>
              <span className="ml-auto text-xs tabular-nums text-[var(--color-text-secondary)]">{group.complete || group.bytes > 0 ? formatStorageBytes(group.bytes) : '—'}</span>
            </button>

            {!domainCollapsed && (
              <div className="border-t border-[var(--color-border)]">
                {group.subgroups.map((subgroup) => {
                  const key = `${group.domain}::${subgroup.key}`
                  const open = openSubgroups[key] === true
                  return (
                    <div key={key}>
                      <button
                        type="button"
                        onClick={() => setOpenSubgroups((current) => ({ ...current, [key]: !open }))}
                        aria-expanded={open}
                        className="flex w-full items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-1.5 text-left"
                      >
                        {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                        <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">{subgroup.label}</span>
                        <span className="text-[10px] text-[var(--color-text-secondary)]">({subgroup.entries.length})</span>
                        <span className="ml-auto text-[11px] tabular-nums text-[var(--color-text-secondary)]">{subgroup.complete || subgroup.bytes > 0 ? formatStorageBytes(subgroup.bytes) : '—'}</span>
                      </button>

                      {open && subgroup.entries.map((entry) => {
                        const count = entry.kind === 'table'
                          ? `${entry.rows ?? '—'} 行`
                          : entry.kind === 'package'
                            ? '随包'
                            : `${entry.files ?? '—'} 个文件`
                        const actions = (
                          <>
                            {entry.location.startsWith('db:') ? null : (
                              <IconButton icon={FolderOpen} label={`打开 ${entry.label} 的位置`} onClick={() => void openPath(entry)} />
                            )}
                            <IconButton
                              icon={Copy}
                              label={copied === entry.id ? '已复制路径' : `复制 ${entry.label} 的路径`}
                              onClick={() => void copyPath(entry)}
                            />
                          </>
                        )
                        const hoverProps = {
                          onMouseEnter: (event: React.MouseEvent) => scheduleHover(entry, event.clientX, event.clientY),
                          onMouseLeave: cancelHover,
                          onFocus: (event: React.FocusEvent<HTMLElement>) => {
                            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
                            scheduleHover(entry, rect.left + 12, rect.bottom)
                          },
                          onBlur: cancelHover,
                        }

                        if (compact) {
                          return (
                            <div key={entry.id} className="border-b border-[var(--color-border)] px-3 py-2 last:border-b-0" {...hoverProps}>
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-primary)]" title={entry.label}>{entry.label}</span>
                                <span className="shrink-0 text-[10px] text-[var(--color-text-secondary)]">{count}</span>
                                <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-primary)]">{formatStorageBytes(entry.bytes)}</span>
                              </div>
                              <div className="mt-1 flex min-w-0 items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--color-text-secondary)]" title={entry.location}>{entry.location}</span>
                                {actions}
                              </div>
                            </div>
                          )
                        }

                        return (
                          <div key={entry.id} className="flex min-w-0 items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0" {...hoverProps}>
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="truncate text-xs text-[var(--color-text-primary)]" title={entry.label}>{entry.label}</span>
                              <span className="shrink-0 text-[10px] text-[var(--color-text-secondary)]">{count}</span>
                            </div>
                            <span className="w-[72px] shrink-0 text-right text-xs tabular-nums text-[var(--color-text-primary)]">{formatStorageBytes(entry.bytes)}</span>
                            <div className="flex shrink-0 items-center gap-1">{actions}</div>
                            <span className="w-[220px] shrink-0 truncate text-[10px] text-[var(--color-text-secondary)]" title={entry.location}>{entry.location}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}

      <p className="text-[10px] leading-4 text-[var(--color-text-secondary)]">
        导出与导入已接入（完整备份 / 数据库文件）；迁移与清理会在后续版本接入，未实现的项不会显示按钮。
      </p>

      {hover && <StorageEntryCard entry={hover.entry} x={hover.x} y={hover.y} />}
    </div>
  )
}
