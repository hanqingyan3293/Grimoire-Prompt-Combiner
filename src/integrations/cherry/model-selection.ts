import {
  computeCollapsedSelection,
  computeToggledSelection
} from '../../../src/vendor/cherry/source/src/renderer/components/ModelSelector/selection'

export { computeCollapsedSelection, computeToggledSelection }

export function toggleCherryModelSelection(currentIds: readonly string[], modelId: string): string[] {
  return computeToggledSelection(currentIds as never, modelId as never) as unknown as string[]
}

export function collapseCherryModelSelection(resolvedIds: readonly string[], rawIds: readonly string[]): string[] | null {
  return computeCollapsedSelection(resolvedIds as never, rawIds as never) as unknown as string[] | null
}
