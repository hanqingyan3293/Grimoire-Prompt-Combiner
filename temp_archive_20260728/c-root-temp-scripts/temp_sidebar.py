target = r"D:\File\Data\魔导书\grimoire\src\renderer\components\ai\AIWindow.tsx"
with open(target, "r", encoding="utf-8") as f:
    c = f.read()

# Find the left sidebar section and rewrite it
# Find marker for sidebar start
sidebar_start = c.find("{/* LEFT SIDEBAR */}")
sidebar_end = c.find("{/* RIGHT MAIN */}")
if sidebar_start < 0 or sidebar_end < 0:
    print("Cannot find sidebar markers")
else:
    old_sidebar = c[sidebar_start:sidebar_end]
    
    new_sidebar = '''{/* LEFT SIDEBAR */}
      <div className="w-[270px] min-w-[270px] border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col">
        {/* Search + New */}
        <div className="p-3 space-y-2">
          <input value={searchQuery} onChange={e => setSearch(e.target.value)}
            placeholder="搜索对话..."
            className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent)]" />
          <button onClick={() => { const id = createConversation(selectedModel); setActive(id) }}
            className="w-full py-2.5 bg-[var(--color-accent)] text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5">
            + 新建对话
          </button>
        </div>

        {/* Group tabs */}
        <div className="flex px-3 pb-1 gap-1">
          <button onClick={() => setGroupBy("time")}
            className={"flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors " + (groupBy === "time" ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]")}>
            📅 按时间
          </button>
          <button onClick={() => setGroupBy("custom")}
            className={"flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors " + (groupBy === "custom" ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]")}>
            📁 自定义
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {searchQuery ? (
            filtered.length === 0 ? (
              <div className="text-center text-sm text-[var(--color-text-secondary)] py-8">无匹配对话</div>
            ) : (
              filtered.map(c => <ConvItem key={c.id} conv={c} active={activeId === c.id} onClick={() => setActive(c.id)}
                onDelete={() => deleteConversation(c.id)} onRename={(t) => renameConversation(c.id, t)}
                editing={editingTitle === c.id} editValue={editValue} setEditValue={setEditValue} setEditingTitle={setEditingTitle}
                groupBy={groupBy} customGroups={customGroups} setConvGroup={setConvGroup}
                onContextMenu={(e) => { e.preventDefault(); setConvCtxMenu({ x: e.clientX, y: e.clientY, convId: c.id, title: c.title }) }} />)
            )
          ) : (
            Object.entries(groupedConvs).map(([group, convs]) => (
              <div key={group} className="mb-1">
                <div className="flex items-center justify-between px-1 py-1">
                  <span className="text-[10px] text-[var(--color-text-secondary)] font-medium uppercase tracking-wider">{group}</span>
                  {groupBy === "custom" && group !== "未分组" && (
                    <button onClick={() => { if (confirm("删除分组 '" + group + "'？")) removeCustomGroup(group) }}
                      className="text-[10px] text-[var(--color-text-secondary)] hover:text-red-400 px-1">×</button>
                  )}
                </div>
                {convs.map(c => <ConvItem key={c.id} conv={c} active={activeId === c.id} onClick={() => setActive(c.id)}
                  onDelete={() => deleteConversation(c.id)} onRename={(t) => renameConversation(c.id, t)}
                  editing={editingTitle === c.id} editValue={editValue} setEditValue={setEditValue} setEditingTitle={setEditingTitle}
                  groupBy={groupBy} customGroups={customGroups} setConvGroup={setConvGroup}
                  onContextMenu={(e) => { e.preventDefault(); setConvCtxMenu({ x: e.clientX, y: e.clientY, convId: c.id, title: c.title }) }} />)}
              </div>
            ))
          )}
        </div>

        {/* Custom group management */}
        {groupBy === "custom" && (
          <div className="border-t border-[var(--color-border)] p-3 space-y-1.5">
            <div className="text-[10px] text-[var(--color-text-secondary)] font-medium mb-1">📁 分组管理</div>
            {customGroups.map(g => (
              <div key={g} className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] px-1">
                <span>☐ {g}</span>
                <button onClick={() => { if (confirm("删除分组 '" + g + "'？")) removeCustomGroup(g) }}
                  className="text-[10px] hover:text-red-400">×</button>
              </div>
            ))}
            <button onClick={() => { const n = prompt("输入新分组名称:"); if (n?.trim()) addCustomGroup(n.trim()) }}
              className="w-full py-1.5 text-xs border border-dashed border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors">
              + 新建分组
            </button>
          </div>
        )}

        {/* Bottom settings */}
        <div className="border-t border-[var(--color-border)] p-3">
          <button onClick={() => { window.api?.window?.openSettings?.() }}
            className="w-full py-2.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)] rounded-lg flex items-center justify-center gap-2 transition-colors">
            ⚙ 设置
          </button>
        </div>
      </div>

      {/* Conversation Context Menu */}
      {convCtxMenu && (<>
        <div className="fixed inset-0 z-40" onClick={() => setConvCtxMenu(null)} />
        <div className="fixed z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-2xl py-1 min-w-[160px]" style={{ left: convCtxMenu.x, top: convCtxMenu.y }}>
          <button onClick={() => { setEditingTitle(convCtxMenu.convId); setEditValue(convCtxMenu.title); setConvCtxMenu(null) }}
            className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10">✏️ 重命名</button>
          {groupBy === "custom" && (
            <div className="relative group/item">
              <button className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10 flex items-center justify-between">
                📁 移动到分组 <span className="text-[10px]">▶</span>
              </button>
              <div className="absolute left-full top-0 ml-1 hidden group-hover/item:block bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-xl py-1 min-w-[120px]">
                {customGroups.map(g => (
                  <button key={g} onClick={() => { setConvGroup(convCtxMenu.convId, g); setConvCtxMenu(null) }}
                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10">{g}</button>
                ))}
                <div className="border-t border-[var(--color-border)]/50 my-0.5" />
                <button onClick={() => { const n = prompt("新分组:"); if (n?.trim()) { addCustomGroup(n.trim()); setConvGroup(convCtxMenu.convId, n.trim()) }; setConvCtxMenu(null) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10">+ 新建分组</button>
              </div>
            </div>
          )}
          <div className="border-t border-[var(--color-border)]/50 my-0.5" />
          <button onClick={() => { if (confirm("删除对话？")) deleteConversation(convCtxMenu.convId); setConvCtxMenu(null) }}
            className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-400/10">🗑 删除</button>
        </div>
      </>)}'''

    c = c.replace(old_sidebar, new_sidebar)
    print("Sidebar rewritten!")

# Add convCtxMenu state
old_state = 'const [compressEnabled, setCompressEnabled] = useState(false)'
new_state = 'const [compressEnabled, setCompressEnabled] = useState(false)\n  const [convCtxMenu, setConvCtxMenu] = useState<{x:number,y:number,convId:string,title:string}|null>(null)'
c = c.replace(old_state, new_state)
print("convCtxMenu state added")

with open(target, "w", encoding="utf-8", newline="") as f:
    f.write(c)
print(f"AIWindow: {len(c)} chars")
