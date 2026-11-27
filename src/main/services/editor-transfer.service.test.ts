import {EventEmitter} from 'node:events'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {EditorTransferManager,type TransferHooks} from './editor-transfer.service'
const owner=()=>Object.assign(new EventEmitter(),{isDestroyed:()=>false})
const input={direction:'popout' as const,workspaceId:'w',panelId:'panel',editorId:'editor',editorKey:'w:editor:novelai-workbench',panelType:'novelai-workbench',title:'work',committedRevision:3}
function fixture(){const hooks:TransferHooks={revision:()=>3,freeze:vi.fn(),release:vi.fn(),move:vi.fn(),activate:vi.fn(),notify:vi.fn(),close:vi.fn(),show:vi.fn()};return{hooks,manager:new EditorTransferManager(hooks),source:owner(),target:owner()}}
afterEach(()=>vi.useRealTimers())
describe('W2 main-owned editor transfer',()=>{
 it('does not send renderer UI events to an already crashed recovery source',()=>{
  const f=fixture(),source=Object.assign(f.source,{isCrashed:()=>true});const transfer=f.manager.prepareRecovery(input,source);f.manager.bindTarget(transfer.transferId,f.target);f.manager.ready(transfer.transferId,f.target,3);
  expect(vi.mocked(f.hooks.notify).mock.calls.some(call=>call[0]===source)).toBe(false);expect(f.hooks.show).toHaveBeenCalledWith(f.target);
 });
 it('never accepts client-supplied recovery authority or foreign properties into its issued record',()=>{
  const f=fixture(),forged={...input,recovery:'persisted-after-crash',sequence:999,phase:'committed',transferId:'forged',bounds:{width:800,foreignSecret:'fixture-only'}};
  const transfer=f.manager.prepare(forged,f.source);expect(transfer.recovery).toBeUndefined();expect(transfer.sequence).toBe(1);expect(transfer.transferId).not.toBe('forged');expect(transfer.bounds).toEqual({width:800});
  f.manager.bindTarget(transfer.transferId,f.target);expect(f.manager.ready(transfer.transferId,f.target,3).phase).toBe('ready');expect(f.hooks.close).not.toHaveBeenCalled();
  f.manager.abort(transfer.transferId,f.source);
 });
 it('recovers a verified crashed source from the latest persisted draft through target readiness',()=>{
  const f=fixture(),source=Object.assign(f.source,{isCrashed:()=>true});
  const recovered=f.manager.prepareRecovery({...input,committedRevision:0},source);
  expect(recovered).toMatchObject({direction:'return',committedRevision:3,recovery:'persisted-after-crash'});
  f.manager.bindTarget(recovered.transferId,f.target);expect(f.hooks.show).not.toHaveBeenCalled();
  const done=f.manager.ready(recovered.transferId,f.target,3);
  expect(done.phase).toBe('committed');expect(f.hooks.move).toHaveBeenCalledWith(input.editorKey,source,f.target,recovered.transferId);expect(f.hooks.close).toHaveBeenCalledWith(source);
 });
 it('keeps the moved owner hidden until an exact source detachment ACK',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);f.manager.ready(transfer.transferId,f.target,3);
  expect(f.manager.commit(transfer.transferId,f.source).phase).toBe('transferred');expect(f.hooks.show).not.toHaveBeenCalled();expect(f.manager.isFrozen(input.editorKey)).toBe(true);
  expect(()=>f.manager.complete(transfer.transferId,f.target)).toThrow('EDITOR_TRANSFER_OWNER');
  expect(f.manager.complete(transfer.transferId,f.source).phase).toBe('committed');expect(f.hooks.show).toHaveBeenCalledWith(f.target);expect(f.manager.isFrozen(input.editorKey)).toBe(false);
 });
 it('rolls back a crashed target after ownership moved while it was still hidden',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);f.manager.ready(transfer.transferId,f.target,3);f.manager.commit(transfer.transferId,f.source);
  f.target.emit('render-process-gone');expect(f.manager.get(transfer.transferId,f.source)?.phase).toBe('aborted');expect(f.hooks.release).toHaveBeenCalledWith(input.editorKey,f.source,transfer.transferId);expect(f.hooks.show).not.toHaveBeenCalled();
 });
 it('requires the actual committed revision and a registered adapter before creating a target',()=>{
  const f=fixture();expect(()=>f.manager.prepare({...input,committedRevision:2},f.source)).toThrow('REVISION_CONFLICT');expect(()=>f.manager.prepare({...input,panelType:'foreign',editorKey:'w:editor:foreign'},f.source)).toThrow('EDITOR_ADAPTER_UNAVAILABLE');expect(f.hooks.freeze).not.toHaveBeenCalled();
 });
 it('holds ownership while the hidden target hydrates and commits only after exact readiness',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);expect(f.manager.isFrozen(input.editorKey)).toBe(true);expect(f.hooks.move).not.toHaveBeenCalled();expect(f.hooks.show).not.toHaveBeenCalled();expect(()=>f.manager.commit(transfer.transferId,f.source)).toThrow('EDITOR_TARGET_NOT_READY');f.manager.ready(transfer.transferId,f.target,3);f.manager.commit(transfer.transferId,f.source);expect(f.hooks.move).toHaveBeenCalledWith(input.editorKey,f.source,f.target,transfer.transferId);f.manager.complete(transfer.transferId,f.source);expect(f.hooks.show).toHaveBeenCalledWith(f.target);expect(f.manager.isFrozen(input.editorKey)).toBe(false);
 });
 it('rejects an arbitrary sender, stale ready revision, and forged editor key',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);expect(()=>f.manager.ready(transfer.transferId,owner(),3)).toThrow('EDITOR_TRANSFER_OWNER');expect(()=>f.manager.ready(transfer.transferId,f.target,2)).toThrow('EDITOR_HYDRATION_STALE');expect(()=>f.manager.prepare({...input,editorKey:'other-key'},f.source)).toThrow('EDITOR_TRANSFER_INVALID');f.manager.abort(transfer.transferId,f.source);
 });
 it('rolls back after10seconds without readiness and keeps source leases intact',()=>{
  vi.useFakeTimers();const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);vi.advanceTimersByTime(10001);expect(f.manager.get(transfer.transferId,f.source)).toMatchObject({phase:'aborted',error:{code:'EDITOR_TRANSFER_TIMEOUT'}});expect(f.hooks.release).toHaveBeenCalledWith(input.editorKey,f.source,transfer.transferId);expect(f.hooks.close).toHaveBeenCalledWith(f.target);expect(f.hooks.move).not.toHaveBeenCalled();expect(f.manager.isFrozen(input.editorKey)).toBe(false);
 });
 it('aborts a crashed target and ignores its later ready acknowledgement',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);f.target.emit('render-process-gone');expect(f.manager.get(transfer.transferId,f.source)?.phase).toBe('aborted');expect(()=>f.manager.ready(transfer.transferId,f.target,3)).toThrow('EDITOR_TRANSFER_ENDED');expect(f.hooks.move).not.toHaveBeenCalled();
 });
 it('rejects a duplicate source transfer and never lets a peer abort another transfer',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);expect(()=>f.manager.prepare(input,f.source)).toThrow('EDITOR_TRANSFER_BUSY');f.manager.bindTarget(transfer.transferId,f.target);expect(()=>f.manager.abort(transfer.transferId,owner())).toThrow('EDITOR_TRANSFER_OWNER');f.manager.abort(transfer.transferId,f.source);expect(f.source.listenerCount('destroyed')).toBe(0);expect(f.target.listenerCount('render-process-gone')).toBe(0);
 });
 it('does not commit if the saved source revision changes during hydration',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);f.manager.ready(transfer.transferId,f.target,3);f.hooks.revision=()=>4;expect(()=>f.manager.commit(transfer.transferId,f.source)).toThrow('REVISION_CONFLICT');expect(f.manager.get(transfer.transferId,f.source)?.phase).toBe('aborted');expect(f.hooks.move).not.toHaveBeenCalled();
 });
 it('invalidates a ready target when its main frame reloads before commit',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);f.manager.ready(transfer.transferId,f.target,3);
  f.target.emit('did-start-navigation',{},'https://fixture.invalid/reload',false,true);
  expect(f.manager.get(transfer.transferId,f.source)).toMatchObject({phase:'aborted',error:{code:'EDITOR_TARGET_NAVIGATED'}});
  expect(()=>f.manager.commit(transfer.transferId,f.source)).toThrow('EDITOR_TRANSFER_ENDED');expect(f.hooks.move).not.toHaveBeenCalled();
 });
 it('keeps initial target navigation, in-page navigation and child frames separate from reload',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);
  f.target.emit('did-start-navigation',{},'https://fixture.invalid/initial',false,true);f.manager.ready(transfer.transferId,f.target,3);
  f.target.emit('did-start-navigation',{},'https://fixture.invalid/#view',true,true);f.target.emit('did-start-navigation',{},'https://fixture.invalid/child',false,false);
  f.manager.commit(transfer.transferId,f.source);f.manager.complete(transfer.transferId,f.source);expect(f.hooks.show).toHaveBeenCalledWith(f.target);
  expect(f.target.listenerCount('did-start-navigation')).toBe(0);
 });
 it('rolls ownership back if the target reloads between move and source unload acknowledgement',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);f.manager.ready(transfer.transferId,f.target,3);f.manager.commit(transfer.transferId,f.source);
  f.target.emit('did-start-navigation',{},'https://fixture.invalid/reload',false,true);
  expect(()=>f.manager.complete(transfer.transferId,f.source)).toThrow('EDITOR_TRANSFER_ENDED');expect(f.hooks.activate).not.toHaveBeenCalled();expect(f.hooks.release).toHaveBeenCalledWith(input.editorKey,f.source,transfer.transferId);
 });
 it('invalidates an old READY sent after the first waiting document committed and then reloaded',()=>{
  const f=fixture(),transfer=f.manager.prepare(input,f.source);f.manager.bindTarget(transfer.transferId,f.target);
  try {
   f.target.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});f.target.emit('did-navigate');
   f.target.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});
   expect(()=>f.manager.ready(transfer.transferId,f.target,3)).toThrow('EDITOR_TRANSFER_ENDED');expect(f.hooks.move).not.toHaveBeenCalled();
  } finally { f.manager.shutdown() }
 });
})
