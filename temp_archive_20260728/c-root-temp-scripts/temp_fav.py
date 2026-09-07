# Fix 3: Favorites display - check fav store and add context menu for favorites
target = r"D:\File\Data\魔导书\grimoire\src\renderer\stores\favorites.store.ts"
with open(target, "r", encoding="utf-8") as f:
    c = f.read()
# Check if favSubList and favTagList are properly implemented
if "favSubList" in c: print("favSubList: YES")
else: print("favSubList: MISSING")
if "toggleSubFav" in c: print("toggleSubFav: YES") 
else: print("toggleSubFav: MISSING")
print(f"Favorites store: {len(c)} chars")

# Fix 4: config.toml/auth.json editable - force pointer-events and z-index
target2 = r"D:\File\Data\魔导书\grimoire\src\renderer\components\settings\ProviderEditor.tsx"
with open(target2, "r", encoding="utf-8") as f:
    c2 = f.read()
# Replace the textarea class to add z-10 and pointer-events-auto
old_ta = 'className="w-full px-4 py-3 bg-[var(--color-bg-primary)] border-2 border-[var(--color-border)] rounded-lg text-xs font-mono text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/30 resize-y min-h-[150px] cursor-text"'
new_ta = 'className="w-full px-4 py-3 bg-[var(--color-bg-primary)] border-2 border-[var(--color-border)] rounded-lg text-xs font-mono text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]/30 resize-y min-h-[150px] cursor-text relative z-10 pointer-events-auto" style={{pointerEvents:"auto"}}'
c2 = c2.replace(old_ta, new_ta)
# Also add tabIndex for focusability
c2 = c2.replace('rows={6}', 'rows={6} tabIndex={0}')
with open(target2, "w", encoding="utf-8", newline="") as f:
    f.write(c2)
print("4. Textareas made editable with z-10 + pointer-events")

