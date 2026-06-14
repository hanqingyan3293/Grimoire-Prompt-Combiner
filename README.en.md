# Grimoire v7

> AI Prompt Combiner — A desktop toolbox for AI art and AI chat

中文: [README.md](./README.md)

## Overview

Grimoire is a Windows desktop application designed for AI creators. It deeply integrates **4000+ tag library management**, **visual prompt composition**, **multi-provider AI chat**, and **AI vision-based tag suggestion** to make prompt engineering intuitive and efficient.

### Core Features

- **📚 Tag Library** — 4000+ bilingual (EN/ZH) tags in a 3-level tree: Category → Subcategory → Tag. Search, filter, random pick.
- **🏷️ Tag Groups** — Multiple independent tag databases. Switch, import, export, rename, copy for different creative scenarios.
- **⭐ Favorites** — Favorite subcategories and tags with a dedicated favorites view for quick access.
- **✏️ Prompt Builder** — Positive/negative prompt panels, weight sliders, undo/redo, one-click copy and export.
- **🤖 AI Assistant** — Standalone AI chat window, multi-model switching, persistent messages, conversation grouping.
- **🔍 AI Vision** — Upload images → AI recognition → auto-suggest matching tags. Multi-select and drag-and-drop support.
- **📊 Simple AI Panel** — Embedded right-panel in main window. Chat + Vision dual modes, synced with AI window.
- **⚙️ Provider Configuration** — Multi-provider API management. Supports Chat Completions / Responses API protocols, model list fetching, connection testing.
- **🎨 Themes** — 7 built-in themes (Neon/Clean/Gold/Midnight/Sakura/Forest/Sunset), custom accent color, font/UI scaling.
- **⌨️ Shortcuts** — Global keyboard shortcuts for send/newline/search/undo/redo/copy, fully customizable.

### Tech Stack

| Technology | Purpose |
|------------|---------|
| Electron 34 | Desktop framework |
| React 19 + TypeScript 5 | UI rendering |
| Vite 8 + Tailwind CSS v4 | Build & styling |
| sql.js (WASM SQLite) | Local database |
| Zustand | State management |
| OpenAI SDK | AI communication |
| electron-builder | Distribution packaging |

## Quick Start

### Requirements

- Windows 10/11 (x64)
- Node.js 18+

### Installation

**Option 1: Installer (Recommended)**

1. Download `Grimoire-Setup-7.0.0.exe` from the [latest Release](https://github.com/hanqingyan3293/grimoire/releases/latest)
2. Double-click to install, choose installation directory
3. Launch from desktop shortcut

**Option 2: Portable**

1. Download `Grimoire-portable-7.0.0.zip`
2. Extract to any directory
3. Run `Grimoire.exe` — all data and configs stay in the folder

**Option 3: From Source**

```bash
git clone https://github.com/hanqingyan3293/grimoire.git
cd grimoire
npm install
npm run build
npm start
```

## Documentation

For detailed instructions, see [USER_MANUAL.en.md](./USER_MANUAL.en.md)

## License

GPL-3.0 License — [hanqingyan3293](https://github.com/hanqingyan3293)
