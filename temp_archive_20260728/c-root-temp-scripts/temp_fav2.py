# Fix 3b: Add favSubList to favorites store
target = r"D:\File\Data\魔导书\grimoire\src\renderer\stores\favorites.store.ts"
with open(target, "r", encoding="utf-8") as f:
    c = f.read()

# Add favSubList if missing
if "favSubList" not in c:
    old = "loadFavorites: async () => {"
    new = '''loadSubFavs: async () => {
    try { set({ favSubs: await window.api.favorites.subList() }) } catch {}
  },
  loadFavorites: async () => {'''
    c = c.replace(old, new)
    print("Added loadSubFavs")
    
    # Add favSubs to state
    old2 = "favSubs: []"
    if old2 not in c:
        old3 = "favTags: []"
        new3 = "favTags: [],\n  favSubs: []"
        c = c.replace(old3, new3)
        print("Added favSubs state")

with open(target, "w", encoding="utf-8", newline="") as f:
    f.write(c)
print(f"Favorites store: {len(c)} chars")
