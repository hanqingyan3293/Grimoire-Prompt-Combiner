// 设置 → 数据 → 数据存储（P1：只读面板）。
//
// 设计取舍：
//  * 数据来自主进程注册表（storage-registry），组件不硬编码表名/路径，避免两处漂移。
//  * bytes === null 渲染为「—」并标注「更新中」，绝不当成 0 —— 0 与未知是两件事。
//  * 窄容器（面板被挤到 640px 以下）改为两行布局、隐藏完整路径、按钮收小，但仍然可用；
//    宽度用 ResizeObserver 量自身，不用视口断点（G9 禁止面板内 sm:/md:）。
//  * P1 只暴露已实现的操作（打开目录 / 复制路径）。导出/迁移/清理等能力位已在数据里，
//    但按钮等 P2–P5 真正实现后再渲染，不做「点了没反应」的占位。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, FolderOpen, HardDrive, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button, IconButton } from '../ui/Button'
import { formatStorageBytes, STORAGE_DOMAIN_LABELS, type StorageDomain, type StorageEntry, type StorageInventory } from '../../../shared/storage-types'

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

export function StorageDataSection() {
  const [inventory, setInventory] = useState<StorageInventory | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [compact, setCompact] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

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

  // 依赖 inventory：首帧是 loading 早退（没有容器 ref），只在挂载时观察会永远拿不到元素，
  // 结果 compact 一直是 false，窄面板里宽布局把标签列挤成 0 宽（2026-11-27 实测）。
  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const apply = (width: number) => setCompact(width > 0 && width < 780)
    apply(element.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [inventory])

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
    // 目录用 openPath；DB 表没有文件路径，交给「打开数据目录」兜底。
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
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            className="ml-auto"
            onClick={() => void load('refresh')}
            disabled={refreshing}
          >{refreshing ? '统计中' : '刷新'}</Button>
        </div>

        {contributions.length > 0 && (
          <>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]" role="img" aria-label="各域占用比例">
              {contributions.map((item) => (
                <span
                  key={item.domain}
                  title={`${item.label} ${formatStorageBytes(item.bytes)}`}
                  style={{ width: `${Math.max(item.ratio * 100, 1)}%`, background: DOMAIN_ACCENT[item.domain] }}
                />
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
      </section>

      {/* 按域展开 */}
      {inventory.groups.map((group) => {
        const isCollapsed = collapsed[group.domain] === true
        return (
          <section key={group.domain} className="ui-list-card ui-list-card-no-hover p-0">
            <button
              type="button"
              onClick={() => setCollapsed((current) => ({ ...current, [group.domain]: !isCollapsed }))}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
            >
              {isCollapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DOMAIN_ACCENT[group.domain] }} aria-hidden="true" />
              <span className="text-sm font-medium text-[var(--color-text-primary)]">{group.label || STORAGE_DOMAIN_LABELS[group.domain]}</span>
              <span className="ml-auto text-xs tabular-nums text-[var(--color-text-secondary)]">{formatStorageBytes(group.bytes)}</span>
            </button>

            {!isCollapsed && (
              <div className="border-t border-[var(--color-border)]">
                {group.entries.map((entry) => {
                  const fileActions = (
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
                  const count = entry.kind === 'table'
                    ? `${entry.rows ?? '—'} 行`
                    : entry.kind === 'package'
                      ? '随包'
                      : `${entry.files ?? '—'} 个文件`

                  // 窄容器：两行块布局（标题+数值 / 路径+操作），不用 flex-col 叠三层，
                  // 460px 实测下那种写法会让三段文字挤在同一行高度里互相压住。
                  if (compact) {
                    return (
                      <div key={entry.id} className="border-b border-[var(--color-border)] px-3 py-2 last:border-b-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-primary)]" title={entry.label}>{entry.label}</span>
                          <span className="shrink-0 text-[10px] text-[var(--color-text-secondary)]">{count}</span>
                          <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-primary)]">{formatStorageBytes(entry.bytes)}</span>
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--color-text-secondary)]" title={entry.location}>{entry.location}</span>
                          {fileActions}
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div key={entry.id} className="flex min-w-0 items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate text-xs text-[var(--color-text-primary)]" title={entry.label}>{entry.label}</span>
                        <span className="shrink-0 text-[10px] text-[var(--color-text-secondary)]">{count}</span>
                      </div>
                      <span className="w-[72px] shrink-0 text-right text-xs tabular-nums text-[var(--color-text-primary)]">{formatStorageBytes(entry.bytes)}</span>
                      <div className="flex shrink-0 items-center gap-1">{fileActions}</div>
                      <span className="w-[220px] shrink-0 truncate text-[10px] text-[var(--color-text-secondary)]" title={entry.location}>{entry.location}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}

      <p className="text-[10px] leading-4 text-[var(--color-text-secondary)]">
        这里只显示位置与占用；导出、导入、迁移与清理会在后续版本逐个接入，未实现的项不会显示按钮。
      </p>
    </div>
  )
}
