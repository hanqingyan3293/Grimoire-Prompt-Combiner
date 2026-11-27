// @vitest-environment jsdom
import React from 'react'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {NovelAIAssetPanel} from './NovelAIAssetPanel'
import {WorkspaceEditorHost} from '../workspace/WorkspaceEditorHost'
vi.mock('../workspace/PanelRegistry',()=>({getEditorDefinition:()=>({stateKeyFactory:()=> 'asset-editor'})}))
const assets=[{id:'a1',kind:'style',name:'first',payload:'first saved',examples:[],uses:0,revision:1,createdAt:'now',updatedAt:'now'},{id:'a2',kind:'style',name:'second',payload:'second saved',examples:[],uses:0,revision:1,createdAt:'now',updatedAt:'now'}]
const api={novelai:{assets:{list:vi.fn(async()=>assets),images:vi.fn(async()=>[]),versions:vi.fn(async()=>[]),update:vi.fn(),remove:vi.fn(),create:vi.fn(),use:vi.fn(),byImage:vi.fn()}},workspace:{loadEditorState:vi.fn(),saveEditorState:vi.fn(),onEditorStateChanged:vi.fn(()=>()=>{}),acquireEditLease:vi.fn(),heartbeatEditLease:vi.fn(),releaseEditLease:vi.fn()}}
beforeEach(()=>{vi.clearAllMocks();api.workspace.loadEditorState.mockResolvedValue({editorKey:'asset-editor',revision:4,state:{kind:'novelai-assets',version:1,selectedAssetId:'a1',assets:{a1:{payload:'unsaved first',baseRevision:1}}}});api.workspace.saveEditorState.mockImplementation(async(editorKey,revision,state)=>({saved:true,value:{editorKey,revision:revision+1,state}}));api.workspace.acquireEditLease.mockImplementation(async(resource)=>({ok:true,lease:{resource,leaseId:resource.id+'-public-lease',expiresAt:Date.now()+30000}}));api.workspace.releaseEditLease.mockResolvedValue({ok:true,released:true});api.novelai.assets.update.mockImplementation(async(id,patch)=>({...assets.find(a=>a.id===id),payload:patch.payload,revision:2}));(window as unknown as {api:unknown}).api=api})
afterEach(()=>cleanup())
const view=()=>render(<WorkspaceEditorHost workspaceId='w' editorId='e' type='novelai-assets'><NovelAIAssetPanel/></WorkspaceEditorHost>)
describe('W1 actual asset editor draft ownership',()=>{
 it('hydrates the saved editor draft and changes text correctly for each selection',async()=>{
  view();expect(await screen.findByLabelText('素材内容')).toHaveProperty('value','unsaved first');
  fireEvent.click(screen.getByRole('button',{name:/second/}));await waitFor(()=>expect(screen.getByLabelText('素材内容')).toHaveProperty('value','second saved'));
  fireEvent.click(screen.getByRole('button',{name:/first/}));await waitFor(()=>expect(screen.getByLabelText('素材内容')).toHaveProperty('value','unsaved first'));
 });
 it('uses the actual asset lease and content revision for an update',async()=>{
  view();await screen.findByLabelText('素材内容');await waitFor(()=>expect(api.workspace.acquireEditLease).toHaveBeenCalledWith({kind:'asset',id:'a1'},'asset-editor'));
  fireEvent.change(screen.getByLabelText('素材内容'),{target:{value:'new first'}});fireEvent.blur(screen.getByLabelText('素材内容'));
  await waitFor(()=>expect(api.novelai.assets.update).toHaveBeenCalledWith('a1',{payload:'new first',expectedRevision:1},{editorKey:'asset-editor',leaseId:'a1-public-lease'}));
 });
 it('retains an editable draft and blocks persisted content when the lease is denied',async()=>{
  api.workspace.acquireEditLease.mockResolvedValueOnce({ok:false,code:'EDIT_LOCKED',message:'busy elsewhere'});view();await screen.findByLabelText('素材内容');expect(await screen.findByText(/编辑权不可用/)).toBeTruthy();expect(screen.getByLabelText('素材内容')).toHaveProperty('readOnly',true);expect(api.novelai.assets.update).not.toHaveBeenCalled();
 });
})
