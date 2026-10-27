import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'src', 'vendor', 'cherry', 'compat', 'dist')
const target = path.join(root, 'dist', 'cherry-compat')

if (!fs.existsSync(source)) {
  throw new Error('Cherry compatibility bundle is missing. Run npm run build:cherry-compat first.')
}

fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(source, target, { recursive: true })
console.log('[cherry] copied compatibility bundle to ' + path.relative(root, target))
