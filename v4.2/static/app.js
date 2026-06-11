/* ========== 魔导书 v4.2 - 应用逻辑 ========== */

// ===== 全局状态 =====
var S = {
  allData: null, activeCat: null, activeSc: null,
  isSearching: false, posTags: [], autoSortPos: true,
  negTags: [], autoSortNeg: true, activeTab: "pos",
  useQuality: true, favs: {}, tagFreq: {},
  history: [], historyIdx: -1, recOn: false
};
var THEME_LIST = ["dark","light","forest","ocean","sunset","purple","ink"];
var THEME_NAMES = {"dark":"暗色","light":"亮色","forest":"森林","ocean":"海洋","sunset":"日落","purple":"紫夜","ink":"水墨"};
var THEME_SWATCH = {"dark":"#1a1b23","light":"#f5f5f8","forest":"#1a231f","ocean":"#1a1f2e","sunset":"#231e1e","purple":"#1d1a28","ink":"#1c1c1e"};
var QW = ["masterpiece", "best quality"];
var QUICK_NEG = [
  {en:"low quality",zh:"低质量"},{en:"worst quality",zh:"最差质量"},{en:"blurry",zh:"模糊"},
  {en:"bad anatomy",zh:"解剖错误"},{en:"extra fingers",zh:"多余手指"},{en:"missing fingers",zh:"缺失手指"},
  {en:"nsfw",zh:"NSFW"},{en:"watermark",zh:"水印"},{en:"signature",zh:"签名"},{en:"text",zh:"文字"}
];
var CAT_ICONS = {"镜头":"🎥","风格":"🎨","光照":"☀️","色彩":"🌈","构图":"📐","画面":"🖼️","人物":"👤","场景":"🏞️","特效":"✨","姿势":"🧍","表情":"😊","服装":"👗","服饰":"👗","动作":"💃","场景道具":"🏗️","视角":"👁️","材质":"🧱","NSFW":"🔞"};

// 默认快捷键
var DEFAULT_SHORTCUTS = {
  "undo": "Ctrl+Z", "redo": "Ctrl+Y", "search": "Ctrl+K",
  "copy": "Ctrl+C", "clean": "Shift+C", "clearAll": "Delete"
};

// ===== 工具 =====
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function toast(msg, type) {
  var t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  if (type === "warn") t.classList.add("warn");
  if (type === "error") t.classList.add("error");
  document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 2500);
}
function api(u, o) {
  o = o || {};
  return fetch(u, { method: o.method || "GET", headers: {"Content-Type":"application/json"},
    body: o.body ? JSON.stringify(o.body) : undefined }).then(function(r){ return r.json(); });
}
function copyText(t) {
  navigator.clipboard.writeText(t).catch(function(){
    var ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove();
  });
}
function lsGet(k, d) { try { var v = localStorage.getItem("grimoire42_"+k); return v ? JSON.parse(v) : d; } catch(e) { return d; } }
function lsSet(k, v) { localStorage.setItem("grimoire42_"+k, JSON.stringify(v)); }

// ===== 主题系统 =====
function initTheme() {
  var saved = localStorage.getItem("grimoire42_theme");
  if (!saved || THEME_LIST.indexOf(saved) < 0) saved = "dark";
  applyTheme(saved);
  // 加载自定义主题颜色
  var custom = lsGet("custom_theme", null);
  if (custom) applyCustomColors(custom);
}
function applyTheme(name) {
  document.documentElement.setAttribute("data-theme", name);
  localStorage.setItem("grimoire42_theme", name);
  updateThemeBtn();
}
function applyCustomColors(colors) {
  var root = document.documentElement;
  if (colors.accent) root.style.setProperty("--accent", colors.accent);
  if (colors.accent2) root.style.setProperty("--accent2", colors.accent2);
  if (colors.bg) root.style.setProperty("--bg", colors.bg);
  if (colors.bg2) root.style.setProperty("--bg2", colors.bg2);
  if (colors.text) root.style.setProperty("--text", colors.text);
}
function updateThemeBtn() {
  var btn = $("btn-theme"); if (!btn) return;
  var cur = document.documentElement.getAttribute("data-theme") || "dark";
  var iconMap = {"dark":"🌙","light":"☀️","forest":"🌿","ocean":"🌊","sunset":"🌅","purple":"💜","ink":"🖋"};
  btn.textContent = iconMap[cur] || "🎨";
  btn.title = "主题: "+(THEME_NAMES[cur]||cur);
}

// ===== 主题设置弹窗 =====
function showThemePanel() {
  var cur = document.documentElement.getAttribute("data-theme") || "dark";
  var custom = lsGet("custom_theme", {accent:"#7c6ff7",bg:"#1a1b23",bg2:"#21232b",text:"#e1e1f0"});
  var html = '<h3>🎨 主题设置</h3>';
  // 预设主题色卡
  html += '<h4>预设主题</h4><div class="theme-grid">';
  for (var i = 0; i < THEME_LIST.length; i++) {
    var tn = THEME_LIST[i];
    html += '<div class="theme-swatch'+(tn===cur?' active':'')+'" data-theme="'+tn+'" style="background:'+THEME_SWATCH[tn]+';color:'+(tn==='light'?'#2a2a3a':'#e1e1f0')+'">'+THEME_NAMES[tn]+'</div>';
  }
  html += '</div>';
  // 自定义颜色
  html += '<h4>自定义颜色</h4>';
  html += '<div class="color-row"><label>主色调</label><input type="color" id="tc-accent" value="'+custom.accent+'"><input type="text" id="tc-accent-hex" value="'+custom.accent+'"></div>';
  html += '<div class="color-row"><label>背景色</label><input type="color" id="tc-bg" value="'+custom.bg+'"><input type="text" id="tc-bg-hex" value="'+custom.bg+'"></div>';
  html += '<div class="color-row"><label>面板色</label><input type="color" id="tc-bg2" value="'+custom.bg2+'"><input type="text" id="tc-bg2-hex" value="'+custom.bg2+'"></div>';
  html += '<div class="color-row"><label>文字色</label><input type="color" id="tc-text" value="'+custom.text+'"><input type="text" id="tc-text-hex" value="'+custom.text+'"></div>';
  html += '<div class="modal-btns"><button id="tc-apply" class="tb-btn primary">应用自定义</button><button id="tc-reset" class="tb-btn">恢复默认</button><button id="tc-close" class="tb-btn">关闭</button></div>';

  modal(html);

  // 预设主题点击
  var swatches = document.querySelectorAll(".theme-swatch");
  for (var j = 0; j < swatches.length; j++) {
    swatches[j].addEventListener("click", function(){
      var tn2 = this.dataset.theme;
      applyTheme(tn2);
      closeModal();
      toast("主题: "+THEME_NAMES[tn2]);
    });
  }
  // 颜色同步
  ["accent","bg","bg2","text"].forEach(function(k){
    var color = document.getElementById("tc-"+k);
    var hex = document.getElementById("tc-"+k+"-hex");
    if (color && hex) {
      color.addEventListener("input", function(){ hex.value = this.value; });
      hex.addEventListener("input", function(){ color.value = this.value; });
    }
  });
  // 应用自定义
  var applyBtn = $("tc-apply");
  if (applyBtn) applyBtn.addEventListener("click", function(){
    var colors = {
      accent: ($("tc-accent")||{}).value || "#7c6ff7",
      accent2: ($("tc-accent")||{}).value || "#7c6ff7",
      bg: ($("tc-bg")||{}).value || "#1a1b23",
      bg2: ($("tc-bg2")||{}).value || "#21232b",
      text: ($("tc-text")||{}).value || "#e1e1f0"
    };
    lsSet("custom_theme", colors);
    applyCustomColors(colors);
    closeModal();
    toast("自定义颜色已应用!");
  });
  var resetBtn = $("tc-reset");
  if (resetBtn) resetBtn.addEventListener("click", function(){
    lsSet("custom_theme", null);
    document.documentElement.style.removeProperty("--accent");
    document.documentElement.style.removeProperty("--accent2");
    document.documentElement.style.removeProperty("--bg");
    document.documentElement.style.removeProperty("--bg2");
    document.documentElement.style.removeProperty("--text");
    closeModal();
    toast("已恢复默认颜色");
  });
  $("tc-close").addEventListener("click", closeModal);
}

print("Part1 OK")
// ===== 快捷键系统 =====
function loadShortcuts() { return lsGet("shortcuts", JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS))); }
function saveShortcuts(sc) { lsSet("shortcuts", sc); }

function showShortcutsPanel() {
  var sc = loadShortcuts();
  var html = '<h3>⌨ 快捷键设置</h3>';
  html += '<div id="sc-list">';
  var names = {"undo":"撤销","redo":"重做","search":"搜索","copy":"复制","clean":"清洗","clearAll":"清空全部"};
  Object.keys(sc).forEach(function(k){
    html += '<div class="color-row"><label>'+names[k]+'</label><input type="text" class="sc-input" data-key="'+k+'" value="'+esc(sc[k])+'" style="flex:1" readonly></div>';
  });
  html += '</div>';
  html += '<p style="font-size:10px;color:var(--muted);margin:8px 0">点击输入框后按下新快捷键组合即可修改</p>';
  html += '<div class="modal-btns"><button id="sc-reset" class="tb-btn">恢复默认</button><button id="sc-close" class="tb-btn primary">关闭</button></div>';
  modal(html);

  // 快捷键录制
  var inputs = document.querySelectorAll(".sc-input");
  for (var i = 0; i < inputs.length; i++) {
    inputs[i].addEventListener("keydown", function(e){
      e.preventDefault();
      var keys = [];
      if (e.ctrlKey) keys.push("Ctrl");
      if (e.shiftKey) keys.push("Shift");
      if (e.altKey) keys.push("Alt");
      if (e.key === "Control" || e.key === "Shift" || e.key === "Alt") return;
      var k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      keys.push(k);
      this.value = keys.join("+");
      sc[this.dataset.key] = this.value;
      saveShortcuts(sc);
      this.blur();
    });
  }
  $("sc-close").addEventListener("click", closeModal);
  $("sc-reset").addEventListener("click", function(){
    saveShortcuts(JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS)));
    closeModal(); toast("快捷键已恢复默认");
  });
}

// 解析快捷键
function matchShortcut(e, name) {
  var sc = loadShortcuts();
  var def = sc[name]; if (!def) return false;
  var parts = def.split("+");
  var hasCtrl = parts.indexOf("Ctrl") >= 0;
  var hasShift = parts.indexOf("Shift") >= 0;
  var hasAlt = parts.indexOf("Alt") >= 0;
  var mainKey = parts[parts.length - 1];
  if (e.ctrlKey !== hasCtrl) return false;
  if (e.shiftKey !== hasShift) return false;
  if (e.altKey !== hasAlt) return false;
  if (mainKey === "C" && e.key === "c") return true;
  if (mainKey === "Z" && e.key === "z") return true;
  if (mainKey === "Y" && e.key === "y") return true;
  if (mainKey === "K" && e.key === "k") return true;
  return e.key === mainKey || e.key.toUpperCase() === mainKey || e.key === mainKey.toLowerCase();
}

// ===== 历史系统 =====
function pushHistory() {
  S.history = S.history.slice(0, S.historyIdx + 1);
  S.history.push({ pos: JSON.parse(JSON.stringify(S.posTags)), neg: JSON.parse(JSON.stringify(S.negTags)) });
  if (S.history.length > 50) S.history.shift();
  S.historyIdx = S.history.length - 1;
  updateHistoryUI(); updateUndoBtns();
}
function undo() {
  if (S.historyIdx <= 0) return; S.historyIdx--;
  var st = S.history[S.historyIdx];
  S.posTags = JSON.parse(JSON.stringify(st.pos)); S.negTags = JSON.parse(JSON.stringify(st.neg));
  refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts();
  if (!S.isSearching) renderGrid();
  updateHistoryUI(); updateUndoBtns(); toast("撤销 ↩");
}
function redo() {
  if (S.historyIdx >= S.history.length - 1) return; S.historyIdx++;
  var st = S.history[S.historyIdx];
  S.posTags = JSON.parse(JSON.stringify(st.pos)); S.negTags = JSON.parse(JSON.stringify(st.neg));
  refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts();
  if (!S.isSearching) renderGrid();
  updateHistoryUI(); updateUndoBtns(); toast("重做 ↪");
}
function jumpToHistory(idx) {
  if (idx < 0 || idx >= S.history.length) return; S.historyIdx = idx;
  var st = S.history[idx];
  S.posTags = JSON.parse(JSON.stringify(st.pos)); S.negTags = JSON.parse(JSON.stringify(st.neg));
  refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts();
  if (!S.isSearching) renderGrid();
  updateHistoryUI(); updateUndoBtns();
}
function updateHistoryUI() {
  var cont = $("history-states"); if (!cont) return;
  cont.innerHTML = "";
  for (var i = S.history.length - 1; i >= 0; i--) {
    var st = S.history[i], desc = "正面"+(st.pos.length||"0")+"个 负面"+(st.neg.length||"0")+"个";
    var div = document.createElement("div"); div.className = "history-state-item";
    if (i === S.historyIdx) div.classList.add("current");
    if (i > S.historyIdx) div.classList.add("future");
    div.textContent = "#"+(i+1)+" "+desc;
    (function(idx){ div.addEventListener("click", function(){ jumpToHistory(idx); }); })(i);
    cont.appendChild(div);
  }
}
function updateUndoBtns() {
  var u = $("btn-undo"), r = $("btn-redo");
  if (u) u.disabled = S.historyIdx <= 0;
  if (r) r.disabled = S.historyIdx >= S.history.length - 1;
}

// ===== 数据加载 =====
function loadFavs() { S.favs = lsGet("favs", {}); }
function saveFavs() { lsSet("favs", S.favs); }
function loadFreq() { S.tagFreq = lsGet("freq", {}); }
function saveFreq() { lsSet("freq", S.tagFreq); }
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
function addTag(en, zh, panel, skipHistory) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  for (var i = 0; i < a.length; i++) if (a[i].en === en) return;
  var info = findTagInfo(en);
  a.push({en:en, zh:zh||info.zh||en, weight:1.0, category:info.cat||"", subcategory:info.sc||""});
  bumpFreq(en);
  if (!skipHistory) pushHistory();
  refreshPanel(panel); updatePreview(); renderFreqTags(); updateTabCounts();
  if (!S.isSearching) renderGrid();
  updateFullscreenPreview();
}
function removeTag(en, panel, skipHistory) {
  if (!skipHistory) pushHistory();
  if (panel === "neg") S.negTags = S.negTags.filter(function(t){return t.en!==en;});
  else S.posTags = S.posTags.filter(function(t){return t.en!==en;});
  updateTabCounts(); refreshPanel(panel); updatePreview();
  if (!S.isSearching) renderGrid();
  updateFullscreenPreview();
}
function updateWeight(en, w, panel) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  for (var i = 0; i < a.length; i++) if (a[i].en === en) { a[i].weight = w; break; }
  updatePreview(); updateFullscreenPreview();
}
function clearPos() { pushHistory(); S.posTags = []; refreshPanel("pos"); updatePreview(); updateTabCounts(); updateFullscreenPreview(); toast("已清空正面"); }
function clearNeg() { pushHistory(); S.negTags = []; refreshPanel("neg"); updatePreview(); updateTabCounts(); updateFullscreenPreview(); toast("已清空负面"); }
function clearAll() { pushHistory(); S.posTags = []; S.negTags = []; refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts(); updateFullscreenPreview(); toast("已清空全部"); }

// ===== 提示词生成 =====
function genPrompt(tags) {
  return tags.map(function(t){ return t.weight === 1.0 ? t.en : "(" + t.en + ":" + t.weight.toFixed(1) + ")"; }).join(", ");
}
function genPromptCN(tags) {
  return tags.map(function(t){ return t.weight === 1.0 ? t.zh : "(" + t.zh + ":" + t.weight.toFixed(1) + ")"; }).join(", ");
}
function getSorted(panel) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  var sorted = a.slice();
  if ((panel==="neg"?S.autoSortNeg:S.autoSortPos)) sorted.sort(function(a,b){return b.weight-a.weight;});
  return sorted;
}
function updatePreview() {
  var pos = getSorted("pos"), neg = getSorted("neg");
  var enOut = "", cnOut = "";
  if (S.useQuality && pos.length > 0) enOut = QW.join(", ") + ", " + genPrompt(pos);
  else if (pos.length > 0) enOut = genPrompt(pos);
  if (neg.length > 0) { if (enOut) enOut += "\n--neg "; enOut += genPrompt(neg); }
  if (pos.length > 0) cnOut = genPromptCN(pos);
  if (neg.length > 0) { if (cnOut) cnOut += "\n--neg "; cnOut += genPromptCN(neg); }
  var taEn = $("prompt-output-en"); if (taEn) taEn.value = enOut;
  var taCn = $("prompt-output-cn"); if (taCn) taCn.value = cnOut;
  updateUndoBtns();
}
function updateTabCounts() {
  var pn = $("tab-pos-num"); if (pn) pn.textContent = "("+S.posTags.length+")";
  var nn = $("tab-neg-num"); if (nn) nn.textContent = "("+S.negTags.length+")";
  var pc = $("pos-count"); if (pc) pc.textContent = S.posTags.length + " 个";
  var nc = $("neg-count"); if (nc) nc.textContent = S.negTags.length + " 个";
}

// ===== 全屏预览 =====
function showFullscreenPreview() {
  updateFullscreenPreview();
  $("fullscreen-preview").style.display = "";
}
function updateFullscreenPreview() {
  var pos = getSorted("pos"), neg = getSorted("neg");
  var enOut = "", cnOut = "";
  if (S.useQuality && pos.length > 0) enOut = QW.join(", ") + ", " + genPrompt(pos);
  else if (pos.length > 0) enOut = genPrompt(pos);
  if (neg.length > 0) { if (enOut) enOut += "\n\nNEGATIVE:\n"; enOut += genPrompt(neg); }
  if (pos.length > 0) cnOut = genPromptCN(pos);
  if (neg.length > 0) { if (cnOut) cnOut += "\n\n负面:\n"; cnOut += genPromptCN(neg); }
  var fsEn = $("fs-prompt-en"); if (fsEn) fsEn.value = enOut;
  var fsCn = $("fs-prompt-cn"); if (fsCn) fsCn.value = cnOut;
}
function hideFullscreen() { $("fullscreen-preview").style.display = "none"; }

print("Part2 OK")
// ===== 面板标签行 =====
function refreshPanel(panel) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  var container = $(panel === "neg" ? "tags-neg" : "tags-pos");
  if (!container) return; container.innerHTML = "";
  if (a.length === 0) { container.innerHTML = '<div class="empty-hint">'+(panel==="neg"?"右键或Shift+点击添加":"点击标签卡片添加")+'</div>'; return; }
  var sorted = a.slice();
  if ((panel==="neg"?S.autoSortNeg:S.autoSortPos)) sorted.sort(function(a,b){return b.weight-a.weight;});
  for (var i = 0; i < sorted.length; i++) {
    var t = sorted[i];
    var row = document.createElement("div"); row.className = "tag-row" + (panel==="neg"?" neg":"");
    row.innerHTML =
      '<span class="tag-name" title="'+esc(t.zh)+'">'+esc(t.en)+'</span>' +
      '<input type="range" class="weight-slider" min="0.1" max="2.0" step="0.05" value="'+t.weight.toFixed(2)+'" data-en="'+esc(t.en)+'" data-pn="'+panel+'">' +
      '<input type="number" class="weight-val" min="0.1" max="2.0" step="0.1" value="'+t.weight.toFixed(1)+'" data-en="'+esc(t.en)+'" data-pn="'+panel+'">' +
      '<button class="tag-remove" data-en="'+esc(t.en)+'" data-pn="'+panel+'">×</button>';
    container.appendChild(row);
  }
  container.querySelectorAll(".weight-slider").forEach(function(s){
    s.addEventListener("input", function(){
      var w = parseFloat(this.value), row = this.parentElement;
      var vi = row.querySelector(".weight-val"); if (vi) vi.value = w.toFixed(1);
      updateWeight(w, this.dataset.en, this.dataset.pn);
    });
  });
  container.querySelectorAll(".weight-val").forEach(function(v){
    v.addEventListener("change", function(){
      var w = parseFloat(this.value); if (isNaN(w)) w = 1.0;
      w = Math.max(0.1, Math.min(2.0, w)); this.value = w.toFixed(1);
      var row = this.parentElement, sl = row.querySelector(".weight-slider");
      if (sl) sl.value = w; updateWeight(w, this.dataset.en, this.dataset.pn);
    });
  });
  container.querySelectorAll(".tag-remove").forEach(function(r){
    r.addEventListener("click", function(){ removeTag(this.dataset.en, this.dataset.pn); });
  });
  updateTabCounts();
}

// ===== 标签网格（含编辑和收藏） =====
function renderGrid() {
  var grid = $("tag-grid"), title = $("canvas-title");
  if (!grid) return;
  grid.innerHTML = "";
  ["btn-select-all","btn-clear-page","btn-add-sub-here","btn-add-tag-here","rec-toggle"].forEach(function(id){
    var el = $(id); if (el) el.style.display = "none";
  });
  if (!S.allData) { grid.innerHTML = '<div class="empty-hint">加载中...</div>'; return; }
  if (S.isSearching) { renderSearchResults(); return; }
  if (!S.activeCat || !S.activeSc) {
    if (title) title.textContent = "选择一个子类别开始";
    grid.innerHTML = '<div class="empty-hint">👈 从左侧分类中选择子类别</div>';
    return;
  }
  var tags = [];
  for (var ci = 0; ci < S.allData.categories.length; ci++) {
    var c = S.allData.categories[ci]; if (c.name !== S.activeCat) continue;
    for (var si = 0; si < (c.subcategories||[]).length; si++) {
      var sc = c.subcategories[si]; if (sc.name !== S.activeSc) continue;
      tags = sc.tags || []; break;
    }
    if (tags.length > 0) break;
  }
  if (title) title.textContent = (S.activeCat||"") + " › " + (S.activeSc||"") + " ("+tags.length+"个)";
  if (tags.length > 0) {
    $("btn-select-all").style.display = "";
    $("btn-clear-page").style.display = "";
    $("btn-add-sub-here").style.display = "";
    $("btn-add-tag-here").style.display = "";
    $("rec-toggle").style.display = "";
  }
  $("rec-toggle").style.background = S.recOn ? "var(--accent)" : "";

  for (var i = 0; i < tags.length; i++) {
    var t = tags[i], isFaved = S.favs[t.en];
    var card = document.createElement("div"); card.className = "tag-card";
    if (isSelected(t.en, "pos")) card.classList.add("selected-pos");
    if (isSelected(t.en, "neg")) card.classList.add("selected-neg");
    card.innerHTML =
      '<div class="tag-zh">'+esc(t.zh)+'</div>' +
      '<div class="tag-en">'+esc(t.en)+'</div>' +
      '<div class="tag-actions">' +
        '<button class="tag-edit" data-en="'+esc(t.en)+'" data-zh="'+esc(t.zh)+'" title="编辑">✎</button>' +
        '<button class="tag-star'+(isFaved?" faved":"")+'" data-en="'+esc(t.en)+'">'+(isFaved?"★":"☆")+'</button>' +
      '</div>';

    card.addEventListener("click", function(e){
      if (e.target.classList.contains("tag-edit") || e.target.classList.contains("tag-star")) return;
      var en = this.querySelector(".tag-en").textContent, zh = this.querySelector(".tag-zh").textContent;
      if (e.shiftKey) { if (isSelected(en,"neg")) removeTag(en,"neg"); else addTag(en,zh,"neg"); }
      else { if (isSelected(en,"pos")) removeTag(en,"pos"); else addTag(en,zh,"pos"); }
    });
    card.addEventListener("contextmenu", function(e){
      e.preventDefault();
      var en = this.querySelector(".tag-en").textContent, zh = this.querySelector(".tag-zh").textContent;
      if (isSelected(en,"neg")) removeTag(en,"neg"); else addTag(en,zh,"neg");
    });
    card.querySelector(".tag-star").addEventListener("click", function(e){
      e.stopPropagation(); toggleFav(this.dataset.en); renderGrid();
    });
    card.querySelector(".tag-edit").addEventListener("click", function(e){
      e.stopPropagation();
      openTagEdit(this.dataset.en, this.dataset.zh);
    });
    grid.appendChild(card);
  }
}
function renderSearchResults() {
  var q = ($("search-input")||{}).value || "";
  if (!q.trim()) { S.isSearching = false; renderGrid(); return; }
  api("/api/search?q="+encodeURIComponent(q)).then(function(results){
    var grid = $("tag-grid"), title = $("canvas-title"), info = $("search-info");
    if (!grid) return; grid.innerHTML = "";
    ["btn-select-all","btn-clear-page","btn-add-sub-here","btn-add-tag-here","rec-toggle"].forEach(function(id){
      var el = $(id); if (el) el.style.display = "none";
    });
    var total = 0;
    for (var i = 0; i < results.length; i++) {
      var r = results[i]; total += r.tags.length;
      var hdr = document.createElement("div"); hdr.className = "search-group-header";
      hdr.textContent = r.category + " › " + r.subcategory + " ("+r.tags.length+")"; grid.appendChild(hdr);
      for (var j = 0; j < r.tags.length; j++) {
        var t = r.tags[j], isFaved = S.favs[t.en];
        var card = document.createElement("div"); card.className = "tag-card";
        if (isSelected(t.en, "pos")) card.classList.add("selected-pos");
        if (isSelected(t.en, "neg")) card.classList.add("selected-neg");
        card.innerHTML =
          '<div class="tag-zh">'+esc(t.zh)+'</div>' +
          '<div class="tag-en">'+esc(t.en)+'</div>' +
          '<div class="tag-actions">' +
            '<button class="tag-edit" data-en="'+esc(t.en)+'" data-zh="'+esc(t.zh)+'">✎</button>' +
            '<button class="tag-star'+(isFaved?" faved":"")+'" data-en="'+esc(t.en)+'">'+(isFaved?"★":"☆")+'</button>' +
          '</div>';
        (function(en,zh){
          card.addEventListener("click", function(e){
            if (e.target.classList.contains("tag-edit")||e.target.classList.contains("tag-star")) return;
            if (e.shiftKey){if(isSelected(en,"neg"))removeTag(en,"neg");else addTag(en,zh,"neg");}
            else{if(isSelected(en,"pos"))removeTag(en,"pos");else addTag(en,zh,"pos");}
          });
          card.querySelector(".tag-star").addEventListener("click",function(e2){e2.stopPropagation();toggleFav(en);renderGrid();});
          card.querySelector(".tag-edit").addEventListener("click",function(e2){e2.stopPropagation();openTagEdit(en,zh);});
        })(t.en,t.zh);
        grid.appendChild(card);
      }
    }
    if (title) title.textContent = "🔍 搜索: "+esc(q)+" ("+total+"个)";
    if (info) { info.style.display = ""; info.textContent = "共 "+total+" 个结果"; }
  });
}

// ===== 标签编辑 =====
function openTagEdit(en, zh) {
  if (!S.activeCat || !S.activeSc) { toast("请先选择分类","warn"); return; }
  modal('<h3>✎ 编辑标签</h3>' +
    '<input value="'+esc(S.activeCat)+' > '+esc(S.activeSc)+'" readonly>' +
    '<input id="edit-tag-en" value="'+esc(en)+'">' +
    '<input id="edit-tag-zh" value="'+esc(zh)+'">' +
    '<input type="hidden" id="edit-tag-old-en" value="'+esc(en)+'">' +
    '<div class="modal-btns">' +
      '<button id="edit-tag-save" class="tb-btn primary">保存</button>' +
      '<button id="edit-tag-delete" class="tb-btn danger">删除</button>' +
      '<button id="edit-tag-cancel" class="tb-btn">取消</button>' +
    '</div>');
  $("edit-tag-cancel").addEventListener("click", closeModal);
  $("edit-tag-save").addEventListener("click", function(){
    var newEn = ($("edit-tag-en")||{}).value.trim(), newZh = ($("edit-tag-zh")||{}).value.trim();
    var oldEn = ($("edit-tag-old-en")||{}).value;
    if (!newEn) { toast("请输入英文标签","warn"); return; }
    api("/api/custom-tags/edit", {method:"POST", body:{category:S.activeCat, subcategory:S.activeSc, old_en:oldEn, new_en:newEn, new_zh:newZh}})
      .then(function(r){ if(r.ok){ closeModal(); loadTags(); toast("已更新"); } else toast(r.error,"error"); });
  });
  $("edit-tag-delete").addEventListener("click", function(){
    if (!confirm("确定删除 "+en+" 吗？")) return;
    api("/api/custom-tags/delete", {method:"POST", body:{category:S.activeCat, subcategory:S.activeSc, en:en}})
      .then(function(r){ if(r.ok){ closeModal(); loadTags(); toast("已删除"); } else toast(r.error,"error"); });
  });
}

// ===== 分类树 =====
function renderCategoryTree() {
  var tree = $("category-tree"); if (!tree || !S.allData) return;
  tree.innerHTML = "";
  var custom = lsGet("custom_cats", {});
  for (var ci = 0; ci < S.allData.categories.length; ci++) {
    var c = S.allData.categories[ci];
    var catDiv = document.createElement("div"); catDiv.className = "cat-group";
    var icon = CAT_ICONS[c.name] || "📌";
    var isExpanded = (custom[c.name]&&custom[c.name].expanded);
    catDiv.innerHTML =
      '<div class="cat-head">' +
        '<span class="cat-arrow">'+(isExpanded?"▼":"▶")+'</span> <span>'+icon+'</span> ' +
        '<span class="cat-name">'+esc(c.name)+' ('+(c.subcategories||[]).length+')</span>' +
        '<button class="cat-btn" data-cat="'+esc(c.name)+'">＋子类</button>' +
      '</div>' +
      '<div class="cat-subs"'+(isExpanded?' style="display:block"':'')+'></div>';
    var subsDiv = catDiv.querySelector(".cat-subs");
    for (var si = 0; si < (c.subcategories||[]).length; si++) {
      var sc = c.subcategories[si];
      var subItem = document.createElement("div"); subItem.className = "sub-item";
      if (S.activeCat === c.name && S.activeSc === sc.name) subItem.classList.add("active");
      subItem.innerHTML =
        '<span class="sub-name">'+esc(sc.name)+' ('+(sc.tags||[]).length+')</span>' +
        '<button class="sub-act" data-cat="'+esc(c.name)+'" data-sub="'+esc(sc.name)+'">＋标签</button>' +
        '<button class="sub-act del" data-cat="'+esc(c.name)+'" data-sub="'+esc(sc.name)+'">✕</button>';
      (function(cn,sn){
        subItem.querySelector(".sub-name").addEventListener("click", function(){
          S.activeCat = cn; S.activeSc = sn; S.isSearching = false;
          $("search-input").value = ""; $("btn-search-clear").style.display = "none";
          renderCategoryTree(); renderGrid();
        });
      })(c.name, sc.name);
      subItem.querySelector(".sub-act:not(.del)").addEventListener("click", function(e){
        e.stopPropagation(); openTagForm(this.dataset.cat, this.dataset.sub);
      });
      subItem.querySelector(".sub-act.del").addEventListener("click", function(e){
        e.stopPropagation();
        if (confirm("确定删除子类 "+this.dataset.sub+" 吗？")) {
          api("/api/custom-tags/delete-subcategory", {method:"POST", body:{category:this.dataset.cat, subcategory:this.dataset.sub}})
            .then(function(r){ if(r.ok){ toast("已删除"); loadTags(); } else toast(r.error,"error"); });
        }
      });
      subsDiv.appendChild(subItem);
    }
    catDiv.querySelector(".cat-btn").addEventListener("click", function(e){
      e.stopPropagation(); openNewSc(this.dataset.cat);
    });
    catDiv.querySelector(".cat-head").addEventListener("click", function(e){
      if (e.target.classList.contains("cat-btn")) return;
      var subs = this.nextElementSibling, arrow = this.querySelector(".cat-arrow");
      if (subs.style.display === "block") {
        subs.style.display = "none"; arrow.textContent = "▶";
        if (!custom[c.name]) custom[c.name] = {}; custom[c.name].expanded = false;
      } else {
        subs.style.display = "block"; arrow.textContent = "▼";
        if (!custom[c.name]) custom[c.name] = {}; custom[c.name].expanded = true;
      }
      lsSet("custom_cats", custom);
    });
    tree.appendChild(catDiv);
  }
}

// ===== 收藏 =====
function toggleFav(en) { if (S.favs[en]) { delete S.favs[en]; } else { S.favs[en] = Date.now(); } saveFavs(); renderFavList(); }
function renderFavList() {
  var list = $("fav-list"), count = $("fav-count"); if (!list) return;
  list.innerHTML = "";
  var keys = Object.keys(S.favs);
  if (count) count.textContent = keys.length > 0 ? "("+keys.length+")" : "";
  if (keys.length === 0) { list.innerHTML = '<div class="empty-hint" style="padding:6px;font-size:10px">暂无收藏</div>'; return; }
  var grouped = {};
  for (var i = 0; i < keys.length; i++) {
    var en = keys[i], info = findTagInfo(en), cat = info.cat || "未分类";
    if (!grouped[cat]) grouped[cat] = []; grouped[cat].push({en:en, zh:info.zh||en});
  }
  Object.keys(grouped).sort().forEach(function(cn){
    var catHead = document.createElement("div"); catHead.className = "sidebar-label";
    catHead.textContent = (CAT_ICONS[cn]||"📌")+" "+cn; list.appendChild(catHead);
    grouped[cn].forEach(function(t){
      var item = document.createElement("div"); item.className = "mini-list-item";
      item.innerHTML = '<span>⭐ '+esc(t.zh)+'</span><span style="font-size:9px;color:var(--muted);margin-left:4px">'+esc(t.en)+'</span><button class="item-del" data-en="'+esc(t.en)+'">✕</button>';
      item.querySelector("span").addEventListener("click", function(){
        addTag(t.en, null, S.activeTab==="neg"?"neg":"pos");
      });
      item.querySelector(".item-del").addEventListener("click", function(e){
        e.stopPropagation(); toggleFav(this.dataset.en);
      });
      list.appendChild(item);
    });
  });
}

// ===== 常用标签等 =====
function renderFreqTags() {
  var cont = $("freq-tags"); if (!cont) return;
  cont.innerHTML = "";
  Object.keys(S.tagFreq).sort(function(a,b){return S.tagFreq[b]-S.tagFreq[a];}).slice(0,10).forEach(function(en){
    var span = document.createElement("span"); span.className = "freq-tag"; span.textContent = en;
    span.title = "使用 "+S.tagFreq[en]+" 次";
    span.addEventListener("click", function(){ addTag(this.textContent, null, S.activeTab==="neg"?"neg":"pos"); });
    cont.appendChild(span);
  });
}
function renderQuickNeg() {
  var cont = $("quick-neg"); if (!cont) return;
  cont.innerHTML = "";
  QUICK_NEG.forEach(function(q){
    var chip = document.createElement("span"); chip.className = "quick-chip";
    if (isSelected(q.en,"neg")) chip.classList.add("active");
    chip.textContent = q.zh;
    chip.addEventListener("click", function(){
      if (isSelected(q.en,"neg")) removeTag(q.en,"neg"); else addTag(q.en,null,"neg"); renderQuickNeg();
    });
    cont.appendChild(chip);
  });
}

// ===== 预设 =====
function loadPresets() {
  api("/api/presets").then(function(d){
    var list = $("presets-list"); if (!list) return;
    list.innerHTML = "";
    var all = (d.builtin||[]).concat(d.user||[]);
    if (all.length === 0) { list.innerHTML = '<div class="empty-hint" style="padding:4px;font-size:10px">暂无</div>'; }
    all.forEach(function(p){
      var item = document.createElement("div"); item.className = "mini-list-item"; item.textContent = "📦 "+p.name;
      item.addEventListener("click", function(){ applyPreset(p); }); list.appendChild(item);
    });
    var btns = document.createElement("div"); btns.style.cssText = "display:flex;gap:4px;margin-top:4px";
    btns.innerHTML = '<button id="btn-save-preset" class="cud-btn">💾 保存预设</button><button id="btn-import-preset" class="cud-btn">📥 导入</button>';
    list.appendChild(btns);
    setTimeout(function(){
      var sb=$("btn-save-preset"),ib=$("btn-import-preset");
      if(sb)sb.addEventListener("click",showSavePreset); if(ib)ib.addEventListener("click",showImportPreset);
    },50);
  });
}
function applyPreset(p) {
  pushHistory(); S.posTags=[]; S.negTags=[];
  (p.tags||[]).forEach(function(en){var info=findTagInfo(en);S.posTags.push({en:en,zh:info.zh||en,weight:(p.weights||{})[en]||1.0,category:info.cat||"",subcategory:info.sc||""});});
  (p.negative_tags||[]).forEach(function(en){var info=findTagInfo(en);S.negTags.push({en:en,zh:info.zh||en,weight:(p.negative_weights||{})[en]||1.0,category:info.cat||"",subcategory:info.sc||""});});
  refreshPanel("pos");refreshPanel("neg");updatePreview();updateTabCounts();updateHistoryUI();
  toast("已加载: "+p.name);
}
function showSavePreset() {
  if (S.posTags.length===0&&S.negTags.length===0){toast("请先选择标签","warn");return;}
  modal('<h3>💾 保存预设</h3><input id="pf-name" placeholder="名称..."><div class="modal-btns"><button id="pf-save" class="tb-btn primary">保存</button><button id="pf-cancel" class="tb-btn">取消</button></div>');
  $("pf-cancel").addEventListener("click",closeModal);
  $("pf-save").addEventListener("click",function(){
    var nm=($("pf-name")||{}).value.trim();if(!nm){toast("请输入名称","warn");return;}
    var w={};S.posTags.forEach(function(t){w[t.en]=t.weight;});var nw={};S.negTags.forEach(function(t){nw[t.en]=t.weight;});
    api("/api/presets/save",{method:"POST",body:{name:nm,tags:S.posTags.map(function(t){return t.en}),weights:w,negative_tags:S.negTags.map(function(t){return t.en}),negative_weights:nw}})
      .then(function(r){if(r.ok){toast("已保存");closeModal();loadPresets();loadSavedList();}else toast(r.error,"error");});
  });
}
function showImportPreset() {
  modal('<h3>📥 导入预设</h3><textarea id="pf-json" placeholder="粘贴JSON..."></textarea><div class="modal-btns"><button id="pf-import" class="tb-btn primary">导入</button><button id="pf-cancel2" class="tb-btn">取消</button></div>');
  $("pf-cancel2").addEventListener("click",closeModal);
  $("pf-import").addEventListener("click",function(){
    var t=($("pf-json")||{}).value.trim();if(!t)return;
    try{var d=JSON.parse(t);if(!d.name){toast("缺少名称","warn");return;}
      api("/api/presets/import",{method:"POST",body:d}).then(function(r){if(r.ok){toast("已导入");closeModal();loadPresets();loadSavedList();}else toast(r.error,"error");});
    }catch(e){toast("JSON格式错误","error");}
  });
}
function loadSavedList() {
  api("/api/presets").then(function(d){
    var list=$("saved-list");if(!list)return;list.innerHTML="";var user=d.user||[];
    if(user.length===0){list.innerHTML='<div class="empty-hint" style="padding:4px;font-size:10px">暂无</div>';return;}
    user.forEach(function(p){
      var item=document.createElement("div");item.className="mini-list-item";
      item.innerHTML='<span>💾 '+esc(p.name)+'</span><button class="item-del" data-name="'+esc(p._filename)+'">✕</button>';
      item.querySelector("span").addEventListener("click",function(){applyPreset(p);});
      item.querySelector(".item-del").addEventListener("click",function(e){e.stopPropagation();
        api("/api/presets/delete/"+p._filename,{method:"DELETE"}).then(function(r){if(r.ok){toast("已删除");loadSavedList();loadPresets();}else toast(r.error,"error");});
      });
      list.appendChild(item);
    });
  });
}

// ===== 快照 =====
function saveSnapshot() {
  if (S.posTags.length===0&&S.negTags.length===0){toast("没有可保存的标签","warn");return;}
  api("/api/snapshots/save",{method:"POST",body:{name:"快照",pos_tags:S.posTags,neg_tags:S.negTags}}).then(function(r){
    if(r.ok){toast("快照已保存");loadSnapshots();}else toast(r.error,"error");
  });
}
function loadSnapshots() {
  api("/api/snapshots").then(function(items){
    var list=$("snapshot-list");if(!list)return;list.innerHTML="";
    if(items.length===0){list.innerHTML='<div class="empty-hint" style="padding:6px;font-size:10px">暂无快照</div>';return;}
    items.forEach(function(s){
      var item=document.createElement("div");item.className="snapshot-item";
      item.innerHTML='<span>📸 '+(s.pos_tags.length+s.neg_tags.length)+'个标签</span><span class="snap-time">'+esc((s.created||"").substring(11))+'</span><span class="snap-actions"><button class="snap-restore" data-id="'+s._id+'">↩</button><button class="snap-del" data-id="'+s._id+'">✕</button></span>';
      item.querySelector(".snap-restore").addEventListener("click",function(e){e.stopPropagation();
        pushHistory();S.posTags=JSON.parse(JSON.stringify(s.pos_tags));S.negTags=JSON.parse(JSON.stringify(s.neg_tags));
        refreshPanel("pos");refreshPanel("neg");updatePreview();updateTabCounts();updateHistoryUI();toast("已恢复快照");
      });
      item.querySelector(".snap-del").addEventListener("click",function(e){e.stopPropagation();
        if(confirm("删除此快照？")){api("/api/snapshots/"+s._id,{method:"DELETE"}).then(function(r){if(r.ok){toast("已删除");loadSnapshots();}else toast(r.error,"error");});}
      });
      list.appendChild(item);
    });
  });
}

print("Part3 OK")
// ===== 随机 =====
function randomTags() {
  if (!S.allData) { toast("数据加载中...","warn"); return; }
  pushHistory(); S.posTags=[]; S.negTags=[];
  var aa=[];
  (S.allData.categories||[]).forEach(function(c){
    if(c.name==="NSFW"||c.name==="NSFW标签")return;
    (c.subcategories||[]).forEach(function(sc){
      (sc.tags||[]).forEach(function(t){aa.push({en:t.en,zh:t.zh,category:c.name,subcategory:sc.name});});
    });
  });
  var cnt=Math.floor(Math.random()*8)+3,pk=[],seen2={};
  while(pk.length<cnt&&aa.length>0){var idx=Math.floor(Math.random()*aa.length),t2=aa[idx];
    if(!seen2[t2.en]){seen2[t2.en]=true;pk.push({en:t2.en,zh:t2.zh,weight:Math.round((Math.random()*0.5+1.0)*10)/10,category:t2.category,subcategory:t2.subcategory});}
    aa.splice(idx,1);
  }
  S.posTags=pk;refreshPanel("pos");refreshPanel("neg");updatePreview();updateTabCounts();updateHistoryUI();
  if(!S.isSearching)renderGrid();toast("🎲 随机生成 "+pk.length+" 个标签");
}

// ===== 清洗 =====
function cleanPrompt(){
  var changed=false,seen={},newPos=[];S.posTags.forEach(function(t){var k=t.en.toLowerCase();if(!seen[k]){seen[k]=true;newPos.push(t);}else changed=true;});
  var seen2={},newNeg=[];S.negTags.forEach(function(t){var k=t.en.toLowerCase();if(!seen2[k]){seen2[k]=true;newNeg.push(t);}else changed=true;});
  if(changed)pushHistory();S.posTags=newPos;S.negTags=newNeg;
  refreshPanel("pos");refreshPanel("neg");updatePreview();updateTabCounts();updateHistoryUI();
  if(!S.isSearching)renderGrid();toast(changed?"已清洗：去除重复标签":"提示词已干净");
}

// ===== 导出卡片 =====
function exportCard(){
  var pos=getSorted("pos"),neg=getSorted("neg");
  if(pos.length===0&&neg.length===0){toast("没有标签可导出","warn");return;}
  var c=document.createElement("canvas");c.width=800;c.height=Math.max(200,80+pos.length*26+neg.length*26+80);
  var ctx=c.getContext("2d");
  ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--bg").trim()||"#1a1b23";
  ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle="#e1e1f0";ctx.font="bold 18px sans-serif";ctx.fillText("魔导书 v4.2",20,36);
  var y=66;
  if(pos.length>0){ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--accent").trim()||"#7c6ff7";ctx.font="bold 13px sans-serif";ctx.fillText("正面提示词:",20,y);y+=22;
    ctx.fillStyle="#e1e1f0";ctx.font="12px monospace";
    pos.forEach(function(t){ctx.fillText((t.weight!==1.0?"("+t.en+":"+t.weight.toFixed(1)+")":t.en),28,y);y+=22;});}
  if(neg.length>0){y+=6;ctx.fillStyle="#e0556a";ctx.font="bold 13px sans-serif";ctx.fillText("负面提示词:",20,y);y+=22;
    ctx.fillStyle="#e1e1f0";ctx.font="12px monospace";
    neg.forEach(function(t){ctx.fillText((t.weight!==1.0?"("+t.en+":"+t.weight.toFixed(1)+")":t.en),28,y);y+=22;});}
  var a=document.createElement("a");a.download="grimoire42-"+Date.now()+".png";a.href=c.toDataURL("image/png");a.click();
  toast("已导出PNG卡片!");
}

// ===== 推荐 =====
function toggleRecommend(){S.recOn=!S.recOn;$("rec-toggle").style.background=S.recOn?"var(--accent)":"";
  if(S.recOn){api("/api/recommend",{method:"POST",body:{tags:S.posTags.map(function(t){return t.en})}}).then(function(r){showRecs(r);});}
  else{var bar=$("rec-bar");if(bar)bar.remove();}
}
function showRecs(recs){var old=$("rec-bar");if(old)old.remove();if(!recs||recs.length===0)return;
  var bar=document.createElement("div");bar.id="rec-bar";bar.className="rec-bar";bar.innerHTML='<span style="font-size:10px;color:var(--muted)">💡 推荐:</span>';
  for(var i=0;i<Math.min(recs.length,10);i++){var r=recs[i];var chip=document.createElement("span");chip.className="rec-chip";
    chip.textContent=r.en;chip.title=r.zh;
    chip.addEventListener("click",function(){addTag(this.textContent,this.title,S.activeTab==="neg"?"neg":"pos");});
    bar.appendChild(chip);
  }
  $("canvas").insertBefore(bar,$("tag-grid"));
}

// ===== CRUD 模态 =====
function modal(html){var root=$("modal-root");if(!root)return;root.innerHTML='<div class="modal-overlay" id="modal-over"><div class="modal-box">'+html+'</div></div>';root.style.display="";
  $("modal-over").addEventListener("click",function(e){if(e.target===this)closeModal();});}
function closeModal(){var r=$("modal-root");if(r){r.innerHTML="";r.style.display="none";}}

function openNewCat(){
  modal('<h3>新建大类</h3><input id="ncat-name" placeholder="大类名称..." autofocus><div class="modal-btns"><button id="ncat-ok" class="tb-btn primary">创建</button><button id="ncat-cancel" class="tb-btn">取消</button></div>');
  $("ncat-cancel").addEventListener("click",closeModal);
  $("ncat-ok").addEventListener("click",function(){var n=($("ncat-name")||{}).value.trim();if(!n){toast("请输入名称","warn");return;}
    api("/api/custom-tags/add-category",{method:"POST",body:{name:n}}).then(function(r){if(r.ok){toast("已添加: "+n);closeModal();loadTags();}else toast(r.error,"error");});
  });
}
function openNewSc(catName){
  modal('<h3>新建子类</h3><input value="'+esc(catName)+'" readonly><input id="nsc-name" placeholder="子类名称..." autofocus><div class="modal-btns"><button id="nsc-ok" class="tb-btn primary">创建</button><button id="nsc-cancel" class="tb-btn">取消</button></div>');
  $("nsc-cancel").addEventListener("click",closeModal);
  $("nsc-ok").addEventListener("click",function(){var sn=($("nsc-name")||{}).value.trim();if(!sn){toast("请输入名称","warn");return;}
    api("/api/custom-tags/add-subcategory",{method:"POST",body:{category:catName,subcategory:sn}}).then(function(r){if(r.ok){toast("已添加: "+sn);closeModal();loadTags();}else toast(r.error,"error");});
  });
}
function openTagForm(catName,scName){
  modal('<h3>添加标签</h3><input value="'+esc(catName)+' > '+esc(scName)+'" readonly><input id="tf-en" placeholder="英文标签..." autofocus><input id="tf-zh" placeholder="中文标签..."><div class="modal-btns"><button id="tf-ok" class="tb-btn primary">添加</button><button id="tf-cancel" class="tb-btn">取消</button></div>');
  $("tf-cancel").addEventListener("click",closeModal);
  $("tf-ok").addEventListener("click",function(){var en=($("tf-en")||{}).value.trim(),zh=($("tf-zh")||{}).value.trim();
    if(!en){toast("请输入英文标签","warn");return;}
    api("/api/custom-tags/add",{method:"POST",body:{category:catName,subcategory:scName,en:en,zh:zh}}).then(function(r){if(r.ok){toast("已添加: "+en);closeModal();loadTags();}else toast(r.error,"error");});
  });
}

// ===== 数据加载 =====
function loadTags(){api("/api/tags").then(function(d){S.allData=d;renderCategoryTree();renderGrid();renderQuickNeg();
  loadPresets();loadSavedList();loadSnapshots();renderFreqTags();renderFavList();});}

// ===== 初始化 =====
function init(){
  loadFavs();loadFreq();initTheme();loadTags();pushHistory();

  // 搜索
  var si=$("search-input");
  if(si){si.addEventListener("input",function(){S.isSearching=this.value.trim().length>0;$("btn-search-clear").style.display=S.isSearching?"":"none";if(S.isSearching)renderSearchResults();else renderGrid();});
    si.addEventListener("focus",function(){this.select();});}
  var sc=$("btn-search-clear");if(sc)sc.addEventListener("click",function(){si.value="";S.isSearching=false;this.style.display="none";renderGrid();});

  // 标签页切换
  document.querySelectorAll(".panel-tab").forEach(function(tab){tab.addEventListener("click",function(){
    var t=this.dataset.tab;S.activeTab=t;
    document.querySelectorAll(".panel-tab").forEach(function(x){x.classList.remove("active");});this.classList.add("active");
    $("ws-pos").style.display=t==="pos"?"":"none";$("ws-neg").style.display=t==="neg"?"":"none";$("quick-neg").style.display=t==="neg"?"":"none";
  });});

  // 排序
  var asp=$("auto-sort-pos");if(asp)asp.addEventListener("change",function(){S.autoSortPos=this.checked;refreshPanel("pos");updatePreview();});
  var asn=$("auto-sort-neg");if(asn)asn.addEventListener("change",function(){S.autoSortNeg=this.checked;refreshPanel("neg");updatePreview();});

  // 工具栏
  var bq=$("btn-quality");if(bq)bq.addEventListener("click",function(){S.useQuality=!S.useQuality;if(S.useQuality)this.classList.add("active");else this.classList.remove("active");updatePreview();updateFullscreenPreview();});
  var bc=$("btn-clean");if(bc)bc.addEventListener("click",cleanPrompt);
  var brnd=$("btn-random");if(brnd)brnd.addEventListener("click",randomTags);
  $("btn-clear-all").addEventListener("click",clearAll);
  $("btn-clear-pos").addEventListener("click",clearPos);
  $("btn-clear-neg").addEventListener("click",clearNeg);
  $("btn-undo").addEventListener("click",undo);
  $("btn-redo").addEventListener("click",redo);

  // 主题按钮 → 主题面板
  var bth=$("btn-theme");if(bth)bth.addEventListener("click",showThemePanel);

  // 快捷键按钮 → 快捷键面板
  var bsk=$("btn-shortcuts");if(bsk)bsk.addEventListener("click",showShortcutsPanel);

  // 全选/清空当前页
  $("btn-select-all").addEventListener("click",function(){
    if(S.isSearching||!S.activeCat||!S.activeSc)return;pushHistory();
    (S.allData.categories||[]).forEach(function(c){if(c.name!==S.activeCat)return;
      (c.subcategories||[]).forEach(function(sc){if(sc.name!==S.activeSc)return;
        (sc.tags||[]).forEach(function(t){if(!isSelected(t.en,"pos"))addTag(t.en,t.zh,"pos",true);});
      });
    });
    refreshPanel("pos");updatePreview();updateTabCounts();updateHistoryUI();renderGrid();toast("已全选当前子类别");
  });
  $("btn-clear-page").addEventListener("click",function(){
    if(S.isSearching||!S.activeCat||!S.activeSc)return;pushHistory();
    (S.allData.categories||[]).forEach(function(c){if(c.name!==S.activeCat)return;
      (c.subcategories||[]).forEach(function(sc){if(sc.name!==S.activeSc)return;
        (sc.tags||[]).forEach(function(t){if(isSelected(t.en,"pos"))removeTag(t.en,"pos",true);if(isSelected(t.en,"neg"))removeTag(t.en,"neg",true);});
      });
    });
    refreshPanel("pos");refreshPanel("neg");updatePreview();updateTabCounts();updateHistoryUI();renderGrid();toast("已清空当前子类别");
  });

  // 中间添加子类/标签
  $("btn-add-sub-here").addEventListener("click",function(){if(S.activeCat)openNewSc(S.activeCat);});
  $("btn-add-tag-here").addEventListener("click",function(){if(S.activeCat&&S.activeSc)openTagForm(S.activeCat,S.activeSc);});

  // 推荐
  $("rec-toggle").addEventListener("click",toggleRecommend);
  $("btn-add-cat").addEventListener("click",openNewCat);
  $("btn-save-snapshot").addEventListener("click",saveSnapshot);

  // 收藏切换
  $("fav-toggle").addEventListener("click",function(){var list=$("fav-list");if(list)list.style.display=list.style.display==="none"?"":"none";});

  // 全屏预览
  $("btn-preview-expand").addEventListener("click",showFullscreenPreview);
  $("fs-close").addEventListener("click",hideFullscreen);
  $("fullscreen-preview").addEventListener("click",function(e){if(e.target===this)hideFullscreen();});
  $("fs-copy-en").addEventListener("click",function(){var t=($("fs-prompt-en")||{}).value||"";if(t.trim()){copyText(t);toast("已复制英文!");}});
  $("fs-copy-cn").addEventListener("click",function(){var t=($("fs-prompt-cn")||{}).value||"";if(t.trim()){copyText(t);toast("已复制中文!");}});

  // 复制
  $("btn-copy").addEventListener("click",function(){var t=($("prompt-output-en")||{}).value||"";if(!t.trim()){toast("没有可复制的内容","warn");return;}copyText(t);toast("已复制英文!");});
  $("btn-copy-cn").addEventListener("click",function(){var t=($("prompt-output-cn")||{}).value||"";if(!t.trim()){toast("没有可复制的内容","warn");return;}copyText(t);toast("已复制中文!");});
  $("btn-copy-pos").addEventListener("click",function(){var p=getSorted("pos");var t=S.useQuality&&p.length>0?QW.join(", ")+", "+genPrompt(p):genPrompt(p);if(!t.trim()){toast("没有正面提示词","warn");return;}copyText(t);toast("已复制正面!");});
  $("btn-copy-neg").addEventListener("click",function(){var n=getSorted("neg");var t=genPrompt(n);if(!t.trim()){toast("没有负面提示词","warn");return;}copyText(t);toast("已复制负面!");});
  $("btn-export-card").addEventListener("click",exportCard);

  // 键盘快捷键
  document.addEventListener("keydown",function(e){
    if(matchShortcut(e,"undo")){e.preventDefault();undo();}
    else if(matchShortcut(e,"redo")){e.preventDefault();redo();}
    else if(matchShortcut(e,"search")){e.preventDefault();var si2=$("search-input");if(si2)si2.focus();}
    else if(matchShortcut(e,"copy")&&e.target.tagName!=="INPUT"&&e.target.tagName!=="TEXTAREA"){var t=($("prompt-output-en")||{}).value||"";if(t.trim()){copyText(t);toast("已复制!");}}
    else if(matchShortcut(e,"clean")){e.preventDefault();cleanPrompt();}
    else if(e.key==="Delete"&&e.target.tagName!=="INPUT"&&e.target.tagName!=="TEXTAREA"){e.preventDefault();clearAll();}
    else if(e.key==="Escape"){hideFullscreen();}
  });

  updateUndoBtns();updatePreview();updateTabCounts();
}

document.addEventListener("DOMContentLoaded",init);
