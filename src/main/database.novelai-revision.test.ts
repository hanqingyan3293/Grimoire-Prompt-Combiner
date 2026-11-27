import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
let root='';let external:DatabaseSync|null=null
vi.mock('electron',()=>({app:{getPath:(name:string)=>name==='exe'?path.join(root,'Grimoire.exe'):root}}))
import {CURRENT_SCHEMA_VERSION,initDatabase,closeDatabase,getDatabase,initializeDatabaseConnection} from './database'
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'grimoire-w1-revision-'))})
afterEach(()=>{external?.close();external=null;closeDatabase();fs.rmSync(root,{recursive:true,force:true})})
function old(){external=new DatabaseSync(path.join(root,'grimoire.db'));initializeDatabaseConnection(external);const cols=external.prepare('PRAGMA table_info(novelai_asset)').all() as Array<{name:string}>;if(cols.some(c=>c.name==='revision'))external.exec('ALTER TABLE novelai_asset DROP COLUMN revision');external.prepare("UPDATE schema_meta SET value='41' WHERE key='schema_version'").run();external.prepare('INSERT INTO novelai_asset(id,kind,name,payload,examples,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('old-asset','style','old name','old raw','[]','old created','old updated');external.close();external=null}
describe('W1 asset revision schema migration',()=>{
 it('upgrades41to42, keeps old content and does not invent another draft store',async()=>{
  old();await initDatabase();expect(CURRENT_SCHEMA_VERSION).toBe(42);expect(getDatabase().exec("SELECT value FROM schema_meta WHERE key='schema_version'")[0].values[0][0]).toBe('42');expect(getDatabase().exec("SELECT payload,revision FROM novelai_asset WHERE id='old-asset'")[0].values[0]).toEqual(['old raw',1]);expect(getDatabase().exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='novelai_draft'")[0].values[0][0]).toBe(0);
  closeDatabase();await initDatabase();expect(getDatabase().exec("SELECT payload,revision FROM novelai_asset WHERE id='old-asset'")[0].values[0]).toEqual(['old raw',1]);
 });
 it('does not advance the schema if adding asset revision fails',()=>{
  old();external=new DatabaseSync(path.join(root,'grimoire.db'));const prepare=external.prepare.bind(external);const spy=vi.spyOn(external,'prepare').mockImplementation(sql=>{if(sql.includes('ALTER TABLE novelai_asset ADD COLUMN revision'))throw new Error('fixture migration failure');return prepare(sql)});
  expect(()=>initializeDatabaseConnection(external!)).toThrow('fixture migration failure');spy.mockRestore();expect(external.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()).toMatchObject({value:'41'});expect(external.prepare("SELECT payload FROM novelai_asset WHERE id='old-asset'").get()).toMatchObject({payload:'old raw'});
 });
})
