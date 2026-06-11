/* ========== 魔导书 v2 - 应用逻辑 ========== */
var S={allData:null,activeCat:null,activeSc:null,isSearching:false,posTags:[],autoSortPos:true,negTags:[],autoSortNeg:true,activeTab:'positive',useQuality:true,favs:{}};
var QW=['masterpiece','best quality'];
function el(id){return document.getElementById(id);}
function qs(s,p){return (p||document).querySelector(s);}
function qsa(s,p){return (p||document).querySelectorAll(s);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function toast(m){var t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);setTimeout(function(){t.remove();},2000);}
function api(u,o){o=o||{};return fetch(u,{method:o.method||'GET',headers:{'Content-Type':'application/json'},body:o.body?JSON.stringify(o.body):undefined}).then(function(r){return r.json();});}
function loadFavs(){try{var d=localStorage.getItem('grimoire2_favs');if(d)S.favs=JSON.parse(d);}catch(e){S.favs={};}}
function saveFavs(){localStorage.setItem('grimoire2_favs',JSON.stringify(S.favs));}
function toggleFav(en){if(S.favs[en])delete S.favs[en];else S.favs[en]=true;saveFavs();renderFavs();if(!S.isSearching)renderGrid();}
function isSelected(en,panel){var a=panel==='negative'?S.negTags:S.posTags;for(var i=0;i<a.length;i++)if(a[i].en===en)return true;return false;}
function findZh(en){if(!S.allData)return null;for(var ci=0;ci<S.allData.categories.length;ci++){var c=S.allData.categories[ci];for(var si=0;si<c.subcategories.length;si++){var sc=c.subcategories[si];for(var ti=0;ti<sc.tags.length;ti++)if(sc.tags[ti].en===en)return sc.tags[ti].zh;}}return null;}
function findCat(en){if(!S.allData)return null;for(var ci=0;ci<S.allData.categories.length;ci++){var c=S.allData.categories[ci];for(var si=0;si<c.subcategories.length;si++){var sc=c.subcategories[si];for(var ti=0;ti<sc.tags.length;ti++)if(sc.tags[ti].en===en)return {category:c.name,subcategory:sc.name};}}return null;}
function addTag(en,zh,panel){var a=panel==='negative'?S.negTags:S.posTags;for(var i=0;i<a.length;i++)if(a[i].en===en)return;var info=findCat(en)||{};a.push({en:en,zh:zh||en,weight:1.0,category:info.category||'',subcategory:info.subcategory||''});refreshPanel(panel);updatePreview();if(!S.isSearching)renderGrid();}
function removeTag(en,panel){if(panel==='negative')S.negTags=S.negTags.filter(function(t){return t.en!==en;});else S.posTags=S.posTags.filter(function(t){return t.en!==en;});refreshPanel(panel);updatePreview();if(!S.isSearching)renderGrid();}
function updateWeight(en,w,panel){var a=panel==='negative'?S.negTags:S.posTags;for(var i=0;i<a.length;i++)if(a[i].en===en){a[i].weight=w;break;}updatePreview();}
function clearAll(){S.posTags=[];S.negTags=[];refreshPanel('positive');refreshPanel('negative');updatePreview();if(!S.isSearching)renderGrid();toast('已清空全部标签');}
function getSorted(panel){var a=panel==='negative'?S.negTags:S.posTags;var as=panel==='negative'?S.autoSortNeg:S.autoSortPos;var cp=a.slice();if(as)cp.sort(function(a,b){return b.weight-a.weight;});return cp;}
function genPrompt(tags,fmt){fmt=fmt||el('export-format').value;var p=[];for(var i=0;i<tags.length;i++){var t=tags[i];if(Math.abs(t.weight-1.0)<0.01){p.push(t.en);}else{if(fmt==='novelai'){if(t.weight>1.0){var n=Math.min(Math.round((t.weight-1.0)*10),5);var b='';for(var j=0;j<n;j++)b+='{';var eb='';for(var j=0;j<n;j++)eb+='}';p.push(b+t.en+eb);}else{var n=Math.min(Math.round((1.0-t.weight)*10),5);var br='';for(var j=0;j<n;j++)br+='[';var ebr='';for(var j=0;j<n;j++)ebr+=']';p.push(br+t.en+ebr);}}else{if(t.weight>1.0)p.push('('+t.en+':'+t.weight.toFixed(1)+')');else p.push('['+t.en+':'+t.weight.toFixed(1)+']');}}}return p.join(', ');}
function genPromptCN(tags){var p=[];for(var i=0;i<tags.length;i++){var t=tags[i];var zh=t.zh||t.en;if(Math.abs(t.weight-1.0)<0.01){p.push(zh);}else{if(t.weight>1.0)p.push('('+zh+':'+t.weight.toFixed(1)+')');else p.push('['+zh+':'+t.weight.toFixed(1)+']');}}return p.join(', ');}
function updatePreview(){var pos=getSorted('positive');var neg=getSorted('negative');var parts=[];if(S.useQuality&&pos.length>0)parts.push(QW.join(', '));if(pos.length>0)parts.push(genPrompt(pos));var txt=parts.join(', ');if(neg.length>0)txt+='\n--neg '+genPrompt(neg);el('prompt-output').value=txt;}
function refreshPanel(panel){var a=panel==='negative'?S.negTags:S.posTags;var ct=el('selected-tags-'+panel);var cnt=el(panel+'-count');var sorted=getSorted(panel);var as=panel==='negative'?S.autoSortNeg:S.autoSortPos;cnt.textContent='已选 '+a.length+' 个';if(sorted.length===0){ct.innerHTML='<div class=empty-hint>点击左侧标签添加到此处</div>';return;}
var groups={};for(var i=0;i<sorted.length;i++){var t=sorted[i];var cat=t.category||'未分类';if(!groups[cat])groups[cat]=[];groups[cat].push(t);}
var html='';var gnames=Object.keys(groups);
for(var gi=0;gi<gnames.length;gi++){var gn=gnames[gi];var gtags=groups[gn];html+='<div class=cat-group><div class=cat-group-header><span class=cat-dot></span>'+esc(gn)+' ('+gtags.length+')</div>';
for(var ti=0;ti<gtags.length;ti++){var t=gtags[ti];html+='<div class=tag-row data-en='+esc(t.en)+' data-panel='+panel+'>';
if(!as)html+='<span class=drag-handle draggable=true data-en='+esc(t.en)+' data-panel='+panel+' title=拖拽排序>☰</span>';
html+='<span class=tag-info><span class=zh>'+esc(t.zh||t.en)+'</span><span class=en>'+esc(t.en)+' ('+esc(t.category||'')+')</span></span>';
html+='<input type=range class=weight-slider min=0.5 max=2.0 step=0.1 value='+t.weight.toFixed(1)+' data-en='+esc(t.en)+' data-panel='+panel+'>';
html+='<input type=number class=weight-input min=0.5 max=2.0 step=0.1 value='+t.weight.toFixed(1)+' data-en='+esc(t.en)+' data-panel='+panel+'>';
html+='<button class=tag-remove data-en='+esc(t.en)+' data-panel='+panel+' title=移除>✕</button>';
html+='</div>';}html+='</div>';}
ct.innerHTML=html;
qsa('.weight-slider',ct).forEach(function(s){s.addEventListener('input',function(){var w=parseFloat(this.value);var en=this.dataset.en;var p=this.dataset.panel;updateWeight(en,w,p);var row=this.closest('.tag-row');if(row){var inp=qs('.weight-input',row);if(inp)inp.value=w.toFixed(1);}if((p==='negative'?S.autoSortNeg:S.autoSortPos))refreshPanel(p);});});
qsa('.weight-input',ct).forEach(function(inp){inp.addEventListener('change',function(){var w=parseFloat(this.value);if(isNaN(w)||w<0.5)w=0.5;if(w>2.0)w=2.0;this.value=w.toFixed(1);var en=this.dataset.en;var p=this.dataset.panel;updateWeight(en,w,p);var row=this.closest('.tag-row');if(row){var sl=qs('.weight-slider',row);if(sl)sl.value=w.toFixed(1);}if((p==='negative'?S.autoSortNeg:S.autoSortPos))refreshPanel(p);});});
qsa('.tag-remove',ct).forEach(function(b){b.addEventListener('click',function(){var en=this.dataset.en;var p=this.dataset.panel;removeTag(en,p);});});
if(!as)setupDrag(ct,panel);
}

function setupDrag(ct,panel){
qsa('.drag-handle',ct).forEach(function(h){
h.addEventListener('dragstart',function(e){e.dataTransfer.setData('text/plain',this.dataset.en+'|'+panel);e.dataTransfer.effectAllowed='move';});
});
qsa('.tag-row',ct).forEach(function(row){
row.addEventListener('dragover',function(e){e.preventDefault();this.classList.add('drag-over');e.dataTransfer.dropEffect='move';});
row.addEventListener('dragleave',function(e){this.classList.remove('drag-over');});
row.addEventListener('drop',function(e){e.preventDefault();this.classList.remove('drag-over');var d=e.dataTransfer.getData('text/plain');var ps=d.split('|');var fromEn=ps[0],fromP=ps[1];var toEn=this.dataset.en;var a=panel==='negative'?S.negTags:S.posTags;var fi=-1,ti=-1;for(var i=0;i<a.length;i++){if(a[i].en===fromEn)fi=i;if(a[i].en===toEn)ti=i;}if(fi>=0&&ti>=0&&fi!==ti){var item=a.splice(fi,1)[0];a.splice(ti,0,item);refreshPanel(panel);updatePreview();}});
});
}
function renderGrid(){if(S.isSearching)return;var grid=el('tag-grid');var title=el('browser-title');var acts=el('browser-actions');if(!S.activeSc||!S.allData){grid.innerHTML='';title.textContent='请从左侧选择一个子类别';acts.innerHTML='';return;}
var allTags=[];var cn='';var sn=S.activeSc;
for(var ci=0;ci<S.allData.categories.length;ci++){var c=S.allData.categories[ci];if(c.name===S.activeCat){cn=c.name;for(var si=0;si<c.subcategories.length;si++){if(c.subcategories[si].name===sn){allTags=c.subcategories[si].tags;break;}}break;}}
title.textContent=cn+' › '+sn+' ('+allTags.length+'个)';
acts.innerHTML='<button id=btn-sc-add-tag class=tool-btn title=添加标签到当前子类别>✚ 添加标签</button>';
el('btn-sc-add-tag').addEventListener('click',function(){openTagForm(cn,sn);});
if(allTags.length===0){grid.innerHTML='<div class=empty-hint style=padding:40px;text-align:center>此子类别暂无标签<br><button id=btn-empty-add class=action-btn style=margin-top:12px>✚ 添加第一个标签</button></div>';el('btn-empty-add').addEventListener('click',function(){openTagForm(cn,sn);});return;}
var html='<div class=tag-grid>';
for(var i=0;i<allTags.length;i++){var t=allTags[i];var ip=isSelected(t.en,'positive'),in2=isSelected(t.en,'negative');var sc='';if(ip&&in2)sc=' selected both';else if(ip)sc=' selected positive';else if(in2)sc=' selected negative';var fv=S.favs[t.en]?' faved':'';
html+='<div class=tag-chip'+sc+' data-en='+esc(t.en)+' data-zh='+esc(t.zh||'')+' title='+esc(t.en+(t.zh?' - '+t.zh:''))+'>';
html+='<span class=tag-zh>'+esc(t.zh||t.en)+'</span><span class=tag-en>'+esc(t.en)+'</span>';
html+='<span class=tag-star'+fv+' data-en='+esc(t.en)+'>&#11088;</span>';
html+='<span class=tag-edit-icon data-en='+esc(t.en)+' data-zh='+esc(t.zh||'')+' data-cat='+esc(cn)+' data-sc='+esc(sn)+' title=编辑>&#9998;</span>';
html+='</div>';}
html+='</div>';grid.innerHTML=html;
qsa('.tag-chip',grid).forEach(function(ch){ch.addEventListener('click',function(e){if(e.target.classList.contains('tag-star')||e.target.classList.contains('tag-edit-icon'))return;var en=this.dataset.en,zh=this.dataset.zh;if(S.activeTab==='negative'){if(isSelected(en,'negative'))removeTag(en,'negative');else addTag(en,zh,'negative');}else{if(isSelected(en,'positive'))removeTag(en,'positive');else addTag(en,zh,'positive');}});});
qsa('.tag-star',grid).forEach(function(s){s.addEventListener('click',function(e){e.stopPropagation();toggleFav(this.dataset.en);});});
qsa('.tag-edit-icon',grid).forEach(function(ic){ic.addEventListener('click',function(e){e.stopPropagation();openTagFormEdit(this.dataset.cat,this.dataset.sc,this.dataset.en,this.dataset.zh);});});
}

function renderTree(){if(!S.allData)return;var tree=el('category-tree');var html='';
for(var i=0;i<S.allData.categories.length;i++){var c=S.allData.categories[i];var oc=S.activeCat===c.name?' open':'';html+='<div class=category-item><div class=cat-header data-cat='+esc(c.name)+'>';
html+='<span class=arrow'+oc+'>▶</span><span class=cat-name>'+esc(c.name)+'</span><span class=cat-badge>'+c.subcategories.length+'</span>';
html+='<button class=cat-add-sc data-cat='+esc(c.name)+' title=添加子类别>✚</button></div>';
html+='<div class=subcat-list'+oc+'>';
for(var j=0;j<c.subcategories.length;j++){var sc=c.subcategories[j];var ac=S.activeSc===sc.name&&S.activeCat===c.name?' active':'';html+='<div class=subcat-item'+ac+' data-cat='+esc(c.name)+' data-sc='+esc(sc.name)+'><span class=sc-name>'+esc(sc.name)+' ('+sc.tags.length+')</span></div>';}
html+='</div></div>';}
tree.innerHTML=html;
qsa('.cat-header',tree).forEach(function(h){h.addEventListener('click',function(e){if(e.target.classList.contains('cat-add-sc'))return;var item=this.parentElement;var a=qs('.arrow',this);var l=qs('.subcat-list',item);var io=l.classList.contains('open');if(io){l.classList.remove('open');a.classList.remove('open');}else{l.classList.add('open');a.classList.add('open');}});});
qsa('.cat-add-sc',tree).forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();openNewSc(this.dataset.cat);});});
qsa('.subcat-item',tree).forEach(function(it){it.addEventListener('click',function(){S.isSearching=false;S.activeCat=this.dataset.cat;S.activeSc=this.dataset.sc;el('search-input').value='';el('btn-search-clear').style.display='none';el('search-results-info').style.display='none';qsa('.subcat-item',tree).forEach(function(s){s.classList.remove('active');});this.classList.add('active');renderGrid();});});
}

function doSearch(q){if(q.length<1){clearSearch();return;}api('/api/search?q='+encodeURIComponent(q)).then(function(rs){S.isSearching=true;var grid=el('tag-grid');var title=el('browser-title');var info=el('search-results-info');el('browser-actions').innerHTML='';var tc=0;for(var i=0;i<rs.length;i++)tc+=rs[i].tags.length;title.textContent='搜索: '+q;info.style.display='block';info.innerHTML='找到 <b>'+tc+'</b> 个标签，分布在 <b>'+rs.length+'</b> 个子类别';if(rs.length===0){grid.innerHTML='<div class=empty-hint style=padding:40px;text-align:center>未找到相关标签</div>';return;}
var html='';for(var i=0;i<rs.length;i++){var r=rs[i];html+='<div class=search-result-group><h3>'+esc(r.category)+' › '+esc(r.subcategory)+'</h3><div class=tag-grid>';
for(var j=0;j<r.tags.length;j++){var t=r.tags[j];var ip=isSelected(t.en,'positive'),in2=isSelected(t.en,'negative');var sc='';if(ip&&in2)sc=' selected both';else if(ip)sc=' selected positive';else if(in2)sc=' selected negative';var fv=S.favs[t.en]?' faved':'';
html+='<div class=tag-chip'+sc+' data-en='+esc(t.en)+' data-zh='+esc(t.zh||'')+'><span class=tag-zh>'+esc(t.zh||t.en)+'</span><span class=tag-en>'+esc(t.en)+'</span><span class=tag-star'+fv+' data-en='+esc(t.en)+'>&#11088;</span></div>';}
html+='</div></div>';}
grid.innerHTML=html;
qsa('.tag-chip',grid).forEach(function(ch){ch.addEventListener('click',function(e){if(e.target.classList.contains('tag-star'))return;var en=this.dataset.en,zh=this.dataset.zh;if(S.activeTab==='negative'){if(isSelected(en,'negative'))removeTag(en,'negative');else addTag(en,zh,'negative');}else{if(isSelected(en,'positive'))removeTag(en,'positive');else addTag(en,zh,'positive');}doSearch(q);});});
qsa('.tag-star',grid).forEach(function(s){s.addEventListener('click',function(e){e.stopPropagation();toggleFav(this.dataset.en);doSearch(q);});});
});}
function clearSearch(){S.isSearching=false;el('search-results-info').style.display='none';if(S.activeSc)renderGrid();else{el('tag-grid').innerHTML='';el('browser-title').textContent='请从左侧选择一个子类别';}}
function renderFavs(){var list=el('favorites-list');var count=Object.keys(S.favs).length;el('fav-count').textContent=count>0?'('+count+')':'';var html='';var keys=Object.keys(S.favs);for(var i=0;i<keys.length;i++){var en=keys[i];var zh=findZh(en);html+='<div class=fav-item data-en='+esc(en)+' data-zh='+esc(zh||'')+'>&#11088; '+esc(zh||en)+'</div>';}if(keys.length===0)html='<div style=padding:4px 14px;font-size:11px;color:var(--text-muted)>点击标签旁的 ⭐ 收藏</div>';list.innerHTML=html;qsa('.fav-item',list).forEach(function(it){it.addEventListener('click',function(){var en=this.dataset.en,zh=this.dataset.zh;if(S.activeTab==='negative'){if(isSelected(en,'negative'))removeTag(en,'negative');else addTag(en,zh,'negative');}else{if(isSelected(en,'positive'))removeTag(en,'positive');else addTag(en,zh,'positive');}});});}
function loadPresets(){api('/api/presets').then(function(d){var list=el('presets-list');var html='';for(var i=0;i<d.builtin.length;i++){var p=d.builtin[i];html+='<div class=preset-item data-preset='+esc(p.name)+' data-type=builtin><span class=preset-cat>'+esc(p.category)+'</span>'+esc(p.name)+' ('+p.tags.length+')</div>';}list.innerHTML=html;qsa('.preset-item[data-type=builtin]',list).forEach(function(it){it.addEventListener('click',function(){var nm=this.dataset.preset;for(var i=0;i<d.builtin.length;i++)if(d.builtin[i].name===nm){applyPreset(d.builtin[i]);break;}});});});}
function loadSaved(){api('/api/presets').then(function(d){var list=el('saved-list');var html='';for(var i=0;i<d.user.length;i++){var p=d.user[i];html+='<div class=saved-item><span style=flex:1;cursor:pointer data-preset='+esc(p.name)+' data-type=user>'+esc(p.name)+'</span><span class=saved-actions><button title=导出 data-name='+esc(p._filename)+'>📤</button><button title=删除 data-name='+esc(p._filename)+'>🗑</button></span></div>';}html+='<div class=saved-item id=btn-import-preset style=color:var(--accent);cursor:pointer>📥 导入预设...</div>';list.innerHTML=html;qsa('.saved-item>span[data-preset]',list).forEach(function(sp){sp.addEventListener('click',function(){var nm=this.dataset.preset;for(var i=0;i<d.user.length;i++)if(d.user[i].name===nm){applyPreset(d.user[i]);break;}});});qsa('.saved-actions button[title=导出]',list).forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();var fn=this.dataset.name;api('/api/presets/export/'+encodeURIComponent(fn)).then(function(p){if(p.error){toast(p.error);return;}var bl=new Blob([JSON.stringify(p,null,2)],{type:'application/json'});var u=URL.createObjectURL(bl);var a=document.createElement('a');a.href=u;a.download=fn;a.click();URL.revokeObjectURL(u);toast('已导出');});});});qsa('.saved-actions button[title=删除]',list).forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();if(!confirm('确定删除?'))return;var fn=this.dataset.name;api('/api/presets/delete/'+encodeURIComponent(fn),{method:'DELETE'}).then(function(r){if(r.ok){toast('已删除');loadSaved();}});});});var ib=el('btn-import-preset');if(ib)ib.addEventListener('click',function(){el('modal-import').style.display='';el('import-preset-json').value='';});});}
function applyPreset(p){S.posTags=[];S.negTags=[];var w=p.weights||{};for(var i=0;i<(p.tags||[]).length;i++){var en=p.tags[i];var zh=findZh(en);var info=findCat(en)||{};S.posTags.push({en:en,zh:zh||en,weight:w[en]||1.0,category:info.category||'',subcategory:info.subcategory||''});}var nw=p.negative_weights||{};for(var i=0;i<(p.negative_tags||[]).length;i++){var en=p.negative_tags[i];var zh=findZh(en);var info=findCat(en)||{};S.negTags.push({en:en,zh:zh||en,weight:nw[en]||1.0,category:info.category||'',subcategory:info.subcategory||''});}refreshPanel('positive');refreshPanel('negative');updatePreview();if(!S.isSearching)renderGrid();toast('已加载: '+p.name);}
function loadHistory(){api('/api/history').then(function(items){var list=el('history-list');var html='';for(var i=0;i<Math.min(items.length,20);i++){var h=items[i];var p=h.prompt.length>50?h.prompt.substring(0,50)+'...':h.prompt;html+='<div class=history-item data-id='+esc(h._filename)+' title='+esc(h.created)+'><span style=flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap>'+esc(p)+'</span><button class=hist-del-btn data-id='+esc(h._filename)+'>✕</button></div>';}if(items.length===0)html='<div style=padding:6px 14px;font-size:11px;color:var(--text-muted)>暂无历史记录</div>';list.innerHTML=html;qsa('.history-item',list).forEach(function(it){it.addEventListener('click',function(e){if(e.target.classList.contains('hist-del-btn'))return;var id=this.dataset.id;api('/api/history').then(function(items2){for(var i=0;i<items2.length;i++)if(items2[i]._filename===id){el('prompt-output').value=items2[i].prompt;navigator.clipboard.writeText(items2[i].prompt).then(function(){toast('已复制历史提示词');});break;}});});});qsa('.hist-del-btn',list).forEach(function(b){b.addEventListener('click',function(e){e.stopPropagation();var id=this.dataset.id;api('/api/history/'+encodeURIComponent(id),{method:'DELETE'}).then(function(){loadHistory();});});});});}
/* === 标签管理弹窗 === */
var tagFormCtx={};
function openTagForm(cat,sc){tagFormCtx={cat:cat,sc:sc,mode:'add'};el('tag-form-title').textContent='添加标签';el('tag-form-info').textContent=cat+' › '+sc;el('tag-form-en').value='';el('tag-form-zh').value='';el('tag-form-old-en').value='';el('modal-tag-form').style.display='';el('tag-form-en').focus();}
function openTagFormEdit(cat,sc,en,zh){tagFormCtx={cat:cat,sc:sc,mode:'edit',oldEn:en};el('tag-form-title').textContent='编辑标签';el('tag-form-info').textContent=cat+' › '+sc;el('tag-form-en').value=en;el('tag-form-zh').value=zh||'';el('tag-form-old-en').value=en;el('modal-tag-form').style.display='';}
function submitTagForm(){var en=el('tag-form-en').value.trim();var zh=el('tag-form-zh').value.trim()||en;if(!en){toast('请输入英文标签');return;}
if(tagFormCtx.mode==='add'){api('/api/custom-tags/add',{method:'POST',body:{category:tagFormCtx.cat,subcategory:tagFormCtx.sc,en:en,zh:zh}}).then(function(r){if(r.ok){toast('标签已添加');el('modal-tag-form').style.display='none';loadAllData();}else{toast(r.error||'添加失败');}});}
else{api('/api/custom-tags/edit',{method:'POST',body:{category:tagFormCtx.cat,subcategory:tagFormCtx.sc,old_en:tagFormCtx.oldEn,new_en:en,new_zh:zh}}).then(function(r){if(r.ok){toast('标签已更新');el('modal-tag-form').style.display='none';loadAllData();}else{toast(r.error||'更新失败');}});}}
function openNewCat(){el('modal-new-cat').style.display='';el('new-cat-name').value='';el('new-cat-name').focus();}
function submitNewCat(){var nm=el('new-cat-name').value.trim();if(!nm){toast('请输入名称');return;}api('/api/custom-tags/add-category',{method:'POST',body:{name:nm}}).then(function(r){if(r.ok){toast('大类已创建');el('modal-new-cat').style.display='none';loadAllData();}else{toast(r.error||'创建失败');}});}
function openNewSc(cat){el('new-sc-cat-name').textContent='大类: '+cat;el('modal-new-sc').style.display='';el('new-sc-name').value='';el('modal-new-sc').dataset.cat=cat;el('new-sc-name').focus();}
function submitNewSc(){var cat=el('modal-new-sc').dataset.cat;var nm=el('new-sc-name').value.trim();if(!nm){toast('请输入名称');return;}api('/api/custom-tags/add-subcategory',{method:'POST',body:{category:cat,subcategory:nm}}).then(function(r){if(r.ok){toast('子类别已创建');el('modal-new-sc').style.display='none';loadAllData();}else{toast(r.error||'创建失败');}});}

function loadAllData(){api('/api/tags').then(function(d){S.allData=d;renderTree();});}

function init(){
loadFavs();loadAllData();loadPresets();loadSaved();loadHistory();renderFavs();
el('search-input').addEventListener('input',function(){var q=this.value.trim();var b=el('btn-search-clear');if(q){b.style.display='block';doSearch(q);}else{b.style.display='none';clearSearch();}});
el('btn-search-clear').addEventListener('click',function(){el('search-input').value='';this.style.display='none';clearSearch();});
el('fav-toggle').addEventListener('click',function(){var l=el('favorites-list');l.style.display=l.style.display==='none'?'':'none';});
qsa('.panel-tab').forEach(function(t){t.addEventListener('click',function(){var tb=this.dataset.tab;S.activeTab=tb;qsa('.panel-tab').forEach(function(x){x.classList.remove('active');});this.classList.add('active');el('panel-positive').style.display=tb==='positive'?'':'none';el('panel-negative').style.display=tb==='negative'?'':'none';if(!S.isSearching)renderGrid();});});
el('auto-sort-positive').addEventListener('change',function(){S.autoSortPos=this.checked;refreshPanel('positive');updatePreview();});
el('auto-sort-negative').addEventListener('change',function(){S.autoSortNeg=this.checked;refreshPanel('negative');updatePreview();});
el('export-format').addEventListener('change',updatePreview);
el('btn-quality').addEventListener('click',function(){S.useQuality=!S.useQuality;if(S.useQuality)this.classList.add('active');else this.classList.remove('active');updatePreview();});
el('btn-copy').addEventListener('click',function(){var t=el('prompt-output').value;if(!t.trim()){toast('没有可复制的内容');return;}copyText(t);toast('已复制英文提示词!');api('/api/history',{method:'POST',body:{prompt:t,tags:S.posTags.map(function(x){return x.en;}),negative_tags:S.negTags.map(function(x){return x.en;})}}).then(function(){loadHistory();});});
el('btn-copy-cn').addEventListener('click',function(){var pos=getSorted('positive');var neg=getSorted('negative');var parts=[];if(pos.length>0)parts.push(genPromptCN(pos));if(neg.length>0)parts.push('--neg '+genPromptCN(neg));var t=parts.join(', ');if(!t.trim()){toast('没有可复制的内容');return;}copyText(t);toast('已复制中文提示词!');});
el('btn-clear').addEventListener('click',clearAll);
el('btn-random').addEventListener('click',function(){if(!S.allData)return;S.posTags=[];S.negTags=[];var aa=[];for(var ci=0;ci<S.allData.categories.length;ci++){var c=S.allData.categories[ci];if(c.name==='NSFW'||c.name==='NSFW标签')continue;for(var si=0;si<c.subcategories.length;si++){var sc=c.subcategories[si];for(var ti=0;ti<sc.tags.length;ti++){var t=sc.tags[ti];aa.push({en:t.en,zh:t.zh,category:c.name,subcategory:sc.name});}}}
var cnt=Math.floor(Math.random()*6)+3;var pk=[];var sn2={};while(pk.length<cnt&&aa.length>0){var idx=Math.floor(Math.random()*aa.length);var t=aa[idx];if(!sn2[t.en]){sn2[t.en]=true;pk.push({en:t.en,zh:t.zh,weight:Math.round((Math.random()*0.5+1.0)*10)/10,category:t.category,subcategory:t.subcategory});}aa.splice(idx,1);}S.posTags=pk;refreshPanel('positive');updatePreview();if(!S.isSearching)renderGrid();toast('随机生成 '+pk.length+' 个标签');});
el('btn-save-preset').addEventListener('click',function(){if(S.posTags.length===0&&S.negTags.length===0){toast('请先选择标签');return;}el('modal-save').style.display='';el('save-preset-name').value='';el('save-preset-name').focus();});
el('btn-save-confirm').addEventListener('click',function(){var nm=el('save-preset-name').value.trim();if(!nm){toast('请输入名称');return;}var w={};S.posTags.forEach(function(t){w[t.en]=t.weight;});var nw={};S.negTags.forEach(function(t){nw[t.en]=t.weight;});api('/api/presets/save',{method:'POST',body:{name:nm,tags:S.posTags.map(function(t){return t.en;}),weights:w,negative_tags:S.negTags.map(function(t){return t.en;}),negative_weights:nw}}).then(function(r){if(r.ok){toast('已保存: '+nm);el('modal-save').style.display='none';loadSaved();}else{toast(r.error||'未知错误');}});});
el('btn-save-cancel').addEventListener('click',function(){el('modal-save').style.display='none';});
el('btn-add-category').addEventListener('click',openNewCat);
el('btn-new-cat-confirm').addEventListener('click',submitNewCat);
el('btn-new-cat-cancel').addEventListener('click',function(){el('modal-new-cat').style.display='none';});
el('btn-new-sc-confirm').addEventListener('click',submitNewSc);
el('btn-new-sc-cancel').addEventListener('click',function(){el('modal-new-sc').style.display='none';});
el('btn-tag-form-confirm').addEventListener('click',submitTagForm);
el('btn-tag-form-cancel').addEventListener('click',function(){el('modal-tag-form').style.display='none';});
el('btn-import-confirm').addEventListener('click',function(){var t=el('import-preset-json').value.trim();if(!t)return;try{var d=JSON.parse(t);if(!d.name){toast('缺少名称');return;}api('/api/presets/import',{method:'POST',body:d}).then(function(r){if(r.ok){toast('已导入: '+d.name);el('modal-import').style.display='none';loadSaved();}else{toast('失败: '+r.error);}});}catch(e){toast('JSON格式错误');}});
el('btn-import-cancel').addEventListener('click',function(){el('modal-import').style.display='none';});
qsa('.modal').forEach(function(m){m.addEventListener('click',function(e){if(e.target===this)this.style.display='none';});});
document.addEventListener('keydown',function(e){if(e.ctrlKey&&e.key==='k'){e.preventDefault();el('search-input').focus();}});
}
function copyText(t){navigator.clipboard.writeText(t).catch(function(){var ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();});}
document.addEventListener('DOMContentLoaded',init);
