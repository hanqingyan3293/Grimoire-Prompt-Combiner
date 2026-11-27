import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EventEmitter} from 'node:events'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {IPC_CHANNELS} from '../../shared/types'
let root='';const handlers=new Map<string,(event:unknown,input:unknown)=>unknown>();const who=()=>Object.assign(new EventEmitter(),{isDestroyed:()=>false});const owners:ReturnType<typeof who>[]=[]
vi.mock('electron',()=>({app:{getPath:()=>root},BrowserWindow:{getAllWindows:()=>[],fromWebContents:()=>undefined},ipcMain:{handle:(channel:string,handler:unknown)=>handlers.set(channel,handler as never)},dialog:{}}))
vi.mock('./providers.ipc',()=>({getActiveProvider:async()=>null}))
import {initDatabase,closeDatabase,getDatabase} from '../database'
import {registerNovelaiIPC} from './novelai.ipc'
import {createNovelaiWork,getNovelaiWork} from '../services/novelai-version.service'
import {createNovelaiAsset,getNovelaiAsset} from '../services/novelai-asset.service'
import {novelaiEditSessions} from '../services/novelai-edit-session.service'
function owner(){const value=who();owners.push(value);return value}
function call(channel:string,input:unknown,sender:ReturnType<typeof who>){const handler=handlers.get(channel);if(!handler)throw new Error('missing handler');return Promise.resolve().then(()=>handler({sender},input))}
beforeEach(async()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'grimoire-w1-proof-ipc-'));handlers.clear();await initDatabase();registerNovelaiIPC()})
afterEach(()=>{for(const sender of owners.splice(0))sender.emit('destroyed');closeDatabase();fs.rmSync(root,{recursive:true,force:true})})
describe('W1 public IPC owner proof',()=>{
 it('rejects a stolen lease token on a different sender and accepts the real owner',async()=>{
  const created=createNovelaiWork({name:'work',snapshot:'raw'}),sender=owner(),other=owner();const lease=novelaiEditSessions.acquire({kind:'work',id:created.work.id},{kind:'window',sender,editorKey:'editor'});const parameters={workId:created.work.id,parentVersionId:created.root.id,snapshot:'new',expectedRevision:1,source:'agent',edit:{editorKey:'editor',leaseId:lease.leaseId}};
  await expect(call(IPC_CHANNELS.NOVELAI_VERSION_CREATE,parameters,other)).rejects.toThrow('EDIT_LOCKED');expect(getNovelaiWork(created.work.id)?.revision).toBe(1);
  const result=await call(IPC_CHANNELS.NOVELAI_VERSION_CREATE,parameters,sender) as {version:{source:string;snapshot:string}};expect(result.version).toMatchObject({source:'user',snapshot:'new'});
 });
 it('does not accept a renderer-created owner object as a main lease context',async()=>{
  const created=createNovelaiWork({name:'work',snapshot:'raw'}),sender=owner();novelaiEditSessions.acquire({kind:'work',id:created.work.id},{kind:'window',sender,editorKey:'editor'});
  await expect(call(IPC_CHANNELS.NOVELAI_VERSION_CREATE,{workId:created.work.id,parentVersionId:created.root.id,snapshot:'foreign',expectedRevision:1,owner:{kind:'window',sender,editorKey:'editor'}},owner())).rejects.toThrow('EDIT_LOCKED');
 });
 it('uses asset expected revision and exact sender without exporting a token into the returned asset',async()=>{
  const asset=createNovelaiAsset({kind:'style',name:'asset',payload:'raw'}),sender=owner(),other=owner();const lease=novelaiEditSessions.acquire({kind:'asset',id:asset.id},{kind:'window',sender,editorKey:'asset-editor'});const value={id:asset.id,patch:{payload:'changed',expectedRevision:1},edit:{editorKey:'asset-editor',leaseId:lease.leaseId}};
  await expect(call(IPC_CHANNELS.NOVELAI_ASSET_UPDATE,value,other)).rejects.toThrow('EDIT_LOCKED');const result=await call(IPC_CHANNELS.NOVELAI_ASSET_UPDATE,value,sender);expect(result).toMatchObject({payload:'changed',revision:2});expect(JSON.stringify(result)).not.toContain('leaseId');
  await expect(call(IPC_CHANNELS.NOVELAI_ASSET_UPDATE,value,sender)).rejects.toThrow('REVISION_CONFLICT');expect(getNovelaiAsset(asset.id)?.payload).toBe('changed');
 });
})
