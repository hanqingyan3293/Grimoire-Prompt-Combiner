import DocumentProcessingSettings from '../../source/src/renderer/pages/settings/FileProcessingSettings/DocumentProcessingSettings'
import OcrSettings from '../../source/src/renderer/pages/settings/FileProcessingSettings/OcrSettings'

/** Keep the authentic source loading/error state. The missing processor discovery IPC
 * rejects at the existing boundary; this wrapper never supplies a false ready/empty list.
 * Credential forms are not available unless a real processor is discovered. */
export function CompatProcessingSettings({ kind }: { kind: 'document' | 'ocr' }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col" data-ui="compat.settings.processing">
      <p role="note" className="mx-4 mt-4 rounded border border-amber-500/30 p-3 text-sm">
        {kind === 'document' ? '源文档处理设置' : '源 OCR 设置'}已挂载。处理器发现请求使用真实 IPC；当前处理服务未接入时，源页面显示加载失败，不代表没有处理器，也不会保存密钥或启动处理任务。
      </p>
      {kind === 'document' ? <DocumentProcessingSettings /> : <OcrSettings />}
    </div>
  )
}
