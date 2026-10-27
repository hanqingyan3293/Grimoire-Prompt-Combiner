import { describe, expect, it } from 'vitest'
import { detectCherryHtmlArtifact } from './markdown-artifacts'

describe('Cherry Markdown artifact adapter', () => {
  it('uses Cherry source logic to detect a standalone HTML fence', () => {
    const fence = String.fromCharCode(96).repeat(3)
    const artifact = detectCherryHtmlArtifact([fence + 'html', '<div>Hello</div>', fence].join('\n'))
    expect(artifact).toMatchObject({ kind: 'fragment', source: 'fence', html: '<div>Hello</div>' })
  })

  it('does not classify mixed Markdown as a standalone artifact', () => {
    const fence = String.fromCharCode(96).repeat(3)
    expect(detectCherryHtmlArtifact([fence + 'html', '<div>Hello</div>', fence, '', 'more text'].join('\n'))).toBeUndefined()
  })

  it('keeps an incomplete HTML document in streaming mode only', () => {
    expect(detectCherryHtmlArtifact('<html><body>Loading', false)).toBeUndefined()
    expect(detectCherryHtmlArtifact('<html><body>Loading', true)).toMatchObject({ kind: 'document', source: 'document' })
  })
})
