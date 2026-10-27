import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { surfaceIdentity, pngDigest, verifiedCapture } from './cherry-ui-capture-evidence.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const run = process.argv[2]
if (!run) throw new Error('Provide an isolated source-shell run directory')
const runRoot = path.resolve(root, run)
const report = JSON.parse(fs.readFileSync(path.join(runRoot, 'smoke.json'), 'utf8'))
if (!report.passed || !report.checks.isolatedProfile || report.profileRemoved !== true) throw new Error('Source interaction run or isolation/cleanup did not pass')
const directory = path.join(root, 'artifacts/cherry-ui-catalog')
const manifestPath = path.join(directory, '截图清单.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const definitions = [
  [71, 'session-context-menu', '会话右键菜单', 'src/vendor/cherry/source/src/renderer/components/chat/actions/ResourceListActionContextMenu.tsx', 'sessionContextMenuActualOpenAndDismiss'],
  [72, 'quick-panel-open', '快捷面板', 'src/vendor/cherry/source/src/renderer/components/QuickPanel/QuickPanelView.tsx', 'quickPanelActualOpenAndDismiss'],
  [73, 'message-delete-confirm', '消息删除确认弹窗', 'src/vendor/cherry/source/src/renderer/components/chat/messages/frame/MessageMenuBarToolbarRenderers.tsx', 'messageDeleteActualConfirmCancel']
]
for (const [sequence, key, name, sourceFile, check] of definitions) {
  const item = manifest.items.find(row => row.sequence === sequence)
  const interaction = report.interactions?.[key]
  if (!item || !interaction || !report.checks[check]) continue
  // Do not import a QuickPanel during its expanding animation.
  if (interaction.surface.bounds.height < (sequence === 72 ? 80 : 40)) continue
  if (sequence === 72 && (!interaction.keyboardNavigation || interaction.noMessageSent !== true)) continue
  if (sequence === 73 && interaction.cancelPreservedMessage !== true) continue
  item.name = name
  item.sourceFile = sourceFile
  item.route = '/app/agents'
  const filename = `06-${String(sequence).padStart(4, '0')}_聊天命令与弹窗-${name}.png`
  const source = path.join(runRoot, interaction.screenshot)
  fs.copyFileSync(source, path.join(directory, filename))
  item.screenshot = filename
  item.capture = 'passed'
  item.captureEvidence = {
    surfaceIdentity: surfaceIdentity(item), pngSha256: pngDigest(source),
    entry: 'source-shell', run: path.relative(root, runRoot).split(path.sep).join('/'),
    observedRoute: interaction.observedRoute, exitCode: 0,
    action: { inputMethod: interaction.inputMethod, dismissed: true, keyboardNavigation: interaction.keyboardNavigation, noMessageSent: interaction.noMessageSent, cancelPreservedMessage: interaction.cancelPreservedMessage },
    assertion: { passed: true, kind: item.kind, visible: true, bounds: interaction.surface.bounds, text: interaction.surface.text },
    viewport: { width: 1280, height: 800 }, nativeDpi: 'not verified'
  }
  if (!verifiedCapture(item, directory)) throw new Error(`Invalid imported interaction evidence ${sequence}`)
}
manifest.manualAcceptance = 'pending'
manifest.interactionVerification = definitions.map(([sequence]) => ({ sequence, verified: verifiedCapture(manifest.items.find(row => row.sequence === sequence), directory) }))
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest.interactionVerification, null, 2))
