import { useEffect, useState } from 'react'

// Grimoire's About page (M1.5.5).
//
// The source About page names Cherry Studio, links its feedback address and offers an update check
// that would talk to Cherry's release service. None of that is true for this build, so the page is
// ours — while keeping the attribution the upstream AGPL-3.0 license actually requires.
type AppInfo = { version?: string; isPackaged?: boolean; appPath?: string; appDataPath?: string; arch?: string }

export function CompatAbout() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const result = await window.api?.ipcApi?.request('app.get_info' as never)
        const data = (result as { data?: AppInfo } | undefined)?.data
        if (alive && data) setInfo(data)
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6" data-ui="compat.about">
      <header className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">魔导书 Grimoire</h1>
        <span className="text-sm text-muted-foreground">{info?.version ? 'v' + info.version : '版本读取中…'}</span>
      </header>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        提示词工作台、Agent 工作区与素材库。数据保存在本机 SQLite，模型凭据只留在主进程。
      </p>
      <section className="max-w-2xl rounded border border-border-subtle p-4 text-sm">
        <h2 className="mb-2 font-medium">上游与许可</h2>
        <p className="text-muted-foreground">
          本项目的界面层派生自 Cherry Studio 2.1.4（AGPL-3.0），源码保存在
          <code className="mx-1 rounded bg-muted px-1">src/vendor/cherry/source</code>，按 AGPL-3.0 保留原始许可与署名。
          魔导书自身的改动同样以 AGPL-3.0 发布。
        </p>
      </section>
      <section className="max-w-2xl rounded border border-border-subtle p-4 text-sm">
        <h2 className="mb-2 font-medium">环境</h2>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-muted-foreground">
          <dt>运行形态</dt><dd>{info?.isPackaged ? '已打包' : '开发模式'}</dd>
          <dt>应用路径</dt><dd className="break-all">{info?.appPath ?? '—'}</dd>
          <dt>数据目录</dt><dd className="break-all">{info?.appDataPath ?? '—'}</dd>
          <dt>架构</dt><dd>{info?.arch ?? '—'}</dd>
        </dl>
      </section>
      <p className="text-xs text-muted-foreground">
        这里没有「检查更新」也没有 Cherry 的反馈邮箱：本构建不连接 Cherry 的发布服务。
      </p>
      {error && <p role="alert" className="text-xs text-destructive">环境信息读取失败：{error}</p>}
    </div>
  )
}
