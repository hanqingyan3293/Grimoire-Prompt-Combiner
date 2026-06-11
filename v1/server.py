# -*- coding: utf-8 -*-
"""魔导书 - AI绘画提示词组合器 后端服务"""

import json
import os
import time
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="")

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
PRESETS_DIR = BASE_DIR / "presets"
HISTORY_DIR = BASE_DIR / "history"
TAGS_FILE = DATA_DIR / "tags.json"
CUSTOM_TAGS_FILE = DATA_DIR / "custom_tags.json"

# 确保目录存在
for d in [DATA_DIR, PRESETS_DIR, HISTORY_DIR]:
    d.mkdir(parents=True, exist_ok=True)


def load_tags():
    """加载合并后的标签数据(原始+自定义)"""
    tags = {"categories": [], "presets": []}
    if TAGS_FILE.exists():
        with open(TAGS_FILE, "r", encoding="utf-8") as f:
            tags = json.load(f)
    # 合并自定义标签
    if CUSTOM_TAGS_FILE.exists():
        with open(CUSTOM_TAGS_FILE, "r", encoding="utf-8") as f:
            custom = json.load(f)
        for custom_cat in custom.get("categories", []):
            # 查找是否已有同名大类
            found = False
            for cat in tags["categories"]:
                if cat["name"] == custom_cat["name"]:
                    # 合并子类别
                    for custom_sc in custom_cat.get("subcategories", []):
                        sc_found = False
                        for sc in cat["subcategories"]:
                            if sc["name"] == custom_sc["name"]:
                                sc["tags"].extend(custom_sc["tags"])
                                sc_found = True
                                break
                        if not sc_found:
                            cat["subcategories"].append(custom_sc)
                    found = True
                    break
            if not found:
                tags["categories"].append(custom_cat)
    return tags


def load_custom_tags():
    """仅加载自定义标签"""
    if CUSTOM_TAGS_FILE.exists():
        with open(CUSTOM_TAGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"categories": []}


def save_custom_tags(data):
    with open(CUSTOM_TAGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ========== 页面 ==========

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# ========== 标签 API ==========

@app.route("/api/tags")
def api_tags():
    return jsonify(load_tags())


@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").strip().lower()
    if not q:
        return jsonify([])
    
    data = load_tags()
    results = []
    for cat in data["categories"]:
        for sc in cat["subcategories"]:
            matches = []
            for tag in sc["tags"]:
                if q in tag["en"].lower() or q in tag["zh"].lower():
                    matches.append(tag)
            if matches:
                results.append({
                    "category": cat["name"],
                    "subcategory": sc["name"],
                    "tags": matches
                })
    return jsonify(results)


# ========== 预设 API ==========

@app.route("/api/presets")
def api_presets():
    """获取所有预设(内置+用户保存)"""
    data = load_tags()
    builtin = data.get("presets", [])
    
    user_presets = []
    if PRESETS_DIR.exists():
        for f in PRESETS_DIR.glob("*.json"):
            with open(f, "r", encoding="utf-8") as fp:
                p = json.load(fp)
                p["_filename"] = f.stem
                user_presets.append(p)
    
    return jsonify({"builtin": builtin, "user": user_presets})


@app.route("/api/presets/save", methods=["POST"])
def api_presets_save():
    """保存用户预设"""
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "预设名称不能为空"}), 400
    
    preset = {
        "name": name,
        "tags": data.get("tags", []),
        "weights": data.get("weights", {}),
        "negative_tags": data.get("negative_tags", []),
        "negative_weights": data.get("negative_weights", {}),
        "created": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    
    safe_name = "".join(c for c in name if c.isalnum() or c in "._- ")
    filepath = PRESETS_DIR / f"{safe_name}.json"
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(preset, f, ensure_ascii=False, indent=2)
    
    return jsonify({"ok": True, "filename": f"{safe_name}.json"})


@app.route("/api/presets/delete/<name>", methods=["DELETE"])
def api_presets_delete(name):
    filepath = PRESETS_DIR / f"{name}.json"
    if filepath.exists():
        filepath.unlink()
        return jsonify({"ok": True})
    return jsonify({"error": "预设不存在"}), 404


@app.route("/api/presets/export/<name>")
def api_presets_export(name):
    filepath = PRESETS_DIR / f"{name}.json"
    if filepath.exists():
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify(data)
    return jsonify({"error": "预设不存在"}), 404


@app.route("/api/presets/import", methods=["POST"])
def api_presets_import():
    """导入预设JSON"""
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "无效的预设数据"}), 400
    
    safe_name = "".join(c for c in name if c.isalnum() or c in "._- ")
    filepath = PRESETS_DIR / f"{safe_name}.json"
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    return jsonify({"ok": True, "filename": f"{safe_name}.json"})


# ========== 历史记录 API ==========

@app.route("/api/history")
def api_history():
    """获取历史记录列表"""
    items = []
    if HISTORY_DIR.exists():
        for f in sorted(HISTORY_DIR.glob("*.json"), reverse=True):
            with open(f, "r", encoding="utf-8") as fp:
                item = json.load(fp)
                item["_filename"] = f.stem
                items.append(item)
    return jsonify(items[:50])  # 最多50条


@app.route("/api/history", methods=["POST"])
def api_history_add():
    """添加历史记录"""
    data = request.get_json()
    prompt = data.get("prompt", "")
    negative = data.get("negative", "")
    if not prompt:
        return jsonify({"error": "提示词为空"}), 400
    
    ts = time.strftime("%Y%m%d_%H%M%S")
    item = {
        "prompt": prompt,
        "negative": negative,
        "tags": data.get("tags", []),
        "negative_tags": data.get("negative_tags", []),
        "created": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    
    filepath = HISTORY_DIR / f"{ts}.json"
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(item, f, ensure_ascii=False, indent=2)
    
    return jsonify({"ok": True})


@app.route("/api/history/<name>", methods=["DELETE"])
def api_history_delete(name):
    filepath = HISTORY_DIR / f"{name}.json"
    if filepath.exists():
        filepath.unlink()
        return jsonify({"ok": True})
    return jsonify({"error": "记录不存在"}), 404


# ========== 自定义标签 API ==========

@app.route("/api/custom-tags", methods=["GET"])
def api_custom_tags_get():
    return jsonify(load_custom_tags())


@app.route("/api/custom-tags", methods=["POST"])
def api_custom_tags_save():
    """保存自定义标签(全量覆盖)"""
    data = request.get_json()
    save_custom_tags(data)
    return jsonify({"ok": True})


@app.route("/api/custom-tags/add", methods=["POST"])
def api_custom_tags_add():
    """添加单个标签"""
    data = request.get_json()
    cat_name = data.get("category", "")
    sc_name = data.get("subcategory", "")
    tag_en = data.get("en", "").strip()
    tag_zh = data.get("zh", "").strip()
    
    if not cat_name or not sc_name or not tag_en:
        return jsonify({"error": "参数不完整"}), 400
    
    custom = load_custom_tags()
    
    # 找到或创建大类
    cat = None
    for c in custom["categories"]:
        if c["name"] == cat_name:
            cat = c
            break
    if not cat:
        cat = {"id": "custom_" + cat_name.lower().replace(" ", "_"), "name": cat_name, "subcategories": []}
        custom["categories"].append(cat)
    
    # 找到或创建子类别
    sc = None
    for s in cat["subcategories"]:
        if s["name"] == sc_name:
            sc = s
            break
    if not sc:
        sc = {"name": sc_name, "tags": []}
        cat["subcategories"].append(sc)
    
    # 检查重复
    for t in sc["tags"]:
        if t["en"] == tag_en:
            return jsonify({"error": "标签已存在"}), 400
    
    sc["tags"].append({"en": tag_en, "zh": tag_zh})
    save_custom_tags(custom)
    return jsonify({"ok": True})


@app.route("/api/custom-tags/edit", methods=["POST"])
def api_custom_tags_edit():
    """编辑标签"""
    data = request.get_json()
    cat_name = data.get("category", "")
    sc_name = data.get("subcategory", "")
    old_en = data.get("old_en", "")
    new_en = data.get("new_en", "").strip()
    new_zh = data.get("new_zh", "").strip()
    
    if not cat_name or not sc_name or not old_en or not new_en:
        return jsonify({"error": "参数不完整"}), 400
    
    custom = load_custom_tags()
    for cat in custom["categories"]:
        if cat["name"] == cat_name:
            for sc in cat["subcategories"]:
                if sc["name"] == sc_name:
                    for tag in sc["tags"]:
                        if tag["en"] == old_en:
                            tag["en"] = new_en
                            tag["zh"] = new_zh
                            save_custom_tags(custom)
                            return jsonify({"ok": True})
    
    return jsonify({"error": "标签不存在"}), 404


@app.route("/api/custom-tags/delete", methods=["POST"])
def api_custom_tags_delete():
    """删除标签"""
    data = request.get_json()
    cat_name = data.get("category", "")
    sc_name = data.get("subcategory", "")
    tag_en = data.get("en", "")
    
    custom = load_custom_tags()
    for cat in custom["categories"]:
        if cat["name"] == cat_name:
            for sc in cat["subcategories"]:
                if sc["name"] == sc_name:
                    sc["tags"] = [t for t in sc["tags"] if t["en"] != tag_en]
                    save_custom_tags(custom)
                    return jsonify({"ok": True})
    
    return jsonify({"error": "标签不存在"}), 404


if __name__ == "__main__":
    print("=" * 50)
    print("  魔导书 - AI绘画提示词组合器")
    print("  服务启动中...")
    print("=" * 50)
    app.run(host="127.0.0.1", port=5800, debug=False)
