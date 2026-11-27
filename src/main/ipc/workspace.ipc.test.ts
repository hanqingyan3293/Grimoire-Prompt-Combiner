import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types'
let root=''
const handlers=new Map<string,(event:{sender:ReturnType<typeof sender>},value?:unknown)=>Promise<unknown>>()
function sender(){return Object.assign(new EventEmitter(),{isDestroyed:()=>false,send:vi.fn()})}
const owners:ReturnType<typeof sender>[]=[]
vi.mock('electron',()=>({app:{getPath:()=>root},BrowserWindow:{getAllWindows:()=>[]},ipcMain:{handle:(channel:string,handler:unknown)=>handlers.set(channel,handler as never)}}))
import {initDatabase,closeDatabase,getDatabase} from '../database'
import {registerWorkspaceIPC} from './workspace.ipc'
const owner=()=>{const value=sender();owners.push(value);return value}
async function call(channel:string,input:unknown,who=owner()) {const fn=handlers.get(channel);if(!fn)throw new Error('Missing handler '+channel);return fn({sender:who},input)}
beforeEach(async()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'grimoire-w1-editor-'));handlers.clear();await initDatabase();registerWorkspaceIPC()})
afterEach(()=>{for(const who of owners.splice(0))who.emit('destroyed');closeDatabase();fs.rmSync(root,{recursive:true,force:true})})

describe('W1 actual draft SQLite IPC boundary',()=>{
 it('preserves the one existing table and rejects stale CAS writes',async()=>{
  const who=owner();const first=await call(IPC_CHANNELS.WORKSPACE_SAVE_EDITOR_STATE,{editorKey:'w:e:prompt-editor',expectedRevision:0,state:{raw:'local'}},who)
  expect(first).toMatchObject({saved:true,value:{revision:1}})
  await expect(call(IPC_CHANNELS.WORKSPACE_SAVE_EDITOR_STATE,{editorKey:'w:e:prompt-editor',expectedRevision:0,state:{raw:'stale'}},who)).resolves.toMatchObject({saved:false,conflict:true,current:{revision:1,state:{raw:'local'}}})
  expect(getDatabase().exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='novelai_draft'")[0].values[0][0]).toBe(0)
 });
 it('returns a plain size error and keeps stored bytes untouched',async()=>{
  const who=owner(),key='w:e:prompt-editor';await call(IPC_CHANNELS.WORKSPACE_SAVE_EDITOR_STATE,{editorKey:key,expectedRevision:0,state:'original'},who)
  await expect(call(IPC_CHANNELS.WORKSPACE_SAVE_EDITOR_STATE,{editorKey:key,expectedRevision:1,state:'界'.repeat(2_000_000)},who)).resolves.toMatchObject({saved:false,error:{code:'EDITOR_STATE_TOO_LARGE'}})
  await expect(call(IPC_CHANNELS.WORKSPACE_LOAD_EDITOR_STATE,key,who)).resolves.toMatchObject({revision:1,state:'original'})
 });
 it.each(['0',-1,NaN])('rejects a malformed expected revision without a write: %j',async expectedRevision=>{
  await expect(call(IPC_CHANNELS.WORKSPACE_SAVE_EDITOR_STATE,{editorKey:'key',expectedRevision,state:'raw'})).resolves.toMatchObject({saved:false,error:{code:'EDITOR_REVISION_INVALID'}})
  expect(getDatabase().exec('SELECT count(*) FROM workspace_editor_states')[0].values[0][0]).toBe(0)
 });
 it('acquires a lease from the sender instead of accepting a forged owner',async()=>{
  const who=owner(),other=owner();const input={resource:{kind:'work',id:'work-one'},editorKey:'w:e:novelai-workbench',owner:who};const granted=await call('workspace:edit:acquire',input,who) as {ok:boolean;lease:{leaseId:string}}
  expect(granted.ok).toBe(true)
  await expect(call('workspace:edit:acquire',input,other)).resolves.toMatchObject({ok:false,code:'EDIT_LOCKED'})
  await expect(call('workspace:edit:heartbeat',{...input,leaseId:granted.lease.leaseId},other)).resolves.toMatchObject({ok:false,code:'EDIT_LEASE_EXPIRED'})
 });
 it('refuses another sender writing an editor key bound to an active resource lease',async()=>{
  const who=owner(),other=owner(),editorKey='w:e:novelai-workbench';await call('workspace:edit:acquire',{resource:{kind:'work',id:'work-one'},editorKey},who)
  await expect(call(IPC_CHANNELS.WORKSPACE_SAVE_EDITOR_STATE,{editorKey,expectedRevision:0,state:'foreign'},other)).resolves.toMatchObject({saved:false,error:{code:'EDIT_LOCKED'}})
  expect(getDatabase().exec('SELECT count(*) FROM workspace_editor_states')[0].values[0][0]).toBe(0)
 });
 it('lets the acquired editor owner persist a draft without exposing its lease in the saved DTO',async()=>{
  const who=owner(),editorKey='w:e:novelai-workbench';await call('workspace:edit:acquire',{resource:{kind:'work',id:'work-one'},editorKey},who);
  const saved=await call(IPC_CHANNELS.WORKSPACE_SAVE_EDITOR_STATE,{editorKey,expectedRevision:0,state:{raw:'owned draft'}},who);
  expect(saved).toMatchObject({saved:true,value:{editorKey,revision:1,state:{raw:'owned draft'}}});expect(JSON.stringify(saved)).not.toContain('leaseId');
 });
})
