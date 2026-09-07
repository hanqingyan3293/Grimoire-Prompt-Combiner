target = r"D:\File\Data\魔导书\grimoire\src\renderer\components\ai\AIWindow.tsx"
with open(target, "r", encoding="utf-8") as f:
    c = f.read()

# Find sidebar boundaries
idx1 = c.find("w-[270px] min-w-[270px]")
idx2 = c.find("{/* RIGHT MAIN */}")
if idx2 < 0:
    idx2 = c.find("{/* ========== RIGHT") 

print(f"Sidebar div at {idx1}, right area at {idx2}")

# Find the exact start of the right area
# Search for the end of the sidebar section (closing of the left div)
marker = "</div>\n\n      {/* ========== RIGHT"
idx3 = c.find(marker)
if idx3 < 0:
    marker2 = "</div>\n\n      {/_ ========== RIGHT"
    idx3 = c.find(marker2)
if idx3 < 0:
    # Try finding the subTab chat/vision buttons
    idx3 = c.find('subTab === "chat"')
    if idx3 > 0:
        # Go back to find sidebar end
        before = c[:idx3]
        last_div = before.rfind("</div>")
        idx3 = last_div
        print(f"Sidebar end at {idx3}")

if idx1 > 0 and idx3 > 0:
    old_sidebar = c[idx1:idx3+6]
    print(f"Old sidebar: {len(old_sidebar)} chars")
    print("First 100:", old_sidebar[:100])
    print("Last 100:", old_sidebar[-100:])
