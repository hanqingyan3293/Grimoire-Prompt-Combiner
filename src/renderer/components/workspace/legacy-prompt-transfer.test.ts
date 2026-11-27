import {describe,expect,it} from 'vitest'
import {captureLegacyPromptEditor,validateLegacyPromptEditor} from './legacy-prompt-transfer'
const tag={tag:{id:'tag',subcategory_id:'sub',en:'raw tag',zh:'标签',sort_order:0,source:'custom' as const,created_at:'now'},weight:1.3,category:'cat',subcategory:'sub',breakBefore:true}
describe('W2 legacy prompt editor adapter',()=>{
 it('keeps explicit implied-tag exclusions in its existing draft snapshot',()=>{
  expect(captureLegacyPromptEditor({positive:[tag],negative:[],undoStack:[],redoStack:[],impliedExcluded:['excluded-tag']})).toHaveProperty('impliedExcluded',['excluded-tag']);
 });
 it('preserves tag, numeric dialect weight, break markers and grouped undo history',()=>{const state={positive:[tag],negative:[{...tag,weight:0.8}],undoStack:[{positive:[tag],negative:[],timestamp:10}],redoStack:[]};const snapshot=captureLegacyPromptEditor(state);expect(snapshot).toMatchObject(state);state.positive[0].weight=1.5;expect(snapshot.positive[0].weight).toBe(1.3)});
 it('does not accept an unrelated or malformed transfer shape',()=>{expect(()=>validateLegacyPromptEditor({kind:'foreign',version:1,positive:[],negative:[]})).toThrow('EDITOR_STATE_INVALID');expect(()=>validateLegacyPromptEditor({kind:'legacy-prompts',version:1,positive:'bad',negative:[],undoStack:[],redoStack:[]})).toThrow('EDITOR_STATE_INVALID')});
})
