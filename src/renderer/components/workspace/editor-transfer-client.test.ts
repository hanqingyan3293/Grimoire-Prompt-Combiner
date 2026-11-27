import {describe,expect,it,vi} from 'vitest'
import {performEditorTransfer,registerEditorTransferHandle,type EditorTransferBridge} from './editor-transfer-client'
const input={direction:'popout' as const,workspaceId:'w',panelId:'panel',editorId:'editor',editorKey:'w:editor:novelai-workbench',panelType:'novelai-workbench',title:'work'}
function fixture(){let changed:(event:never)=>void=()=>{};const record={...input,committedRevision:3,transferId:'transfer',sequence:1,expiresAt:Date.now()+10000,phase:'waiting' as const};const bridge:EditorTransferBridge={prepareTransfer:vi.fn(async()=>({ok:true as const,transfer:record})),commitTransfer:vi.fn(async()=>({ok:true as const,transfer:{...record,phase:'transferred' as const}})),finishTransfer:vi.fn(async()=>({ok:true as const,transfer:{...record,phase:'committed' as const}})),abortTransfer:vi.fn(async()=>({ok:true as const,transfer:{...record,phase:'aborted' as const}})),getTransfer:vi.fn(async()=>({...record,phase:'ready' as const})),onTransferChanged:callback=>{changed=callback as never;return()=>{}}};const handle={freeze:vi.fn(async()=>{}),thaw:vi.fn(),flush:vi.fn(async()=>({status:'saved' as const,revision:3}))};return{bridge,handle,record,detach:vi.fn(async()=>{}),restore:vi.fn(),changed}}
describe('W2 renderer ordered transfer',()=>{
 it('orders ready, owner move, source detach, then target activation',async()=>{
  const f=fixture(),steps:string[]=[],unregister=registerEditorTransferHandle(input.editorKey,f.handle);
  f.bridge.getTransfer=vi.fn(async()=>{steps.push('ready');return{...f.record,phase:'ready' as const}});
  f.bridge.commitTransfer=vi.fn(async()=>{steps.push('owner');return{ok:true as const,transfer:{...f.record,phase:'transferred' as const}}});
  Object.assign(f.bridge,{finishTransfer:vi.fn(async()=>{steps.push('show');return{ok:true as const,transfer:{...f.record,phase:'committed' as const}}})});
  try{await performEditorTransfer(input,f.bridge,async()=>{steps.push('detach')},f.restore);expect(steps).toEqual(['ready','owner','detach','show'])}finally{unregister()}
 });
 it('freezes and flushes before preparing, waits ready before detaching, then commits',async()=>{
  const f=fixture(),unregister=registerEditorTransferHandle(input.editorKey,f.handle);try{await performEditorTransfer(input,f.bridge,f.detach,f.restore);expect(f.handle.freeze).toHaveBeenCalledOnce();expect(f.handle.flush).toHaveBeenCalledWith('transfer');expect(f.bridge.prepareTransfer).toHaveBeenCalledWith({...input,committedRevision:3});expect(f.detach).toHaveBeenCalledOnce();expect(f.bridge.commitTransfer).toHaveBeenCalledWith('transfer');expect(f.restore).not.toHaveBeenCalled()}finally{unregister()}
 });
 it('keeps original editor and owner when flush reports a conflict',async()=>{
  const f=fixture(),unregister=registerEditorTransferHandle(input.editorKey,f.handle);f.handle.flush.mockResolvedValue({status:'conflict',local:'raw',remote:null} as never);try{await expect(performEditorTransfer(input,f.bridge,f.detach,f.restore)).rejects.toThrow('EDITOR_FLUSH_CONFLICT');expect(f.bridge.prepareTransfer).not.toHaveBeenCalled();expect(f.detach).not.toHaveBeenCalled();expect(f.handle.thaw).toHaveBeenCalled()}finally{unregister()}
 });
 it('restores the source after a commit failure and aborts the owned target',async()=>{
  const f=fixture(),unregister=registerEditorTransferHandle(input.editorKey,f.handle);f.bridge.commitTransfer=vi.fn(async()=>({ok:false as const,code:'REVISION_CONFLICT',message:'changed'}));try{await expect(performEditorTransfer(input,f.bridge,f.detach,f.restore)).rejects.toThrow('REVISION_CONFLICT');expect(f.detach).not.toHaveBeenCalled();expect(f.restore).not.toHaveBeenCalled();expect(f.bridge.abortTransfer).toHaveBeenCalledWith('transfer');expect(f.handle.thaw).toHaveBeenCalled()}finally{unregister()}
 });
 it('refuses an unregistered editor without opening a window',async()=>{const f=fixture();await expect(performEditorTransfer(input,f.bridge,f.detach,f.restore)).rejects.toThrow('EDITOR_ADAPTER_UNAVAILABLE');expect(f.bridge.prepareTransfer).not.toHaveBeenCalled()});
 it('does not move ownership after the source adapter changes while target readiness is pending',async()=>{
  const f=fixture();let current=true;Object.assign(f.handle,{ready:()=>current});const unregister=registerEditorTransferHandle(input.editorKey,f.handle);
  f.bridge.getTransfer=vi.fn(async()=>{current=false;return{...f.record,phase:'ready' as const}});
  try{await expect(performEditorTransfer(input,f.bridge,f.detach,f.restore)).rejects.toThrow('EDITOR_SOURCE_CHANGED');expect(f.bridge.commitTransfer).not.toHaveBeenCalled();expect(f.detach).not.toHaveBeenCalled()}finally{unregister()}
 });
 it('rolls back instead of detaching a different source adapter after ownership moved',async()=>{
  const f=fixture();let current=true;Object.assign(f.handle,{ready:()=>current});const unregister=registerEditorTransferHandle(input.editorKey,f.handle);
  f.bridge.commitTransfer=vi.fn(async()=>{current=false;return{ok:true as const,transfer:{...f.record,phase:'transferred' as const}}});
  try{await expect(performEditorTransfer(input,f.bridge,f.detach,f.restore)).rejects.toThrow('EDITOR_SOURCE_CHANGED');expect(f.detach).not.toHaveBeenCalled();expect(f.bridge.abortTransfer).toHaveBeenCalledWith('transfer')}finally{unregister()}
 });
})
