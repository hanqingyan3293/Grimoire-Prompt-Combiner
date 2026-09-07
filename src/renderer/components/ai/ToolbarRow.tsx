// 魔导书 Grimoire v7 — 工具栏
import React from 'react'
import { Globe2, Paperclip, Settings } from 'lucide-react'
import { Button } from '../ui/Button'

interface Props {
  onUpload: () => void
  onWebSearch: () => void
  onConvSettings: () => void
}

export function ToolbarRow({ onUpload, onWebSearch, onConvSettings }: Props) {
  return (
    <div className="flex items-center gap-2 px-1 pb-2">
      <Button size='sm' icon={Paperclip} onClick={onUpload}>上传</Button>
      <Button size='sm' icon={Globe2} onClick={onWebSearch} disabled title='联网搜索开发中'>搜索</Button>
      <Button size='sm' icon={Settings} onClick={onConvSettings}>设置</Button>
    </div>
  )
}
