import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import { parsePromptDocument, scanPromptSyntax, type PromptBlock, type TextRange } from '@shared/prompt-blocks'
import { editPromptBlockWeight, validatePromptSyntax, type PromptTextEdit } from '@shared/prompt-block-edit'
import { promptTextInputEdit } from '@shared/prompt-raw-input'
import { appendNovelaiQualityTokens, getNovelaiDocumentText, sampleNovelaiRandomPools, type NovelaiBlockMeta, type NovelaiDocument, type NovelaiGeneration, type NovelaiJsonValue, type NovelaiTextTarget } from '@shared/novelai-document'
import type { NovelaiDraftCommit, NovelaiDraftState } from '../../stores/novelai-draft.store'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

type HistoryAction = 'undo' | 'redo' | 'agent'
interface Props { journal: NovelaiDraftState; readOnly: boolean; onCommit: (input: NovelaiDraftCommit) => boolean; onHistory: (action: HistoryAction) => void; onError: (message: string | null) => void }
const targetKey = (target: NovelaiTextTarget) => typeof target === 'string' ? target : JSON.stringify(target)
const typeLabel: Record<PromptBlock['type'], string> = { tags: '标签块', paragraph: '段落块', random: '随机块' }
const typeTone: Record<PromptBlock['type'], 'neutral' | 'accent' | 'warning'> = { tags: 'accent', paragraph: 'neutral', random: 'warning' }
const generationLabels: Record<keyof NovelaiGeneration, string> = { steps: '步数', cfg: 'CFG', seed: '种子', sampler: '采样器', scheduler: '调度器', width: '宽度', height: '高度', model: '模型', checkpoint: '检查点', loras: 'LoRA（逗号分隔）' }
const asJson = (value: unknown) => value as NovelaiJsonValue

function RawField({ label, value, readOnly, onEdit, onFocus, onBlur, className = '' }: { label: string; value: string; readOnly: boolean; onEdit: (edit: PromptTextEdit) => void; onFocus: () => void; onBlur: () => void; className?: string }) {
  const field = useRef<HTMLTextAreaElement | null>(null)
  const selection = useRef<{ range: TextRange; inputType: string } | undefined>(undefined)
  const composition = useRef<TextRange | undefined>(undefined)
  useEffect(() => {
    const element = field.current
    if (!element) return
    const beginComposition = () => { composition.current = { start: element.selectionStart, end: element.selectionEnd } }
    const endComposition = () => { composition.current = undefined }
    const beforeInput = (event: Event) => { selection.current = { range: composition.current ?? { start: element.selectionStart, end: element.selectionEnd }, inputType: (event as InputEvent).inputType } }
    element.addEventListener('beforeinput', beforeInput)
    element.addEventListener('compositionstart', beginComposition)
    element.addEventListener('compositionend', endComposition)
    return () => { element.removeEventListener('beforeinput', beforeInput); element.removeEventListener('compositionstart', beginComposition); element.removeEventListener('compositionend', endComposition) }
  }, [])
  return <label className='flex min-w-0 flex-col gap-1 text-xs'>
    <span className='text-[var(--color-text-secondary)]'>{label}</span>
    <textarea ref={field} aria-label={label} value={value.replace(/\r\n?/g, '\n')} readOnly={readOnly} spellCheck={false}
      onFocus={onFocus} onBlur={() => { selection.current = undefined; composition.current = undefined; onBlur() }}
      onChange={event => {
        const beforeInput = selection.current
        const next = event.target.value
        const edit = promptTextInputEdit(value, next, beforeInput?.range, beforeInput?.inputType)
        if (composition.current && beforeInput) composition.current = { start: beforeInput.range.start, end: beforeInput.range.start + next.length - (value.replace(/\r\n?/g, '\n').length - (beforeInput.range.end - beforeInput.range.start)) }
        selection.current = undefined; onEdit(edit)
      }}
      className={'ui-field min-w-[min(100%,8rem)] resize-y px-2 py-2 font-mono text-xs leading-6 ' + className} />
  </label>
}

function BlockRow({ block, index, meta, readOnly, onText, onWeight, onMeta, onFocus, onBlur }: { block: PromptBlock; index: number; meta?: NovelaiBlockMeta; readOnly: boolean; onText: (edit: PromptTextEdit) => void; onWeight: (operation: 'increase' | 'decrease' | 'numeric', value?: number) => void; onMeta: (patch: { name?: string; ownLine?: boolean }) => void; onFocus: (field: 'text' | 'name') => void; onBlur: () => void }) {
  const [numeric, setNumeric] = useState(block.weight?.kind === 'numeric' ? String(block.weight.value) : '1')
  useEffect(() => setNumeric(block.weight?.kind === 'numeric' ? String(block.weight.value) : '1'), [block.raw])
  const label = '块 ' + (index + 1)
  const weight = !block.weight ? null : block.weight.kind === 'numeric' ? '权重 ' + block.weight.value : (block.weight.kind === 'increase' ? '+' : '−') + Math.round(block.weight.value * 100) + '%'
  return <div data-block-index={index} data-own-line={meta?.ownLine ? 'true' : 'false'} className={'flex min-w-[min(100%,12rem)] flex-col gap-2 rounded px-2 py-2 text-xs odd:bg-[var(--color-bg-secondary)] ' + (meta?.ownLine ? 'basis-full' : 'basis-[12rem] flex-1')}>
    <div className='flex flex-wrap items-center gap-1.5'><span className='text-[var(--color-text-secondary)]'>{index + 1}</span><Badge tone={typeTone[block.type]}>{typeLabel[block.type]}</Badge>{weight && <span className='text-[11px] text-[var(--color-text-secondary)]'>{weight}</span>}</div>
    <div className='flex flex-wrap items-center gap-2'>
      <input aria-label={label + ' 名称'} value={meta?.name ?? ''} placeholder='块名称' readOnly={readOnly} onFocus={() => onFocus('name')} onBlur={onBlur} onChange={event => onMeta({ name: event.target.value })} className='ui-field min-w-[min(100%,7rem)] flex-1 px-2 py-1 text-xs' />
      <label className='flex items-center gap-1 text-[11px]'><input type='checkbox' className='ui-checkbox' aria-label={label + ' 单独成行'} checked={meta?.ownLine ?? false} disabled={readOnly} onChange={event => onMeta({ ownLine: event.target.checked })} />单独成行</label>
    </div>
    <RawField label={label + ' 原文'} value={block.raw} readOnly={readOnly} onEdit={onText} onFocus={() => onFocus('text')} onBlur={onBlur} className='min-h-[4rem]' />
    <div className='flex flex-wrap items-center gap-1'>
      <Button size='sm' aria-label={label + ' 加权 5%'} disabled={readOnly} onClick={() => onWeight('increase')}>+5%</Button>
      <Button size='sm' aria-label={label + ' 减权 5%'} disabled={readOnly} onClick={() => onWeight('decrease')}>−5%</Button>
      <input data-novelai-local-input aria-label={label + ' 数字权重'} value={numeric} inputMode='decimal' readOnly={readOnly} onChange={event => setNumeric(event.target.value)} className='ui-field w-16 min-w-[4rem] px-2 py-1 text-xs' />
      <Button size='sm' aria-label={'应用' + label + ' 数字权重'} disabled={readOnly} onClick={() => onWeight('numeric', numeric.trim() ? Number(numeric) : Number.NaN)}>应用权重</Button>
    </div>
  </div>
}

export function NovelaiDocumentEditor({ journal, readOnly, onCommit, onHistory, onError }: Props) {
  const document = journal.document
  const [chosenTarget, setChosenTarget] = useState('primary')
  const [sample, setSample] = useState<{ revision: number; target: NovelaiTextTarget; text: string; edits: PromptTextEdit[] } | null>(null)
  const focusGroup = useRef<{ key: string; id: string; edited: boolean } | null>(null)
  const focus = (key: string) => { focusGroup.current = { key, id: crypto.randomUUID(), edited: false } }
  const blur = () => { focusGroup.current = null }
  const group = (key: string) => { if (focusGroup.current?.key !== key) focus(key); return focusGroup.current!.id }
  const commitDocument = (nextDocument: NovelaiDocument, operation: string, mode: 'typing' | 'guarded' = 'guarded', groupId?: string) => onCommit({ expectedRevision: journal.revision, transactionId: crypto.randomUUID(), source: 'user', operation, mode, groupId, nextDocument })
  const textInput = (target: NovelaiTextTarget, edit: PromptTextEdit) => {
    const accepted = onCommit({ expectedRevision: journal.revision, transactionId: crypto.randomUUID(), source: 'user', operation: '编辑提示词', mode: 'typing', groupId: group(targetKey(target)), changes: [{ kind: 'text', target, ...edit }] })
    if (accepted && edit.expectedText !== edit.text && focusGroup.current) focusGroup.current.edited = true
  }
  const finishPrimaryInput = () => {
    if (!readOnly && document.quality.enabled && focusGroup.current?.key === 'primary' && focusGroup.current.edited) {
      const result = appendNovelaiQualityTokens(document)
      const otherSyntax = [document.negative, ...document.characters.flatMap(character => [character.positive, character.negative])].some(text => validatePromptSyntax(text).length)
      if (!result.ok || otherSyntax) onError('质量词未追加 [' + (!result.ok ? result.code : 'INVALID_SYNTAX') + ']，请先完成原文中的括号或引号')
      else if (result.changed) onCommit({ expectedRevision: journal.revision, transactionId: crypto.randomUUID(), source: 'user', operation: '编辑提示词', mode: 'typing', groupId: focusGroup.current.id, changes: [{ kind: 'text', target: 'primary', range: { start: document.primary.length, end: document.primary.length }, expectedText: '', text: result.document.primary.slice(document.primary.length) }] })
    }
    blur()
  }
  const targets: Array<{ value: string; target: NovelaiTextTarget; label: string }> = [{ value: 'primary', target: 'primary', label: '主提示词' }, { value: 'negative', target: 'negative', label: '反向提示词' }, ...document.characters.flatMap((character, index) => (['positive', 'negative'] as const).map(field => ({ value: targetKey({ characterId: character.id, field }), target: { characterId: character.id, field }, label: (character.name || '角色 ' + (index + 1)) + (field === 'positive' ? ' · 正面' : ' · 负面') })))]
  const target = targets.find(item => item.value === chosenTarget)?.target ?? 'primary'
  const raw = getNovelaiDocumentText(document, target) ?? ''
  const blocks = useMemo(() => parsePromptDocument(raw).blocks, [raw])
  const matchedMeta = (block: PromptBlock) => document.blockMeta.find(meta => targetKey(meta.target) === targetKey(target) && meta.range.start === block.range.start && meta.range.end === block.range.end && meta.expectedText === block.raw)

  const editBlock = (block: PromptBlock, edit: PromptTextEdit, operation = '编辑块', groupId?: string) => {
    const text = block.raw.slice(0, edit.range.start) + edit.text + block.raw.slice(edit.range.end)
    const shift = text.length - block.raw.length
    const metadata = document.blockMeta.map(meta => {
      if (targetKey(meta.target) !== targetKey(target)) return meta
      if (meta.range.start === block.range.start && meta.range.end === block.range.end && meta.expectedText === block.raw) return { ...meta, range: { start: meta.range.start, end: meta.range.end + shift }, expectedText: text }
      if (meta.range.start >= block.range.end) return { ...meta, range: { start: meta.range.start + shift, end: meta.range.end + shift } }
      return meta
    })
    onCommit({ expectedRevision: journal.revision, transactionId: crypto.randomUUID(), source: 'user', operation, groupId, changes: [{ kind: 'text', target, range: { start: block.range.start + edit.range.start, end: block.range.start + edit.range.end }, expectedText: edit.expectedText, text: edit.text, ...(edit.uncertainOrigin ? { uncertainOrigin: { start: block.range.start + edit.uncertainOrigin.start, end: block.range.start + edit.uncertainOrigin.end } } : {}) }, { kind: 'field', path: ['blockMeta'], expectedValue: asJson(document.blockMeta), value: asJson(metadata) }] })
  }
  const weightBlock = (block: PromptBlock, index: number, operation: 'increase' | 'decrease' | 'numeric', value?: number) => {
    const weighted = editPromptBlockWeight(raw, index, operation, value)
    if (!weighted.ok) { onError('块修改未应用 [' + weighted.code + ']，原文已保留'); return }
    const text = weighted.text.slice(block.range.start, block.range.end + weighted.text.length - raw.length)
    editBlock(block, { range: { start: 0, end: block.raw.length }, expectedText: block.raw, text }, '调整块权重')
  }
  const editMeta = (block: PromptBlock, patch: { name?: string; ownLine?: boolean }) => {
    const existing = matchedMeta(block)
    const next = { id: crypto.randomUUID(), target, range: block.range, expectedText: block.raw, name: '', ownLine: false, ...existing, ...patch }
    commitDocument({ ...document, blockMeta: existing ? document.blockMeta.map(meta => meta.id === existing.id ? next : meta) : [...document.blockMeta, next] }, '块名称与布局', 'typing', patch.name !== undefined ? group('meta:' + block.range.start) : undefined)
  }
  const previewSample = () => {
    onError(null)
    const result = sampleNovelaiRandomPools(raw, document.randomPools, document.generation.seed)
    if (!result.ok) { setSample(null); onError('随机抽样失败 [' + result.code + ']，原文已保留'); return }
    setSample({ revision: journal.revision, target, text: result.text, edits: result.selections.map(selection => ({ range: selection.range, expectedText: raw.slice(selection.range.start, selection.range.end), text: selection.text })) })
  }
  const applySample = () => {
    if (!sample) return
    if (sample.revision !== journal.revision || targetKey(sample.target) !== targetKey(target)) { onError('草稿或目标已改变，随机抽样预览已失效，请重新预览'); return }
    if (onCommit({ expectedRevision: sample.revision, transactionId: crypto.randomUUID(), source: 'user', operation: '随机抽样', changes: sample.edits.map(edit => ({ kind: 'text', target: sample.target, ...edit })) })) setSample(null)
  }
  const quality = (next: NovelaiDocument) => {
    const result = appendNovelaiQualityTokens(next)
    if (!result.ok) { onError('质量词未追加 [' + result.code + ']，原文已保留'); return }
    commitDocument(result.document, '质量词设置')
  }
  const reorderCharacter = (index: number, direction: -1 | 1) => {
    const characters = [...document.characters]
    ;[characters[index], characters[index + direction]] = [characters[index + direction], characters[index]]
    commitDocument({ ...document, characters }, '调整角色顺序', 'typing')
  }
  const staleLabels = document.blockMeta.filter(meta => getNovelaiDocumentText(document, meta.target)?.slice(meta.range.start, meta.range.end) !== meta.expectedText)

  return <div className='min-w-0' aria-label='完整提示词文档' onKeyDown={event => {
    if (readOnly || event.altKey || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey) || (event.target as HTMLElement).closest('[data-novelai-local-input]')) return
    const key = event.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return
    event.preventDefault(); event.stopPropagation()
    onHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo')
  }}>
    <div className='flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-3 py-2'>
      <Button size='sm' icon={Undo2} onClick={() => onHistory('undo')} disabled={readOnly || !journal.history.length}>撤销</Button>
      <Button size='sm' icon={Redo2} onClick={() => onHistory('redo')} disabled={readOnly || !journal.redo.length}>重做</Button>
      <Button size='sm' variant='ghost' onClick={() => onHistory('agent')} disabled={readOnly || !journal.history.some(entry => entry.source === 'agent' && entry.kind === 'commit' && !journal.undoneAgentGroups.includes(entry.id))}>撤销 Agent 改动</Button>
      <span className='ml-auto text-[11px] text-[var(--color-text-secondary)]'>草稿 r{journal.revision} · {journal.history.length} 组记录</span>
    </div>
    <div className='flex flex-wrap gap-3 p-3'>
      <section className='flex min-w-[min(100%,16rem)] basis-[24rem] flex-1 flex-col gap-3' aria-label='原文编辑'>
        <RawField label='提示词原文' value={document.primary} readOnly={readOnly} onEdit={edit => textInput('primary', edit)} onFocus={() => focus('primary')} onBlur={finishPrimaryInput} className='min-h-[14rem]' />
        <RawField label='反向提示词' value={document.negative} readOnly={readOnly} onEdit={edit => textInput('negative', edit)} onFocus={() => focus('negative')} onBlur={blur} className='min-h-[5rem]' />
        {staleLabels.length > 0 && <p className='text-[11px] text-[var(--color-text-secondary)]'>保留 {staleLabels.length} 个已失配的块标签。原文变化后不会将旧名称自动绑定到其他块。</p>}
      </section>
      <section className='min-w-[min(100%,16rem)] basis-[24rem] flex-1' aria-label='块编辑'>
        <label className='mb-2 flex flex-wrap items-center gap-2 text-xs'><span>块编辑目标</span><select aria-label='块编辑目标' value={targetKey(target)} onChange={event => { setChosenTarget(event.target.value); setSample(null) }} className='ui-field min-w-[8rem] flex-1 px-2 py-1 text-xs'>{targets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><span className='text-[var(--color-text-secondary)]'>共 {blocks.length} 块</span></label>
        <div className='flex flex-wrap gap-2'>{blocks.map((block, index) => <BlockRow key={index} block={block} index={index} meta={matchedMeta(block)} readOnly={readOnly} onText={edit => editBlock(block, edit, '编辑块', group('block:' + block.range.start))} onWeight={(operation, value) => weightBlock(block, index, operation, value)} onMeta={patch => editMeta(block, patch)} onFocus={field => focus((field === 'name' ? 'meta:' : 'block:') + block.range.start)} onBlur={blur} />)}</div>
        {!blocks.length && <p className='py-3 text-xs text-[var(--color-text-secondary)]'>输入原文后自动显示标签、段落和随机块。</p>}
      </section>
    </div>
    <section className='border-t border-[var(--color-border)] px-3 py-3' aria-label='多角色'>
      <div className='mb-3 flex flex-wrap items-center gap-2'><h3 className='text-xs font-medium'>角色提示词</h3><Button size='sm' icon={Plus} disabled={readOnly} onClick={() => commitDocument({ ...document, characters: [...document.characters, { id: crypto.randomUUID(), name: '角色 ' + (document.characters.length + 1), positive: '', negative: '' }] }, '添加角色', 'typing')}>添加角色</Button></div>
      {document.characters.map((character, index) => <div key={character.id} data-character-id={character.id} className='mb-3 border-t border-[var(--color-border)] pt-3'>
        <div className='mb-2 flex flex-wrap items-center gap-1'>
          <label className='flex min-w-[8rem] flex-1 items-center gap-2 text-xs'><span>角色 {index + 1}</span><input aria-label={'角色 ' + (index + 1) + ' 名称'} value={character.name} readOnly={readOnly} onFocus={() => focus('name:' + character.id)} onBlur={blur} onChange={event => commitDocument({ ...document, characters: document.characters.map(item => item.id === character.id ? { ...item, name: event.target.value } : item) }, '角色名称', 'typing', group('name:' + character.id))} className='ui-field min-w-[min(100%,7rem)] flex-1 px-2 py-1 text-xs' /></label>
          <Button size='sm' aria-label={'角色 ' + (index + 1) + ' 上移'} icon={ArrowUp} disabled={readOnly || index === 0} onClick={() => reorderCharacter(index, -1)} />
          <Button size='sm' aria-label={'角色 ' + (index + 1) + ' 下移'} icon={ArrowDown} disabled={readOnly || index === document.characters.length - 1} onClick={() => reorderCharacter(index, 1)} />
          <Button size='sm' aria-label={'移除角色 ' + (index + 1)} icon={Trash2} disabled={readOnly} onClick={() => commitDocument({ ...document, characters: document.characters.filter(item => item.id !== character.id), blockMeta: document.blockMeta.filter(meta => typeof meta.target === 'string' || meta.target.characterId !== character.id), provenance: { ...document.provenance, insertions: document.provenance.insertions.filter(item => !item.target || typeof item.target === 'string' || item.target.characterId !== character.id) } }, '移除角色', 'typing')} />
        </div>
        <div className='flex flex-wrap gap-2'>{(['positive', 'negative'] as const).map(field => <div key={field} className='min-w-[min(100%,12rem)] basis-[20rem] flex-1'><RawField label={'角色 ' + (index + 1) + (field === 'positive' ? ' 正面提示词' : ' 负面提示词')} value={character[field]} readOnly={readOnly} onEdit={edit => textInput({ characterId: character.id, field }, edit)} onFocus={() => focus(targetKey({ characterId: character.id, field }))} onBlur={blur} className='min-h-[5rem]' /></div>)}</div>
      </div>)}
      {!document.characters.length && <p className='text-xs text-[var(--color-text-secondary)]'>每个角色独立保存正面和负面原文。</p>}
    </section>
    <details className='border-t border-[var(--color-border)] px-3 py-3' open>
      <summary className='cursor-pointer text-xs font-medium'>随机池与固定质量词</summary>
      <div className='mt-3 flex flex-wrap items-center gap-2'><Button size='sm' disabled={readOnly} onClick={() => { let name = 'pool_' + (document.randomPools.length + 1); while (document.randomPools.some(pool => pool.name === name)) name += '_'; commitDocument({ ...document, randomPools: [...document.randomPools, { id: crypto.randomUUID(), name, options: [] }] }, '添加随机池', 'typing') }}>添加随机池</Button><label className='flex items-center gap-1 text-xs'><span>种子</span><input aria-label='种子' value={document.generation.seed} readOnly={readOnly} onFocus={() => focus('generation:seed')} onBlur={blur} onChange={event => commitDocument({ ...document, generation: { ...document.generation, seed: event.target.value } }, '编辑生成参数', 'typing', group('generation:seed'))} className='ui-field w-28 min-w-[6rem] px-2 py-1 text-xs' /></label><Button size='sm' disabled={readOnly} onClick={previewSample}>预览随机抽样</Button><span className='text-[11px] text-[var(--color-text-secondary)]'>每个标记抽一个选项</span></div>
      {document.randomPools.map((pool, index) => <div key={pool.id} className='mt-3 flex flex-wrap items-start gap-2'>
        <label className='flex min-w-[min(100%,10rem)] flex-1 flex-col gap-1 text-xs'><span>随机池 {index + 1}</span><input aria-label={'随机池 ' + (index + 1) + ' 名称'} value={pool.name} readOnly={readOnly} onChange={event => commitDocument({ ...document, randomPools: document.randomPools.map(item => item.id === pool.id ? { ...item, name: event.target.value } : item) }, '随机池名称', 'typing', group('pool-name:' + pool.id))} onFocus={() => focus('pool-name:' + pool.id)} onBlur={blur} className='ui-field min-w-[min(100%,8rem)] px-2 py-1 text-xs' /></label>
        <label className='flex min-w-[min(100%,12rem)] basis-[20rem] flex-1 flex-col gap-1 text-xs'><span>选项（每行一个）</span><textarea aria-label={'随机池 ' + (index + 1) + ' 选项（每行一个）'} value={pool.options.join('\n')} readOnly={readOnly} onFocus={() => focus('pool-options:' + pool.id)} onBlur={blur} onChange={event => commitDocument({ ...document, randomPools: document.randomPools.map(item => item.id === pool.id ? { ...item, options: event.target.value.split(/\r?\n/) } : item) }, '随机池选项', 'typing', group('pool-options:' + pool.id))} className='ui-field min-h-[5rem] min-w-[min(100%,8rem)] px-2 py-1 text-xs' /></label>
        <Button size='sm' aria-label={'移除随机池 ' + (index + 1)} disabled={readOnly} icon={Trash2} onClick={() => commitDocument({ ...document, randomPools: document.randomPools.filter(item => item.id !== pool.id) }, '移除随机池', 'typing')} />
      </div>)}
      {sample && <div className='mt-3 text-xs'><output aria-label='随机抽样预览' className='block whitespace-pre-wrap break-words font-mono'>{sample.text}</output><div className='mt-2 flex flex-wrap gap-1'><Button size='sm' disabled={readOnly} onClick={applySample}>应用抽样</Button><Button size='sm' variant='ghost' onClick={() => setSample(null)}>取消抽样</Button></div></div>}
      <div className='mt-4 flex flex-wrap items-center gap-2'>
        <label className='flex items-center gap-2 text-xs'><input type='checkbox' aria-label='自动追加质量词' className='ui-checkbox' checked={document.quality.enabled} disabled={readOnly} onChange={event => quality({ ...document, quality: { enabled: event.target.checked, tokens: event.target.checked && !document.quality.tokens.length ? ['best quality', 'very aesthetic'] : document.quality.tokens } })} />自动追加质量词</label>
        <input aria-label='固定质量词（逗号分隔）' value={document.quality.tokens.join(', ')} placeholder='best quality, very aesthetic' readOnly={readOnly} onFocus={() => focus('quality')} onBlur={() => { const edited = focusGroup.current?.edited; blur(); if (edited && document.quality.enabled) quality(document) }} onChange={event => { const value = event.target.value; const commas = scanPromptSyntax(value).commas; const tokens = [0, ...commas.map(position => position + 1)].map((start, index) => value.slice(start, commas[index] ?? value.length).trim()).filter(Boolean); if (commitDocument({ ...document, quality: { ...document.quality, tokens } }, '固定质量词', 'typing', group('quality')) && focusGroup.current) focusGroup.current.edited = value !== document.quality.tokens.join(', ') }} className='ui-field min-w-[min(100%,12rem)] flex-1 px-2 py-1 text-xs' />
        <Button size='sm' disabled={readOnly || !document.quality.enabled} onClick={() => quality(document)}>追加质量词</Button>
      </div>
    </details>
    <details className='border-t border-[var(--color-border)] px-3 py-3' aria-label='生成参数'>
      <summary className='cursor-pointer text-xs font-medium'>生成参数{Object.keys(document.metadataUnknown).length ? ' · 保留 ' + Object.keys(document.metadataUnknown).length + ' 个未知字段' : ''}</summary>
      <div className='mt-3 flex flex-wrap gap-2'>{(Object.entries(generationLabels) as Array<[keyof NovelaiGeneration, string]>).filter(([key]) => key !== 'seed').map(([key, label]) => <label key={key} className='flex min-w-[min(100%,10rem)] flex-1 items-center gap-1 text-[11px]'><span className='shrink-0 text-[var(--color-text-secondary)]'>{label}</span><input aria-label={label} value={document.generation[key]} readOnly={readOnly} onFocus={() => focus('generation:' + key)} onBlur={blur} onChange={event => commitDocument({ ...document, generation: { ...document.generation, [key]: event.target.value } }, '编辑生成参数', 'typing', group('generation:' + key))} className='ui-field min-w-[min(100%,6rem)] flex-1 px-2 py-1 text-xs' /></label>)}</div>
      {Object.keys(document.metadataUnknown).length > 0 && <p className='mt-2 break-words text-[11px] text-[var(--color-text-secondary)]'>未知字段：{Object.keys(document.metadataUnknown).join('、')}</p>}
    </details>
  </div>
}
