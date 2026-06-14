import sys, io, json, uuid
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from openpyxl import load_workbook

def gen_id():
    return uuid.uuid4().hex[:12]

# ===== 魔导书.xlsx 主标签库 =====
# Sheet结构: 奇数列(en) → 偶数列(zh), 表头=子类中文名

# 每个sheet的大类中文名 (sheet名 → 大类中文名)
SHEET_CATEGORY_ZH = {
    "1.镜头": "镜头",
    "2.人物": "人物",
    "3.服饰": "服饰",
    "4.表情": "表情",
    "5.动作": "动作",
    "6.场景道具": "场景道具",
    "0.可以涩涩": "NSFW",
}

# 不需要的列标题(元数据/不是标签列)
SKIP_COLS = {
    "部分预览图", "e", "标签", "咒名", "tag", "ntag", "浏览图", "None", "",
    "@dropdown", "配合D站标签导出器食用", "Option 1", "win+。", "win。",
    "emoji(\u201cwin+\u3002\u201d\u8f93\u5165)", "emoji（\"win+。\"输入）",
}

# 子类中文名明确映射 (表头英文 → 应该显示的中文)
SUBCAT_ZH_MAP = {
    # sheet 1.镜头
    "景别": "景别",
    "镜头角度": "镜头角度",
    "焦点": "焦点",
    "画风": "画风",
    # sheet 2.人物
    "性别": "性别",
    "身体": "身体",
    "头发样式": "头发样式",
    "头发颜色": "头发颜色",
    "头发长度": "头发长度",
    # sheet 3.服饰
    "正装": "正装",
    "上衣": "上衣",
    "裙子": "裙子",
    "袜子": "袜子",
    "花纹、材质、装饰": "花纹材质装饰",
    "鞋类": "鞋类",
    "装饰": "装饰",
    "面部": "面部",
    "手臂": "手臂",
    "耳饰": "耳饰",
    "头饰": "头饰",
    "帽子": "帽子",
    "发饰": "发饰",
    "小装饰": "小装饰",
    # sheet 4.表情
    "眼睛": "眼睛",
    "瞳孔": "瞳孔",
    "嘴巴": "嘴巴",
    "笑": "笑容",
    "奇怪的表情": "奇怪表情",
    "表情": "表情",
    # sheet 5.动作
    "姿势": "姿势",
    "手": "手部",
    "腿": "腿部",
    "多人": "多人",
    # sheet 6.场景道具
    "室内及装饰": "室内与装饰",
    "自然": "自然",
    "室外": "室外",
    "背景填充物": "背景元素",
    "植物": "植物",
    "动物": "动物",
    "物品": "物品",
    "武器": "武器",
    "食物": "食物",
    "云": "云",
    "瓶子": "瓶子",
    # sheet 7 (0.可以涩涩)
    "性行为": "性行为",
    "Play": "玩法",
    "性对象（玩具sex_toy）": "性对象",
    "受伤": "受伤",
    "马赛克": "马赛克",
}


all_cats = []
cat_order = 0

wb = load_workbook(r"D:\File\Data\魔导书\法典\魔导书.xlsx", data_only=True)

for sn in wb.sheetnames:
    if sn == "NSFW Tags":
        # === NSFW Tags: 特殊格式, 从Col2开始 zh,en,zh,en ===
        ws = wb[sn]
        tags = []
        seen = set()
        
        for row in ws.iter_rows(min_row=3, values_only=True):
            for i in range(1, len(row), 2):
                if i + 1 >= len(row):
                    break
                zh_val = row[i]     # Col2起: zh,en,zh,en
                en_val = row[i + 1] 
                if en_val and str(en_val).strip():
                    en = str(en_val).strip()
                    zh = str(zh_val).strip() if zh_val else en
                    if en.lower() in ("none", "", "nsfw tags") or len(en) > 80:
                        continue
                    if en not in seen:
                        seen.add(en)
                        tags.append({
                            "id": gen_id(),
                            "en": en,
                            "zh": zh,
                            "sort_order": len(tags),
                            "source": "builtin"
                        })
        
        if tags:
            sub_id = gen_id()
            all_cats.append({
                "id": gen_id(),
                "en": "NSFW Tags",
                "zh": "NSFW标签",
                "sort_order": cat_order,
                "subcategories": [{
                    "id": sub_id,
                    "en": "NSFW Tags",
                    "zh": "NSFW标签",
                    "sort_order": 0,
                    "tags": tags
                }]
            })
            cat_order += 1
            print(f"NSFW标签: 1 subcat, {len(tags)} tags")
        continue

    if sn == "tag组合":
        continue  # 这是提示词组合，不是标签库

    if sn not in SHEET_CATEGORY_ZH:
        continue

    cat_zh = SHEET_CATEGORY_ZH[sn]
    ws = wb[sn]
    header_row = list(ws.iter_rows(min_row=1, max_row=1, values_only=True))[0]

    # 找子类: skip Col1 headers that are in SKIP_COLS
    subcat_defs = []
    i = 0
    while i < len(header_row):
        h = header_row[i]
        if h and str(h).strip():
            name = str(h).strip()
            if name not in SKIP_COLS:
                # 用映射或原名
                zh_name = SUBCAT_ZH_MAP.get(name, name)
                subcat_defs.append({"name": zh_name, "col": i})
            i += 2  # 跳两列(en+zh一对)
        else:
            i += 1

    # 提取每个子类的标签
    subcats = []
    for sd in subcat_defs:
        tags = []
        seen = set()
        for row in ws.iter_rows(min_row=2, values_only=True):
            if sd["col"] >= len(row):
                continue
            en_val = row[sd["col"]]
            zh_val = row[sd["col"] + 1] if sd["col"] + 1 < len(row) else None
            if en_val and str(en_val).strip():
                en = str(en_val).strip()
                zh = str(zh_val).strip() if zh_val else en
                # 跳过无效
                if en.lower() in ("none", "", "copyright\uff0cd\u7ad9\u8bcd\u9891\u6392\u5e8f") or len(en) > 80:
                    continue
                # 跳过中文-only的行(说明信息)
                if all('\u4e00' <= c <= '\u9fff' or c in '，。；：、' for c in en) and not any(c.isascii() and c.isalpha() for c in en):
                    continue
                if en not in seen:
                    seen.add(en)
                    tags.append({
                        "id": gen_id(),
                        "en": en,
                        "zh": zh,
                        "sort_order": len(tags),
                        "source": "builtin"
                    })

        if tags:
            sub_id = gen_id()
            subcats.append({
                "id": sub_id,
                "en": sd["name"],
                "zh": sd["name"],
                "sort_order": len(subcats),
                "tags": tags
            })

    if subcats:
        all_cats.append({
            "id": gen_id(),
            "en": cat_zh,
            "zh": cat_zh,
            "sort_order": cat_order,
            "subcategories": subcats
        })
        cat_order += 1
        total = sum(len(s["tags"]) for s in subcats)
        print(f"{cat_zh}: {len(subcats)} subcats, {total} tags")

# 写文件
out_path = r"D:\File\Data\魔导书\grimoire\data\tags_clean.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(all_cats, f, ensure_ascii=False, indent=2)

total_tags = sum(sum(len(s["tags"]) for s in c["subcategories"]) for c in all_cats)
print(f"\n总计: {len(all_cats)} 大类, {total_tags} 标签")
print(f"输出: {out_path}")
