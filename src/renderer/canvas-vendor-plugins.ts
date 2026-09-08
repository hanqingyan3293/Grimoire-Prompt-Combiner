import { activatePlugin } from '@canvas/lib/canvas/plugin-loader'
import htmlPlugin from './canvas-vendor-plugins/html/src/index'
import markdownPlugin from './canvas-vendor-plugins/markdown/src/index'
import panoramaPlugin from './canvas-vendor-plugins/panorama/src/index'
import stickyNotePlugin from './canvas-vendor-plugins/sticky-note/src/index'
import svgPlugin from './canvas-vendor-plugins/svg/src/index'
import type { CanvasPlugin } from '@canvas/types/canvas-plugin'

/** Local, bundled extensions from basketikun/infinite-canvas. No remote URL loading. */
export function registerBundledCanvasPlugins() {
  const plugins = [htmlPlugin, markdownPlugin, panoramaPlugin, stickyNotePlugin, svgPlugin] as unknown as CanvasPlugin[]
  for (const plugin of plugins) {
    activatePlugin(plugin)
  }
}
