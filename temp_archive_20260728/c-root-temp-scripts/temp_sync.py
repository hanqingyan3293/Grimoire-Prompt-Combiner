target = r"D:\File\Data\魔导书\grimoire\src\renderer\components\ai\SimpleAIPanel.tsx"
with open(target, "r", encoding="utf-8") as f:
    c = f.read()

# 1. Add chat sync listener in SimpleChat
old_effect = 'useEffect(() => { loadProviders() }, [])'
new_effect = '''useEffect(() => { loadProviders() }, [])
  useEffect(() => {
    const h = () => { const s = useChatStore.getState(); s.loadConversations() }
    window.addEventListener("chat:updated", h)
    return () => window.removeEventListener("chat:updated", h)
  }, [])'''
c = c.replace(old_effect, new_effect)
print("1. Chat sync listener added")

# 2. Add chat sync listener in SimpleVision too
old_ve = 'useEffect(() => { loadProviders() }, [])  // eslint-disable-line'
new_ve = '''useEffect(() => { loadProviders() }, [])
  useEffect(() => { const h = () => { useChatStore.getState().loadConversations() }; window.addEventListener("chat:updated", h); return () => window.removeEventListener("chat:updated", h) }, [])'''
c = c.replace(old_ve, new_ve)
print("2. Vision sync listener added")

# 3. Enhance vision with favorite + import to library
# Find the addToPositive function and add favorite/import buttons
old_add_pos = '''const addToPositive = () => {
    const sel = suggestions.filter((_, i) => selected.has(i))
    sel.forEach(s => {
      const tag = tags.find(t => t.en.toLowerCase() === s.en.toLowerCase())
      if (tag) addPositive(tag, "", "")
    })
    showToast("已添加到正面提示词", "success")
  }'''
new_add_pos = '''const addToPositive = () => {
    const sel = suggestions.filter((_, i) => selected.has(i))
    sel.forEach(s => {
      const tag = tags.find(t => t.en.toLowerCase() === s.en.toLowerCase())
      if (tag) addPositive(tag, "", "")
    })
    showToast("已添加到正面提示词", "success")
  }
  const addToFavorites = () => {
    const sel = suggestions.filter((_, i) => selected.has(i))
    sel.forEach(s => {
      const tag = tags.find(t => t.en.toLowerCase() === s.en.toLowerCase())
      if (tag) { try { window.api.favorites.tagAdd(tag.id); showToast("已收藏: " + s.en, "success") } catch {} }
    })
  }
  const importToLibrary = async () => {
    const cats = useTagsStore.getState().categories
    if (!cats.length) { showToast("请先加载标签库", "error"); return }
    const catNames = cats.map(c => c.zh).join(", ")
    const catZh = prompt("选择大类 (" + catNames + "):")
    if (!catZh) return
    const cat = cats.find(c => c.zh === catZh.trim())
    if (!cat) { showToast("未找到大类", "error"); return }
    const subZh = prompt("输入子类名 (新子类):")
    if (!subZh) return
    const sel = suggestions.filter((_, i) => selected.has(i))
    try {
      await window.api.tags.createSubcategory({ category_id: cat.id, zh: subZh.trim() })
      const store = useTagsStore.getState()
      await store.loadTags()
      const newSub = store.subcategories.find(s => s.zh === subZh.trim() && s.category_id === cat.id)
      if (newSub) {
        for (const s of sel) {
          await window.api.tags.create({ subcategory_id: newSub.id, en: s.en, zh: s.zh })
        }
        await store.loadTags()
        showToast("已导入 " + sel.length + " 个标签", "success")
      }
    } catch (e: any) { showToast("导入失败: " + (e?.message || ""), "error") }
  }'''
c = c.replace(old_add_pos, new_add_pos)
print("3. Favorite + import functions added")

# Add buttons in the vision results toolbar
old_toolbar = '''<button onClick={addToPositive} className="text-[10px] text-[var(--color-accent)] hover:underline">+正面</button>'''
new_toolbar = '''<button onClick={addToPositive} className="text-[10px] text-[var(--color-accent)] hover:underline">+正面</button>
                <button onClick={addToFavorites} className="text-[10px] text-[var(--color-text-secondary)] hover:underline">收藏</button>
                <button onClick={importToLibrary} className="text-[10px] text-[var(--color-text-secondary)] hover:underline">导入库</button>'''
c = c.replace(old_toolbar, new_toolbar)
print("4. Favorite/import buttons added")

with open(target, "w", encoding="utf-8", newline="") as f:
    f.write(c)
print(f"SimpleAIPanel: {len(c)} chars")
