// @vitest-environment jsdom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { FixedWorkspace } from './FixedWorkspace'

const io=vi.hoisted(()=>({ready:false,readyCheck:vi.fn(),prepare:vi.fn(async()=>({ok:false,code:'FIXTURE_STOP',message:'no target required'}))}))
vi.mock('./PanelRegistry',()=>({PANEL_DEFINITIONS:{'novelai-workbench':{title:'workbench'}},ENABLED_PANEL_OPTIONS:[],PANEL_OPTION_GROUPS:[],renderPanel:()=> <span>editor content</span>}))
vi.mock('./PanelShell',()=>({PanelShell:({children}: {children:React.ReactNode})=><div>{children}</div>}))
vi.mock('./WorkspaceEditorHost',async()=>{
  const {registerEditorTransferHandle}=await import('./editor-transfer-client')
  return {WorkspaceEditorHost:({workspaceId,editorId,type,children}:{workspaceId:string;editorId:string;type:string;children:React.ReactNode})=>{
    React.useEffect(()=>registerEditorTransferHandle(workspaceId+':'+editorId+':'+type,{ready:()=>{io.readyCheck();return io.ready},freeze:async()=>{},thaw:()=>{},flush:async()=>({status:'saved',revision:3})}),[workspaceId,editorId,type])
    return children
  }}
})
beforeEach(()=>{
  vi.clearAllMocks();io.ready=false
  useWorkspaceStore.setState({activeWorkspaceId:'compose',maximizedPanels:{},floatingPanels:{},popoutPanels:{compose:['restored']},restoringPopouts:{compose:['restored']},layouts:{compose:{kind:'panel',id:'restored',type:'novelai-workbench',tabs:[{id:'restored-editor',type:'novelai-workbench'}],activeTabId:'restored-editor'}}})
  Object.assign(window,{api:{workspace:{prepareTransfer:io.prepare,onTransferChanged:()=>()=>{},pendingTransfers:async()=>[],isPopoutOpen:async()=>false}}})
})
afterEach(()=>{cleanup();useWorkspaceStore.setState({layouts:{},popoutPanels:{},restoringPopouts:{},maximizedPanels:{}})})
describe('restored editor source readiness',()=>{
  it('does not prepare a target after its open intent is withdrawn while readiness is pending',async()=>{
    render(<FixedWorkspace />)
    await vi.waitFor(()=>expect(io.readyCheck).toHaveBeenCalled())
    useWorkspaceStore.getState().setPopoutPanel('compose','restored',false);io.ready=true
    await vi.waitFor(()=>expect(useWorkspaceStore.getState().restoringPopouts.compose || []).toEqual([]))
    expect(io.prepare).not.toHaveBeenCalled()
  })
})
