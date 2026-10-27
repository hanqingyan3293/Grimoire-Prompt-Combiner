// Public contract for the owned Node staging script, not a declaration of vendor APIs.
export const compatRoot: string
export const sourceRoot: string
export const stagingRoot: string
export const authenticTreeSha256: string
export function collectStage(referenceRoot: string): Map<string, Buffer>
export function stageSourceShell(referenceRoot: string, options?: { check?: boolean }): number
