import sys, io, json, uuid
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from openpyxl import load_workbook

def gen_id():
    return uuid.uuid4().hex[:12]

# Skip these subcategory names (metadata / non-tag columns)
SKIP_SUBCATS = {
    "部分预览图", "e", "标签", "咒名", "tag", "ntag", "浏览图", "None", "",
    "@dropdown", "配合D站标签导出器食用", "Option 1", "win+。", "win。",
    "emoji(\u201cwin+\u3002\u201d\u8f93\u5165)", "表情",  # emoji picker column
}

# Category name mapping
SHEET_TO_CATEGORY = {
    "1.镜头": "镜头",
    "2.人物": "人物",
    "3.服饰": "服饰",
    "4.表情": "表情",
    "5.动作": "动作",
    "6.场景道具": "场景道具",
    "0.可以涩涩": "NSFW",
}

# Special: NSFW Tags sheet has different format
def parse_nsfw_tags_sheet(ws):
    """Parse the unstructured NSFW Tags sheet"""
    tags = []
    seen = set()
    for row in ws.iter_rows(min_row=3, values_only=True):
        for i in range(0, len(row), 2):
            if i+1 >= len(row): break
            en_val = row[i]
            zh_val = row[i+1]
            if en_val and str(en_val).strip():
                en = str(en_val).strip()
                zh = str(zh_val).strip() if zh_val else en
                # Skip empty, headers, numbers
                if en.lower() in ("none", "", "nsfw tags") or len(en) > 80:
                    continue
                if en not in seen:
                    seen.add(en)
                    tags.append({"id": gen_id(), "en": en, "zh": zh, "sort_order": len(tags), "source": "builtin"})
    return tags

categories = []
cat_order = 0

wb = load_workbook(r"D:\File\Data\魔导书\法典\魔导书.xlsx", data_only=True)

for sn in wb.sheetnames:
    if sn not in SHEET_TO_CATEGORY and sn != "NSFW Tags":
        continue
    
    if sn == "NSFW Tags":
        # Special handling
        subcats = [{"name": "NSFW标签", "tags": parse_nsfw_tags_sheet(wb[sn])}]
        cat_name = "NSFW标签"
    else:
        cat_name = SHEET_TO_CATEGORY[sn]
        ws = wb[sn]
        header_row = list(ws.iter_rows(min_row=1, max_row=1, values_only=True))[0]
        
        # Find subcategories
        subcat_defs = []
        i = 0
        while i < len(header_row):
            if header_row[i] and str(header_row[i]).strip():
                name = str(header_row[i]).strip()
                if name not in SKIP_SUBCATS:
                    subcat_defs.append({"name": name, "col": i})
                i += 2
            else:
                i += 1
        
        # Extract tags for each subcategory
        subcats = []
        for sd in subcat_defs:
            tags = []
            seen = set()
            for row in ws.iter_rows(min_row=2, values_only=True):
                if sd["col"] >= len(row): continue
                en_val = row[sd["col"]]
                zh_val = row[sd["col"] + 1] if sd["col"] + 1 < len(row) else None
                if en_val and str(en_val).strip():
                    en = str(en_val).strip()
                    zh = str(zh_val).strip() if zh_val else en
                    if en.lower() in ("none", "") or len(en) > 80:
                        continue
                    if en not in seen:
                        seen.add(en)
                        tags.append({"id": gen_id(), "en": en, "zh": zh, "sort_order": len(tags), "source": "builtin"})
            
            if tags:
                subcats.append({
                    "id": gen_id(),
                    "en": sd["name"],
                    "zh": sd["name"],
                    "sort_order": len(subcats),
                    "tags": tags
                })
    
    if subcats:
        categories.append({
            "id": gen_id(),
            "en": cat_name,
            "zh": cat_name,
            "sort_order": cat_order,
            "subcategories": subcats
        })
        cat_order += 1
        total_tags = sum(len(s["tags"]) for s in subcats)
        print(f"{cat_name}: {len(subcats)} subcats, {total_tags} tags")

# Write to file
with open(r"D:\File\Data\魔导书\grimoire\data\tags_new.json", "w", encoding="utf-8") as f:
    json.dump(categories, f, ensure_ascii=False, indent=2)

total = sum(sum(len(s["tags"]) for s in c["subcategories"]) for c in categories)
print(f"\nTotal: {len(categories)} categories, {total} tags")
