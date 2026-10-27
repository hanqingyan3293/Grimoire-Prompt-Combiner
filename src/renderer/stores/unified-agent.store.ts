import { create } from 'zustand'

const ACTIVE_SESSION_KEY = 'grimoire-agent-active-session'

type UnifiedAgentState = {
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
}

function readActiveSessionId() {
  try { return window.localStorage.getItem(ACTIVE_SESSION_KEY) || null } catch { return null }
}

export const useUnifiedAgentStore = create<UnifiedAgentState>((set) => ({
  activeSessionId: typeof window === 'undefined' ? null : readActiveSessionId(),
  setActiveSessionId: (id) => {
    set({ activeSessionId: id })
    try {
      if (id) window.localStorage.setItem(ACTIVE_SESSION_KEY, id)
      else window.localStorage.removeItem(ACTIVE_SESSION_KEY)
    } catch {}
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === ACTIVE_SESSION_KEY) useUnifiedAgentStore.setState({ activeSessionId: event.newValue || null })
  })
}
