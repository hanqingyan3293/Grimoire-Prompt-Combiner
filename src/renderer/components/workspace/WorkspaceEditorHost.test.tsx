// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceEditorHost, useWorkspaceEditorState } from './WorkspaceEditorHost'

vi.mock('./PanelRegistry', () => ({ getEditorDefinition: () => ({ stateKeyFactory: ({ workspaceId, editorId, type }: {workspaceId:string;editorId:string;type:string}) => workspaceId + ':' + editorId + ':' + type }) }))
type Stored = {editorKey:string;revision:number;state:unknown}
let changed: (value: Stored) => void = () => {}
const api = { loadEditorState:vi.fn(), saveEditorState:vi.fn(), onEditorStateChanged:vi.fn((callback:typeof changed) => { changed=callback; return () => {} }) }
function barrier<T>() { let resolve!: (value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve} }
function Consumer() {
  const editor=useWorkspaceEditorState<string>()
  return <><output aria-label='state'>{String(editor.state)}</output><output aria-label='dirty'>{String(editor.dirty)}</output><output aria-label='status'>{editor.status}</output><output aria-label='revision'>{editor.revision}</output><button onClick={()=>editor.setState('local')}>edit</button><button onClick={()=>editor.setState('newer local')}>edit newer</button><button onClick={()=>void editor.flush?.('test')}>flush</button></>
}
const host=(id='a')=><WorkspaceEditorHost workspaceId='w' editorId={id} type='prompt-editor'><Consumer/></WorkspaceEditorHost>
beforeEach(()=>{vi.clearAllMocks();api.loadEditorState.mockResolvedValue({editorKey:'w:a:prompt-editor',revision:1,state:'remote1'});api.saveEditorState.mockImplementation(async (key:string,revision:number,state:unknown)=>({saved:true,value:{editorKey:key,revision:revision+1,state}}));(window as unknown as {api:unknown}).api={workspace:api}})
afterEach(()=>cleanup())

describe('W1 editor state ownership and CAS races',()=>{
 it('keeps a newer broadcast when an older initial load returns',async()=>{
  const load=barrier<Stored>();api.loadEditorState.mockReturnValue(load.promise);render(host());
  act(()=>changed({editorKey:'w:a:prompt-editor',revision:2,state:'remote2'}));
  await act(async()=>load.resolve({editorKey:'w:a:prompt-editor',revision:1,state:'remote1'}));
  expect(screen.getByLabelText('state').textContent).toBe('remote2');expect(screen.getByLabelText('revision').textContent).toBe('2');
 });
 it('preserves a dirty local value when a different revision is broadcast',async()=>{
  render(host());await screen.findByText('remote1');fireEvent.click(screen.getByText('edit'));
  act(()=>changed({editorKey:'w:a:prompt-editor',revision:2,state:'other window'}));
  expect(screen.getByLabelText('state').textContent).toBe('local');expect(screen.getByLabelText('dirty').textContent).toBe('true');
  fireEvent.click(screen.getByText('flush'));await waitFor(()=>expect(screen.getByLabelText('status').textContent).toBe('conflict'));expect(api.saveEditorState).not.toHaveBeenCalled();
 });
 it('does not roll back a new local edit when an earlier save acknowledges',async()=>{
  const save=barrier<unknown>();api.saveEditorState.mockReturnValue(save.promise);render(host());await screen.findByText('remote1');fireEvent.click(screen.getByText('edit'));fireEvent.click(screen.getByText('flush'));
  await waitFor(()=>expect(api.saveEditorState).toHaveBeenCalled());
  act(()=>changed({editorKey:'w:a:prompt-editor',revision:2,state:'local'}));
  fireEvent.click(screen.getByText('edit newer'));
  await act(async()=>save.resolve({saved:true,value:{editorKey:'w:a:prompt-editor',revision:2,state:'local'}}));
  expect(screen.getByLabelText('state').textContent).toBe('newer local');expect(screen.getByLabelText('dirty').textContent).toBe('true');expect(Number(screen.getByLabelText('revision').textContent)).toBe(2);
 });
 it('isolates a pending save acknowledgement after the editor key changes',async()=>{
  const save=barrier<unknown>();api.saveEditorState.mockReturnValue(save.promise);api.loadEditorState.mockImplementation(async(key:string)=>({editorKey:key,revision:key.includes(':a:')?9:1,state:key.includes(':a:')?'state A':'state B'}));const view=render(host());await screen.findByText('state A');fireEvent.click(screen.getByText('edit'));fireEvent.click(screen.getByText('flush'));await waitFor(()=>expect(api.saveEditorState).toHaveBeenCalled());view.rerender(host('b'));await screen.findByText('state B');
  await act(async()=>save.resolve({saved:true,value:{editorKey:'w:a:prompt-editor',revision:10,state:'local'}}));
  expect(screen.getByLabelText('state').textContent).toBe('state B');expect(screen.getByLabelText('revision').textContent).toBe('1');
 });
 it('retains local state on a rejected write and reports a structured failure',async()=>{
  api.saveEditorState.mockRejectedValue(new Error('disk fixture'));render(host());await screen.findByText('remote1');fireEvent.click(screen.getByText('edit'));fireEvent.click(screen.getByText('flush'));
  await waitFor(()=>expect(screen.getByLabelText('status').textContent).toBe('error'));expect(screen.getByLabelText('state').textContent).toBe('local');expect(screen.getByLabelText('dirty').textContent).toBe('true');
 });
 it('never writes an already-clean editor state as another business version',async()=>{
  render(host());await screen.findByText('remote1');fireEvent.click(screen.getByText('flush'));await waitFor(()=>expect(screen.getByLabelText('status').textContent).toBe('ready'));expect(api.saveEditorState).not.toHaveBeenCalled();
 });
})
