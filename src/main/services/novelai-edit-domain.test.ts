import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
let root='';vi.mock('electron',()=>({app:{getPath:()=>root}}))
import {initDatabase,closeDatabase} from '../database'
import {createNovelaiWork,createNovelaiVersion,getNovelaiWork,setNovelaiBranchName,softDeleteNovelaiVersion,restoreNovelaiVersion} from './novelai-version.service'
import {createNovelaiAsset,getNovelaiAsset,updateNovelaiAsset,deleteNovelaiAsset} from './novelai-asset.service'
import {novelaiEditSessions,type NovelaiEditOwner} from './novelai-edit-session.service'
const releases:Array<()=>void>=[]
function windowOwner(){const sender=Object.assign(new EventEmitter(),{isDestroyed:()=>false});releases.push(()=>sender.emit('destroyed'));return{kind:'window' as const,sender,editorKey:'w:e:novelai-workbench'}}
beforeEach(async()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'grimoire-w1-domain-'));await initDatabase()})
afterEach(()=>{releases.splice(0).forEach(release=>release());closeDatabase();fs.rmSync(root,{recursive:true,force:true})})
describe('W1 leases protect actual domain mutations',()=>{
 it('surfaces a revision conflict without consuming a new work revision',()=>{
  const work=createNovelaiWork({name:'work',snapshot:'raw'}),owner=windowOwner();const lease=novelaiEditSessions.acquire({kind:'work',id:work.work.id},owner);
  expect(()=>createNovelaiVersion({workId:work.work.id,parentVersionId:work.root.id,snapshot:'new',expectedRevision:0,owner:{...owner,leaseId:lease.leaseId}} as never)).toThrow('REVISION_CONFLICT');
  expect(getNovelaiWork(work.work.id)?.revision).toBe(1);
 });
 it('blocks an Agent or legacy writer from modifying a user-owned work',()=>{
  const work=createNovelaiWork({name:'work',snapshot:'raw'});const owner=windowOwner();const lease=novelaiEditSessions.acquire({kind:'work',id:work.work.id},owner);
  const input={workId:work.work.id,parentVersionId:work.root.id,snapshot:'agent change',source:'agent' as const,expectedRevision:work.work.revision};expect(()=>createNovelaiVersion({...input,owner:{kind:'runtime',sessionId:'owned-session'}} as never)).toThrow('EDIT_LOCKED');expect(()=>setNovelaiBranchName(work.work.id,work.root.branchId,'stolen')).toThrow('EDIT_LOCKED');expect(getNovelaiWork(work.work.id)?.revision).toBe(work.work.revision);
  const saved=createNovelaiVersion({...input,source:'user',owner:{...owner,leaseId:lease.leaseId}} as never);expect(saved.version.snapshot).toBe('agent change');
 });
 it('blocks restore while another editor owns the work',()=>{
  const work=createNovelaiWork({name:'work',snapshot:'raw'});const version=createNovelaiVersion({workId:work.work.id,parentVersionId:work.root.id,snapshot:'next',expectedRevision:work.work.revision});softDeleteNovelaiVersion({workId:work.work.id,versionId:version.version.id,mode:'single',expectedRevision:getNovelaiWork(work.work.id)!.revision});novelaiEditSessions.acquire({kind:'work',id:work.work.id},windowOwner());expect(()=>restoreNovelaiVersion(version.version.id)).toThrow('EDIT_LOCKED');
 });
 it('uses independent asset revision CAS and owner lease for actual payload writes',()=>{
  const asset=createNovelaiAsset({kind:'style',name:'asset',payload:'raw'});const owner=windowOwner();const lease=novelaiEditSessions.acquire({kind:'asset',id:asset.id},owner);
  expect(()=>updateNovelaiAsset(asset.id,{payload:'foreign'})).toThrow('EDIT_LOCKED');expect(()=>deleteNovelaiAsset(asset.id,{force:true})).toThrow('EDIT_LOCKED');const original=getNovelaiAsset(asset.id) as typeof asset & {revision:number};expect(original.revision).toBe(1);
  const saved=updateNovelaiAsset(asset.id,{payload:'mine',expectedRevision:1,owner:{...owner,leaseId:lease.leaseId}} as never) as typeof original;expect(saved.revision).toBe(2);expect(()=>updateNovelaiAsset(asset.id,{payload:'old',expectedRevision:1,owner:{...owner,leaseId:lease.leaseId}} as never)).toThrow('REVISION_CONFLICT');expect(getNovelaiAsset(asset.id)?.payload).toBe('mine');
 });
})
