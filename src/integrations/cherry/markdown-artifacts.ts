import { scanStandaloneHtmlArtifact } from '../../../src/vendor/cherry/source/src/renderer/components/chat/messages/markdown/standaloneHtmlArtifact'

export type CherryHtmlArtifact = {
  html: string
  kind: 'document' | 'fragment'
  source: 'document' | 'fence'
  start: { line: number; column: number; offset?: number }
}

/** Grimoire boundary for the Cherry standalone HTML artifact detector. */
export function detectCherryHtmlArtifact(source: string, isStreaming = false): CherryHtmlArtifact | undefined {
  return scanStandaloneHtmlArtifact(source, isStreaming) as CherryHtmlArtifact | undefined
}
