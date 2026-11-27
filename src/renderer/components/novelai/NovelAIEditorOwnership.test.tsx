// @vitest-environment jsdom
import React from 'react'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {NovelAIPromptPanel} from './NovelAIPromptPanel'
import {WorkspaceEditorHost} from '../workspace/WorkspaceEditorHost'
vi.mock('../workspace/PanelRegistry',()=>({getEditorDefinition:()=>({stateKeyFactory:()=> 'editor-key'})}))
const metadata={negativePrompt:'negative draft',steps:'25',cfg:'7',seed:'9',sampler:'euler',scheduler:'normal',width:'512',height:'512',model:'novelai',checkpoint:'',loras:'',unknown:{future:'retained'}}
const bundle={work:{id:'work',name:'work',lastVersionId:'v1',revision:1,lastUsedAt:'now'},line:[{id:'v1',workId:'work',parentId:null,number:1,branchId:'v1',branchNumber:1,snapshot:'saved business prompt',source:'user',operation:'create',createdAt:'now',deletedAt:null}],branchName:null,deleted:[],branches:[]}
const api={novelai:{listWorks:vi.fn(async()=>[bundle.work]),bundle:vi.fn(async(_input:unknown)=>bundle),createVersion:vi.fn(),metadata:{exportTo:vi.fn(),readFrom:vi.fn()},proposeOrganize:vi.fn()},workspace:{loadEditorState:vi.fn(),saveEditorState:vi.fn(),onEditorStateChanged:vi.fn(()=>()=>{}),acquireEditLease:vi.fn(),heartbeatEditLease:vi.fn(),releaseEditLease:vi.fn()}}
beforeEach(()=>{vi.clearAllMocks();api.workspace.loadEditorState.mockResolvedValue({editorKey:'editor-key',revision:4,state:{kind:'novelai-workbench',version:1,activeWorkId:'work',works:{work:{draft:'unsaved draft',metadata,selectedVersionId:'v1'}}}});api.workspace.saveEditorState.mockImplementation(async(editorKey,revision,state)=>({saved:true,value:{editorKey,revision:revision+1,state}}));api.workspace.acquireEditLease.mockResolvedValue({ok:true,lease:{resource:{kind:'work',id:'work'},leaseId:'public-fixture-lease',expiresAt:Date.now()+30000}});api.workspace.releaseEditLease.mockResolvedValue({ok:true,released:true});(window as unknown as {api:unknown}).api=api})
afterEach(()=>cleanup())
const view=()=>render(<WorkspaceEditorHost workspaceId='w' editorId='e' type='novelai-workbench'><NovelAIPromptPanel/></WorkspaceEditorHost>)
describe('W1 workbench uses the actual draft host and main lease',()=>{
 it('hydrates the uncommitted prompt and metadata without loading a business tip over it',async()=>{
  view();expect(await screen.findByLabelText('提示词原文')).toHaveProperty('value','unsaved draft');expect(screen.getByLabelText('反向提示词')).toHaveProperty('value','negative draft');expect(api.workspace.acquireEditLease).toHaveBeenCalledWith({kind:'work',id:'work'},'editor-key');
 });
 it('flushes edited prompt and metadata to the existing editor state without creating a version',async()=>{
  view();await screen.findByLabelText('提示词原文');await waitFor(()=>expect(api.workspace.acquireEditLease).toHaveBeenCalled());fireEvent.change(screen.getByLabelText('提示词原文'),{target:{value:'new unsaved'}});fireEvent.change(screen.getByLabelText('反向提示词'),{target:{value:'new negative'}});fireEvent.click(screen.getByRole('button',{name:'保存草稿'}));await waitFor(()=>expect(api.workspace.saveEditorState).toHaveBeenCalledWith('editor-key',4,expect.objectContaining({version:2,works:expect.objectContaining({work:expect.objectContaining({journal:expect.objectContaining({document:expect.objectContaining({primary:'new unsaved',negative:'new negative',generation:expect.objectContaining({steps:'25',seed:'9'}),metadataUnknown:{future:'retained'}})})})})})));expect(api.novelai.createVersion).not.toHaveBeenCalled();
 });
 it('makes a denied lease visible and blocks writing a business version',async()=>{
  api.workspace.acquireEditLease.mockResolvedValueOnce({ok:false,code:'EDIT_LOCKED',message:'another editor is active'});view();await screen.findByLabelText('提示词原文');expect(await screen.findByText(/编辑权不可用/)).toBeTruthy();expect(screen.getByRole('button',{name:/保存为新版本/}).hasAttribute('disabled')).toBe(true);expect(api.novelai.createVersion).not.toHaveBeenCalled();
 });
 it('preserves newer input typed while a business version save is pending',async()=>{
  let release!: (value:unknown)=>void;api.novelai.createVersion.mockReturnValueOnce(new Promise(resolve=>{release=resolve}));
  view();await screen.findByLabelText('提示词原文');await waitFor(()=>expect(api.workspace.acquireEditLease).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button',{name:/保存为新版本/}));await waitFor(()=>expect(api.novelai.createVersion).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('提示词原文'),{target:{value:'typed after save'}});
  release({version:bundle.line[0],branched:false,unchanged:false});
  await waitFor(()=>expect(api.novelai.bundle.mock.calls.length).toBeGreaterThan(1));
  expect(screen.getByLabelText('提示词原文')).toHaveProperty('value','typed after save');
 });
 it('keeps prompt and metadata separate for each selected work',async()=>{
  const other={...bundle,work:{...bundle.work,id:'other',name:'other',lastVersionId:'v2'},line:[{...bundle.line[0],id:'v2',workId:'other',branchId:'v2',snapshot:'other saved'}]};
  api.novelai.listWorks.mockResolvedValue([bundle.work,other.work]);api.novelai.bundle.mockImplementation(async(input:unknown)=>(input as {workId:string}).workId==='other'?other:bundle);
  view();await screen.findByLabelText('提示词原文');fireEvent.click(screen.getByRole('button',{name:'other'}));
  await waitFor(()=>expect(screen.getByLabelText('提示词原文')).toHaveProperty('value','other saved'));
  expect(screen.getByLabelText('反向提示词')).toHaveProperty('value','');
  fireEvent.click(screen.getByRole('button',{name:'work'}));
  await waitFor(()=>expect(screen.getByLabelText('提示词原文')).toHaveProperty('value','unsaved draft'));
  expect(screen.getByLabelText('反向提示词')).toHaveProperty('value','negative draft');
 });
 it('discards a PNG metadata reply when the user switches to another work',async()=>{
  let release!: (value:unknown)=>void;api.novelai.metadata.readFrom.mockReturnValueOnce(new Promise(resolve=>{release=resolve}));
  const other={...bundle,work:{...bundle.work,id:'other',name:'other',lastVersionId:'v2'},line:[{...bundle.line[0],id:'v2',workId:'other',branchId:'v2',snapshot:'other saved'}]};
  api.novelai.listWorks.mockResolvedValue([bundle.work,other.work]);api.novelai.bundle.mockImplementation(async(input:unknown)=>(input as {workId:string}).workId==='other'?other:bundle);
  view();await screen.findByLabelText('提示词原文');fireEvent.click(screen.getByRole('button',{name:/从 PNG 读取/}));await waitFor(()=>expect(api.novelai.metadata.readFrom).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button',{name:'other'}));await waitFor(()=>expect(screen.getByLabelText('提示词原文')).toHaveProperty('value','other saved'));
  release({canceled:false,decoded:{params:{prompt:'old PNG result',negativePrompt:'old PNG negative'},unknown:{future:'old'}}});
  await waitFor(()=>expect(screen.getByText(/已丢弃本次 PNG/)).toBeTruthy());
  expect(screen.getByLabelText('提示词原文')).toHaveProperty('value','other saved');expect(screen.getByLabelText('反向提示词')).toHaveProperty('value','');
 });
})
