import json
with open(r"D:\File\Data\魔导书\grimoire\data\tags_new.json", "r", encoding="utf-8") as f:
    data = json.load(f)
for cat in data:
    print(f"\n=== {cat['zh']} ===")
    for sub in cat["subcategories"][:3]:
        print(f"  [{sub['zh']}] ({len(sub['tags'])} tags)")
        for t in sub["tags"][:5]:
            print(f"    {t['en']} -> {t['zh'][:40]}")
