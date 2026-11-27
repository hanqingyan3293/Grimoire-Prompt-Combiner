import {describe,expect,it} from 'vitest'
import {captureSettingsView,validateSettingsView} from './settings-editor-view'
describe('W2 safe settings view state',()=>{
 it('retains selected section, search and expansion only',()=>{const value=captureSettingsView('appearance','主题',{general:true,appearance:false});expect(value).toEqual({kind:'settings-view',version:1,section:'appearance',query:'主题',collapsed:{general:true,appearance:false}});expect(Object.keys(value).sort()).toEqual(['collapsed','kind','query','section','version'])});
 it('rejects transferred forms or secret fields and invalid view schema',()=>{expect(()=>validateSettingsView({kind:'settings-view',version:1,section:'general',query:'',collapsed:{},apiKey:'public-test-secret'})).toThrow('EDITOR_STATE_INVALID');expect(()=>validateSettingsView({kind:'settings-view',version:1,section:'unknown',query:'',collapsed:{}})).toThrow('EDITOR_STATE_INVALID')});
})
