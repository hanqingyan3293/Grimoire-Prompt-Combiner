# -*- coding: utf-8 -*-
"""魔导书 - AI绘画提示词组合器 (PyWebView版)"""
import json, os, sys, time, threading
from pathlib import Path
import webview
from flask import Flask, jsonify, request, send_from_directory

# ---- 路径 ----
if getattr(sys, 'frozen', False):
    BASE = Path(sys._MEIPASS)
    RUNTIME = Path(os.path.dirname(sys.executable))
else:
    BASE = Path(__file__).parent
    RUNTIME = BASE

DATA_DIR = BASE / "data"
PRESETS_DIR = RUNTIME / "presets"
HISTORY_DIR = RUNTIME / "history"
CUSTOM_DIR = RUNTIME / "data"

for d in [PRESETS_DIR, HISTORY_DIR, CUSTOM_DIR]:
    d.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(BASE/"static"), static_url_path="")
app.config['JSON_AS_ASCII'] = False

# ---- 工具 ----
def rjson(p, d=None):
    if Path(p).exists():
        with open(p, "r", encoding="utf-8") as f: return json.load(f)
    return d if d is not None else {}

def wjson(p, d):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f: json.dump(d, f, ensure_ascii=False, indent=2)

def merge_tags():
    tags = rjson(DATA_DIR / "tags.json", {"categories":[],"presets":[]})
    custom = rjson(CUSTOM_DIR / "custom_tags.json", {"categories":[]})
    for cc in custom.get("categories", []):
        found = False
        for cat in tags["categories"]:
            if cat["name"] == cc["name"]:
                for csc in cc.get("subcategories", []):
                    sf = False
                    for sc in cat.setdefault("subcategories", []):
                        if sc["name"] == csc["name"]:
                            sc["tags"].extend(csc["tags"]); sf = True; break
                    if not sf: cat["subcategories"].append(csc)
                found = True; break
        if not found: tags["categories"].append(cc)
    return tags

# ---- API路由 (与v2完全相同) ----
@app.route("/")
def index():
    return send_from_directory(str(BASE/"static"), "index.html")

@app.route("/api/tags")
def api_tags():
    return jsonify(merge_tags())

@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").strip().lower()
    if not q: return jsonify([])
    data = merge_tags()
    results = []
    for cat in data["categories"]:
        for sc in cat.get("subcategories", []):
            matches = [t for t in sc["tags"] if q in t["en"].lower() or q in t["zh"].lower()]
            if matches:
                results.append({"category": cat["name"], "subcategory": sc["name"], "tags": matches})
    return jsonify(results)

@app.route("/api/presets")
def api_presets():
    data = merge_tags()
    builtin = data.get("presets", [])
    user = []
    if PRESETS_DIR.exists():
        for f in PRESETS_DIR.glob("*.json"):
            p = rjson(f); p["_filename"] = f.stem; user.append(p)
    return jsonify({"builtin": builtin, "user": user})

@app.route("/api/presets/save", methods=["POST"])
def api_presets_save():
    data = request.get_json()
    name = (data.get("name", "")).strip()
    if not name: return jsonify({"error": "名称不能为空"}), 400
    preset = {"name": name, "tags": data.get("tags", []), "weights": data.get("weights", {}),
              "negative_tags": data.get("negative_tags", []), "negative_weights": data.get("negative_weights", {}),
              "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    safe = "".join(c for c in name if c.isalnum() or c in "._- ")
    wjson(PRESETS_DIR / f"{safe}.json", preset)
    return jsonify({"ok": True})

@app.route("/api/presets/delete/<name>", methods=["DELETE"])
def api_presets_delete(name):
    fp = PRESETS_DIR / f"{name}.json"
    if fp.exists(): fp.unlink(); return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route("/api/presets/export/<name>")
def api_presets_export(name):
    fp = PRESETS_DIR / f"{name}.json"
    if fp.exists(): return jsonify(read_json(fp))
    return jsonify({"error": "not found"}), 404

@app.route("/api/presets/import", methods=["POST"])
def api_presets_import():
    data = request.get_json()
    name = (data.get("name", "")).strip()
    if not name: return jsonify({"error": "invalid"}), 400
    safe = "".join(c for c in name if c.isalnum() or c in "._- ")
    wjson(PRESETS_DIR / f"{safe}.json", data)
    return jsonify({"ok": True})

@app.route("/api/history")
def api_history():
    items = []
    if HISTORY_DIR.exists():
        for f in sorted(HISTORY_DIR.glob("*.json"), reverse=True):
            item = rjson(f); item["_filename"] = f.stem; items.append(item)
    return jsonify(items[:50])

@app.route("/api/history", methods=["POST"])
def api_history_add():
    data = request.get_json()
    prompt = data.get("prompt", "")
    if not prompt: return jsonify({"error": "empty"}), 400
    ts = time.strftime("%Y%m%d_%H%M%S")
    wjson(HISTORY_DIR / f"{ts}.json", {
        "prompt": prompt, "tags": data.get("tags", []),
        "negative_tags": data.get("negative_tags", []),
        "created": time.strftime("%Y-%m-%d %H:%M:%S")
    })
    return jsonify({"ok": True})

@app.route("/api/history/<name>", methods=["DELETE"])
def api_history_delete(name):
    fp = HISTORY_DIR / f"{name}.json"
    if fp.exists(): fp.unlink(); return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route("/api/custom-tags", methods=["GET"])
def api_custom_tags_get():
    return jsonify(rjson(CUSTOM_DIR / "custom_tags.json", {"categories": []}))

@app.route("/api/custom-tags/save", methods=["POST"])
def api_custom_tags_save():
    wjson(CUSTOM_DIR / "custom_tags.json", request.get_json())
    return jsonify({"ok": True})

@app.route("/api/custom-tags/add", methods=["POST"])
def api_custom_tags_add():
    data = request.get_json()
    cn, sn, en, zh = data.get("category",""), data.get("subcategory",""), data.get("en","").strip(), data.get("zh","").strip()
    if not cn or not sn or not en: return jsonify({"error": "参数不完整"}), 400
    custom = rjson(CUSTOM_DIR / "custom_tags.json", {"categories": []})
    cat = next((c for c in custom["categories"] if c["name"] == cn), None)
    if not cat: cat = {"id": "c_"+cn, "name": cn, "subcategories": []}; custom["categories"].append(cat)
    sc = next((s for s in cat["subcategories"] if s["name"] == sn), None)
    if not sc: sc = {"name": sn, "tags": []}; cat["subcategories"].append(sc)
    if any(t["en"] == en for t in sc["tags"]): return jsonify({"error": "标签已存在"}), 400
    sc["tags"].append({"en": en, "zh": zh})
    wjson(CUSTOM_DIR / "custom_tags.json", custom)
    return jsonify({"ok": True})

@app.route("/api/custom-tags/delete", methods=["POST"])
def api_custom_tags_delete():
    data = request.get_json()
    cn, sn, en = data.get("category",""), data.get("subcategory",""), data.get("en","")
    custom = rjson(CUSTOM_DIR / "custom_tags.json", {"categories": []})
    for cat in custom["categories"]:
        if cat["name"] == cn:
            for sc in cat["subcategories"]:
                if sc["name"] == sn:
                    sc["tags"] = [t for t in sc["tags"] if t["en"] != en]
                    wjson(CUSTOM_DIR / "custom_tags.json", custom)
                    return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route("/api/custom-tags/edit", methods=["POST"])
def api_custom_tags_edit():
    data = request.get_json()
    cn, sn, old_en = data.get("category",""), data.get("subcategory",""), data.get("old_en","")
    new_en, new_zh = data.get("new_en","").strip(), data.get("new_zh","").strip()
    custom = rjson(CUSTOM_DIR / "custom_tags.json", {"categories": []})
    for cat in custom["categories"]:
        if cat["name"] == cn:
            for sc in cat["subcategories"]:
                if sc["name"] == sn:
                    for t in sc["tags"]:
                        if t["en"] == old_en:
                            t["en"] = new_en; t["zh"] = new_zh
                            wjson(CUSTOM_DIR / "custom_tags.json", custom)
                            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route("/api/custom-tags/add-category", methods=["POST"])
def api_custom_tags_add_category():
    name = request.get_json().get("name","").strip()
    if not name: return jsonify({"error": "名称不能为空"}), 400
    custom = rjson(CUSTOM_DIR / "custom_tags.json", {"categories": []})
    if any(c["name"] == name for c in custom["categories"]): return jsonify({"error": "大类已存在"}), 400
    custom["categories"].append({"id": "c_"+name, "name": name, "subcategories": []})
    wjson(CUSTOM_DIR / "custom_tags.json", custom)
    return jsonify({"ok": True})

@app.route("/api/custom-tags/add-subcategory", methods=["POST"])
def api_custom_tags_add_subcategory():
    data = request.get_json()
    cn, sn = data.get("category",""), data.get("subcategory","").strip()
    if not cn or not sn: return jsonify({"error": "参数不完整"}), 400
    custom = rjson(CUSTOM_DIR / "custom_tags.json", {"categories": []})
    cat = next((c for c in custom["categories"] if c["name"] == cn), None)
    if not cat: return jsonify({"error": "大类不存在"}), 404
    if any(s["name"] == sn for s in cat["subcategories"]): return jsonify({"error": "子类别已存在"}), 400
    cat["subcategories"].append({"name": sn, "tags": []})
    wjson(CUSTOM_DIR / "custom_tags.json", custom)
    return jsonify({"ok": True})

# ---- 启动 ----
def run_flask():
    app.run(host="127.0.0.1", port=5803, debug=False)

if __name__ == "__main__":
    t = threading.Thread(target=run_flask, daemon=True)
    t.start()
    time.sleep(1)
    webview.create_window("魔导书 - AI绘画提示词组合器", "http://127.0.0.1:5803",
                          width=1400, height=850, min_size=(1000, 600),
                          resizable=True, easy_drag=False)
    webview.start()