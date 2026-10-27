import { describe, expect, it } from 'vitest'
import { collapseCherryModelSelection, toggleCherryModelSelection } from './model-selection'

describe('Cherry ModelSelector selection adapter', () => {
  it('preserves hidden selections when toggling a visible model', () => {
    expect(toggleCherryModelSelection(['hidden::model', 'visible::old'], 'visible::new')).toEqual([
      'hidden::model',
      'visible::old',
      'visible::new'
    ])
  })

  it('removes only the toggled model from the raw selection', () => {
    expect(toggleCherryModelSelection(['a::one', 'a::two'], 'a::one')).toEqual(['a::two'])
  })

  it('collapses multi-select to the first resolved model only when the value changes', () => {
    expect(collapseCherryModelSelection(['p::one', 'p::two'], ['p::one'])).toBeNull()
    expect(collapseCherryModelSelection(['p::one', 'p::two'], ['p::two', 'p::three'])).toEqual(['p::one'])
  })
})
