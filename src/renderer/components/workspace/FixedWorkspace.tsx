import React from "react"
import { PanelShell } from "./PanelShell"
import { PANEL_DEFINITIONS, renderPanel } from "./PanelRegistry"
import type { PanelType } from "./panelTypes"

interface FixedPanelSlot {
  id: string
  type: PanelType
  className: string
}

const FIXED_LAYOUT: FixedPanelSlot[] = [
  { id: "left-sidebar", type: "tag-sidebar", className: "w-[260px] min-w-[260px]" },
  { id: "main-workbench", type: "prompt-workbench", className: "flex-1" },
  { id: "right-sidebar", type: "utility-sidebar", className: "w-[320px] min-w-[320px]" },
]

export function FixedWorkspace() {
  return (
    <div className="flex flex-1 overflow-hidden">
      {FIXED_LAYOUT.map(slot => {
        const definition = PANEL_DEFINITIONS[slot.type]
        return (
          <PanelShell
            key={slot.id}
            id={slot.id}
            type={slot.type}
            title={definition.title}
            className={slot.className}
          >
            {renderPanel(slot.type)}
          </PanelShell>
        )
      })}
    </div>
  )
}

