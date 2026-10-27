import { useEffect, useState } from 'react'

/** Which `/settings/general` switches actually do something (M3).
 *
 * The read-only banner used to say "未接入" as one sentence; that tells the user nothing about
 * which switch is live. This reads the main-process registry and lists the keys that are stored
 * but have no consumer, so the page never looks more finished than it is.
 */
type WiringItem = { key: string; wired: boolean; note: string }
type WiringReport = { total: number; wired: number; items: WiringItem[] }

export function CompatPreferenceWiring() {
  const [report, setReport] = useState<WiringReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const result = await window.api?.ipcApi?.request('app.preferences.consumers' as never)
        const data = (result as { ok?: boolean; data?: WiringReport } | undefined)?.data
        if (alive && data && Array.isArray(data.items)) setReport(data)
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { alive = false }
  }, [])
  if (error) return <p className="mt-2 text-xs text-muted-foreground">接线报告读取失败：{error}</p>
  if (!report) return <p className="mt-2 text-xs text-muted-foreground">读取接线报告…</p>
  const unwired = report.items.filter(item => !item.wired)
  return (
    <div className="mt-2 text-xs" data-ui="compat.preference-wiring">
      <div>已接线 {report.wired}/{report.total} 个通用设置键；其余仅保存、不改变行为。</div>
      {unwired.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">
          {unwired.map(item => <li key={item.key}><code>{item.key}</code>：{item.note}</li>)}
        </ul>
      )}
    </div>
  )
}
