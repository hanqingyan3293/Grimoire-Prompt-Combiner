# Fix 1: Vision split bug in SimpleAIPanel
target = r"D:\File\Data\魔导书\grimoire\src\renderer\components\ai\SimpleAIPanel.tsx"
with open(target, "r", encoding="utf-8") as f:
    c = f.read()
c = c.replace('const lines = result.split("\\n").filter(Boolean)', 'const lines = (result.text || result || "").split("\\n").filter(Boolean)')
with open(target, "w", encoding="utf-8", newline="") as f:
    f.write(c)
print("1a. SimpleAIPanel vision split fixed")

# Fix 1b: AIWindow vision split
target2 = r"D:\File\Data\魔导书\grimoire\src\renderer\components\ai\AIWindow.tsx"
with open(target2, "r", encoding="utf-8") as f:
    c2 = f.read()
c2 = c2.replace('const lines = result.split("\\n").filter(Boolean)', 'const lines = (result.text || result || "").split("\\n").filter(Boolean)')
with open(target2, "w", encoding="utf-8", newline="") as f:
    f.write(c2)
print("1b. AIWindow vision split fixed")

# Fix 2: Add onContextMenu to subcategories in Sidebar
target3 = r"D:\File\Data\魔导书\grimoire\src\renderer\components\layout\Sidebar.tsx"
with open(target3, "r", encoding="utf-8") as f:
    c3 = f.read()
# Find the subcategory div and add onContextMenu
old = 'onClick={() => store.toggleSubSelect(sub.id)}'
new = 'onClick={() => store.toggleSubSelect(sub.id)}\n                          onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, type: "subcategory", id: sub.id, name: sub.zh, parentId: cat.id }) }}'
if old in c3:
    c3 = c3.replace(old, new)
    print("2. Subcategory context menu added")
else:
    print("2. Pattern not found for context menu")
with open(target3, "w", encoding="utf-8", newline="") as f:
    f.write(c3)
print("Done bug fixes")
