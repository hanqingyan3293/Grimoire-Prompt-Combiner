/* ========== 魔导书 v4.1 - 应用逻辑 ========== */

// ===== 全局状态 =====
var S = {
  allData: null, activeCat: null, activeSc: null,
  isSearching: false, posTags: [], autoSortPos: true,
  negTags: [], autoSortNeg: true, activeTab: "pos",
  useQuality: true, favs: {}, tagFreq: {},
  history: [], historyIdx: -1, themeIdx: 0, recOn: false
};
var THEMES = ["dark", "light"];
var QW = ["masterpiece", "best quality"];
var QUICK_NEG = [
  {en:"low quality",zh:"低质量"},{en:"worst quality",zh:"最差质量"},{en:"blurry",zh:"模糊"},
  {en:"bad anatomy",zh:"解剖错误"},{en:"extra fingers",zh:"多余手指"},{en:"missing fingers",zh:"缺失手指"},
  {en:"nsfw",zh:"NSFW"},{en:"watermark",zh:"水印"},{en:"signature",zh:"签名"},{en:"text",zh:"文字"}
];
var CAT_ICONS = {"镜头":"🎥","风格":"🎨","光照":"☀️","色彩":"🌈","构图":"📐","画面":"🖼️","人物":"👤","场景":"🏞️","特效":"✨","姿势":"🧍","表情":"😊","服装":"👗","服饰":"👗","动作":"💃","场景道具":"🏗️","视角":"👁️","材质":"🧱","NSFW":"🔞"};

// ===== 工具 =====
function $(id) { return document.getElementById(id); }
function $$(s, p) { return (p || document).querySelectorAll(s); }
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function toast(msg, type) {
  var t = document.createElement("div"); t.className = "toast";
  t.textContent = msg;
  if (type === "warn") t.classList.add("warn");
  if (type === "error") t.classList.add("error");
  document.body.appendChild(t);
  setTimeout(function(){ t.remove(); }, 2500);
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
function lsGet(k, d) {
  try { var v = localStorage.getItem("grimoire41_"+k); return v ? JSON.parse(v) : d; }
  catch(e) { return d; }
}
function lsSet(k, v) { localStorage.setItem("grimoire41_"+k, JSON.stringify(v)); }

// ===== 历史系统 (PS风格) =====
function pushHistory() {
  S.history = S.history.slice(0, S.historyIdx + 1);
  S.history.push({ pos: JSON.parse(JSON.stringify(S.posTags)), neg: JSON.parse(JSON.stringify(S.negTags)) });
  if (S.history.length > 50) S.history.shift();
  S.historyIdx = S.history.length - 1;
  updateHistoryUI();
  updateUndoBtns();
}
function undo() {
  if (S.historyIdx <= 0) return;
  S.historyIdx--;
  var st = S.history[S.historyIdx];
  S.posTags = JSON.parse(JSON.stringify(st.pos));
  S.negTags = JSON.parse(JSON.stringify(st.neg));
  refreshPanel("pos"); refreshPanel("neg");
  updatePreview(); updateTabCounts();
  if (!S.isSearching) renderGrid();
  updateHistoryUI(); updateUndoBtns();
  toast("撤销 ↩");
}
function redo() {
  if (S.historyIdx >= S.history.length - 1) return;
  S.historyIdx++;
  var st = S.history[S.historyIdx];
  S.posTags = JSON.parse(JSON.stringify(st.pos));
  S.negTags = JSON.parse(JSON.stringify(st.neg));
  refreshPanel("pos"); refreshPanel("neg");
  updatePreview(); updateTabCounts();
  if (!S.isSearching) renderGrid();
  updateHistoryUI(); updateUndoBtns();
  toast("重做 ↪");
}
function jumpToHistory(idx) {
  if (idx < 0 || idx >= S.history.length) return;
  S.historyIdx = idx;
  var st = S.history[idx];
  S.posTags = JSON.parse(JSON.stringify(st.pos));
  S.negTags = JSON.parse(JSON.stringify(st.neg));
  refreshPanel("pos"); refreshPanel("neg");
  updatePreview(); updateTabCounts();
  if (!S.isSearching) renderGrid();
  updateHistoryUI(); updateUndoBtns();
}
function updateHistoryUI() {
  var cont = $("history-states");
  if (!cont) return;
  cont.innerHTML = "";
  for (var i = S.history.length - 1; i >= 0; i--) {
    var st = S.history[i];
    var posCount = st.pos.length;
    var negCount = st.neg.length;
    var desc = "正面"+(posCount||"0")+"个, 负面"+(negCount||"0")+"个";
    var div = document.createElement("div");
    div.className = "history-state-item";
    if (i === S.historyIdx) div.classList.add("current");
    if (i > S.historyIdx) div.classList.add("future");
    div.textContent = "#"+(i+1)+" "+desc;
    (function(idx){ div.addEventListener("click", function(){ jumpToHistory(idx); }); })(i);
    cont.appendChild(div);
  }
}
function updateUndoBtns() {
  var u = $("btn-undo"); var r = $("btn-redo");
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
}
function removeTag(en, panel, skipHistory) {
  if (!skipHistory) pushHistory();
  if (panel === "neg") S.negTags = S.negTags.filter(function(t){return t.en!==en;});
  else S.posTags = S.posTags.filter(function(t){return t.en!==en;});
  updateTabCounts(); refreshPanel(panel); updatePreview();
  if (!S.isSearching) renderGrid();
}
function updateWeight(en, w, panel) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  for (var i = 0; i < a.length; i++) if (a[i].en === en) { a[i].weight = w; break; }
  updatePreview();
}
function clearPos() { pushHistory(); S.posTags = []; refreshPanel("pos"); updatePreview(); updateTabCounts(); toast("已清空正面提示词"); }
function clearNeg() { pushHistory(); S.negTags = []; refreshPanel("neg"); updatePreview(); updateTabCounts(); toast("已清空负面提示词"); }
function clearAll() { pushHistory(); S.posTags = []; S.negTags = []; refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts(); toast("已清空全部标签"); }

print("Part1 OK")
// ===== 提示词生成 =====
function genPrompt(tags) {
  return tags.map(function(t){
    return t.weight === 1.0 ? t.en : "(" + t.en + ":" + t.weight.toFixed(1) + ")";
  }).join(", ");
}
function genPromptCN(tags) {
  return tags.map(function(t){
    return t.weight === 1.0 ? t.zh : "(" + t.zh + ":" + t.weight.toFixed(1) + ")";
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
  var enOut = "";
  var cnOut = "";
  if (S.useQuality && pos.length > 0) enOut = QW.join(", ") + ", " + genPrompt(pos);
  else if (pos.length > 0) enOut = genPrompt(pos);
  if (neg.length > 0) {
    if (enOut) enOut += "\n--neg ";
    enOut += genPrompt(neg);
  }
  if (pos.length > 0) cnOut = genPromptCN(pos);
  if (neg.length > 0) {
    if (cnOut) cnOut += "\n--neg ";
    cnOut += genPromptCN(neg);
  }
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

// ===== 面板标签行渲染 (v3.1风格) =====
function refreshPanel(panel) {
  var a = panel === "neg" ? S.negTags : S.posTags;
  var container = $(panel === "neg" ? "tags-neg" : "tags-pos");
  if (!container) return;
  container.innerHTML = "";
  if (a.length === 0) {
    container.innerHTML = '<div class="empty-hint">'+(panel==="neg"?"右键或Shift+点击标签添加到此处":"点击标签卡片添加")+'</div>';
    return;
  }
  var sorted = a.slice();
  var autoSort = panel === "neg" ? S.autoSortNeg : S.autoSortPos;
  if (autoSort) sorted.sort(function(a,b){ return b.weight - a.weight; });
  for (var i = 0; i < sorted.length; i++) {
    var t = sorted[i];
    var row = document.createElement("div");
    row.className = "tag-row" + (panel === "neg" ? " neg" : "");
    row.innerHTML =
      '<span class="tag-name" title="'+esc(t.zh)+'">'+esc(t.en)+'</span>' +
      '<input type="range" class="weight-slider" min="0.1" max="2.0" step="0.05" value="'+t.weight.toFixed(2)+'" data-en="'+esc(t.en)+'" data-pn="'+panel+'">' +
      '<input type="number" class="weight-val" min="0.1" max="2.0" step="0.1" value="'+t.weight.toFixed(1)+'" data-en="'+esc(t.en)+'" data-pn="'+panel+'">' +
      '<button class="tag-remove" data-en="'+esc(t.en)+'" data-pn="'+panel+'">×</button>';
    container.appendChild(row);
  }
  // bind slider
  var sliders = container.querySelectorAll(".weight-slider");
  for (var j = 0; j < sliders.length; j++) {
    sliders[j].addEventListener("input", function(){
      var w = parseFloat(this.value);
      var row = this.parentElement;
      var valInput = row.querySelector(".weight-val");
      if (valInput) valInput.value = w.toFixed(1);
      updateWeight(w, this.dataset.en, this.dataset.pn);
    });
  }
  // bind number input
  var vals = container.querySelectorAll(".weight-val");
  for (var k = 0; k < vals.length; k++) {
    vals[k].addEventListener("change", function(){
      var w = parseFloat(this.value);
      if (isNaN(w)) w = 1.0;
      w = Math.max(0.1, Math.min(2.0, w));
      this.value = w.toFixed(1);
      var row = this.parentElement;
      var slider = row.querySelector(".weight-slider");
      if (slider) slider.value = w;
      updateWeight(w, this.dataset.en, this.dataset.pn);
    });
  }
  // bind remove
  var removes = container.querySelectorAll(".tag-remove");
  for (var m = 0; m < removes.length; m++) {
    removes[m].addEventListener("click", function(){
      removeTag(this.dataset.en, this.dataset.pn);
    });
  }
  updateTabCounts();
}

// ===== 标签网格 (中文显眼) =====
function renderGrid() {
  var grid = $("tag-grid");
  var title = $("canvas-title");
  if (!grid) return;
  grid.innerHTML = "";
  $("btn-select-all").style.display = "none";
  $("btn-clear-page").style.display = "none";
  $("rec-toggle").style.display = "none";
  if (!S.allData) { grid.innerHTML = '<div class="empty-hint">加载中...</div>'; return; }
  if (S.isSearching) { renderSearchResults(); return; }
  if (!S.activeCat || !S.activeSc) {
    if (title) title.textContent = "选择一个子类别开始";
    grid.innerHTML = '<div class="empty-hint">👈 从左侧分类中选择子类别</div>';
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
  if (title) title.textContent = (S.activeCat||"") + " › " + (S.activeSc||"") + " ("+tags.length+"个)";
  $("btn-select-all").style.display = tags.length > 0 ? "" : "none";
  $("btn-clear-page").style.display = tags.length > 0 ? "" : "none";
  $("rec-toggle").style.display = tags.length > 0 ? "" : "none";
  $("rec-toggle").style.background = S.recOn ? "var(--accent)" : "";

  for (var i = 0; i < tags.length; i++) {
    var t = tags[i];
    var card = document.createElement("div");
    card.className = "tag-card";
    if (isSelected(t.en, "pos")) card.classList.add("selected-pos");
    if (isSelected(t.en, "neg")) card.classList.add("selected-neg");
    var isFaved = S.favs[t.en];
    card.innerHTML =
      '<div class="tag-zh">'+esc(t.zh)+'</div>' +
      '<div class="tag-en">'+esc(t.en)+'</div>' +
      '<button class="tag-star'+(isFaved?" faved":"")+'" data-en="'+esc(t.en)+'">'+(isFaved?"★":"☆")+'</button>';

    card.addEventListener("click", function(e){
      if (e.target.classList.contains("tag-star")) return;
      var en = this.querySelector(".tag-en").textContent;
      var zh = this.querySelector(".tag-zh").textContent;
      if (e.shiftKey) {
        if (isSelected(en, "neg")) removeTag(en, "neg"); else addTag(en, zh, "neg");
      } else {
        if (isSelected(en, "pos")) removeTag(en, "pos"); else addTag(en, zh, "pos");
      }
    });
    card.addEventListener("contextmenu", function(e){
      e.preventDefault();
      var en = this.querySelector(".tag-en").textContent;
      var zh = this.querySelector(".tag-zh").textContent;
      if (isSelected(en, "neg")) removeTag(en, "neg"); else addTag(en, zh, "neg");
    });
    // star button
    card.querySelector(".tag-star").addEventListener("click", function(e){
      e.stopPropagation();
      var en2 = this.dataset.en;
      toggleFav(en2);
      renderGrid();
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
    $("btn-select-all").style.display = "none";
    $("btn-clear-page").style.display = "none";
    $("rec-toggle").style.display = "none";
    var total = 0;
    for (var i = 0; i < results.length; i++) {
      var r = results[i]; total += r.tags.length;
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
        var isFaved = S.favs[t.en];
        card.innerHTML =
          '<div class="tag-zh">'+esc(t.zh)+'</div>' +
          '<div class="tag-en">'+esc(t.en)+'</div>' +
          '<button class="tag-star'+(isFaved?" faved":"")+'" data-en="'+esc(t.en)+'">'+(isFaved?"★":"☆")+'</button>';
        (function(en,zh){
          card.addEventListener("click", function(e){
            if (e.target.classList.contains("tag-star")) return;
            if (e.shiftKey) { if (isSelected(en,"neg")) removeTag(en,"neg"); else addTag(en,zh,"neg"); }
            else { if (isSelected(en,"pos")) removeTag(en,"pos"); else addTag(en,zh,"pos"); }
          });
          card.querySelector(".tag-star").addEventListener("click", function(e2){
            e2.stopPropagation(); toggleFav(en); renderGrid();
          });
        })(t.en, t.zh);
        grid.appendChild(card);
      }
    }
    if (title) title.textContent = "🔍 搜索: "+esc(q)+" ("+total+"个)";
    if (info) { info.style.display = ""; info.textContent = "共 "+total+" 个结果"; }
  });
}

print("Part2 OK")
// ===== 分类树 (含CRUD按钮) =====
function renderCategoryTree() {
  var tree = $("category-tree");
  if (!tree || !S.allData) return;
  tree.innerHTML = "";
  var custom = lsGet("custom_cats", {});
  for (var ci = 0; ci < S.allData.categories.length; ci++) {
    var c = S.allData.categories[ci];
    var catDiv = document.createElement("div");
    catDiv.className = "cat-group";
    var icon = CAT_ICONS[c.name] || "📌";
    var isExpanded = (custom[c.name]&&custom[c.name].expanded);
    catDiv.innerHTML =
      '<div class="cat-head">' +
        '<span class="cat-arrow">'+(isExpanded?"▼":"▶")+'</span>' +
        '<span>'+icon+'</span>' +
        '<span class="cat-name">'+esc(c.name)+' ('+(c.subcategories||[]).length+')</span>' +
        '<button class="cat-btn" data-cat="'+esc(c.name)+'" title="添加子类">＋</button>' +
      '</div>' +
      '<div class="cat-subs"'+(isExpanded?' style="display:block"':'')+'></div>';
    
    var subsDiv = catDiv.querySelector(".cat-subs");
    for (var si = 0; si < (c.subcategories||[]).length; si++) {
      var sc = c.subcategories[si];
      var subItem = document.createElement("div");
      subItem.className = "sub-item";
      if (S.activeCat === c.name && S.activeSc === sc.name) subItem.classList.add("active");
      subItem.innerHTML =
        '<span class="sub-name">'+esc(sc.name)+' ('+(sc.tags||[]).length+')</span>' +
        '<button class="sub-btn" data-cat="'+esc(c.name)+'" data-sub="'+esc(sc.name)+'" title="添加标签">＋</button>' +
        '<button class="sub-btn del" data-cat="'+esc(c.name)+'" data-sub="'+esc(sc.name)+'" title="删除子类">✕</button>';
      (function(cn,sn){
        subItem.querySelector(".sub-name").addEventListener("click", function(){
          S.activeCat = cn; S.activeSc = sn; S.isSearching = false;
          $("search-input").value = ""; $("btn-search-clear").style.display = "none";
          renderCategoryTree(); renderGrid();
        });
      })(c.name, sc.name);
      // 添加标签按钮
      subItem.querySelector(".sub-btn:not(.del)").addEventListener("click", function(e){
        e.stopPropagation();
        openTagForm(this.dataset.cat, this.dataset.sub);
      });
      // 删除子类按钮
      subItem.querySelector(".sub-btn.del").addEventListener("click", function(e){
        e.stopPropagation();
        if (confirm("确定删除子类 "+this.dataset.sub+" 吗？")) {
          api("/api/custom-tags/delete-subcategory", {method:"POST", body:{category:this.dataset.cat, subcategory:this.dataset.sub}})
            .then(function(r){ if(r.ok){ toast("已删除"); loadTags(); } else toast(r.error||"删除失败","error"); });
        }
      });
      subsDiv.appendChild(subItem);
    }
    // 添加子类按钮
    catDiv.querySelector(".cat-btn").addEventListener("click", function(e){
      e.stopPropagation();
      openNewSc(this.dataset.cat);
    });
    // 点击大类名展开/折叠
    catDiv.querySelector(".cat-head").addEventListener("click", function(e){
      if (e.target.classList.contains("cat-btn")) return;
      var subs = this.nextElementSibling;
      var arrow = this.querySelector(".cat-arrow");
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
function toggleFav(en) {
  if (S.favs[en]) { delete S.favs[en]; } else { S.favs[en] = Date.now(); }
  saveFavs(); renderFavList();
}
function renderFavList() {
  var list = $("fav-list");
  var count = $("fav-count");
  if (!list) return;
  list.innerHTML = "";
  var keys = Object.keys(S.favs);
  if (count) count.textContent = keys.length > 0 ? "("+keys.length+")" : "";
  if (keys.length === 0) { list.innerHTML = '<div class="empty-hint" style="padding:6px;font-size:10px">暂无收藏</div>'; return; }
  // 按分类分组
  var grouped = {};
  for (var i = 0; i < keys.length; i++) {
    var en = keys[i];
    var info = findTagInfo(en);
    var cat = info.cat || "未分类";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({en:en, zh:info.zh||en});
  }
  var catNames = Object.keys(grouped).sort();
  for (var ci = 0; ci < catNames.length; ci++) {
    var cn = catNames[ci];
    var catHead = document.createElement("div");
    catHead.className = "sidebar-label";
    catHead.textContent = (CAT_ICONS[cn]||"📌")+" "+cn;
    list.appendChild(catHead);
    for (var ti = 0; ti < grouped[cn].length; ti++) {
      var t = grouped[cn][ti];
      var item = document.createElement("div");
      item.className = "mini-list-item";
      item.innerHTML = '<span>⭐ '+esc(t.zh)+'</span><span style="font-size:9px;color:var(--muted);margin-left:4px">'+esc(t.en)+'</span><button class="item-del" data-en="'+esc(t.en)+'">✕</button>';
      item.querySelector("span").addEventListener("click", function(){
        var en2 = this.nextElementSibling ? this.nextElementSibling.textContent : this.parentElement.querySelector(".item-del").dataset.en;
        addTag(en2, null, S.activeTab === "neg" ? "neg" : "pos");
      });
      item.querySelector(".item-del").addEventListener("click", function(e){
        e.stopPropagation(); toggleFav(this.dataset.en);
      });
      list.appendChild(item);
    }
  }
}

// ===== 常用标签 =====
function renderFreqTags() {
  var cont = $("freq-tags");
  if (!cont) return;
  cont.innerHTML = "";
  var sorted = Object.keys(S.tagFreq).sort(function(a,b){return S.tagFreq[b]-S.tagFreq[a];}).slice(0,10);
  for (var i = 0; i < sorted.length; i++) {
    var en = sorted[i];
    var span = document.createElement("span");
    span.className = "freq-tag";
    span.textContent = en;
    span.title = "使用 "+S.tagFreq[en]+" 次";
    span.addEventListener("click", function(){ addTag(this.textContent, null, S.activeTab==="neg"?"neg":"pos"); });
    cont.appendChild(span);
  }
}

// ===== 预设 =====
function loadPresets() {
  api("/api/presets").then(function(d){
    var list = $("presets-list");
    if (!list) return;
    list.innerHTML = "";
    var all = (d.builtin||[]).concat(d.user||[]);
    if (all.length === 0) { list.innerHTML = '<div class="empty-hint" style="padding:4px;font-size:10px">暂无</div>'; }
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      var item = document.createElement("div");
      item.className = "mini-list-item";
      item.textContent = "📦 " + p.name;
      item.addEventListener("click", function(){ applyPreset(this._preset); });
      item._preset = p;
      list.appendChild(item);
    }
    var btns = document.createElement("div");
    btns.style.cssText = "display:flex;gap:4px;margin-top:4px";
    btns.innerHTML = '<button id="btn-save-preset" class="mini-btn">💾 保存</button><button id="btn-import-preset" class="mini-btn">📥 导入</button>';
    list.appendChild(btns);
    setTimeout(function(){
      var sb = $("btn-save-preset"); if (sb) sb.addEventListener("click", showSavePreset);
      var ib = $("btn-import-preset"); if (ib) ib.addEventListener("click", showImportPreset);
    }, 50);
  });
}
function applyPreset(p) {
  pushHistory();
  S.posTags = []; S.negTags = [];
  var tags = p.tags||[], w = p.weights||{};
  for (var i=0;i<tags.length;i++){
    var en=tags[i], info=findTagInfo(en);
    S.posTags.push({en:en,zh:info.zh||en,weight:w[en]||1.0,category:info.cat||"",subcategory:info.sc||""});
  }
  var nt=p.negative_tags||[], nw=p.negative_weights||{};
  for (var j=0;j<nt.length;j++){
    var en2=nt[j], info2=findTagInfo(en2);
    S.negTags.push({en:en2,zh:info2.zh||en2,weight:nw[en2]||1.0,category:info2.cat||"",subcategory:info2.sc||""});
  }
  refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts(); updateHistoryUI();
  toast("已加载: "+p.name);
}
function showSavePreset() {
  if (S.posTags.length===0 && S.negTags.length===0) { toast("请先选择标签","warn"); return; }
  modal('<h3>💾 保存预设</h3><input id="pf-name" placeholder="名称..."><div class="modal-btns"><button id="pf-save" class="tb-btn primary">保存</button><button id="pf-cancel" class="tb-btn">取消</button></div>');
  $("pf-cancel").addEventListener("click", closeModal);
  $("pf-save").addEventListener("click", function(){
    var nm=($("pf-name")||{}).value.trim(); if(!nm){toast("请输入名称","warn");return;}
    var w={}; S.posTags.forEach(function(t){w[t.en]=t.weight;});
    var nw={}; S.negTags.forEach(function(t){nw[t.en]=t.weight;});
    api("/api/presets/save",{method:"POST",body:{name:nm,tags:S.posTags.map(function(t){return t.en}),weights:w,negative_tags:S.negTags.map(function(t){return t.en}),negative_weights:nw}})
      .then(function(r){if(r.ok){toast("已保存");closeModal();loadPresets();loadSavedList();}else toast(r.error,"error");});
  });
}
function showImportPreset() {
  modal('<h3>📥 导入预设</h3><textarea id="pf-json" placeholder="粘贴JSON..."></textarea><div class="modal-btns"><button id="pf-import" class="tb-btn primary">导入</button><button id="pf-cancel2" class="tb-btn">取消</button></div>');
  $("pf-cancel2").addEventListener("click", closeModal);
  $("pf-import").addEventListener("click", function(){
    var t=($("pf-json")||{}).value.trim(); if(!t)return;
    try{var d=JSON.parse(t); if(!d.name){toast("缺少名称","warn");return;}
      api("/api/presets/import",{method:"POST",body:d}).then(function(r){if(r.ok){toast("已导入");closeModal();loadPresets();loadSavedList();}else toast(r.error,"error");});
    }catch(e){toast("JSON格式错误","error");}
  });
}
function loadSavedList() {
  api("/api/presets").then(function(d){
    var list=$("saved-list"); if(!list)return;
    list.innerHTML="";
    var user=d.user||[];
    if(user.length===0){list.innerHTML='<div class="empty-hint" style="padding:4px;font-size:10px">暂无</div>';return;}
    for(var i=0;i<user.length;i++){var p=user[i];var item=document.createElement("div");item.className="mini-list-item";
      item.innerHTML='<span>💾 '+esc(p.name)+'</span><button class="item-del" data-name="'+esc(p._filename)+'">✕</button>';
      item.querySelector("span").addEventListener("click",function(){applyPreset(this._preset);});item._preset=p;
      item.querySelector(".item-del").addEventListener("click",function(e){e.stopPropagation();
        api("/api/presets/delete/"+this.dataset.name,{method:"DELETE"}).then(function(r){if(r.ok){toast("已删除");loadSavedList();loadPresets();}else toast(r.error,"error");});
      });
      list.appendChild(item);
    }
  });
}

print("Part3 OK")
// ===== 版本快照 =====
function saveSnapshot() {
  if (S.posTags.length===0 && S.negTags.length===0) { toast("没有可保存的标签","warn"); return; }
  api("/api/snapshots/save", {method:"POST", body:{name:"快照", pos_tags:S.posTags, neg_tags:S.negTags}}).then(function(r){
    if (r.ok) { toast("快照已保存"); loadSnapshots(); } else toast(r.error,"error");
  });
}
function loadSnapshots() {
  api("/api/snapshots").then(function(items){
    var list = $("snapshot-list"); if (!list) return;
    list.innerHTML = "";
    if (items.length === 0) { list.innerHTML = '<div class="empty-hint" style="padding:6px;font-size:10px">暂无快照</div>'; return; }
    for (var i = 0; i < items.length; i++) {
      var s = items[i];
      var item = document.createElement("div");
      item.className = "snapshot-item";
      item.innerHTML =
        '<span>📸 '+esc(s.name||"快照")+' ('+s.pos_tags.length+'/'+s.neg_tags.length+')</span>' +
        '<span class="snap-time">'+esc((s.created||"").substring(11))+'</span>' +
        '<span class="snap-actions">' +
          '<button class="snap-restore" data-id="'+s._id+'" title="恢复">↩</button>' +
          '<button class="snap-del" data-id="'+s._id+'" title="删除">✕</button>' +
        '</span>';
      // restore
      item.querySelector(".snap-restore").addEventListener("click", function(e){
        e.stopPropagation();
        var sid = this.dataset.id;
        api("/api/snapshots").then(function(all){
          for (var j=0;j<all.length;j++){if(all[j]._id===sid){
            pushHistory();
            S.posTags = JSON.parse(JSON.stringify(all[j].pos_tags));
            S.negTags = JSON.parse(JSON.stringify(all[j].neg_tags));
            refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts(); updateHistoryUI();
            toast("已恢复快照"); return;
          }}
        });
      });
      // delete
      item.querySelector(".snap-del").addEventListener("click", function(e){
        e.stopPropagation();
        if (confirm("删除此快照？")) {
          api("/api/snapshots/"+this.dataset.id, {method:"DELETE"}).then(function(r){
            if(r.ok){ toast("已删除"); loadSnapshots(); } else toast(r.error,"error");
          });
        }
      });
      list.appendChild(item);
    }
  });
}

// ===== 随机 =====
function randomTags() {
  if (!S.allData) { toast("数据加载中...","warn"); return; }
  pushHistory();
  S.posTags = []; S.negTags = [];
  var aa = [];
  for (var ci = 0; ci < (S.allData.categories||[]).length; ci++) {
    var c = S.allData.categories[ci];
    if (c.name === "NSFW" || c.name === "NSFW标签") continue;
    for (var si = 0; si < (c.subcategories||[]).length; si++) {
      var sc = c.subcategories[si];
      for (var ti = 0; ti < (sc.tags||[]).length; ti++) {
        var t = sc.tags[ti];
        aa.push({en:t.en,zh:t.zh,category:c.name,subcategory:sc.name});
      }
    }
  }
  var cnt = Math.floor(Math.random()*8)+3;
  var pk = [], seen2 = {};
  while (pk.length < cnt && aa.length > 0) {
    var idx = Math.floor(Math.random()*aa.length);
    var t2 = aa[idx];
    if (!seen2[t2.en]) { seen2[t2.en]=true; pk.push({en:t2.en,zh:t2.zh,weight:Math.round((Math.random()*0.5+1.0)*10)/10,category:t2.category,subcategory:t2.subcategory}); }
    aa.splice(idx,1);
  }
  S.posTags = pk;
  refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts(); updateHistoryUI();
  if (!S.isSearching) renderGrid();
  toast("🎲 随机生成 "+pk.length+" 个标签");
}

// ===== 清洗 =====
function cleanPrompt() {
  var changed = false;
  var seen={}, newPos=[];
  for(var i=0;i<S.posTags.length;i++){var t=S.posTags[i];var k=t.en.toLowerCase();if(!seen[k]){seen[k]=true;newPos.push(t);}else changed=true;}
  var seen2={}, newNeg=[];
  for(var j=0;j<S.negTags.length;j++){var t2=S.negTags[j];var k2=t2.en.toLowerCase();if(!seen2[k2]){seen2[k2]=true;newNeg.push(t2);}else changed=true;}
  if (changed) pushHistory();
  S.posTags=newPos; S.negTags=newNeg;
  refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts(); updateHistoryUI();
  if (!S.isSearching) renderGrid();
  toast(changed ? "已清洗：去除重复标签" : "提示词已干净");
}

// ===== 导出卡片 =====
function exportCard() {
  var pos=getSorted("pos"), neg=getSorted("neg");
  if (pos.length===0&&neg.length===0){toast("没有标签可导出","warn");return;}
  var c=document.createElement("canvas");c.width=800;c.height=Math.max(200,80+pos.length*26+neg.length*26+80);
  var ctx=c.getContext("2d");
  ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--bg").trim()||"#1a1b23";
  ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle="#e1e1f0";ctx.font="bold 18px sans-serif";ctx.fillText("魔导书 v4.1",20,36);
  var y=66;
  if(pos.length>0){ctx.fillStyle="#7c6ff7";ctx.font="bold 13px sans-serif";ctx.fillText("正面提示词:",20,y);y+=22;
    ctx.fillStyle="#e1e1f0";ctx.font="12px monospace";
    for(var i=0;i<pos.length;i++){var t=pos[i];ctx.fillText((t.weight!==1.0?"("+t.en+":"+t.weight.toFixed(1)+")":t.en),28,y);y+=22;}}
  if(neg.length>0){y+=6;ctx.fillStyle="#e0556a";ctx.font="bold 13px sans-serif";ctx.fillText("负面提示词:",20,y);y+=22;
    ctx.fillStyle="#e1e1f0";ctx.font="12px monospace";
    for(var j=0;j<neg.length;j++){var t2=neg[j];ctx.fillText((t2.weight!==1.0?"("+t2.en+":"+t2.weight.toFixed(1)+")":t2.en),28,y);y+=22;}}
  var a=document.createElement("a");a.download="grimoire41-"+Date.now()+".png";a.href=c.toDataURL("image/png");a.click();
  toast("已导出PNG卡片!");
}

// ===== 主题 =====
function initTheme() {
  var saved = localStorage.getItem("grimoire41_theme") || "dark";
  S.themeIdx = THEMES.indexOf(saved);
  if (S.themeIdx < 0) S.themeIdx = 0;
  document.documentElement.setAttribute("data-theme", THEMES[S.themeIdx]);
  updateThemeBtn();
}
function cycleTheme() {
  S.themeIdx = (S.themeIdx + 1) % THEMES.length;
  var t = THEMES[S.themeIdx];
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("grimoire41_theme", t);
  updateThemeBtn();
  toast("主题: "+(t==="dark"?"暗色":"亮色"));
}
function updateThemeBtn() {
  var btn = $("btn-theme");
  if (btn) btn.textContent = THEMES[S.themeIdx] === "dark" ? "🌙" : "☀️";
}

// ===== 快速负面 =====
function renderQuickNeg() {
  var cont = $("quick-neg");
  if (!cont) return;
  cont.innerHTML = '<span class="quick-label">⚡ 快速负面词：</span>';
  for (var i = 0; i < QUICK_NEG.length; i++) {
    var q = QUICK_NEG[i];
    var chip = document.createElement("span");
    chip.className = "quick-chip";
    if (isSelected(q.en, "neg")) chip.classList.add("active");
    chip.textContent = q.zh;
    (function(en){
      chip.addEventListener("click", function(){
        if (isSelected(en, "neg")) removeTag(en, "neg"); else addTag(en, null, "neg");
        renderQuickNeg();
      });
    })(q.en);
    cont.appendChild(chip);
  }
}

// ===== 推荐 =====
function toggleRecommend() {
  S.recOn = !S.recOn;
  $("rec-toggle").style.background = S.recOn ? "var(--accent)" : "";
  if (S.recOn) {
    api("/api/recommend", {method:"POST", body:{tags:S.posTags.map(function(t){return t.en;})}}).then(function(r){
      showRecs(r);
    });
  } else {
    var bar = $("rec-bar"); if (bar) bar.remove();
  }
}
function showRecs(recs) {
  var old = $("rec-bar"); if (old) old.remove();
  if (!recs || recs.length === 0) return;
  var bar = document.createElement("div"); bar.id = "rec-bar"; bar.className = "rec-bar";
  bar.innerHTML = '<span class="rec-label">💡 推荐:</span>';
  for (var i = 0; i < Math.min(recs.length, 10); i++) {
    var r = recs[i];
    var chip = document.createElement("span"); chip.className = "rec-chip"; chip.textContent = r.en; chip.title = r.zh;
    chip.addEventListener("click", function(){ addTag(this.textContent, this.title, S.activeTab==="neg"?"neg":"pos"); });
    bar.appendChild(chip);
  }
  $("canvas").insertBefore(bar, $("tag-grid"));
}

// ===== CRUD 模态 =====
function modal(html) {
  var root = $("modal-root"); if (!root) return;
  root.innerHTML = '<div class="modal-overlay" id="modal-over"><div class="modal-box">'+html+'</div></div>';
  root.style.display = "";
  $("modal-over").addEventListener("click", function(e){ if (e.target === this) closeModal(); });
}
function closeModal() { var r=$("modal-root"); if(r){r.innerHTML="";r.style.display="none";} }

function openNewCat() {
  modal('<h3>新建大类</h3><input id="ncat-name" placeholder="大类名称..." autofocus><div class="modal-btns"><button id="ncat-ok" class="tb-btn primary">创建</button><button id="ncat-cancel" class="tb-btn">取消</button></div>');
  $("ncat-cancel").addEventListener("click", closeModal);
  $("ncat-ok").addEventListener("click", function(){
    var n = ($("ncat-name")||{}).value.trim(); if(!n){toast("请输入名称","warn");return;}
    api("/api/custom-tags/add-category", {method:"POST", body:{name:n}}).then(function(r){
      if(r.ok){toast("已添加: "+n);closeModal();loadTags();}else toast(r.error,"error");
    });
  });
}
function openNewSc(catName) {
  modal('<h3>新建子类</h3><input value="'+esc(catName)+'" readonly><input id="nsc-name" placeholder="子类名称..." autofocus><div class="modal-btns"><button id="nsc-ok" class="tb-btn primary">创建</button><button id="nsc-cancel" class="tb-btn">取消</button></div>');
  $("nsc-cancel").addEventListener("click", closeModal);
  $("nsc-ok").addEventListener("click", function(){
    var sn = ($("nsc-name")||{}).value.trim(); if(!sn){toast("请输入名称","warn");return;}
    api("/api/custom-tags/add-subcategory", {method:"POST", body:{category:catName, subcategory:sn}}).then(function(r){
      if(r.ok){toast("已添加: "+sn);closeModal();loadTags();}else toast(r.error,"error");
    });
  });
}
function openTagForm(catName, scName) {
  modal('<h3>添加标签</h3><input value="'+esc(catName)+' > '+esc(scName)+'" readonly><input id="tf-en" placeholder="英文标签..." autofocus><input id="tf-zh" placeholder="中文标签..."><div class="modal-btns"><button id="tf-ok" class="tb-btn primary">添加</button><button id="tf-cancel" class="tb-btn">取消</button></div>');
  $("tf-cancel").addEventListener("click", closeModal);
  $("tf-ok").addEventListener("click", function(){
    var en = ($("tf-en")||{}).value.trim();
    var zh = ($("tf-zh")||{}).value.trim();
    if (!en){toast("请输入英文标签","warn");return;}
    api("/api/custom-tags/add", {method:"POST", body:{category:catName, subcategory:scName, en:en, zh:zh}}).then(function(r){
      if(r.ok){toast("已添加: "+en);closeModal();loadTags();}else toast(r.error,"error");
    });
  });
}

function showShortcuts() {
  modal('<h3>⌨ 快捷键</h3><div style="font-size:12px;line-height:2">Ctrl+Z — 撤销<br>Ctrl+Y — 重做<br>Ctrl+K — 搜索<br>Shift+点击 — 添加到负面<br>右键 — 添加到负面<br>Delete — 清空全部<br>Shift+C — 清洗</div><div class="modal-btns"><button id="sk-close" class="tb-btn primary">关闭</button></div>');
  $("sk-close").addEventListener("click", closeModal);
}

// ===== 数据加载 =====
function loadTags() {
  api("/api/tags").then(function(d){
    S.allData = d;
    renderCategoryTree(); renderGrid(); renderQuickNeg();
    loadPresets(); loadSavedList(); loadSnapshots();
    renderFreqTags(); renderFavList();
  });
}

// ===== 初始化 =====
function init() {
  loadFavs(); loadFreq(); initTheme(); loadTags();

  // 初始化历史
  pushHistory();

  // 搜索
  var si = $("search-input");
  if (si) {
    si.addEventListener("input", function(){
      S.isSearching = this.value.trim().length > 0;
      $("btn-search-clear").style.display = S.isSearching ? "" : "none";
      if (S.isSearching) renderSearchResults(); else renderGrid();
    });
    si.addEventListener("focus", function(){ this.select(); });
  }
  var sc = $("btn-search-clear");
  if (sc) sc.addEventListener("click", function(){ si.value=""; S.isSearching=false; this.style.display="none"; renderGrid(); });

  // 面板标签切换
  var tabs = $$(".panel-tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function(){
      var tab = this.dataset.tab;
      S.activeTab = tab;
      for (var j=0;j<tabs.length;j++) tabs[j].classList.remove("active");
      this.classList.add("active");
      $("ws-pos").style.display = tab === "pos" ? "" : "none";
      $("ws-neg").style.display = tab === "neg" ? "" : "none";
      $("quick-neg").style.display = tab === "neg" ? "" : "none";
    });
  }

  // 自动排序
  var aspos = $("auto-sort-pos"); if (aspos) aspos.addEventListener("change", function(){ S.autoSortPos=this.checked; refreshPanel("pos"); updatePreview(); });
  var asneg = $("auto-sort-neg"); if (asneg) asneg.addEventListener("change", function(){ S.autoSortNeg=this.checked; refreshPanel("neg"); updatePreview(); });

  // 工具栏
  var bq = $("btn-quality"); if (bq) bq.addEventListener("click", function(){ S.useQuality=!S.useQuality; if(S.useQuality)this.classList.add("active");else this.classList.remove("active");updatePreview(); });
  var bc = $("btn-clean"); if (bc) bc.addEventListener("click", cleanPrompt);
  var br = $("btn-random"); if (br) br.addEventListener("click", randomTags);
  var bca = $("btn-clear-all"); if (bca) bca.addEventListener("click", clearAll);
  var bcp = $("btn-clear-pos"); if (bcp) bcp.addEventListener("click", clearPos);
  var bcn = $("btn-clear-neg"); if (bcn) bcn.addEventListener("click", clearNeg);
  var bu = $("btn-undo"); if (bu) bu.addEventListener("click", undo);
  var brd = $("btn-redo"); if (brd) brd.addEventListener("click", redo);
  var bt = $("btn-theme"); if (bt) bt.addEventListener("click", cycleTheme);
  var bsk = $("btn-shortcuts"); if (bsk) bsk.addEventListener("click", showShortcuts);

  // 全选/清空当前页
  var bsa = $("btn-select-all");
  if (bsa) bsa.addEventListener("click", function(){
    if (S.isSearching||!S.activeCat||!S.activeSc) return;
    pushHistory();
    for (var ci=0;ci<S.allData.categories.length;ci++){
      var c=S.allData.categories[ci]; if(c.name!==S.activeCat) continue;
      for (var si2=0;si2<(c.subcategories||[]).length;si2++){
        var sc2=c.subcategories[si2]; if(sc2.name!==S.activeSc) continue;
        for (var ti=0;ti<(sc2.tags||[]).length;ti++){
          var t=sc2.tags[ti]; if(!isSelected(t.en,"pos")) addTag(t.en,t.zh,"pos",true);
        }
        break;
      }
      break;
    }
    refreshPanel("pos"); updatePreview(); updateTabCounts(); updateHistoryUI(); renderGrid();
    toast("已全选当前子类别");
  });
  var bclp = $("btn-clear-page");
  if (bclp) bclp.addEventListener("click", function(){
    if (S.isSearching||!S.activeCat||!S.activeSc) return;
    pushHistory();
    for (var ci=0;ci<S.allData.categories.length;ci++){
      var c=S.allData.categories[ci]; if(c.name!==S.activeCat) continue;
      for (var si2=0;si2<(c.subcategories||[]).length;si2++){
        var sc2=c.subcategories[si2]; if(sc2.name!==S.activeSc) continue;
        for (var ti=0;ti<(sc2.tags||[]).length;ti++){
          var t=sc2.tags[ti];
          if(isSelected(t.en,"pos")) removeTag(t.en,"pos",true);
          if(isSelected(t.en,"neg")) removeTag(t.en,"neg",true);
        }
        break;
      }
      break;
    }
    refreshPanel("pos"); refreshPanel("neg"); updatePreview(); updateTabCounts(); updateHistoryUI(); renderGrid();
    toast("已清空当前子类别");
  });

  // 推荐
  var rec = $("rec-toggle"); if (rec) rec.addEventListener("click", toggleRecommend);

  // 快照
  var bss = $("btn-save-snapshot"); if (bss) bss.addEventListener("click", saveSnapshot);

  // 添加大类
  var bac = $("btn-add-cat"); if (bac) bac.addEventListener("click", openNewCat);

  // 收藏切换
  var ft = $("fav-toggle"); if (ft) ft.addEventListener("click", function(){
    var list=$("fav-list"); if(list)list.style.display=list.style.display==="none"?"":"none";
  });

  // 复制
  var bcpy=$("btn-copy");if(bcpy)bcpy.addEventListener("click",function(){
    var t=($("prompt-output-en")||{}).value||"";if(!t.trim()){toast("没有可复制的内容","warn");return;}
    copyText(t);toast("已复制英文提示词!");
    api("/api/history",{method:"POST",body:{prompt:t,tags:S.posTags.map(function(x){return x.en}),negative_tags:S.negTags.map(function(x){return x.en})}}).then(function(){});
  });
  var bcpycn=$("btn-copy-cn");if(bcpycn)bcpycn.addEventListener("click",function(){
    var t=($("prompt-output-cn")||{}).value||"";if(!t.trim()){toast("没有可复制的内容","warn");return;}copyText(t);toast("已复制中文提示词!");
  });
  var bcpyp=$("btn-copy-pos");if(bcpyp)bcpyp.addEventListener("click",function(){
    var p=getSorted("pos");var t=S.useQuality&&p.length>0?QW.join(", ")+", "+genPrompt(p):genPrompt(p);
    if(!t.trim()){toast("没有正面提示词","warn");return;}copyText(t);toast("已复制正面提示词");
  });
  var bcpyn=$("btn-copy-neg");if(bcpyn)bcpyn.addEventListener("click",function(){
    var n=getSorted("neg");var t=genPrompt(n);if(!t.trim()){toast("没有负面提示词","warn");return;}copyText(t);toast("已复制负面提示词");
  });

  // 导出卡片
  var bec=$("btn-export-card");if(bec)bec.addEventListener("click",exportCard);

  // 键盘快捷键
  document.addEventListener("keydown", function(e){
    if(e.ctrlKey&&e.key==="z"){e.preventDefault();undo();}
    else if(e.ctrlKey&&e.key==="y"){e.preventDefault();redo();}
    else if(e.ctrlKey&&e.key==="k"){e.preventDefault();var si2=$("search-input");if(si2)si2.focus();}
    else if(e.ctrlKey&&e.key==="c"&&e.target.tagName!=="INPUT"&&e.target.tagName!=="TEXTAREA"){
      var t=($("prompt-output-en")||{}).value||"";if(t.trim()){copyText(t);toast("已复制!");}
    }
    else if(e.key==="Delete"&&e.target.tagName!=="INPUT"&&e.target.tagName!=="TEXTAREA"){e.preventDefault();clearAll();}
    else if(e.shiftKey&&e.key==="C"){e.preventDefault();cleanPrompt();}
  });

  updateUndoBtns(); updatePreview(); updateTabCounts();
}

document.addEventListener("DOMContentLoaded", init);
