target = r"D:\File\Data\魔导书\grimoire\src\renderer\components\ai\AIWindow.tsx"
with open(target, "r", encoding="utf-8") as f:
    c = f.read()

# 1. Update ConvItem to use onCtx for context menu
old_ci_start = "function ConvItem({ conv, active, onClick, onDelete, onRename, editing, editValue, setEditValue, setEditingTitle, groupBy, customGroups, setConvGroup }:"
new_ci_start = "function ConvItem({ conv, active, onClick, onDelete, onRename, editing, editValue, setEditValue, setEditingTitle, groupBy, customGroups, setConvGroup, onCtx }:"
c = c.replace(old_ci_start, new_ci_start)

# Add onCtx to the type
old_ci_type_end = "setConvGroup?: (convId: string, group: string) => void;"
new_ci_type_end = "setConvGroup?: (convId: string, group: string) => void;\n  onCtx?: (e: React.MouseEvent) => void;"
c = c.replace(old_ci_type_end, new_ci_type_end)

# Add onContextMenu to the main div
old_ci_div = ")}, onClick={editing ? undefined : onClick}>"
new_ci_div = ")}, onClick={editing ? undefined : onClick} onContextMenu={onCtx}>"
c = c.replace(old_ci_div, new_ci_div)
print("1. ConvItem context menu updated")

# 2. Fix toolbar buttons horizontal layout + provider selector
old_tb_section = '''{/* Controls row - ChatBox toolbar */}
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <div className="flex items-center gap-2">'''
new_tb_section = '''{/* Controls row */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-1 flex-wrap">
              {/* Provider selector */}
              <select
                onChange={async (e) => { const id = e.target.value; if (id && window.api) { await loadProviders(); try { const s = await import("../../stores/providers.store"); await s.useProviderStore.getState().setActive(id); await loadProviders() } catch {} } }}
                value={activeProvider?.id || ""}
                className="px-2 py-1.5 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-primary)] cursor-pointer max-w-[130px] truncate">
                {(() => { try { const ps = (window as any).__providers || []; return ps.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>) } catch { return null } })()}
              </select>'''
c = c.replace(old_tb_section, new_tb_section)
print("2. Toolbar with provider selector")

# 3. Make toolbar buttons horizontal
old_tb_btns = '''<button className="text-xs px-2.5 py-1.5 border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors flex items-center gap-1" title="上传文件/图片"> 文件</button>
              <button className="text-xs px-2.5 py-1.5 border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors flex items-center gap-1" title="联网搜索"> 搜索</button>
              <button className="text-xs px-2.5 py-1.5 border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors flex items-center gap-1" title="对话设置"> 设置</button>'''
new_tb_btns = '''<button onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.multiple = true; inp.onchange = (e) => { const files = (e.target as HTMLInputElement).files; if (files) { const rs: Promise<string>[] = []; for (let i=0;i<files.length;i++) { rs.push(new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result as string); fr.readAsDataURL(files[i]) })) }; Promise.all(rs).then(urls => showToast("已选择 " + urls.length + " 个文件", "info")) }; inp.remove() }; inp.click() }}
                className="text-xs px-2.5 py-1.5 border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors" title="上传文件/图片">文件</button>
              <button onClick={() => showToast("联网搜索功能开发中", "info")}
                className="text-xs px-2.5 py-1.5 border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors" title="联网搜索">搜索</button>
              <button onClick={() => showToast("对话设置功能开发中", "info")}
                className="text-xs px-2.5 py-1.5 border border-[var(--color-border)] rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] transition-colors" title="对话设置">设置</button>'''
c = c.replace(old_tb_btns, new_tb_btns)
print("3. Toolbar buttons with actions")

# 4. Add chat sync - broadcast event on send
old_send_end = 'inputRef.current?.focus()'
new_send_end = '''inputRef.current?.focus()
    window.dispatchEvent(new CustomEvent("chat:updated"))'''
c = c.replace(old_send_end, new_send_end)
print("4. Chat sync event added")

with open(target, "w", encoding="utf-8", newline="") as f:
    f.write(c)
print(f"AIWindow: {len(c)} chars")
