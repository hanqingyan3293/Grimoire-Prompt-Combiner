// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tag } from '@shared/types'
import { TagAutocomplete } from './TagAutocomplete'

const tags: Tag[] = [
  { id: 'tag_1', subcategory_id: 'sub', en: '1girl', zh: '单个女孩', sort_order: 0, source: 'builtin', created_at: '' },
  { id: 'tag_2', subcategory_id: 'sub', en: 'solo', zh: '单人', sort_order: 1, source: 'builtin', created_at: '' },
]

beforeEach(() => {
  vi.useFakeTimers()
  ;(window as unknown as { api: unknown }).api = { tags: { searchAdvanced: vi.fn().mockResolvedValue([]) } }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TagAutocomplete', () => {
  it('shows locals instantly and selects with Enter', () => {
    const onSelect = vi.fn()
    render(<TagAutocomplete allTags={tags} onSelect={onSelect} />)
    const input = screen.getByRole('combobox', { name: '标签自动补全' })

    fireEvent.change(input, { target: { value: '1g' } })

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain('1girl')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'tag_1' }))
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('navigates with arrow keys before selecting', () => {
    const onSelect = vi.fn()
    render(<TagAutocomplete allTags={tags} onSelect={onSelect} />)
    const input = screen.getByRole('combobox', { name: '标签自动补全' })

    fireEvent.change(input, { target: { value: 'l' } })
    const options = screen.getAllByRole('option')
    expect(options.length).toBe(2)

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'tag_2' }))
  })

  it('ignores Enter while composing (IME safety)', () => {
    const onSelect = vi.fn()
    render(<TagAutocomplete allTags={tags} onSelect={onSelect} />)
    const input = screen.getByRole('combobox', { name: '标签自动补全' })

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '单' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('hides excluded ids and closes on Escape', () => {
    const onSelect = vi.fn()
    render(<TagAutocomplete allTags={tags} onSelect={onSelect} excludeIds={['tag_1']} />)
    const input = screen.getByRole('combobox', { name: '标签自动补全' })

    fireEvent.change(input, { target: { value: 'g' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    fireEvent.change(input, { target: { value: 'solo' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})