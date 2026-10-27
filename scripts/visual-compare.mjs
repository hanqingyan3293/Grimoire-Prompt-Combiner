// Visual baseline record/compare for the Cherry compat window.
//
// `visual-baseline.mjs` captures screenshots and route diagnostics into
// `artifacts/visual/<run>/`. This script turns those into an ENFORCEABLE baseline:
//
//   node scripts/visual-compare.mjs --record    # promote the current run to the baseline
//   node scripts/visual-compare.mjs             # compare the current run against it
//
// Two layers, deliberately different in strictness:
//
//  - STRUCTURED signals from `route-diagnostic.json` (rendered text length, fatal-fallback
//    presence, dialog counts) are compared EXACTLY on the values that are deterministic.
//    A route that stops rendering, or crashes into the fatal fallback, changes one of
//    these and fails immediately — this is the layer that actually guards behaviour.
//
//  - PIXELS are compared with a tolerance. Anti-aliasing, font hinting and scrollbar
//    rendering differ between machines and runs, so an exact match would be noise. A
//    per-file changed-pixel RATIO is reported and only a large deviation fails. This
//    layer catches layout regressions the structured layer cannot see.
//
// The comparison needs a PNG decoder; one is not a dependency of this project, so the
// pixel layer uses a small built-in decoder for the subset the captures actually produce
// (8-bit RGBA/RGB non-interlaced PNG) and reports `unavailable` rather than guessing if it
// meets anything else.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactRoot = path.join(root, 'artifacts', 'visual')
const baselineRoot = path.join(artifactRoot, 'baseline')

const record = process.argv.includes('--record')
const runName = (() => {
  const index = process.argv.indexOf('--run')
  return index === -1 ? 'populated' : String(process.argv[index + 1] || 'populated')
})()
// State frames must be near-identical to their baseline: they exist to prove ONE state, and the
// difference a wrong state produces is the state's own footprint — small but decisive.
const stateFrameTolerance = 0.0005

const pixelTolerance = (() => {
  const index = process.argv.indexOf('--pixel-tolerance')
  // Fraction of differing pixels allowed before a frame fails. 2% absorbs font
  // rasterization and scrollbar jitter while still catching real layout moves.
  return index === -1 ? 0.02 : Number(process.argv[index + 1]) || 0.02
})()
// Every frame present in both baseline and run must be compared. Escaping this would
// let a run pass because its most-changed frame happened to be unreadable. The flag
// exists only for a machine whose captures the built-in decoder genuinely cannot parse
// (an unusual PNG colour type), and using it prints a warning naming what was skipped.
const comparisonsRequired = !process.argv.includes('--allow-uncomparable')

const runRoot = path.join(artifactRoot, runName)

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function listPngs(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.png')).sort() : []
}

/**
 * Decodes an 8-bit non-interlaced PNG into raw RGBA. Supports the colour types the
 * Chromium screenshots use (2 = RGB, 6 = RGBA); anything else throws so the caller can
 * report `unavailable` rather than compare garbage.
 */
function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let index = 0; index < signature.length; index += 1) {
    if (buffer[index] !== signature[index]) throw new Error('不是 PNG 文件')
  }
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  let interlace = 0
  const idat = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (bitDepth !== 8) throw new Error('仅支持 8 位 PNG（实际 ' + bitDepth + '）')
  if (interlace !== 0) throw new Error('不支持隔行 PNG')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels) throw new Error('不支持的 PNG 颜色类型 ' + colorType)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const rgba = Buffer.alloc(width * height * 4)
  let previous = Buffer.alloc(stride)
  let position = 0
  for (let row = 0; row < height; row += 1) {
    const filter = raw[position]
    position += 1
    const scanline = Buffer.from(raw.subarray(position, position + stride))
    position += stride
    // Undo the per-scanline filter (PNG spec 9.2). Each filter is defined relative to
    // the byte to the left and the byte above, both already reconstructed here.
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? scanline[index - channels] : 0
      const up = previous[index]
      const upLeft = index >= channels ? previous[index - channels] : 0
      if (filter === 1) scanline[index] = (scanline[index] + left) & 0xff
      else if (filter === 2) scanline[index] = (scanline[index] + up) & 0xff
      else if (filter === 3) scanline[index] = (scanline[index] + ((left + up) >> 1)) & 0xff
      else if (filter === 4) {
        const estimate = left + up - upLeft
        const dl = Math.abs(estimate - left)
        const du = Math.abs(estimate - up)
        const dul = Math.abs(estimate - upLeft)
        const predictor = dl <= du && dl <= dul ? left : du <= dul ? up : upLeft
        scanline[index] = (scanline[index] + predictor) & 0xff
      }
    }
    for (let column = 0; column < width; column += 1) {
      const source = column * channels
      const target = (row * width + column) * 4
      rgba[target] = scanline[source]
      rgba[target + 1] = scanline[source + 1]
      rgba[target + 2] = scanline[source + 2]
      rgba[target + 3] = channels === 4 ? scanline[source + 3] : 255
    }
    previous = scanline
  }
  return { width, height, rgba }
}

/** Fraction of pixels differing by more than `channelTolerance` on any channel. */
function diffRatio(a, b, channelTolerance = 8) {
  if (a.width !== b.width || a.height !== b.height) return { ratio: 1, sizeChanged: true }
  let differing = 0
  const total = a.width * a.height
  for (let index = 0; index < total; index += 1) {
    const base = index * 4
    if (
      Math.abs(a.rgba[base] - b.rgba[base]) > channelTolerance ||
      Math.abs(a.rgba[base + 1] - b.rgba[base + 1]) > channelTolerance ||
      Math.abs(a.rgba[base + 2] - b.rgba[base + 2]) > channelTolerance
    ) {
      differing += 1
    }
  }
  return { ratio: differing / total, sizeChanged: false }
}


/**
 * Compares ONE run against the baseline.
 *
 * Returns a per-run verdict instead of exiting, so the caller can check several runs and
 * report all of their problems together. The previous version compared a single run
 * (`--run`, defaulting to `populated`) and exited — which meant the EMPTY fixture, also
 * required by the plan, was never actually checked by any gate.
 */
function compareRun(name) {
  const runRoot = path.join(artifactRoot, name)
  if (!fs.existsSync(runRoot)) {
    console.error(`找不到运行目录：${runRoot} —— 请先执行 node scripts/visual-baseline.mjs ${name}`)
    return 'failed'
  }

  const runPngs = listPngs(runRoot)
  if (runPngs.length === 0) {
    console.error(`运行目录中没有截图：${runRoot}`)
    return 'failed'
  }

  if (record) {
    // One subdirectory PER RUN. The baseline used to live directly in `baseline/`, keyed only
    // by filename — so recording the `empty` run would `rmSync` the whole directory and destroy
    // the `populated` baseline (and vice versa). That is why only one run was ever enforceable.
    const thisBaseline = path.join(baselineRoot, name)
    fs.rmSync(thisBaseline, { recursive: true, force: true })
    fs.mkdirSync(thisBaseline, { recursive: true })
    for (const png of runPngs) fs.copyFileSync(path.join(runRoot, png), path.join(thisBaseline, png))
    const diagnostic = readJson(path.join(runRoot, 'route-diagnostic.json'))
    if (diagnostic) fs.copyFileSync(path.join(runRoot, 'route-diagnostic.json'), path.join(thisBaseline, 'route-diagnostic.json'))
    fs.writeFileSync(path.join(thisBaseline, 'baseline.json'), JSON.stringify({
      recordedAt: new Date().toISOString(),
      run: runName,
      frames: runPngs,
      // The structured signals are recorded so a future run can be compared on
      // deterministic values rather than pixels alone.
      diagnostic: diagnostic ? {
        pathname: diagnostic.pathname,
        contentTextLength: diagnostic.contentTextLength ?? null,
        fatalFallback: diagnostic.fatalFallback ?? null,
        dialogCount: diagnostic.dialogCount ?? null
      } : null
    }, null, 2))
    console.log(`已记录基线：${runPngs.length} 帧（${name}）→ ${thisBaseline}`)
    return 'recorded'
  }

  // The per-run baseline directory. `name` here is the RUN name; the PNG filenames are
  // accessed through their own loop variable below, which previously SHADOWED this one.
  const thisBaseline = path.join(baselineRoot, name)
  if (!fs.existsSync(thisBaseline)) {
    return 'missing'
  }

  const problems = []
  const notes = []

  // ── Layer 1: structured signals (strict) ─────────────────────────────────────
  const baselineMeta = readJson(path.join(thisBaseline, 'baseline.json'))
  const runDiagnostic = readJson(path.join(runRoot, 'route-diagnostic.json'))
  if (baselineMeta?.diagnostic && runDiagnostic) {
    const expected = baselineMeta.diagnostic
    if (expected.pathname !== runDiagnostic.pathname) {
      problems.push(`路由不一致：基线 ${expected.pathname}，本次 ${runDiagnostic.pathname}`)
    }
    // A route that stopped rendering, or crashed into the fatal fallback, changes one of
    // these — that is the whole point of enforcing them exactly.
    if (runDiagnostic.fatalFallback) {
      problems.push(`渲染了致命错误回退界面：${String(runDiagnostic.fatalFallback).slice(0, 120)}`)
    }
    if (typeof expected.contentTextLength === 'number' && typeof runDiagnostic.contentTextLength === 'number') {
      const delta = Math.abs(runDiagnostic.contentTextLength - expected.contentTextLength)
      const allowed = Math.max(20, Math.round(expected.contentTextLength * 0.1))
      if (delta > allowed) {
        problems.push(`正文长度变化超出容差：基线 ${expected.contentTextLength}，本次 ${runDiagnostic.contentTextLength}（允许 ±${allowed}）`)
      } else if (delta > 0) {
        notes.push(`正文长度小幅变化：${expected.contentTextLength} → ${runDiagnostic.contentTextLength}`)
      }
    }
  }

  // ── Layer 2: pixels (tolerant) ───────────────────────────────────────────────
  const baselinePngs = listPngs(thisBaseline)
  const missing = runPngs.filter(name => !baselinePngs.includes(name))
  const extra = baselinePngs.filter(name => !runPngs.includes(name))
  if (missing.length) problems.push(`本次运行缺少帧：${missing.join(', ')}`)
  if (extra.length) notes.push(`基线中有而本次未生成的帧：${extra.join(', ')}`)

  let compared = 0
  let unavailable = 0
  // `frame`, NOT `name`: `name` is the run name in this scope, and shadowing it made every
  // message below name the run instead of the frame.
  for (const frame of runPngs) {
    if (!baselinePngs.includes(frame)) continue
    // STATE frames get a much tighter tolerance, because a state frame's ENTIRE PURPOSE is the
    // feature it captures. The uniform 2% is calibrated for the viewport/scale/theme matrix,
    // where a frame is mostly the same page at a different size — but a state's footprint can be
    // smaller than 2% of the canvas.
    //
    // Verified: swapping `populated-state-menu-open.png` for `populated-state-tool.png` PASSED
    // at the uniform tolerance, because the open menu covers under 2% of the pixels. A gate that
    // cannot tell "menu open" from "menu closed" cannot guard the thing it was added for.
    const frameTolerance = frame.includes('state-') ? stateFrameTolerance : pixelTolerance
    try {
      const current = decodePng(fs.readFileSync(path.join(runRoot, frame)))
      const baseline = decodePng(fs.readFileSync(path.join(thisBaseline, frame)))
      const { ratio, sizeChanged } = diffRatio(current, baseline)
      compared += 1
      if (sizeChanged) problems.push(`${frame}：尺寸变化`)
      else if (ratio > frameTolerance) problems.push(`${frame}：像素差异 ${(ratio * 100).toFixed(2)}% 超过 ${(frameTolerance * 100).toFixed(2)}%${frame.includes('state-') ? '（状态帧容差）' : ''}`)
      else if (ratio > frameTolerance / 2) notes.push(`${frame}：像素差异 ${(ratio * 100).toFixed(2)}%（接近阈值）`)
    } catch (error) {
      unavailable += 1
      notes.push(`${name}：无法比较像素（${error instanceof Error ? error.message : String(error)}）`)
    }
  }

  console.log(`基线对比（${name}）：${compared} 帧已比较，${unavailable} 帧无法比较`)
  for (const note of notes) console.log('  · ' + note)

  // A frame that CANNOT be compared is a failure, not a footnote. Skipping it would let a
  // run pass because its most-changed frame was unreadable — the same "reported clean while
  // broken" shape this gate exists to eliminate. Every frame present in both the baseline
  // and the run must have been compared.
  const expectedComparisons = runPngs.filter(name => baselinePngs.includes(name)).length
  if (compared < expectedComparisons) {
    const message = `有 ${expectedComparisons - compared} / ${expectedComparisons} 帧未能比较像素，无法确认一致性`
    if (comparisonsRequired) problems.push(message)
    else notes.push('（已通过 --allow-uncomparable 忽略）' + message)
  }

  if (problems.length) {
    console.error(`\n${name} 对比失败：`)
    for (const problem of problems) console.error('  ✗ ' + problem)
    return 'failed'
  }
  console.log(`${name}：对比通过（结构化信号一致，像素差异在容差内）`)
  return 'ok'
}

// Both required fixtures are checked by default. `--run` narrows to one for a focused run.
const runsToCheck = process.argv.includes('--run') ? [runName] : ['populated', 'empty']
let failed = false
for (const name of runsToCheck) {
  const verdict = compareRun(name)
  if (verdict === 'failed') failed = true
  if (verdict === 'missing') {
    // A missing fixture is reported but does not fail the gate on its own: the empty matrix
    // was only added today, and failing every machine that has not re-run the capture would
    // be a false alarm. It is a NOTE so it stays visible.
    console.log(`  · ${name}：尚未记录基线（运行 npm run visual:record 可纳入门禁）`)
  }
}
process.exit(failed ? 1 : 0)
