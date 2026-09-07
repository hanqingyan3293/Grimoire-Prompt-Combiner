target = r"D:\File\Data\魔导书\grimoire\src\renderer\components\ai\AIWindow.tsx"
with open(target, "r", encoding="utf-8") as f:
    c = f.read()

# Add favorite and import to AIWindow vision results toolbar
old_vt = '''<button onClick={handleVSave}
                        className="text-xs text-[var(--color-text-secondary)] hover:underline">保存</button>'''
new_vt = '''<button onClick={handleVSave}
                        className="text-xs text-[var(--color-text-secondary)] hover:underline">保存</button>
                    <button onClick={() => {
                      const sel = visionSuggestions.filter((_, i) => visionSelected.has(i))
                      sel.forEach(s => { try { window.api.favorites.tagAdd(s.en) } catch {} })
                      showToast("已收藏 " + (visionSelected.size || visionSuggestions.length) + " 个标签", "success")
                    }} className="text-xs text-[var(--color-text-secondary)] hover:underline">收藏</button>
                    <button onClick={async () => {
                      const cats = (await import("../../stores/tags.store")).useTagsStore.getState().categories
                      if (!cats.length) { showToast("请先加载标签库", "error"); return }
                      const catZh = prompt("选择大类 (" + cats.map(c => c.zh).join(", ") + "):")
                      if (!catZh) return
                      const cat = cats.find(c => c.zh === catZh.trim())
                      if (!cat) { showToast("未找到大类", "error"); return }
                      const subZh = prompt("输入子类名:")
                      if (!subZh) return
                      const sel = visionSuggestions.filter((_, i) => visionSelected.has(i))
                      try {
                        await window.api.tags.createSubcategory({ category_id: cat.id, zh: subZh.trim() })
                        const store = (await import("../../stores/tags.store")).useTagsStore
                        await store.getState().loadTags()
                        const newSub = store.getState().subcategories.find(s => s.zh === subZh.trim() && s.category_id === cat.id)
                        if (newSub) {
                          for (const s of sel) { await window.api.tags.create({ subcategory_id: newSub.id, en: s.en, zh: s.zh }) }
                          await store.getState().loadTags()
                          showToast("已导入 " + sel.length + " 个标签", "success")
                        }
                      } catch (e) { showToast("导入失败", "error") }
                    }} className="text-xs text-[var(--color-text-secondary)] hover:underline">导入库</button>'''
c = c.replace(old_vt, new_vt)
print("AIWindow vision enhanced")

with open(target, "w", encoding="utf-8", newline="") as f:
    f.write(c)
print(f"Size: {len(c)}")
