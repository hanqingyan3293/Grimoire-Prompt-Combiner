import type { CompatRoute } from './route-registry'
import { getSettingsDiagnostic } from './settings-route-descriptors'

/** Full main-slot diagnostic. No source effects are mounted behind this notice. */
export function CompatRemainingSettings({ route }: { route: CompatRoute }) {
  const descriptor = getSettingsDiagnostic(route.id)
  if (route.id !== 'settings-invalid' && !descriptor) return null
  return (
    <section role="alert" data-ui="compat.settings.diagnostic" className="m-4 rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground">
      <h1 className="font-medium">{descriptor?.title ?? '设置路由参数无效'}（{descriptor ? 'BLOCKED' : 'INVALID'}）</h1>
      <div className="mt-2">当前路径：<code>{route.path}</code></div>
      {'skillId' in route && <div>skillId：<code>{route.skillId}</code></div>}
      {'taskId' in route && <div>taskId：<code>{route.taskId}</code></div>}
      {descriptor ? (
        <>
          <div className="mt-2">源组件：<code>{descriptor.source}</code>（未挂载）</div>
          <h2 className="mt-3 font-medium">缺失的后端 / 集成合同</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">{descriptor.missing.map(item => <li key={item}>{item}</li>)}</ul>
          <p className="mt-3">下一步：{descriptor.nextAction}</p>
          <p className="mt-2 text-muted-foreground">本页仅报告阻塞，不执行操作，不返回伪造的空列表或成功状态，也不回退到聊天或 Provider 设置。</p>
        </>
      ) : route.id === 'settings-invalid' ? (
        <>
          <p className="mt-2">{route.reason}</p>
          <p className="mt-3">下一步：使用有效 ID 的源路径重新打开；此请求不会加载详情或执行后端操作。</p>
        </>
      ) : null}
    </section>
  )
}
