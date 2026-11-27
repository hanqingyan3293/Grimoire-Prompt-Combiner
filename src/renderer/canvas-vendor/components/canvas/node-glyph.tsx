import type { ReactNode } from "react"
import { Circle, Diamond, Eye, FileText, Globe, Hand, Image as ImageIcon, Layers, Moon, Move, Pencil, Pin, RefreshCw, Sparkles, StickyNote, Sun, Type, Video } from "lucide-react"

/** Plugin and node icons are declared as short semantic keys (`globe`, `sparkles`, `hand`) so no
 * emoji glyph ever reaches the canvas UI. Legacy emoji keys stay mapped because saved node metadata
 * and third-party plugins still carry them; anything unknown renders nothing and leaves the label,
 * which is better than shipping a colour emoji the user has ruled out. */
const GLYPHS: Record<string, typeof Circle> = {
  globe: Globe,
  sparkles: Sparkles,
  refresh: RefreshCw,
  pin: Pin,
  note: FileText,
  eye: Eye,
  pencil: Pencil,
  diamond: Diamond,
  hand: Hand,
  move: Move,
  image: ImageIcon,
  layers: Layers,
  moon: Moon,
  sun: Sun,
  type: Type,
  video: Video,
  sticky: StickyNote,
  "\u{1F310}": Globe,
  "\u{2728}": Sparkles,
  "\u{1F504}": RefreshCw,
  "\u{1F4CC}": Pin,
  "\u{1F4DD}": FileText,
  "\u{1F441}": Eye,
  "\u{270E}": Pencil,
  "\u{1F537}": Diamond,
  "\u{270B}": Hand,
  "\u{1F590}": Move,
  "\u{1F5BC}": ImageIcon,
  "\u{1F5BC}\u{FE0F}": ImageIcon,
  "\u{1F319}": Moon,
  "\u{2600}": Sun,
  "\u{2600}\u{FE0F}": Sun,
}

export function nodeGlyph(icon: string | undefined, size = 14): ReactNode {
  if (!icon) return null
  const Glyph = GLYPHS[icon]
  return Glyph ? <Glyph size={size} aria-hidden="true" /> : null
}

/** Render an icon slot that may already hold an element (host-provided) or a plugin key string. */
export function renderIconSlot(icon: ReactNode, size = 14): ReactNode {
  return typeof icon === "string" ? nodeGlyph(icon, size) : icon
}
