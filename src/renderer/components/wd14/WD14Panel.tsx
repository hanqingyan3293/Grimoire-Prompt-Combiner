import React, { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, ImagePlus, LoaderCircle, RefreshCw, Settings2 } from 'lucide-react'
import { Button, IconButton } from '../ui/Button'
import { EmptyState, PanelHeader, StatusBadge } from '../ui/Feedback'
import { Badge } from '../ui/Badge'

interface WD14Model {
  id: string
  name: string
  has_csv: boolean
}

interface WD14Diagnostics {
  pythonPath: string
  pythonAvailable: boolean
  runtimeAvailable: boolean
  runtimeVersion: string | null
  modelDirectory: string
  modelDirectoryExists: boolean
  modelCount: number
  pairedModelCount: number
  blockingReason: string | null
}

interface WD14Image {
  id: number
  original_name: string | null
  available: boolean
}

export function WD14Panel() {
  const [images, setImages] = useState<WD14Image[]>([])
  const [models, setModels] = useState<WD14Model[]>([])
  const [modelId, setModelId] = useState('')
  const [threshold, setThreshold] = useState('0.35')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<WD14Diagnostics | null>(null)
  const [pythonPath, setPythonPath] = useState('')
  const [modelDirectory, setModelDirectory] = useState('')
  const [loading, setLoading] = useState(true)
  const [messageTone, setMessageTone] = useState<'info' | 'success' | 'danger'>('info')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const settings = await window.api.settings.getAll()
      setPythonPath(typeof settings.wd14_python_path === 'string' ? settings.wd14_python_path : '')
      setModelDirectory(typeof settings.wd14_model_directory === 'string' ? settings.wd14_model_directory : '')
      const diagnosis = await window.api.wd14.diagnostics() as WD14Diagnostics
      setDiagnostics(diagnosis)
      const imageList = await window.api.images.list()
      setImages(imageList.filter(image => image.available).map(image => ({ id: image.id, original_name: image.original_name, available: image.available })))
      if (diagnosis.blockingReason) {
        setModels([])
        setMessageTone('info')
        setMessage(diagnosis.blockingReason + '；请选择正确的模型目录和 Python 后刷新')
        return
      }
      const modelList = await window.api.wd14.models()
      setModels(modelList.models.filter(model => Boolean(model.has_csv)).map(model => ({ id: String(model.id), name: String(model.name), has_csv: Boolean(model.has_csv) })))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load().catch(error => {
      setLoading(false)
      setMessageTone('danger')
      setMessage(error instanceof Error ? error.message : 'WD14 Worker 不可用')
    })
  }, [load])

  const showMessage = (value: string, tone: 'info' | 'success' | 'danger' = 'info') => {
    setMessageTone(tone)
    setMessage(value)
  }

  const chooseModelDirectory = async () => {
    try {
      const directory = await window.api.wd14.selectModelDirectory()
      if (!directory) return
      await window.api.settings.set('wd14_model_directory', directory)
      await load()
      showMessage('WD14 模型目录已更新', 'success')
    } catch (error) { showMessage(error instanceof Error ? error.message : '模型目录设置失败', 'danger') }
  }

  const choosePythonPath = async () => {
    try {
      const selected = await window.api.wd14.selectPythonPath()
      if (!selected) return
      await window.api.settings.set('wd14_python_path', selected)
      setPythonPath(selected)
      await load()
      showMessage('Python 解释器已更新', 'success')
    } catch (error) { showMessage(error instanceof Error ? error.message : 'Python 路径设置失败', 'danger') }
  }

  const createTask = async (imageId: number) => {
    setBusy(true)
    setMessage('')
    try {
      const task = await window.api.wd14.createTask({ imageId, modelId: modelId || undefined, threshold: Number(threshold) })
      showMessage('任务已创建：' + String(task.id), 'success')
    } catch (error) {
      showMessage(error instanceof Error ? error.message : '任务创建失败', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='h-full space-y-3 overflow-auto p-4'>
      <PanelHeader
        icon={ImagePlus}
        title='WD14 图片反推'
        description='本地模型反推，结果会进入任务队列'
        actions={<IconButton icon={RefreshCw} label='刷新 WD14 状态' onClick={() => void load()} disabled={loading || busy} className={loading ? 'ui-spin-icon' : ''} />}
      />
      {diagnostics && (
        <section className='ui-list-card p-3'>
          <div className='flex items-start justify-between gap-2'>
            <div className='min-w-0'>
              <div className='flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]'><Settings2 size={15} className='text-[var(--color-accent-text)]' aria-hidden='true' />运行环境</div>
              <div className='mt-2 flex flex-wrap gap-1.5'>
                <StatusBadge tone={diagnostics.pythonAvailable ? 'success' : 'danger'}>Python {diagnostics.pythonAvailable ? '可用' : '不可用'}</StatusBadge>
                <StatusBadge tone={diagnostics.runtimeAvailable ? 'success' : 'danger'}>onnxruntime {diagnostics.runtimeAvailable ? '可用' : '缺失'}</StatusBadge>
                {diagnostics.runtimeVersion && <Badge>v{diagnostics.runtimeVersion}</Badge>}
              </div>
              <div className='mt-1 truncate text-[11px] text-[var(--color-text-secondary)]' title={pythonPath || diagnostics.pythonPath}>解释器：{pythonPath || diagnostics.pythonPath}</div>
              <div className='mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-secondary)]'><span className='truncate' title={diagnostics.modelDirectory}>模型：{diagnostics.pairedModelCount}/{diagnostics.modelCount} 个可用配对</span><StatusBadge tone={diagnostics.modelDirectoryExists && diagnostics.pairedModelCount > 0 ? 'success' : 'warning'}>{diagnostics.modelDirectoryExists && diagnostics.pairedModelCount > 0 ? '模型就绪' : '待配置模型'}</StatusBadge></div>
            </div>
            <StatusBadge tone={diagnostics.blockingReason ? 'warning' : 'success'}>{diagnostics.blockingReason || '可用'}</StatusBadge>
          </div>
          {diagnostics.blockingReason && <div className='ui-inline-note ui-inline-note-info mt-3 text-xs' role='status'><Settings2 size={15} className='mt-0.5 shrink-0' aria-hidden='true' /><span>{diagnostics.blockingReason}；请选择模型目录和 Python 后刷新</span></div>}
          <div className='mt-3 flex flex-wrap gap-2'>
            <Button size='sm' icon={FolderOpen} onClick={() => void chooseModelDirectory()} disabled={busy}>选择模型目录</Button>
            <Button size='sm' icon={Settings2} onClick={() => void choosePythonPath()} disabled={busy}>选择 Python</Button>
          </div>
        </section>
      )}
      <label className='block text-xs text-[var(--color-text-secondary)]' htmlFor='wd14-model'>模型</label>
      <select id='wd14-model' value={modelId} onChange={event => setModelId(event.target.value)} className='ui-field' disabled={busy || models.length === 0}>
        <option value=''>自动选择可用模型</option>
        {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      <label className='block text-xs text-[var(--color-text-secondary)]' htmlFor='wd14-threshold'>阈值：{threshold}</label>
      <input id='wd14-threshold' type='range' min='0.01' max='0.99' step='0.01' value={threshold} onChange={event => setThreshold(event.target.value)} className='w-full accent-[var(--color-accent)]' disabled={busy} />
      {message && <div className={'ui-inline-note ui-inline-note-' + messageTone} role={messageTone === 'danger' ? 'alert' : 'status'}>{messageTone === 'success' ? <CheckCircle2 size={15} aria-hidden='true' /> : <AlertTriangle size={15} aria-hidden='true' />}<span>{message}</span></div>}
      <div className='space-y-2'>
        {loading && images.length === 0 ? <div className='ui-empty-state flex-col gap-2 text-sm' role='status'><LoaderCircle size={20} className='ui-spin' aria-hidden='true' />正在读取图片资源</div> : images.length === 0 ? <EmptyState icon={ImagePlus} title='没有可反推的图片' description='请先在图片资源库导入可用图片' /> : images.map(image => (
          <div key={image.id} className='ui-list-card flex items-center justify-between gap-2 p-3'>
            <span className='min-w-0 truncate text-sm text-[var(--color-text-primary)]'>{image.original_name || ('图片 ' + image.id)}</span>
            <Button size='sm' variant='primary' icon={ImagePlus} disabled={busy || Boolean(diagnostics?.blockingReason)} onClick={() => void createTask(image.id)}>反推</Button>
          </div>
        ))}
      </div>
    </div>
  )
}
