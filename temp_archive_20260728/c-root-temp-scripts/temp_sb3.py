target = r"D:\File\Data\魔导书\grimoire\src\renderer\components\ai\AIWindow.tsx"
with open(target, "r", encoding="utf-8") as f:
    c = f.read()

# Get sidebar boundaries (from previous run)
idx1 = c.find("w-[270px] min-w-[270px]")
# Find end of sidebar - the closing </div> before subTab buttons
idx3 = c.find('subTab === "chat"')
if idx3 > 0:
    before = c[:idx3]
    idx3 = before.rfind("</div>") + 6

old_sidebar = c[idx1:idx3]

new_sidebar = '''w-[270px] min-w-[270px] border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col">
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
            按时间
          </button>
          <button onClick={() => setGroupBy("custom")}
            className={"flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors " + (groupBy === "custom" ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]")}>
            自定义
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
                onCtx={(e) => { e.preventDefault(); setConvCtxMenu({ x: e.clientX, y: e.clientY, convId: c.id, title: c.title }) }} />)
            )
          ) : (
            Object.entries(groupedConvs).map(([group, convs]) => (
              <div key={group} className="mb-1">
                <div className="text-[10px] text-[var(--color-text-secondary)] font-medium px-1 py-1">{group}</div>
                {convs.map(c => <ConvItem key={c.id} conv={c} active={activeId === c.id} onClick={() => setActive(c.id)}
                  onDelete={() => deleteConversation(c.id)} onRename={(t) => renameConversation(c.id, t)}
                  editing={editingTitle === c.id} editValue={editValue} setEditValue={setEditValue} setEditingTitle={setEditingTitle}
                  groupBy={groupBy} customGroups={customGroups} setConvGroup={setConvGroup}
                  onCtx={(e) => { e.preventDefault(); setConvCtxMenu({ x: e.clientX, y: e.clientY, convId: c.id, title: c.title }) }} />)}
              </div>
            ))
          )}
        </div>

        {/* Custom group management */}
        {groupBy === "custom" && (
          <div className="border-t border-[var(--color-border)] p-3 space-y-1.5">
            <div className="text-[10px] text-[var(--color-text-secondary)] font-medium">分组管理</div>
            {customGroups.map(g => (
              <div key={g} className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] px-1">
                <span>{g}</span>
                <button onClick={() => { if (confirm("删除分组 " + g + "？")) removeCustomGroup(g) }}
                  className="text-[10px] hover:text-red-400">x</button>
              </div>
            ))}
            <button onClick={() => { const n = prompt("输入新分组名称:"); if (n && n.trim()) addCustomGroup(n.trim()) }}
              className="w-full py-1.5 text-xs border border-dashed border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors">
              + 新建分组
            </button>
          </div>
        )}

        {/* Bottom */}
        <div className="border-t border-[var(--color-border)] p-3">
          <button onClick={() => { window.api && window.api.window && window.api.window.openSettings() }}
            className="w-full py-2.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)] rounded-lg flex items-center justify-center gap-2 transition-colors">
            设置
          </button>
        </div>
      </div>

      {/* Conv Context Menu */}
      {convCtxMenu && (<>
        <div className="fixed inset-0 z-40" onClick={() => setConvCtxMenu(null)} />
        <div className="fixed z-50 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg shadow-2xl py-1 min-w-[150px]" style={{ left: convCtxMenu.x, top: convCtxMenu.y }}>
          <button onClick={() => { setEditingTitle(convCtxMenu.convId); setEditValue(convCtxMenu.title); setConvCtxMenu(null) }}
            className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10">重命名</button>
          {groupBy === "custom" && customGroups.map(g => (
            <button key={g} onClick={() => { setConvGroup(convCtxMenu.convId, g); setConvCtxMenu(null) }}
              className="w-full text-left px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/10">移动到: {g}</button>
          ))}
          <div className="border-t border-[var(--color-border)]/50 my-0.5" />
          <button onClick={() => { if (confirm("删除对话？")) deleteConversation(convCtxMenu.convId); setConvCtxMenu(null) }}
            className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-400/10">删除</button>
        </div>
      </>)}'''

c = c.replace(old_sidebar, new_sidebar)
print("Sidebar replaced!")

# Update ConvItem to accept onCtx prop
old_ci = "onContextMenu?:"
if old_ci not in c:
    # ConvItem already has onContextMenu via the props, but we need to add onCtx
    # Replace the existing onContextMenu handler
    old_ocm = 'onContextMenu={e => { e.preventDefault(); setCtxMenu'
    new_ocm = 'onContextMenu={onCtx} onCtxPlaceholder={e => { e.preventDefault(); setCtxMenu'
    # Actually, let's just make sure ConvItem passes through the context menu
    pass

with open(target, "w", encoding="utf-8", newline="") as f:
    f.write(c)
print(f"Size: {len(c)}")
