# Grimoire v7.0.0 Release Notes

> First public release | 2026-06-15

---

## 🎉 New Features

### Core

- **📚 Tag Library** — 4000+ bilingual tags, Category→Subcategory→Tag tree
- **🏷️ Tag Groups** — Multiple independent tag databases, import/export/switch
- **⭐ Favorites** — Subcategory & tag favorites with dedicated view
- **✏️ Prompt Builder** — Positive/negative panels, weight sliders, undo/redo, copy

### AI

- **🤖 AI Assistant** — Standalone chat window, multi-model, Markdown rendering
- **🔍 AI Vision** — Image upload → auto tag suggestion, drag-and-drop
- **📊 Simple AI Panel** — Embedded chat + vision in main window
- **🔄 Sync** — Real-time conversation sync between panels

### Settings

- **🔌 Multi-Provider** — Chat Completions / Responses API support
- **🔄 Fetch Models** — Auto-detect available models from upstream
- **🧪 Test Connection** — One-click API verification
- **🎨 7 Themes** — Neon/Clean/Gold/Midnight/Sakura/Forest/Sunset
- **⌨️ Shortcuts** — Fully customizable keyboard shortcuts
- **📏 Font Scaling** — Small/Medium/Large

### Data

- **💾 Database** — sql.js WASM SQLite, local encrypted storage
- **📤 Import/Export** — Database and tag group import/export
- **🔐 API Key Encryption** — Electron safeStorage encryption

---

## 🛠️ Tech Stack

- Electron 34 + React 19 + TypeScript 5
- Vite 8 + Tailwind CSS v4
- sql.js (WASM SQLite)
- Zustand
- OpenAI SDK

---

## 📦 Downloads

| File | Description |
|------|-------------|
| `Grimoire-Setup-7.0.0.exe` | NSIS Installer (Recommended) |
| `Grimoire-portable-7.0.0.zip` | Portable Version |

---

## ⚠️ Known Issues

- Occasional sync issues in multi-window mode — press **Ctrl+R** to manually refresh
- Some UI elements may display incompletely at large scaling ratios

---

## 📖 Documentation

- [操作文档 (Chinese Manual)](./操作文档.md)
- [User Manual (English)](./USER_MANUAL.en.md)

---

*Grimoire v7.0.0 — GPL-3.0 License*
