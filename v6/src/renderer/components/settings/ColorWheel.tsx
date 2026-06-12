import React, { useState } from 'react'

interface ColorWheelProps {
  accentColor: string
  onChange: (color: string) => void
}

const PRESET_PALETTES = [
  ['#7c3aed','#6366f1','#8b5cf6','#a78bfa','#c4b5fd'],
  ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6'],
  ['#ec4899','#f43f5e','#f59e0b','#10b981','#06b6d4'],
  ['#1e1b4b','#312e81','#3730a3','#4338ca','#4f46e5'],
  ['#064e3b','#047857','#059669','#10b981','#34d399'],
  ['#7f1d1d','#991b1b','#b91c1c','#dc2626','#ef4444'],
]

const ColorWheel: React.FC<ColorWheelProps> = ({ accentColor, onChange }) => {
  const [customHex, setCustomHex] = useState(accentColor)

  return (
    <div className="space-y-3">
      {/* Native color picker */}
      <div className="flex items-center gap-3">
        <input type="color" value={accentColor} onChange={e => { onChange(e.target.value); setCustomHex(e.target.value) }}
          className="w-10 h-10 rounded cursor-pointer border-0 p-0" />
        <input type="text" value={customHex} onChange={e => { setCustomHex(e.target.value); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value) }}
          className="flex-1 px-3 py-2 rounded-lg text-sm"
          style={{ backgroundColor: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }} />
        <div className="w-8 h-8 rounded-lg border" style={{ backgroundColor: accentColor, borderColor: 'var(--color-border)' }} />
      </div>

      {/* Preset palettes */}
      <div>
        <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>Preset Palettes</p>
        <div className="space-y-1">
          {PRESET_PALETTES.map((palette, pi) => (
            <div key={pi} className="flex gap-1">
              {palette.map((color, ci) => (
                <button key={ci} onClick={() => onChange(color)}
                  className="w-8 h-8 rounded-md border-2 transition-all hover:scale-110"
                  style={{ backgroundColor: color, borderColor: accentColor===color ? 'var(--color-text-primary)' : 'transparent' }}
                  title={color} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ColorWheel