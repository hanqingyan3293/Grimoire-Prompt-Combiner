// Minimal, dependency-free HTML → text (M3).
//
// Not a readability engine: it removes scripts/styles and collapses whitespace, which is enough to
// feed a model a page's text. Keeping it small and auditable beats pulling a parser with a DOM
// implementation into the main process for this one job.
const DROP_BLOCKS = /<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi
const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10))
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = TITLE.exec(html)
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : ''
  const body = html
    .replace(DROP_BLOCKS, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body)
    .split('\n')
    .map(line => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return { title, text }
}
