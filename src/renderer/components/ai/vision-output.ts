export interface VisionSuggestion {
  en: string
  zh: string
}

export function parseVisionSuggestions(text: string): VisionSuggestion[] {
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map(item => ({
        en: typeof item === 'object' && item !== null ? String(item.en || item.tag || '') : String(item),
        zh: typeof item === 'object' && item !== null ? String(item.zh || '') : '',
      })).filter(item => item.en.trim().length > 0)
    }
  } catch {
    // Fall through to the line parser for non-JSON model output.
  }

  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/[,，]/)
    return { en: parts[0]?.trim() || line, zh: parts[1]?.trim() || '' }
  })
}
