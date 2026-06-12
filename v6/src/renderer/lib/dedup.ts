export function deduplicateArray<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>()
  return arr.filter(item => {
    const key = keyFn(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function formatWeightedTag(en: string, weight: number): string {
  return weight === 1.0 ? en : `(${en}:${weight})`
}
