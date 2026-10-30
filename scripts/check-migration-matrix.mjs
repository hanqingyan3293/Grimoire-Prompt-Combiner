// Validates the markdown tables in .agent/MIGRATION_MATRIX.md.
//
// An unescaped `|` inside prose silently merges two cells, which is how a row's verdict
// and its evidence end up in the wrong columns with nothing looking broken. The more
// common failure is an edit that inserts a blank line or a paragraph INSIDE a wide cell:
// that terminates the table entirely and orphans every following row, which reads as a
// formatting nit rather than eleven rows losing their header.
//
//   node scripts/check-migration-matrix.mjs [file] [--dump LINE[,LINE…]]
//
// Each table is checked against its own header's width, so a file with several tables at
// different widths is handled correctly. `--dump` prints one row's cells plus every pipe
// marked ESCAPED or BARE, which localizes the offending cell instead of guessing at it
// from the merged count.
import fs from 'node:fs'

const file = process.argv.find(arg => !arg.startsWith('--') && arg.endsWith('.md')) || '.agent/MIGRATION_MATRIX.md'
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)

// Split on pipes that are not backslash-escaped. A lookbehind is used rather than a
// capturing replace because `\|` must stay part of the preceding cell's text.
const splitRow = line => line.split(/(?<!\\)\|/)

let heading = ''
let checked = 0
const problems = []
const evidenceRows = []
// One width per table, not per file: the matrix holds several tables with different
// column counts, and a single file-wide expectation would flag every row of the others.
let expected = null
let inTable = false

lines.forEach((line, index) => {
  if (/^#{1,6}\s/.test(line)) {
    heading = line.trim()
    expected = null
    inTable = false
  }
  if (!line.trimStart().startsWith('|')) {
    // Any non-row line ends the table — that is exactly the signal an edit INSIDE a cell
    // produces, so the next row block re-establishes its own header width.
    inTable = false
    return
  }
  const trimmed = line.trim()
  const cells = splitRow(trimmed)
  // A row is `|a|b|c|` -> ['', 'a', 'b', 'c', ''].
  const width = cells.length - 2

  // The `|---|` separator confirms the preceding line was a header.
  if (/^\|[\s:|-]+\|$/.test(trimmed)) {
    if (expected === null) expected = width
    inTable = true
    return
  }
  if (!inTable) {
    // First row of a block: it is the header, and the separator that follows pins its width.
    if (expected === null) {
      expected = width
      return
    }
    // A new block starting while a width is still live means the previous table was cut.
    inTable = true
  }
  checked += 1
  if (width === 8) evidenceRows.push({ line: index + 1, name: (cells[1] || '').trim(), status: (cells[7] || '').trim(), evidence: cells[8] || '' })
  if (expected !== null && width !== expected) {
    problems.push({ line: index + 1, heading, width, expected, preview: trimmed.slice(0, 110) })
  }
})

// `--dump N[,M…]` prints one row's cells, so the offending cell can be read directly
// instead of guessed at from the merged-cell count.
const dumpArg = process.argv.indexOf('--dump')
if (dumpArg !== -1) {
  for (const n of String(process.argv[dumpArg + 1] || '').split(',')) {
    const line = lines[Number(n) - 1] || ''
    const cells = splitRow(line.trim())
    console.log(`\n--- line ${n} (${cells.length - 2} cells) ---`)
    cells.slice(1, -1).forEach((cell, i) => console.log(`  [${i}] ${cell.trim()}`))
    // Every pipe in the raw line, marked ESCAPED or BARE. A BARE pipe inside prose is
    // the defect; seeing them in order localizes which cell absorbed the split.
    const marks = []
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] !== '|') continue
      const escaped = line[i - 1] === '\\'
      marks.push(`${escaped ? 'ESC' : 'BARE'}@${i}`)
    }
    console.log('  raw pipes: ' + marks.join(' '))
    console.log('  ends with pipe: ' + line.trimEnd().endsWith('|'))
    for (const mark of marks) {
      const at = Number(mark.split('@')[1])
      console.log('   ' + mark + ' ctx=' + JSON.stringify(line.slice(Math.max(0, at - 26), at + 26)))
    }
  }
}


// Rule: every capability row must carry a verifiable pointer in its evidence cell — a file path, a test
// name, a command, or a measured number. A row that only asserts ("reimplemented clean-room", "parity
// delivered") cannot be checked by anyone reading it later, which is how the ledger starts lying.
const withoutPointer = []
for (const row of evidenceRows) {
  if (!/^(DIRECTLY_MIGRATED|VENDORED|WRAPPED|ADAPTED|MINIMAL_MODIFICATION|PARTIALLY_MIGRATED|BLOCKED|MISSING|REIMPLEMENTED|NOT_IMPLEMENTED)$/.test(row.status)) continue
  const evidence = row.evidence
  const verifiable = /\.(ts|tsx|mjs|json|md)/.test(evidence) || /npm run|node scripts|--[a-z-]+/.test(evidence) ||
    /test/i.test(evidence) || /src\//.test(evidence) || /grep|audit/i.test(evidence) || /\d/.test(evidence)
  if (!verifiable) withoutPointer.push(row)
}
console.log(`${file}: checked ${checked} data rows`)
if (problems.length === 0) {
  console.log('no malformed rows')
}
if (withoutPointer.length) {
  for (const row of withoutPointer) console.log(`  line ${row.line}: evidence has no verifiable pointer — ${row.name}`)
  process.exitCode = 1
}
if (problems.length) {
  for (const p of problems) {
    console.log(`  line ${p.line} (${p.width} vs ${p.expected}) ${p.heading}\n    ${p.preview}`)
  }
  process.exitCode = 1
}
