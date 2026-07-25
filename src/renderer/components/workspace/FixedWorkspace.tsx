import React from "react"
import { PanelShell } from "./PanelShell"
import { PANEL_DEFINITIONS, renderPanel } from "./PanelRegistry"
import { useWorkspaceStore } from "../../stores/workspace.store"

export function FixedWorkspace() {
  const workspace = useWorkspaceStore(s => s.getActiveWorkspace())

  return (
    <div className="flex flex-1 overflow-hidden">
      {workspace.slots.map(slot => {
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
