import { describe, expect, it, vi } from 'vitest'
import { WorkspaceEditorStateController } from './workspace-editor-state-controller'
import { encodeWorkspaceEditorState, type StoredWorkspaceEditorState, type WorkspaceEditorBridge } from '../../../shared/workspace-editor-state'
function barrier<T>() { let resolve!: (value:T)=>void, reject!: (error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject} }
const stored=(revision:number,state:unknown):StoredWorkspaceEditorState=>({editorKey:'key',revision,state})
async function fixture() {
 let receive:(value:StoredWorkspaceEditorState)=>void=()=>{}
 const save=vi.fn(async(_key:string,revision:number,state:unknown)=>({saved:true as const,value:stored(revision+1,state)}))
 const bridge:WorkspaceEditorBridge={loadEditorState:async()=>stored(1,'original'),saveEditorState:save,onEditorStateChanged:callback=>{receive=callback;return()=>{}}}
 const controller=new WorkspaceEditorStateController('key');controller.connect(bridge);await controller.flush('ready')
 return{controller,bridge,save,receive:(value:StoredWorkspaceEditorState)=>receive(value)}
}
describe('W1 independent controller races',()=>{
 it('keeps the newer stored baseline after an old successful ack',async()=>{
  const f=await fixture(),wait=barrier<never>();f.save.mockReturnValueOnce(wait.promise);f.controller.setState('A');const saving=f.controller.flush('first');await vi.waitFor(()=>expect(f.save).toHaveBeenCalledOnce());f.receive(stored(2,'A'));f.receive(stored(3,'B'));wait.resolve({saved:true,value:stored(2,'A')} as never);await saving;
  f.controller.setState('A');await f.controller.flush('second');expect(f.save).toHaveBeenCalledTimes(2);expect(f.save.mock.calls[1]).toEqual(['key',3,'A']);
 });
 it('retains newer conflict evidence when an older conflict ack arrives',async()=>{
  const f=await fixture(),wait=barrier<never>();f.save.mockReturnValueOnce(wait.promise);f.controller.setState('A');const saving=f.controller.flush('first');await vi.waitFor(()=>expect(f.save).toHaveBeenCalledOnce());f.receive(stored(3,'B'));wait.resolve({saved:false,conflict:true,current:stored(2,'C')} as never);await saving;f.controller.useRemote();expect(f.controller.getSnapshot()).toMatchObject({state:'B',revision:3,baseRevision:3});
 });
 it('rejects a false conflict marker, foreign key and invalid revision as bad protocol',async()=>{
  const f=await fixture();f.save.mockResolvedValueOnce({saved:false,conflict:false,current:{editorKey:'foreign',revision:-2,state:'X'}} as never);f.controller.setState('A');await expect(f.controller.flush('bad')).resolves.toMatchObject({status:'error',code:'EDITOR_BAD_RESPONSE'});f.controller.useRemote();expect(f.controller.getSnapshot().state).toBe('A');
 });
 it('does not mark a foreign-key initial load as ready or saved',async()=>{
  const c=new WorkspaceEditorStateController('key');c.connect({loadEditorState:async()=>({editorKey:'wrong',revision:1,state:'other'}),saveEditorState:vi.fn(),onEditorStateChanged:()=>()=>{}});await expect(c.flush('load')).resolves.toMatchObject({status:'error',code:'EDITOR_BAD_RESPONSE'});expect(c.getSnapshot().status).toBe('error');
 });
 it('isolates error and conflict objects from callers and the bridge',async()=>{
  const f=await fixture();f.save.mockRejectedValueOnce(new Error('disk failed'));f.controller.setState('A');await f.controller.flush('fail');const error=f.controller.getSnapshot().error!;try{error.message='changed'}catch{}expect(f.controller.getSnapshot().error!.message).toBe('disk failed');
  const raw=stored(2,{text:'remote'});f.receive(raw);raw.state={text:'changed'};const result=await f.controller.flush('conflict');expect(result).toMatchObject({status:'conflict',remote:{state:{text:'remote'}}});if(result.status==='conflict'&&result.remote){try{result.remote.state={text:'mutated'}}catch{}}
  expect(f.controller.getSnapshot().remote?.state).toEqual({text:'remote'});
 });
 it('can retry a rejected write without requiring another edit',async()=>{
  const f=await fixture();f.save.mockRejectedValueOnce(new Error('first write failed'));f.controller.setState('A');await expect(f.controller.flush('first')).resolves.toMatchObject({status:'error'});await expect(f.controller.flush('retry')).resolves.toMatchObject({status:'saved',revision:2});expect(f.save).toHaveBeenCalledTimes(2);
 });
 it('ignores an old rejected save after reconnecting the same controller',async()=>{
  const f=await fixture(),wait=barrier<never>();f.save.mockReturnValueOnce(wait.promise);f.controller.setState('A');const saving=f.controller.flush('first');await vi.waitFor(()=>expect(f.save).toHaveBeenCalledOnce());f.controller.disconnect();f.bridge.loadEditorState=async()=>stored(3,'current');f.controller.connect(f.bridge);await Promise.resolve();wait.reject(new Error('stale failure'));await saving;expect(f.controller.getSnapshot().status).not.toBe('error');expect(f.controller.getSnapshot().error).toBeNull();
 });
 it('supports a large legal array without call-stack argument expansion',async()=>{
  const values=Array(160_000).fill(0);expect(encodeWorkspaceEditorState(values).length).toBe(320001);const f=await fixture();f.controller.setState(values);expect(f.controller.getSnapshot().state).toEqual(values);await expect(f.controller.flush('large')).resolves.toMatchObject({status:'saved'});
 });
 it('does not report saved when the server returns a missing-row conflict',async()=>{
  const f=await fixture();f.save.mockResolvedValueOnce({saved:false,conflict:true,current:null} as never);f.controller.setState('A');await expect(f.controller.flush('deleted elsewhere')).resolves.toMatchObject({status:'conflict',remote:null});expect(f.controller.getSnapshot()).toMatchObject({state:'A',dirty:true,status:'conflict'});
 });
 it('ignores a late rejection after a newer acknowledged broadcast becomes authoritative',async()=>{
  const f=await fixture(),pending=barrier<never>();f.save.mockReturnValueOnce(pending.promise);f.controller.setState('A');const saving=f.controller.flush('first');await vi.waitFor(()=>expect(f.save).toHaveBeenCalledOnce());f.receive(stored(2,'A'));f.receive(stored(3,'B'));pending.reject(new Error('stale rejected RPC'));await saving;expect(f.controller.getSnapshot()).toMatchObject({state:'B',status:'ready',baseRevision:3,error:null});
 });
 it('handles an invalid broadcast without throwing from the subscription callback',async()=>{
  const f=await fixture();expect(()=>f.receive(null as never)).not.toThrow();expect(f.controller.getSnapshot()).toMatchObject({state:'original',status:'error',error:{code:'EDITOR_BAD_RESPONSE'}});
 });
})
