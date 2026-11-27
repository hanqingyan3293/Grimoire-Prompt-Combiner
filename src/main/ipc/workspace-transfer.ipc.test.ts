import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {IPC_CHANNELS} from '../../shared/types'
let root='';const handlers=new Map<string,(event:{sender:any},value:any)=>any>(),owners:Array<EventEmitter>=[]
function owner(){const value=Object.assign(new EventEmitter(),{id:owners.length+1,isDestroyed:()=>false,send:vi.fn()});owners.push(value);return value}
vi.mock('electron',()=>({app:{getPath:()=>root},ipcMain:{handle:(key:string,value:any)=>handlers.set(key,value)}}))
import {initDatabase,closeDatabase,getDatabase} from '../database';import {registerWorkspaceTransferIPC} from './workspace-transfer.ipc';import {novelaiEditSessions} from '../services/novelai-edit-session.service'
const input={direction:'popout' as const,workspaceId:'w',panelId:'panel',editorId:'editor',editorKey:'w:editor:novelai-workbench',panelType:'novelai-workbench',title:'work',committedRevision:1}
const call=(key:string,sender:ReturnType<typeof owner>,value:unknown)=>Promise.resolve().then(()=>handlers.get(key)!({sender},value))
beforeEach(async()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'grimoire-w2-ipc-'));handlers.clear();await initDatabase();getDatabase().run('INSERT INTO workspace_editor_states(editor_key,revision,data_json,updated_at) VALUES(?,?,?,?)',[input.editorKey,1,'{"raw":"source"}','now'])})
afterEach(()=>{for(const who of owners.splice(0))who.emit('destroyed');closeDatabase();fs.rmSync(root,{recursive:true,force:true})})
describe('W2 transfer actual SQLite/IPC and owner hooks',()=>{
 it('binds the created target sender and keeps both writers blocked until commit',async()=>{
  const source=owner(),target=owner(),resource={kind:'work' as const,id:'work'};novelaiEditSessions.acquire(resource,{kind:'window',sender:source,editorKey:input.editorKey});const windows={validateSource:vi.fn(),createTarget:vi.fn((_record,_source,bind)=>bind(target)),showTarget:vi.fn(),closeTarget:vi.fn()};const manager=registerWorkspaceTransferIPC(windows);const prepared=await call(IPC_CHANNELS.WORKSPACE_TRANSFER_PREPARE,source,input);expect(prepared.ok).toBe(true);const id=prepared.transfer.transferId;
  expect(()=>novelaiEditSessions.assertWrite(resource)).toThrow('EDIT_LOCKED');await expect(call(IPC_CHANNELS.WORKSPACE_TRANSFER_READY,owner(),{transferId:id,revision:1})).resolves.toMatchObject({ok:false,code:'EDITOR_TRANSFER_OWNER'});await call(IPC_CHANNELS.WORKSPACE_TRANSFER_READY,target,{transferId:id,revision:1});await call(IPC_CHANNELS.WORKSPACE_TRANSFER_COMMIT,source,id);expect(windows.showTarget).not.toHaveBeenCalled();await call(IPC_CHANNELS.WORKSPACE_TRANSFER_FINISH,source,id);expect(windows.showTarget).toHaveBeenCalledWith(target);expect(manager.isFrozen(input.editorKey)).toBe(false);const adopted=novelaiEditSessions.acquire(resource,{kind:'window',sender:target,editorKey:input.editorKey});novelaiEditSessions.assertWrite(resource,{kind:'window',sender:target,editorKey:input.editorKey,leaseId:adopted.leaseId});manager.shutdown()
 });
 it('releases its hold and retains original SQLite state when opening a target fails',async()=>{
  const source=owner(),windows={validateSource:vi.fn(),createTarget:vi.fn(()=>{throw new Error('target fixture failure')}),showTarget:vi.fn(),closeTarget:vi.fn()};const manager=registerWorkspaceTransferIPC(windows);await expect(call(IPC_CHANNELS.WORKSPACE_TRANSFER_PREPARE,source,input)).resolves.toMatchObject({ok:false});expect(manager.isFrozen(input.editorKey)).toBe(false);novelaiEditSessions.assertEditorWrite(input.editorKey,source);expect(getDatabase().exec('SELECT data_json FROM workspace_editor_states')[0].values[0][0]).toBe('{"raw":"source"}');manager.shutdown()
 });
})
