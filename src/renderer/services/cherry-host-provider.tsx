import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import type { CherryHostBridge } from '@shared/cherry-host-types'
import { getCherryHostBridge } from './cherry-host-bridge'

const CherryHostContext = createContext<CherryHostBridge | null>(null)

export function CherryHostProvider({ bridge, children }: PropsWithChildren<{ bridge?: CherryHostBridge }>) {
  const fallbackBridge = useMemo(() => getCherryHostBridge(), [])
  return <CherryHostContext.Provider value={bridge || fallbackBridge}>{children}</CherryHostContext.Provider>
}

export function useCherryHost(): CherryHostBridge {
  const bridge = useContext(CherryHostContext)
  if (!bridge) throw new Error('useCherryHost must be used inside CherryHostProvider')
  return bridge
}

export { CherryHostContext }
