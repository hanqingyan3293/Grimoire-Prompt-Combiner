import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NovelaiEditSessionManager } from './novelai-edit-session.service'
function owner() { return Object.assign(new EventEmitter(), { isDestroyed:()=>false }) }
const resource={kind:'work' as const,id:'work-one'}
afterEach(()=>vi.useRealTimers())
describe('W1 main-owned editing leases',()=>{
 it('keeps every legacy singleton view under the same window owner and freezes both sides through activation',()=>{
  const manager=new NovelaiEditSessionManager(),source=owner(),target=owner(),a='w:a:prompt-workbench',b='w:b:prompt-workbench';
  expect(manager.getEditorAccess(a,source).writable).toBe(true);expect(manager.getEditorAccess(b,target).writable).toBe(false);
  manager.holdTransfer(a,source,'move');expect(manager.getEditorAccess(b,source).writable).toBe(false);
  manager.commitTransfer(a,source,target,'move');expect(manager.getEditorAccess(b,target).writable).toBe(false);manager.completeTransfer(a,source,target,'move');
  expect(manager.getEditorAccess(b,target).writable).toBe(true);expect(()=>manager.assertEditorWrite(b,source)).toThrow('EDIT_LOCKED');manager.assertEditorWrite(b,target);
 });
 it('does not let a queued target-destroy callback remove the source lease just restored by rollback',()=>{
  const manager=new NovelaiEditSessionManager(),sender=owner(),target=owner(),context={kind:'window' as const,sender,editorKey:'editor'};const lease=manager.acquire(resource,context);
  manager.holdTransfer('editor',sender,'transfer');target.once('destroyed',()=>manager.abortTransfer('editor',sender,'transfer'));manager.commitTransfer('editor',sender,target,'transfer');target.emit('destroyed');
  manager.assertWrite(resource,{...context,leaseId:lease.leaseId});
 });
 it('moves generic editor ownership even when the settings or legacy prompt adapter has no resource lease',()=>{
  const manager=new NovelaiEditSessionManager(),sender=owner(),target=owner();
  manager.holdTransfer('settings-editor',sender,'transfer');manager.commitTransfer('settings-editor',sender,target,'transfer');manager.completeTransfer('settings-editor',sender,target,'transfer');
  expect(()=>manager.assertEditorWrite('settings-editor',sender)).toThrow('EDIT_LOCKED');manager.assertEditorWrite('settings-editor',target);
  sender.emit('destroyed');expect(()=>manager.assertEditorWrite('settings-editor',sender)).toThrow('EDIT_LOCKED');
  target.emit('destroyed');manager.assertEditorWrite('settings-editor',sender);
 });
 it('restores the original token after owner movement is aborted before target activation',()=>{
  const manager=new NovelaiEditSessionManager(),sender=owner(),target=owner(),context={kind:'window' as const,sender,editorKey:'editor'};
  const lease=manager.acquire(resource,context);manager.holdTransfer('editor',sender,'transfer');manager.commitTransfer('editor',sender,target,'transfer');
  expect(()=>manager.acquire(resource,{kind:'window',sender:target,editorKey:'editor'})).toThrow('EDIT_LOCKED');
  manager.abortTransfer('editor',sender,'transfer');manager.assertWrite(resource,{...context,leaseId:lease.leaseId});
 });
 it('holds a transfer lease until target commit and rejects writes from both windows while held',()=>{
  const manager=new NovelaiEditSessionManager(),sender=owner(),target=owner(),context={kind:'window' as const,sender,editorKey:'editor'};const lease=manager.acquire(resource,context);manager.holdTransfer('editor',sender,'transfer');expect(manager.release(resource,lease.leaseId,context)).toBe(false);expect(()=>manager.assertWrite(resource,{...context,leaseId:lease.leaseId})).toThrow('EDIT_LOCKED');manager.commitTransfer('editor',sender,target,'transfer');expect(()=>manager.assertWrite(resource,{...context,leaseId:lease.leaseId})).toThrow('EDIT_LOCKED');manager.completeTransfer('editor',sender,target,'transfer');const adopted=manager.acquire(resource,{kind:'window',sender:target,editorKey:'editor'});manager.assertWrite(resource,{kind:'window',sender:target,editorKey:'editor',leaseId:adopted.leaseId});
 });
 it('restores original transfer ownership when the target fails',()=>{
  const manager=new NovelaiEditSessionManager(),sender=owner(),context={kind:'window' as const,sender,editorKey:'editor'};const lease=manager.acquire(resource,context);manager.holdTransfer('editor',sender,'transfer');expect(()=>manager.assertEditorWrite('editor',sender)).toThrow('EDIT_LOCKED');manager.abortTransfer('editor',sender,'transfer');manager.assertWrite(resource,{...context,leaseId:lease.leaseId});
 });
 it('does not allow a different sender to hold or commit another owner lease',()=>{
  const manager=new NovelaiEditSessionManager(),sender=owner(),other=owner();manager.acquire(resource,{kind:'window',sender,editorKey:'editor'});expect(()=>manager.holdTransfer('editor',other,'bad')).toThrow('EDIT_LOCKED');manager.holdTransfer('editor',sender,'transfer');expect(()=>manager.commitTransfer('editor',other,owner(),'transfer')).toThrow('EDIT_LOCKED');manager.abortTransfer('editor',sender,'transfer');
 });
 it('does not let a delayed release from an earlier acquisition close a reacquired same-owner lease',()=>{
  const manager=new NovelaiEditSessionManager(),sender=owner(),context={kind:'window' as const,sender,editorKey:'a'};const first=manager.acquire(resource,context);const current=manager.acquire(resource,context);expect(current.leaseId).not.toBe(first.leaseId);expect(manager.release(resource,first.leaseId,context)).toBe(false);manager.assertWrite(resource,{...context,leaseId:current.leaseId});
 });
 it('uses the real sender and isolates another editor on the same sender',()=>{
  const manager=new NovelaiEditSessionManager(),sender=owner();const lease=manager.acquire(resource,{kind:'window',sender,editorKey:'editor-a'});
  expect(()=>manager.acquire(resource,{kind:'window',sender,editorKey:'editor-b'})).toThrow(/EDIT_LOCKED/);
  expect(()=>manager.assertWrite(resource,{kind:'window',sender:owner(),editorKey:'editor-a',leaseId:lease.leaseId})).toThrow(/EDIT_LOCKED/);
  manager.assertWrite(resource,{kind:'window',sender,editorKey:'editor-a',leaseId:lease.leaseId});
 });
 it('expires at30seconds and never lets a stale heartbeat or release affect the new lease',()=>{
  vi.useFakeTimers();const manager=new NovelaiEditSessionManager(),first=owner(),second=owner();const old=manager.acquire(resource,{kind:'window',sender:first,editorKey:'a'});
  vi.advanceTimersByTime(30_001);const current=manager.acquire(resource,{kind:'window',sender:second,editorKey:'b'});
  expect(()=>manager.heartbeat(resource,old.leaseId,{kind:'window',sender:first,editorKey:'a'})).toThrow(/EXPIRED|LOCKED/);
  expect(manager.release(resource,old.leaseId,{kind:'window',sender:first,editorKey:'a'})).toBe(false);
  manager.assertWrite(resource,{kind:'window',sender:second,editorKey:'b',leaseId:current.leaseId});
 });
 it('a10second heartbeat extends the active30second lease',()=>{
  vi.useFakeTimers();const manager=new NovelaiEditSessionManager(),sender=owner();const lease=manager.acquire(resource,{kind:'window',sender,editorKey:'a'});
  vi.advanceTimersByTime(10_000);const updated=manager.heartbeat(resource,lease.leaseId,{kind:'window',sender,editorKey:'a'});expect(updated.expiresAt).toBe(Date.now()+30_000);
  vi.advanceTimersByTime(20_001);expect(()=>manager.acquire(resource,{kind:'window',sender:owner(),editorKey:'b'})).toThrow(/EDIT_LOCKED/);
 });
 it('releases only the destroyed owner and removes its listeners',()=>{
  const manager=new NovelaiEditSessionManager(),sender=owner();manager.acquire(resource,{kind:'window',sender,editorKey:'a'});expect(sender.listenerCount('destroyed')).toBe(1);sender.emit('destroyed');
  expect(sender.listenerCount('destroyed')).toBe(0);expect(()=>manager.acquire(resource,{kind:'window',sender:owner(),editorKey:'b'})).not.toThrow();
 });
 it('blocks a runtime mutation while a user editor owns the work',()=>{
  const manager=new NovelaiEditSessionManager();manager.acquire(resource,{kind:'window',sender:owner(),editorKey:'a'});
  expect(()=>manager.assertWrite(resource,{kind:'runtime',sessionId:'real-session'})).toThrow(/EDIT_LOCKED/);
  expect(()=>manager.assertWrite(resource)).toThrow(/EDIT_LOCKED/);
 });
 it('never shares lease ownership between separate work or asset resources',()=>{
  const manager=new NovelaiEditSessionManager(),sender=owner();const lease=manager.acquire(resource,{kind:'window',sender,editorKey:'a'});
  const other={kind:'asset' as const,id:resource.id};expect(()=>manager.acquire(other,{kind:'window',sender:owner(),editorKey:'b'})).not.toThrow();
  expect(()=>manager.assertWrite(other,{kind:'window',sender,editorKey:'a',leaseId:lease.leaseId})).toThrow(/EDIT_LOCKED/);
 });
})
