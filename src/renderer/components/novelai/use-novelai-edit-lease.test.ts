// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { useNovelaiEditLease } from './use-novelai-edit-lease'
vi.mock('../workspace/WorkspaceEditorHost',()=>({useOptionalWorkspaceEditorState:()=>({stateKey:'w:e:novelai-workbench'})}))
const api={acquireEditLease:vi.fn(),heartbeatEditLease:vi.fn(),releaseEditLease:vi.fn()}
const work={kind:'work' as const,id:'work'}
beforeEach(()=>{vi.clearAllMocks();api.acquireEditLease.mockImplementation(async(resource)=>({ok:true,lease:{resource,leaseId:resource.id+'-lease',expiresAt:Date.now()+30000}}));api.heartbeatEditLease.mockImplementation(async(resource,_key,id)=>({ok:true,lease:{resource,leaseId:id,expiresAt:Date.now()+30000}}));api.releaseEditLease.mockResolvedValue({ok:true,released:true});(window as unknown as {api:unknown}).api={workspace:api}})
afterEach(()=>{cleanup();vi.useRealTimers()})
describe('W1 active panel editing lease',()=>{
 it('acquires for the actual editor key and releases the same lease on unmount',async()=>{
  const hook=renderHook(()=>useNovelaiEditLease(work));await waitFor(()=>expect(hook.result.current.status).toBe('ready'));await expect(hook.result.current.proof()).resolves.toEqual({editorKey:'w:e:novelai-workbench',leaseId:'work-lease'});expect(api.acquireEditLease).toHaveBeenCalledWith(work,'w:e:novelai-workbench');hook.unmount();await waitFor(()=>expect(api.releaseEditLease).toHaveBeenCalledWith(work,'w:e:novelai-workbench','work-lease'));
 });
 it('sends a10second heartbeat and makes a lost lease visible',async()=>{
  vi.useFakeTimers();const hook=renderHook(()=>useNovelaiEditLease(work));await act(async()=>{});expect(hook.result.current.status).toBe('ready');api.heartbeatEditLease.mockResolvedValueOnce({ok:false,code:'EDIT_LEASE_EXPIRED',message:'other editor acquired'});await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(api.heartbeatEditLease).toHaveBeenCalledOnce();expect(hook.result.current.error).toMatchObject({code:'EDIT_LEASE_EXPIRED'});await expect(hook.result.current.proof()).rejects.toThrow('EDIT_LEASE_EXPIRED');
 });
 it('releases a delayed old acquisition without clearing the newer resource lease',async()=>{
  let release!:(value:unknown)=>void;api.acquireEditLease.mockReturnValueOnce(new Promise(resolve=>{release=resolve}));const hook=renderHook(({resource})=>useNovelaiEditLease(resource),{initialProps:{resource:work}});hook.rerender({resource:{kind:'work',id:'other'}});await waitFor(()=>expect(hook.result.current.status).toBe('ready'));await act(async()=>release({ok:true,lease:{resource:work,leaseId:'old',expiresAt:Date.now()+30000}}));expect(api.releaseEditLease).toHaveBeenCalledWith(work,'w:e:novelai-workbench','old');await expect(hook.result.current.proof()).resolves.toMatchObject({leaseId:'other-lease'});
 });
})
