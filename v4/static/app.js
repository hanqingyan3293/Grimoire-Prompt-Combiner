/* ========== 魔导书 v4 - 应用逻辑 ========== */

// ===== 全局状态 =====
var S = {
  allData: null,
  activeCat: null,
  activeSc: null,
  isSearching: false,
  posTags: [],
  autoSortPos: true,
  negTags: [],
  autoSortNeg: true,
  activeTab: "pos",
  useQuality: true,
  favs: {},
  tagFreq: {},
  undoStack: [],
  redoStack: [],
  recOn: false
};

var QW = ["masterpiece", "best quality"];
var QUICK_NEG = [
  {en:"low quality",zh:"低质量"},{en:"worst quality",zh:"最差质量"},
  {en:"blurry",zh:"模糊"},{en:"bad anatomy",zh:"解剖错误"},
  {en:"extra fingers",zh:"多余手指"},{en:"missing fingers",zh:"缺失手指"},
  {en:"nsfw",zh:"NSFW"},{en:"watermark",zh:"水印"},{en:"signature",zh:"签名"},{en:"text",zh:"文字"}
];
var CAT_ICONS = {"镜头":"🎥","风格":"🎨","光照":"☀️","色彩":"🌈","构图":"📐","画面":"🖼️","人物":"👤","场景":"🏞️","特效":"✨","姿势":"🧍","表情":"😊","服装":"👗","视角":"👁️","材质":"🧱"};

// ===== 工具函数 =====
function $(id) { return document.getElementById(id); }
function $$(s, p) { return (p || document).querySelectorAll(s); }
function el(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function toast(msg, type) {
  var t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  if (type === "warn") t.style.background = "var(--warning)";
  if (type === "error") t.style.background = "var(--danger)";
  document.body.appendChild(t);
  setTimeout(function(){ t.remove(); }, 2500);
}
function api(u, o) {
  o = o || {};
  return fetch(u, {
    method: o.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: o.body ? JSON.stringify(o.body) : undefined
  }).then(function(r){ return r.json(); });
}
function copyText(t) {
  navigator.clipboard.writeText(t).catch(function(){
    var ta = document.createElement("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}
function loadStorage(key, def) {
  try { var d = localStorage.getItem("grimoire4_"+key); return d ? JSON.parse(d) : def; }
  catch(e) { return def; }
}
function saveStorage(key, val) {
  localStorage.setItem("grimoire4_"+key, JSON.stringify(val));
}
function saveState() {
  S.undoStack.push({pos: JSON.parse(JSON.stringify(S.posTags)), neg: JSON.parse(JSON.stringify(S.negTags))});
  if (S.undoStack.length > 50) S.undoStack.shift();
  S.redoStack = [];
  updateUndoBtns();
}
function undo() {
  if (S.undoStack.length === 0) return;
  S.redoStack.push({pos: JSON.parse(JSON.stringify(S.posTags)), neg: JSON.parse(JSON.stringify(S.negTags))});
  var st = S.undoStack.pop();
  S.posTags = st.pos;
  S.negTags = st.neg;
  refreshPanel("pos");
  refreshPanel("neg");
  updatePreview();
  updateTabCounts();
  if (!S.isSearching) renderGrid();
  updateUndoBtns();
  toast("已撤销 ↩");
}
function redo() {
  if (S.redoStack.length === 0) return;
  S.undoStack.push({pos: JSON.parse(JSON.stringify(S.posTags)), neg: JSON.parse(JSON.stringify(S.negTags))});
  var st = S.redoStack.pop();
  S.posTags = st.pos;
  S.negTags = st.neg;
  refreshPanel("pos");
  refreshPanel("neg");
  updatePreview();
  updateTabCounts();
  if (!S.isSearching) renderGrid();
  updateUndoBtns();
  toast("已重做 ↪");
}
function updateUndoBtns() {
  var u = $("btn-undo");
  var r = $("btn-redo");
  if (u) { u.disabled = S.undoStack.length === 0; }
  if (r) { r.disabled = S.redoStack.length === 0; }
}

// ===== 数据加载 =====
function loadFavs() { S.favs = loadStorage("favs", {}); }
function saveFavs() { saveStorage("favs", S.favs); }
function loadFreq() { S.tagFreq = loadStorage("freq", {}); }
function saveFreq() { saveStorage("freq", S.tagFreq); }
function bumpFreq(en) { S.tagFreq[en] = (S.tagFreq[en] || 0) + 1; saveFreq(); }
function findTagInfo(en) {
  if (!S.allData) return {zh:null,cat:null,sc:null};
  for (var ci = 0; ci < S.allData.categories.length; ci++) {
    var c = S.allData.categories[ci];
    for (var si = 0; si < (c.subcategories||[]).length; si++) {
      var sc = c.subcategories[si];
      for (var ti = 0; ti < (sc.tags||[]).length; ti++) {
        if (sc.tags[ti].en === en) return {zh:sc.tags[ti].zh, cat:c.name, sc:sc.name};
      }
    }
  }
  return {zh:null,cat:null,sc:null};
}
function isSelected(en, panel) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  for (var i = 0; i < a.length; i++) if (a[i].en === en) return true;
  return false;
}

// ===== 标签操作 =====
function addTag(en, zh, panel, skipSave) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  for (var i = 0; i < a.length; i++) if (a[i].en === en) return;
  var info = findTagInfo(en);
  a.push({en:en, zh:zh||info.zh||en, weight:1.0, category:info.cat||"", subcategory:info.sc||""});
  bumpFreq(en);
  if (!skipSave) saveState();
  refreshPanel(panel);
  updatePreview();
  renderFreqTags();
  updateTabCounts();
  if (!S.isSearching) renderGrid();
}
function removeTag(en, panel, skipSave) {
  if (!skipSave) saveState();
  if (panel === "neg") S.negTags = S.negTags.filter(function(t){return t.en!==en;});
  else S.posTags = S.posTags.filter(function(t){return t.en!==en;});
  updateTabCounts();
  refreshPanel(panel);
  updatePreview();
  if (!S.isSearching) renderGrid();
}
function updateWeight(en, w, panel) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  for (var i = 0; i < a.length; i++) if (a[i].en === en) { a[i].weight = w; break; }
  updatePreview();
}
function clearPos() { saveState(); S.posTags = []; refreshPanel("pos"); updatePreview(); updateTabCounts(); toast("已清空正面提示词"); }
function clearNeg() { saveState(); S.negTags = []; refreshPanel("neg"); updatePreview(); updateTabCounts(); toast("已清空负面提示词"); }
function clearAll() { saveState(); S.posTags = []; S.negTags = []; refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts(); toast("已清空全部标签"); }

// ===== 提示词生成 =====
function genPrompt(tags) {
  return tags.map(function(t){
    var w = t.weight;
    if (w === 1.0) return t.en;
    return "(" + t.en + ":" + w.toFixed(1) + ")";
  }).join(", ");
}
function genPromptCN(tags) {
  return tags.map(function(t){
    var w = t.weight;
    if (w === 1.0) return t.zh;
    return "(" + t.zh + ":" + w.toFixed(1) + ")";
  }).join(", ");
}
function getSorted(panel) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  var sorted = a.slice();
  var autoSort = panel === "neg" ? S.autoSortNeg : S.autoSortPos;
  if (autoSort) sorted.sort(function(a,b){ return b.weight - a.weight; });
  return sorted;
}
function updatePreview() {
  var pos = getSorted("pos");
  var neg = getSorted("neg");
  var fmt = ($("export-fmt")||{}).value || "generic";
  var out = "";
  if (S.useQuality && pos.length > 0) {
    var parts = [QW.join(", ")];
    parts.push(genPrompt(pos));
    out = parts.join(", ");
  } else if (pos.length > 0) {
    out = genPrompt(pos);
  }
  if (neg.length > 0) {
    if (out) out += "\n--neg ";
    out += genPrompt(neg);
  }
  var ta = $("prompt-output");
  if (ta) ta.value = out;
  updateUndoBtns();
}
function updateTabCounts() {
  var pn = $("tab-pos-num"); if (pn) pn.textContent = "("+S.posTags.length+")";
  var nn = $("tab-neg-num"); if (nn) nn.textContent = "("+S.negTags.length+")";
  var pc = $("pos-count"); if (pc) pc.textContent = S.posTags.length + "个";
  var nc = $("neg-count"); if (nc) nc.textContent = S.negTags.length + "个";
}

// ===== 面板渲染 =====
function refreshPanel(panel) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  var container = $(panel === "neg" ? "tags-neg" : "tags-pos");
  if (!container) return;
  container.innerHTML = "";
  if (a.length === 0) {
    container.innerHTML = '<div style="padding:30px;text-align:center;color:var(--color-text-muted);font-size:12px">点击标签卡片添加</div>';
    return;
  }
  var sorted = a.slice();
  var autoSort = panel === "neg" ? S.autoSortNeg : S.autoSortPos;
  if (autoSort) sorted.sort(function(a,b){ return b.weight - a.weight; });
  for (var i = 0; i < sorted.length; i++) {
    var t = sorted[i];
    var div = document.createElement("div");
    div.className = "tag-chip" + (panel==="neg"?" chip-neg":"");
    div.innerHTML = '<span class="chip-name" title="'+esc(t.zh)+'">'+esc(t.en)+'</span>' +
      '<input type="range" class="chip-weight" min="0.1" max="2.0" step="0.1" value="'+t.weight.toFixed(1)+'" data-en="'+esc(t.en)+'" data-panel="'+panel+'">' +
      '<button class="chip-remove" data-en="'+esc(t.en)+'" data-panel="'+panel+'">×</button>';
    container.appendChild(div);
  }
  // bind events
  var sliders = container.querySelectorAll(".chip-weight");
  for (var j = 0; j < sliders.length; j++) {
    sliders[j].addEventListener("input", function(){
      updateWeight(parseFloat(this.value), this.dataset.en, this.dataset.panel);
    });
  }
  var removes = container.querySelectorAll(".chip-remove");
  for (var k = 0; k < removes.length; k++) {
    removes[k].addEventListener("click", function(){
      removeTag(this.dataset.en, this.dataset.panel);
    });
  }
  updateTabCounts();
}

// ===== 标签网格 =====
function renderGrid() {
  var grid = $("tag-grid");
  var title = $("canvas-title");
  if (!grid) return;
  grid.innerHTML = "";
  if (!S.allData) { grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-muted)">加载中...</div>'; return; }
  if (S.isSearching) {
    renderSearchResults();
    return;
  }
  if (!S.activeCat || !S.activeSc) {
    if (title) title.textContent = "选择一个子类别开始";
    grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-muted);font-size:13px">👈 从左侧分类中选择子类别</div>';
    return;
  }
  var tags = [];
  for (var ci = 0; ci < S.allData.categories.length; ci++) {
    var c = S.allData.categories[ci];
    if (c.name !== S.activeCat) continue;
    for (var si = 0; si < (c.subcategories||[]).length; si++) {
      var sc = c.subcategories[si];
      if (sc.name !== S.activeSc) continue;
      tags = sc.tags || [];
      break;
    }
    if (tags.length > 0) break;
  }
  if (title) title.textContent = (S.activeCat||"") + " › " + (S.activeSc||"") + " ("+tags.length+"个标签)";
  if ($("btn-select-all")) $("btn-select-all").style.display = tags.length > 0 ? "" : "none";
  
  for (var i = 0; i < tags.length; i++) {
    var t = tags[i];
    var card = document.createElement("div");
    card.className = "tag-card";
    if (isSelected(t.en, "pos")) card.classList.add("selected-pos");
    if (isSelected(t.en, "neg")) card.classList.add("selected-neg");
    card.innerHTML = '<div class="tag-card-en">'+esc(t.en)+'</div><div class="tag-card-zh">'+esc(t.zh)+'</div>';
    card.addEventListener("click", function(e){
      var en = this.querySelector(".tag-card-en").textContent;
      var zh = this.querySelector(".tag-card-zh").textContent;
      if (e.shiftKey) {
        if (isSelected(en, "neg")) removeTag(en, "neg"); else addTag(en, zh, "neg");
      } else {
        if (isSelected(en, "pos")) removeTag(en, "pos"); else addTag(en, zh, "pos");
      }
    });
    card.addEventListener("contextmenu", function(e){
      e.preventDefault();
      var en = this.querySelector(".tag-card-en").textContent;
      var zh = this.querySelector(".tag-card-zh").textContent;
      if (isSelected(en, "neg")) removeTag(en, "neg"); else addTag(en, zh, "neg");
    });
    grid.appendChild(card);
  }
}

function renderSearchResults() {
  var q = ($("search-input")||{}).value || "";
  if (!q.trim()) { S.isSearching = false; renderGrid(); return; }
  api("/api/search?q="+encodeURIComponent(q)).then(function(results){
    var grid = $("tag-grid");
    var title = $("canvas-title");
    var info = $("search-info");
    if (!grid) return;
    grid.innerHTML = "";
    var total = 0;
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      total += r.tags.length;
      var hdr = document.createElement("div");
      hdr.className = "search-group-header";
      hdr.textContent = r.category + " › " + r.subcategory + " ("+r.tags.length+")";
      grid.appendChild(hdr);
      for (var j = 0; j < r.tags.length; j++) {
        var t = r.tags[j];
        var card = document.createElement("div");
        card.className = "tag-card";
        if (isSelected(t.en, "pos")) card.classList.add("selected-pos");
        if (isSelected(t.en, "neg")) card.classList.add("selected-neg");
        card.innerHTML = '<div class="tag-card-en">'+esc(t.en)+'</div><div class="tag-card-zh">'+esc(t.zh)+'</div>';
        (function(en,zh){
          card.addEventListener("click", function(e){
            if (e.shiftKey) {
              if (isSelected(en, "neg")) removeTag(en, "neg"); else addTag(en, zh, "neg");
            } else {
              if (isSelected(en, "pos")) removeTag(en, "pos"); else addTag(en, zh, "pos");
            }
          });
        })(t.en, t.zh);
        grid.appendChild(card);
      }
    }
    if (title) title.textContent = "🔍 搜索: "+esc(q)+" ("+total+"个结果)";
    if (info) { info.style.display = ""; info.textContent = "共找到 "+total+" 个标签"; }
  });
}

// ===== 分类树 =====
function renderCategoryTree() {
  var tree = $("category-tree");
  if (!tree || !S.allData) return;
  tree.innerHTML = "";
  for (var ci = 0; ci < S.allData.categories.length; ci++) {
    var c = S.allData.categories[ci];
    var catDiv = document.createElement("div");
    catDiv.className = "cat-group";
    var icon = CAT_ICONS[c.name] || "📌";
    var catHead = document.createElement("div");
    catHead.className = "cat-head";
    catHead.innerHTML = '<span class="cat-arrow">▶</span> '+icon+' <span class="cat-name">'+esc(c.name)+'</span>';
    var subDiv = document.createElement("div");
    subDiv.className = "cat-subs";
    subDiv.style.display = "none";
    
    for (var si = 0; si < (c.subcategories||[]).length; si++) {
      var sc = c.subcategories[si];
      var scItem = document.createElement("div");
      scItem.className = "sub-item";
      if (S.activeCat === c.name && S.activeSc === sc.name) scItem.classList.add("active");
      scItem.textContent = sc.name + " ("+(sc.tags||[]).length+")";
      (function(cn,sn){
        scItem.addEventListener("click", function(){
          S.activeCat = cn;
          S.activeSc = sn;
          S.isSearching = false;
          if ($("search-input")) $("search-input").value = "";
          renderCategoryTree();
          renderGrid();
        });
      })(c.name, sc.name);
      subDiv.appendChild(scItem);
    }
    
    catHead.addEventListener("click", function(){
      var subs = this.nextElementSibling;
      var arrow = this.querySelector(".cat-arrow");
      if (subs.style.display === "none") {
        subs.style.display = "block";
        if (arrow) arrow.textContent = "▼";
      } else {
        subs.style.display = "none";
        if (arrow) arrow.textContent = "▶";
      }
    });
    
    catDiv.appendChild(catHead);
    catDiv.appendChild(subDiv);
    tree.appendChild(catDiv);
  }
}

print("Part 1 written")
// ===== 常用标签 =====
function renderFreqTags() {
  var cont = $("freq-tags");
  if (!cont) return;
  cont.innerHTML = "";
  var sorted = Object.keys(S.tagFreq).sort(function(a,b){ return S.tagFreq[b] - S.tagFreq[a]; }).slice(0, 10);
  for (var i = 0; i < sorted.length; i++) {
    var en = sorted[i];
    var tag = document.createElement("span");
    tag.className = "freq-tag";
    tag.textContent = en;
    tag.title = "使用 "+S.tagFreq[en]+" 次";
    tag.addEventListener("click", function(){
      addTag(this.textContent, null, S.activeTab === "neg" ? "neg" : "pos");
    });
    cont.appendChild(tag);
  }
}

// ===== 收藏 =====
function toggleFav(en) {
  if (S.favs[en]) { delete S.favs[en]; } else { S.favs[en] = Date.now(); }
  saveFavs();
  renderFavList();
  if (!S.isSearching) renderGrid();
}
function renderFavList() {
  var list = $("fav-list");
  var count = $("fav-count");
  if (!list) return;
  list.innerHTML = "";
  var keys = Object.keys(S.favs);
  if (count) count.textContent = keys.length > 0 ? "("+keys.length+")" : "";
  for (var i = 0; i < keys.length; i++) {
    var en = keys[i];
    var item = document.createElement("div");
    item.className = "fav-item";
    item.innerHTML = '<span>⭐ '+esc(en)+'</span><button class="fav-remove" data-en="'+esc(en)+'">×</button>';
    item.querySelector("span").addEventListener("click", function(){
      addTag(this.textContent.replace("⭐ ",""), null, S.activeTab === "neg" ? "neg" : "pos");
    });
    item.querySelector(".fav-remove").addEventListener("click", function(e){
      e.stopPropagation();
      toggleFav(this.dataset.en);
    });
    list.appendChild(item);
  }
}

// ===== 预设 =====
function loadPresets() {
  api("/api/presets").then(function(d){
    var list = $("presets-list");
    if (!list) return;
    list.innerHTML = "";
    var builtin = d.builtin || [];
    var user = d.user || [];
    var all = builtin.concat(user);
    if (all.length === 0) {
      list.innerHTML = "<div style=\"padding:6px;color:var(--color-text-muted);font-size:11px\">暂无预设</div>";
      return;
    }
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      var item = document.createElement("div");
      item.className = "preset-item";
      item.innerHTML = "<span>📦 "+esc(p.name)+"</span>";
      item.addEventListener("click", function(){
        applyPreset(this._preset);
      });
      item._preset = p;
      list.appendChild(item);
    }
    // save/import buttons
    var btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:4px;margin-top:6px";
    btnRow.innerHTML = '<button class="btn ghost" style="font-size:10px;padding:2px 6px" id="btn-save-preset">💾 保存</button><button class="btn ghost" style="font-size:10px;padding:2px 6px" id="btn-import-preset">📥 导入</button>';
    list.appendChild(btnRow);
    setTimeout(function(){
      var sb = $("btn-save-preset"); if (sb) sb.addEventListener("click", showSavePresetModal);
      var ib = $("btn-import-preset"); if (ib) ib.addEventListener("click", showImportPresetModal);
    }, 50);
  });
}

function applyPreset(p) {
  saveState();
  S.posTags = [];
  S.negTags = [];
  var tags = p.tags || [];
  var weights = p.weights || {};
  for (var i = 0; i < tags.length; i++) {
    var en = tags[i];
    var info = findTagInfo(en);
    S.posTags.push({en:en, zh:info.zh||en, weight:weights[en]||1.0, category:info.cat||"", subcategory:info.sc||""});
  }
  var nt = p.negative_tags || [];
  var nw = p.negative_weights || {};
  for (var j = 0; j < nt.length; j++) {
    var en2 = nt[j];
    var info2 = findTagInfo(en2);
    S.negTags.push({en:en2, zh:info2.zh||en2, weight:nw[en2]||1.0, category:info2.cat||"", subcategory:info2.sc||""});
  }
  refreshPanel("pos");
  refreshPanel("neg");
  updatePreview();
  updateTabCounts();
  toast("已加载预设: "+p.name);
}

function showSavePresetModal() {
  if (S.posTags.length === 0 && S.negTags.length === 0) { toast("请先选择标签","warn"); return; }
  var root = $("modal-root");
  if (!root) return;
  root.innerHTML = '<div class="modal-overlay" id="modal-save"><div class="modal-box"><h3>保存预设</h3><input id="save-preset-name" class="modal-input" placeholder="预设名称..." autofocus><div class="modal-btns"><button id="btn-save-confirm" class="btn primary">保存</button><button id="btn-save-cancel" class="btn">取消</button></div></div></div>';
  root.style.display = "";
  $("modal-save").addEventListener("click", function(e){ if (e.target === this) closeModal(); });
  $("btn-save-cancel").addEventListener("click", closeModal);
  $("btn-save-confirm").addEventListener("click", function(){
    var nm = ($("save-preset-name")||{}).value || "";
    nm = nm.trim();
    if (!nm) { toast("请输入名称","warn"); return; }
    var w = {}; S.posTags.forEach(function(t){ w[t.en] = t.weight; });
    var nw = {}; S.negTags.forEach(function(t){ nw[t.en] = t.weight; });
    api("/api/presets/save", {method:"POST", body:{name:nm, tags:S.posTags.map(function(t){return t.en;}), weights:w, negative_tags:S.negTags.map(function(t){return t.en;}), negative_weights:nw}}).then(function(r){
      if (r.ok) { toast("已保存: "+nm); closeModal(); loadPresets(); }
      else toast(r.error||"保存失败","error");
    });
  });
}

function showImportPresetModal() {
  var root = $("modal-root");
  if (!root) return;
  root.innerHTML = '<div class="modal-overlay" id="modal-import"><div class="modal-box"><h3>导入预设</h3><textarea id="import-preset-json" class="modal-input" style="min-height:120px;resize:vertical" placeholder="粘贴JSON..."></textarea><div class="modal-btns"><button id="btn-import-confirm" class="btn primary">导入</button><button id="btn-import-cancel" class="btn">取消</button></div></div></div>';
  root.style.display = "";
  $("modal-import").addEventListener("click", function(e){ if (e.target === this) closeModal(); });
  $("btn-import-cancel").addEventListener("click", closeModal);
  $("btn-import-confirm").addEventListener("click", function(){
    var t = ($("import-preset-json")||{}).value || "";
    t = t.trim();
    if (!t) return;
    try {
      var d = JSON.parse(t);
      if (!d.name) { toast("缺少名称","warn"); return; }
      api("/api/presets/import", {method:"POST", body:d}).then(function(r){
        if (r.ok) { toast("已导入: "+d.name); closeModal(); loadPresets(); }
        else toast("失败: "+r.error,"error");
      });
    } catch(e) { toast("JSON格式错误","error"); }
  });
}

function closeModal() {
  var root = $("modal-root");
  if (root) { root.innerHTML = ""; root.style.display = "none"; }
}

// ===== 历史 =====
function loadHistory() {
  api("/api/history").then(function(items){
    var list = $("history-list");
    var count = $("history-count");
    if (!list) return;
    list.innerHTML = "";
    if (items.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--color-text-muted);font-size:11px">暂无记录</div>';
      if (count) count.textContent = "";
      return;
    }
    if (count) count.textContent = "("+items.length+")";
    for (var i = 0; i < items.length; i++) {
      var h = items[i];
      var div = document.createElement("div");
      div.className = "history-item";
      div.innerHTML = '<div class="history-time">'+esc(h.created||"")+'</div><div class="history-prompt">'+esc((h.prompt||"").substring(0,60))+'...</div>';
      div.addEventListener("click", function(){
        var ta = $("prompt-output");
        if (ta) { ta.value = this._prompt; ta.select(); }
        copyText(this._prompt);
        toast("已复制历史提示词");
      });
      div._prompt = h.prompt;
      list.appendChild(div);
    }
  });
}

// ===== 随机 =====
function randomTags() {
  if (!S.allData) { toast("数据加载中...","warn"); return; }
  saveState();
  S.posTags = [];
  S.negTags = [];
  var aa = [];
  for (var ci = 0; ci < (S.allData.categories||[]).length; ci++) {
    var c = S.allData.categories[ci];
    if (c.name === "NSFW" || c.name === "NSFW标签") continue;
    for (var si = 0; si < (c.subcategories||[]).length; si++) {
      var sc = c.subcategories[si];
      for (var ti = 0; ti < (sc.tags||[]).length; ti++) {
        var t = sc.tags[ti];
        aa.push({en:t.en, zh:t.zh, category:c.name, subcategory:sc.name});
      }
    }
  }
  var cnt = Math.floor(Math.random() * 8) + 3;
  var pk = [];
  var seen2 = {};
  while (pk.length < cnt && aa.length > 0) {
    var idx = Math.floor(Math.random() * aa.length);
    var t = aa[idx];
    if (!seen2[t.en]) {
      seen2[t.en] = true;
      pk.push({en:t.en, zh:t.zh, weight:Math.round((Math.random()*0.5+1.0)*10)/10, category:t.category, subcategory:t.subcategory});
    }
    aa.splice(idx, 1);
  }
  S.posTags = pk;
  refreshPanel("pos");
  refreshPanel("neg");
  updatePreview();
  updateTabCounts();
  if (!S.isSearching) renderGrid();
  toast("🎲 随机生成 "+pk.length+" 个标签");
}

// ===== 清洗 =====
function cleanPrompt() {
  var changed = false;
  var seen = {};
  var newPos = [];
  for (var i = 0; i < S.posTags.length; i++) {
    var t = S.posTags[i];
    var key = t.en.toLowerCase();
    if (!seen[key]) { seen[key] = true; newPos.push(t); } else { changed = true; }
  }
  var seen2 = {};
  var newNeg = [];
  for (var j = 0; j < S.negTags.length; j++) {
    var t2 = S.negTags[j];
    var key2 = t2.en.toLowerCase();
    if (!seen2[key2]) { seen2[key2] = true; newNeg.push(t2); } else { changed = true; }
  }
  if (changed) { saveState(); }
  S.posTags = newPos;
  S.negTags = newNeg;
  refreshPanel("pos");
  refreshPanel("neg");
  updatePreview();
  updateTabCounts();
  if (!S.isSearching) renderGrid();
  toast(changed ? "已清洗：去除重复标签" : "提示词已干净，无需清洗");
}

// ===== 推荐 =====
function toggleRecommend() {
  S.recOn = !S.recOn;
  var btn = $("rec-toggle");
  if (btn) btn.style.background = S.recOn ? "var(--accent)" : "";
  if (S.recOn) {
    var tags = S.posTags.map(function(t){return t.en;});
    api("/api/recommend", {method:"POST", body:{tags:tags}}).then(function(recs){
      showRecommendations(recs);
    });
  } else {
    var recBar = $("rec-bar");
    if (recBar) recBar.remove();
  }
}
function showRecommendations(recs) {
  var old = $("rec-bar");
  if (old) old.remove();
  if (!recs || recs.length === 0) return;
  var bar = document.createElement("div");
  bar.id = "rec-bar";
  bar.className = "rec-bar";
  bar.innerHTML = '<span style="font-size:11px;color:var(--color-text-muted);margin-right:6px">💡 推荐:</span>';
  for (var i = 0; i < Math.min(recs.length, 10); i++) {
    var r = recs[i];
    var chip = document.createElement("span");
    chip.className = "rec-chip";
    chip.textContent = r.en;
    chip.title = r.zh;
    chip.addEventListener("click", function(){
      addTag(this.textContent, this.title, S.activeTab === "neg" ? "neg" : "pos");
    });
    bar.appendChild(chip);
  }
  var canvas = $("canvas");
  if (canvas) canvas.insertBefore(bar, $("tag-grid"));
}

// ===== 导出卡片 =====
function exportCard() {
  var pos = getSorted("pos");
  var neg = getSorted("neg");
  if (pos.length === 0 && neg.length === 0) { toast("没有标签可导出","warn"); return; }
  var canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = Math.max(200, 80 + pos.length * 28 + neg.length * 28 + 80);
  var ctx = canvas.getContext("2d");
  // bg
  ctx.fillStyle = "#0f0f1a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // title
  ctx.fillStyle = "#e0e0e0";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("魔导书 v4 - AI绘画提示词", 20, 40);
  var y = 70;
  // pos tags
  if (pos.length > 0) {
    ctx.fillStyle = "#4ade80";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("正面提示词:", 20, y);
    y += 24;
    ctx.fillStyle = "#ccc";
    ctx.font = "13px monospace";
    for (var i = 0; i < pos.length; i++) {
      var t = pos[i];
      ctx.fillText((t.weight!==1.0?"("+t.en+":"+t.weight.toFixed(1)+")":t.en), 30, y);
      y += 22;
    }
  }
  // neg tags
  if (neg.length > 0) {
    y += 8;
    ctx.fillStyle = "#f87171";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("负面提示词:", 20, y);
    y += 24;
    ctx.fillStyle = "#ccc";
    ctx.font = "13px monospace";
    for (var j = 0; j < neg.length; j++) {
      var t2 = neg[j];
      ctx.fillText((t2.weight!==1.0?"("+t2.en+":"+t2.weight.toFixed(1)+")":t2.en), 30, y);
      y += 22;
    }
  }
  // export
  var link = document.createElement("a");
  link.download = "grimoire-prompt-"+Date.now()+".png";
  link.href = canvas.toDataURL("image/png");
  link.click();
  toast("已导出PNG卡片!");
}

// ===== 主题 =====
function initTheme() {
  var themes = ["neon", "clean", "gold"];
  var saved = localStorage.getItem("grimoire4_theme") || "neon";
  S.currentTheme = saved;
  S.themeIdx = themes.indexOf(saved);
  if (S.themeIdx < 0) S.themeIdx = 0;
  document.documentElement.setAttribute("data-theme", themes[S.themeIdx]);
  updateThemeBtn();
}
function cycleTheme() {
  var themes = ["neon", "clean", "gold"];
  S.themeIdx = (S.themeIdx + 1) % themes.length;
  S.currentTheme = themes[S.themeIdx];
  document.documentElement.setAttribute("data-theme", S.currentTheme);
  localStorage.setItem("grimoire4_theme", S.currentTheme);
  updateThemeBtn();
  toast("主题: "+S.currentTheme);
}
function updateThemeBtn() {
  var btn = $("btn-theme");
  if (!btn) return;
  var icons = {"neon":"🎨", "clean":"🌿", "gold":"✨"};
  btn.textContent = (icons[S.currentTheme]||"🎨");
  btn.title = "主题: "+S.currentTheme;
}

// ===== 分类CRUD =====
function openNewCat() {
  var root = $("modal-root");
  if (!root) return;
  root.innerHTML = '<div class="modal-overlay" id="modal-new-cat"><div class="modal-box"><h3>添加大类</h3><input id="new-cat-name" class="modal-input" placeholder="大类名称..."><div class="modal-btns"><button id="btn-new-cat-confirm" class="btn primary">确认</button><button id="btn-new-cat-cancel" class="btn">取消</button></div></div></div>';
  root.style.display = "";
  $("modal-new-cat").addEventListener("click", function(e){ if (e.target === this) closeModal(); });
  $("btn-new-cat-cancel").addEventListener("click", closeModal);
  $("btn-new-cat-confirm").addEventListener("click", submitNewCat);
}

function submitNewCat() {
  var name = (($("new-cat-name")||{}).value||"").trim();
  if (!name) { toast("请输入名称","warn"); return; }
  api("/api/custom-tags/add-category", {method:"POST", body:{name:name}}).then(function(r){
    if (r.ok) { toast("已添加大类: "+name); closeModal(); loadTags(); }
    else toast(r.error||"添加失败","error");
  });
}

function openNewSc(catName) {
  var root = $("modal-root");
  if (!root) return;
  root.innerHTML = '<div class="modal-overlay" id="modal-new-sc"><div class="modal-box"><h3>添加子类</h3><input id="new-sc-cat" class="modal-input" value="'+esc(catName)+'" readonly><input id="new-sc-name" class="modal-input" placeholder="子类名称..." autofocus><div class="modal-btns"><button id="btn-new-sc-confirm" class="btn primary">确认</button><button id="btn-new-sc-cancel" class="btn">取消</button></div></div></div>';
  root.style.display = "";
  $("modal-new-sc").addEventListener("click", function(e){ if (e.target === this) closeModal(); });
  $("btn-new-sc-cancel").addEventListener("click", closeModal);
  $("btn-new-sc-confirm").addEventListener("click", submitNewSc);
}

function submitNewSc() {
  var cn = (($("new-sc-cat")||{}).value||"").trim();
  var sn = (($("new-sc-name")||{}).value||"").trim();
  if (!cn || !sn) { toast("参数不完整","warn"); return; }
  api("/api/custom-tags/add-subcategory", {method:"POST", body:{category:cn, subcategory:sn}}).then(function(r){
    if (r.ok) { toast("已添加子类: "+sn); closeModal(); loadTags(); }
    else toast(r.error||"添加失败","error");
  });
}

function openTagForm(catName, scName) {
  var root = $("modal-root");
  if (!root) return;
  root.innerHTML = '<div class="modal-overlay" id="modal-tag-form"><div class="modal-box"><h3>添加标签</h3><input id="tag-form-cat" class="modal-input" value="'+esc(catName)+'" readonly><input id="tag-form-sc" class="modal-input" value="'+esc(scName)+'" readonly><input id="tag-form-en" class="modal-input" placeholder="英文标签..." autofocus><input id="tag-form-zh" class="modal-input" placeholder="中文标签..."><div class="modal-btns"><button id="btn-tag-form-confirm" class="btn primary">确认</button><button id="btn-tag-form-cancel" class="btn">取消</button></div></div></div>';
  root.style.display = "";
  $("modal-tag-form").addEventListener("click", function(e){ if (e.target === this) closeModal(); });
  $("btn-tag-form-cancel").addEventListener("click", closeModal);
  $("btn-tag-form-confirm").addEventListener("click", submitTagForm);
}

function submitTagForm() {
  var cn = (($("tag-form-cat")||{}).value||"").trim();
  var sn = (($("tag-form-sc")||{}).value||"").trim();
  var en = (($("tag-form-en")||{}).value||"").trim();
  var zh = (($("tag-form-zh")||{}).value||"").trim();
  if (!cn || !sn || !en) { toast("请填写完整","warn"); return; }
  api("/api/custom-tags/add", {method:"POST", body:{category:cn, subcategory:sn, en:en, zh:zh}}).then(function(r){
    if (r.ok) { toast("已添加标签: "+en); closeModal(); loadTags(); }
    else toast(r.error||"添加失败","error");
  });
}

// ===== 快捷键提示 =====
function showShortcuts() {
  var root = $("modal-root");
  if (!root) return;
  root.innerHTML = '<div class="modal-overlay" id="modal-shortcuts"><div class="modal-box"><h3>⌨ 快捷键</h3><div style="font-size:12px;line-height:2;color:var(--color-text)">Ctrl+Z — 撤销<br>Ctrl+Y — 重做<br>Ctrl+K — 搜索<br>Shift+点击 — 添加到负面<br>右键 — 添加到负面<br>Ctrl+C — 复制提示词<br>Delete — 清空全部</div><div class="modal-btns"><button id="btn-shortcuts-close" class="btn primary">关闭</button></div></div></div>';
  root.style.display = "";
  $("modal-shortcuts").addEventListener("click", function(e){ if (e.target === this) closeModal(); });
  $("btn-shortcuts-close").addEventListener("click", closeModal);
}

print("Part 2 written")
// ===== 加载数据 =====
function loadTags() {
  api("/api/tags").then(function(d){
    S.allData = d;
    renderCategoryTree();
    renderGrid();
    renderQuickNeg();
    loadPresets();
    loadHistory();
    renderFreqTags();
    renderFavList();
  });
}

function renderQuickNeg() {
  var cont = $("quick-neg");
  if (!cont) return;
  cont.innerHTML = "快速负面: ";
  for (var i = 0; i < QUICK_NEG.length; i++) {
    var q = QUICK_NEG[i];
    var chip = document.createElement("span");
    chip.className = "quick-chip";
    chip.textContent = q.zh;
    chip.title = q.en;
    (function(en,zh){
      chip.addEventListener("click", function(){
        if (isSelected(en,"neg")) removeTag(en,"neg"); else addTag(en,zh,"neg");
      });
    })(q.en, q.zh);
    cont.appendChild(chip);
  }
}

// ===== 保存到存档 =====
function loadSavedList() {
  api("/api/presets").then(function(d){
    var list = $("saved-list");
    if (!list) return;
    list.innerHTML = "";
    var user = d.user || [];
    if (user.length === 0) {
      list.innerHTML = '<div style="padding:6px;color:var(--color-text-muted);font-size:11px">暂无存档</div>';
      return;
    }
    for (var i = 0; i < user.length; i++) {
      var p = user[i];
      var item = document.createElement("div");
      item.className = "preset-item";
      item.textContent = "💾 "+p.name;
      item.addEventListener("click", function(){ applyPreset(this._preset); });
      item._preset = p;
      list.appendChild(item);
    }
  });
}

// ===== 初始化 =====
function init() {
  loadFavs();
  loadFreq();
  initTheme();
  loadTags();
  loadSavedList();

  // 搜索
  var si = $("search-input");
  if (si) {
    si.addEventListener("input", function(){
      S.isSearching = this.value.trim().length > 0;
      if (S.isSearching) { renderSearchResults(); } else { renderGrid(); }
    });
    si.addEventListener("focus", function(){ this.select(); });
  }

  // 分类树双击展开
  var tree = $("category-tree");
  if (tree) {
    tree.addEventListener("dblclick", function(e){
      var sub = e.target.closest(".sub-item");
      if (sub) {
        // edit/delete sub
        var cn = S.activeCat;
        var sn = S.activeSc;
        if (cn && sn) {
          var root = $("modal-root");
          if (root) {
            root.innerHTML = '<div class="modal-overlay" id="modal-sub-ops"><div class="modal-box"><h3>'+esc(sn)+'</h3><div class="modal-btns"><button id="btn-add-tag-sub" class="btn">添加标签</button><button id="btn-delete-sub" class="btn danger">删除子类</button><button id="btn-sub-ops-cancel" class="btn">取消</button></div></div></div>';
            root.style.display = "";
            $("modal-sub-ops").addEventListener("click", function(e){ if (e.target === this) closeModal(); });
            $("btn-sub-ops-cancel").addEventListener("click", closeModal);
            $("btn-add-tag-sub").addEventListener("click", function(){ closeModal(); openTagForm(cn, sn); });
            $("btn-delete-sub").addEventListener("click", function(){
              if (confirm("确定删除子类 "+sn+" 吗？")) {
                api("/api/custom-tags/delete-category", {method:"POST", body:{category:cn}}).then(function(r){
                  if (r.ok) { toast("已删除"); closeModal(); loadTags(); }
                  else toast(r.error||"删除失败","error");
                });
              }
            });
          }
        }
      }
    });
  }

  // 面板标签切换
  var tabs = document.querySelectorAll(".panel-tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function(){
      var tab = this.dataset.tab;
      S.activeTab = tab;
      var allTabs = document.querySelectorAll(".panel-tab");
      for (var j = 0; j < allTabs.length; j++) allTabs[j].classList.remove("active");
      this.classList.add("active");
      $("ws-pos").style.display = tab === "pos" ? "" : "none";
      $("ws-neg").style.display = tab === "neg" ? "" : "none";
      $("quick-neg").style.display = tab === "neg" ? "" : "none";
    });
  }

  // 自动排序
  var aspos = $("auto-sort-pos");
  if (aspos) aspos.addEventListener("change", function(){ S.autoSortPos = this.checked; refreshPanel("pos"); updatePreview(); });
  var asneg = $("auto-sort-neg");
  if (asneg) asneg.addEventListener("change", function(){ S.autoSortNeg = this.checked; refreshPanel("neg"); updatePreview(); });

  // 质量词
  var bq = $("btn-quality");
  if (bq) bq.addEventListener("click", function(){ S.useQuality = !S.useQuality; if (S.useQuality) this.classList.add("active"); else this.classList.remove("active"); updatePreview(); });

  // 清洗
  var bc = $("btn-clean");
  if (bc) bc.addEventListener("click", cleanPrompt);

  // 随机
  var br = $("btn-random");
  if (br) br.addEventListener("click", randomTags);

  // 清空
  var bca = $("btn-clear-all");
  if (bca) bca.addEventListener("click", clearAll);
  var bcp = $("btn-clear-pos");
  if (bcp) bcp.addEventListener("click", clearPos);
  var bcn = $("btn-clear-neg");
  if (bcn) bcn.addEventListener("click", clearNeg);

  // 撤销/重做
  var bu = $("btn-undo");
  if (bu) bu.addEventListener("click", undo);
  var brd = $("btn-redo");
  if (brd) brd.addEventListener("click", redo);

  // 主题
  var bt = $("btn-theme");
  if (bt) bt.addEventListener("click", cycleTheme);

  // 快捷键
  var bsk = $("btn-shortcuts");
  if (bsk) bsk.addEventListener("click", showShortcuts);

  // 导出格式
  var ef = $("export-fmt");
  if (ef) ef.addEventListener("change", updatePreview);

  // 复制
  var bcpy = $("btn-copy");
  if (bcpy) bcpy.addEventListener("click", function(){
    var t = ($("prompt-output")||{}).value || "";
    if (!t.trim()) { toast("没有可复制的内容","warn"); return; }
    copyText(t);
    toast("已复制英文提示词!");
    api("/api/history", {method:"POST", body:{prompt:t, tags:S.posTags.map(function(x){return x.en;}), negative_tags:S.negTags.map(function(x){return x.en;})}}).then(function(){ loadHistory(); });
  });

  var bcpycn = $("btn-copy-cn");
  if (bcpycn) bcpycn.addEventListener("click", function(){
    var pos = getSorted("pos");
    var neg = getSorted("neg");
    var parts = [];
    if (pos.length > 0) parts.push(genPromptCN(pos));
    if (neg.length > 0) parts.push("--neg "+genPromptCN(neg));
    var t = parts.join(", ");
    if (!t.trim()) { toast("没有可复制的内容","warn"); return; }
    copyText(t);
    toast("已复制中文提示词!");
  });

  var bcpyp = $("btn-copy-pos");
  if (bcpyp) bcpyp.addEventListener("click", function(){
    var p = getSorted("pos");
    var t = S.useQuality && p.length > 0 ? QW.join(", ")+", "+genPrompt(p) : genPrompt(p);
    if (!t.trim()) { toast("没有正面提示词","warn"); return; }
    copyText(t);
    toast("已复制正面提示词");
  });

  var bcpyn = $("btn-copy-neg");
  if (bcpyn) bcpyn.addEventListener("click", function(){
    var n = getSorted("neg");
    var t = genPrompt(n);
    if (!t.trim()) { toast("没有负面提示词","warn"); return; }
    copyText(t);
    toast("已复制负面提示词");
  });

  // 导出卡片
  var bec = $("btn-export-card");
  if (bec) bec.addEventListener("click", exportCard);

  // 推荐
  var rec = $("rec-toggle");
  if (rec) rec.addEventListener("click", toggleRecommend);

  // 全选
  var bsa = $("btn-select-all");
  if (bsa) bsa.addEventListener("click", function(){
    if (S.isSearching || !S.activeCat || !S.activeSc) return;
    saveState();
    for (var ci = 0; ci < S.allData.categories.length; ci++) {
      var c = S.allData.categories[ci];
      if (c.name !== S.activeCat) continue;
      for (var si = 0; si < (c.subcategories||[]).length; si++) {
        var sc = c.subcategories[si];
        if (sc.name !== S.activeSc) continue;
        for (var ti = 0; ti < (sc.tags||[]).length; ti++) {
          var t = sc.tags[ti];
          if (!isSelected(t.en, "pos")) addTag(t.en, t.zh, "pos", true);
        }
        break;
      }
      break;
    }
    refreshPanel("pos");
    updatePreview();
    updateTabCounts();
    renderGrid();
    toast("已全选当前子类别");
  });

  // 添加大类
  var bac = $("btn-add-cat");
  if (bac) bac.addEventListener("click", openNewCat);

  // 收藏切换
  var ft = $("fav-toggle");
  if (ft) ft.addEventListener("click", function(){
    var list = $("fav-list");
    if (list) list.style.display = list.style.display === "none" ? "" : "none";
  });

  // 键盘快捷键
  document.addEventListener("keydown", function(e){
    if (e.ctrlKey && e.key === "z") { e.preventDefault(); undo(); }
    else if (e.ctrlKey && e.key === "y") { e.preventDefault(); redo(); }
    else if (e.ctrlKey && e.key === "k") { e.preventDefault(); var si = $("search-input"); if (si) si.focus(); }
    else if (e.ctrlKey && e.key === "c" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
      var t = ($("prompt-output")||{}).value || "";
      if (t.trim()) { copyText(t); toast("已复制!"); }
    }
    else if (e.key === "Delete" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
      e.preventDefault(); clearAll();
    }
    else if (e.shiftKey && e.key === "C") { e.preventDefault(); cleanPrompt(); }
  });

  updateUndoBtns();
  updatePreview();
  updateTabCounts();
}

document.addEventListener("DOMContentLoaded", init);
