# Grimoire v7 — User Manual

> Version: v7.0.0 | Updated: 2026-06-15

---

## Table of Contents

1. [Getting Started & Interface Overview](#1-getting-started--interface-overview)
2. [Tag Library Management](#2-tag-library-management)
3. [Tag Group Management](#3-tag-group-management)
4. [Favorites System](#4-favorites-system)
5. [Prompt Builder](#5-prompt-builder)
6. [Presets](#6-presets)
7. [History](#7-history)
8. [AI Assistant Window](#8-ai-assistant-window)
9. [Simple AI Panel](#9-simple-ai-panel)
10. [AI Vision Tag Suggestion](#10-ai-vision-tag-suggestion)
11. [Settings Center](#11-settings-center)
12. [Keyboard Shortcuts](#12-keyboard-shortcuts)
13. [Data Management](#13-data-management)
14. [FAQ](#14-faq)

---

## 1. Getting Started & Interface Overview

### 1.1 Launching

- **Installer**: Double-click `Grimoire` desktop shortcut
- **Portable**: Open the folder, double-click `Grimoire.exe`
- **Source**: Run `npm start` in terminal

### 1.2 Main Interface Layout

```
+----------+--------------------------+-------------+
|          |                          |             |
|  Sidebar  |      Main Content        | Right Panel |
| (Tag Lib) |  (Tag Cards / Output)    | (Simple AI/ |
|           |                          |  Presets/    |
|           |                          |  History)    |
+----------+--------------------------+-------------+
```

| Area | Position | Function |
|------|----------|----------|
| Sidebar | Left, fixed | Tag tree, group switch, favorites, search |
| Main Content | Center, flexible | Tag cards grid, prompt output (positive/negative), random button |
| Right Panel | Right, collapsible | Simple AI chat/vision, presets, history, status bar |

### 1.3 Right Panel Tabs

| Tab | Icon | Function |
|-----|------|----------|
| Simple AI | 💬 | Embedded AI chat & vision panel |
| Presets | 📋 | Save/load prompt presets |
| History | 🕐 | Prompt generation history |
| Images | 🖼️ | Reference images |

---

## 2. Tag Library Management

The tag library uses a 3-level structure: **Category → Subcategory → Tag**.

### 2.1 Browsing Tags

- The sidebar displays all categories (e.g., "Characters", "Clothing", "Scenes")
- Click the **▶ arrow** next to a category to expand subcategories
- Click a subcategory to display its tags in the main content area
- Numbers indicate tag counts: `CategoryName (subcategories/tags)`

### 2.2 Searching

- **🔍 Search box** at the top of the sidebar
- Type keywords in English or Chinese for real-time filtering
- Matching tags are highlighted

### 2.3 Selecting Tags

| Action | Effect |
|--------|--------|
| **Left-click subcategory** | Selects all tags in that subcategory |
| **Left-click tag** | Select/deselect individual tag |
| **Cross-category multi-select** | Select subcategories/tags across different categories |

### 2.4 Right-Click Menu

**Right-click on a Tag:**

| Item | Function |
|------|----------|
| ✏️ Edit | Modify tag name (EN/ZH) |
| 🗑️ Delete | Delete the tag |
| ⭐ Favorite | Add to favorites |
| ➕ Add to Positive | Add to positive prompt |
| ➖ Add to Negative | Add to negative prompt |

**Right-click on a Subcategory:**

| Item | Function |
|------|----------|
| ✏️ Edit | Modify subcategory name |
| 🗑️ Delete | Delete subcategory and all its tags |
| ⭐ Favorite | Add to favorites |

### 2.5 Adding Tags

- **➕ Add** button at the bottom of the sidebar
- **Add Category**: Enter Chinese name, English auto-generated
- **Add Subcategory**: Select a category first, then enter name
- **Add Tag**: Select a subcategory first, then enter EN/ZH names

### 2.6 Random Prompt

- **🎲 Random Tags** button at the bottom of the main area
- Randomly selects a specified number of tags
- Number range adjustable in Settings

### 2.7 Prompt Output

Fixed output area at the bottom of the main content:

| Area | Border | Purpose |
|------|--------|---------|
| Positive Prompt | — | Selected positive tags as text |
| Negative Prompt | — | Selected negative tags as text |

**📋 Copy** button copies the complete prompt to clipboard.

---

## 3. Tag Group Management

Tag groups are **complete independent tag databases** with their own category/subcategory/tag hierarchy.

### 3.1 Use Cases

- Different creative scenarios (anime, realistic, architecture)
- Imported shared tag groups without mixing
- Backup current tag library

### 3.2 Switching Groups

1. Click **🏷️ Tag Library Management** dropdown at the top of the sidebar
2. Active group is marked with `◉`
3. Click a group name to switch

### 3.3 Management Operations

| Action | Description |
|--------|-------------|
| **New Group** | Create an empty tag group |
| **Rename** | Right-click group → Rename |
| **Import** | 📥 Import `.json` group file |
| **Export** | 📤 Export current group as `.json` |
| **Copy** | Create a full copy of the current group |
| **Set Default** | Set as the default startup group |
| **Delete** | Delete entire group (irreversible!) |

---

## 4. Favorites System

### 4.1 Access

Click **⭐ Favorites** at the bottom of the sidebar.

### 4.2 Favorite Subcategories

- Upper area: favorited subcategories
- Click to view tags within that subcategory
- Click again to deselect
- Right-click: Edit, Unfavorite

### 4.3 Favorite Tags

- Lower area: favorited tags
- Organized as **Category → Subcategory → Tag** tree
- Left-click to select (cross-category multi-select supported)
- Right-click menu same as tag library

---

## 5. Prompt Builder

### 5.1 Positive & Negative Prompts

- Right panel shows currently selected positive and negative prompts
- Each tag has a **weight slider** (0.1 ~ 2.0) to adjust strength

### 5.2 Action Buttons

| Button | Function |
|--------|----------|
| 🧹 Clear | Remove all selected tags |
| ↩️ Undo | Undo last action |
| ↪️ Redo | Redo undone action |
| 📋 Copy | Copy complete prompt text |
| 💾 Save Preset | Save current combination as preset |

---

## 6. Presets

### 6.1 Saving

1. Compose your prompt
2. Click **💾 Save Preset**
3. Enter a name
4. Preset appears in the right panel "Presets" tab

### 6.2 Loading

1. Switch to right panel **📋 Presets** tab
2. Click preset name to load
3. Prompt area restores to saved state

---

## 7. History

- Right panel **🕐 History** tab
- Each tag selection/generation is auto-recorded
- Click entry to view details
- Clear all history available

---

## 8. AI Assistant Window

### 8.1 Opening

- Right panel → 💬 Simple AI → **🔲 Pop-out Window** button

### 8.2 Layout

```
+----------+----------------------------------+
|          |                                  |
|  Convo    |         Message Area              |
|  List     |   (Chat bubbles + Markdown)       |
| (Groups)  |                                  |
|          |                                  |
| -------- | -------------------------------- |
| Settings |         Input Area                |
|          |   [Model Picker] [Send]           |
+----------+----------------------------------+
```

### 8.3 Conversation Management

**New Conversation:**
- Click **➕ New Conversation** at the top

**Groups:**
- Organize by **time** or **custom groups**
- Click group header to collapse/expand
- **Right-click** group to rename or delete

### 8.4 Model Selection

- Model dropdown above the input area
- Lists all available models from active provider

### 8.5 Provider Switching

- **Provider switch** button next to input
- Shows current active provider name
- Click to switch between configured providers

### 8.6 Sending Messages

- Type in the input field
- Press **Enter** to send
- **Shift+Enter** for newline
- Click **Send button**

### 8.7 Message Bubbles

| Role | Position | Style |
|------|----------|-------|
| User | Right | Blue background, white text, rounded |
| AI | Left | Gray background with border, Markdown rendered |

### 8.8 Conversation Settings

Click **⚙️ Conversation Settings** near input:

| Setting | Description |
|---------|-------------|
| System Prompt | Custom AI system prompt |
| Auto-compress Context | Manage context length automatically |
| Temperature | Control AI randomness |

---

## 9. Simple AI Panel

### 9.1 Location

First tab in the right panel (💬 Simple AI).

### 9.2 Dual Modes

| Mode | Purpose |
|------|---------|
| 💬 Chat | Quick AI chat, synced with AI window |
| 🔍 Vision | Upload images for AI tag suggestion |

### 9.3 Sync with AI Window

- Shared conversation data
- Messages appear in both panels
- New conversations sync across both

---

## 10. AI Vision Tag Suggestion

### 10.1 Access

- Simple AI panel → **🔍 Vision** tab
- AI Assistant window → **Vision** tab at top

### 10.2 Uploading Images

| Method | Action |
|--------|--------|
| Click | Click upload area, open file picker |
| Drag | Drag image files into upload area |
| Multi-select | File picker supports Ctrl+multi-select |

### 10.3 Workflow

1. Upload image(s) → preview shown
2. Select AI model
3. Click **🔍 Start Recognition**
4. AI analyzes image and returns tag suggestions

### 10.4 Result Actions

| Action | Button | Description |
|--------|--------|-------------|
| Select | ☑️ Checkbox | Choose desired tags |
| Copy | 📋 | Copy selected tag text |
| Add to Positive | ➕ | Add to positive prompt |
| Favorite | ⭐ | Add to favorites |
| Import to Library | 📥 | Save to tag library (choose category/subcategory) |

### 10.5 Vision History

- Results are auto-saved
- View previous recognition results in history
- Synced with AI window

---

## 11. Settings Center

### 11.1 Opening

Click **⚙ Settings** in the status bar. Opens as independent window.

### 11.2 Categories

| Category | Icon | Content |
|----------|------|---------|
| General | ⚙ | Language, font size, random tag range |
| Appearance | 🎨 | Theme, custom accent color |
| API Config | 🔌 | Provider management |
| Shortcuts | ⌨ | Keyboard shortcut customization |
| Data | 💾 | Database import/export |
| About | ℹ | Version info |

### 11.3 API Provider Configuration

**Provider List:** Shows all configured providers. Active provider highlighted in green.

**Provider Fields:**

| Field | Description |
|-------|-------------|
| Name | Display name |
| Access Mode | `Official Login` or `API Only` |
| Protocol | `Responses API` or `Chat Completions` |
| Default Model | Default model for chat |
| Test Model | Model for connection testing |
| Context Size | Token limit (blank = default) |
| Base URL | API endpoint |
| API Key | Your API key (encrypted storage) |
| Model List | Fetched from upstream or manual entry |

**Config Preview:**
- `config.toml` — editable
- `auth.json` — editable

**Actions:**

| Button | Function |
|--------|----------|
| 🔄 Fetch Models | Auto-detect available models |
| 🧪 Test Connection | Verify API configuration |
| 💾 Save | Save provider config |
| 🔘 Switch | Set as active provider |
| 🗑️ Delete | Remove provider |

---

## 12. Keyboard Shortcuts

### 12.1 Defaults

| Function | Shortcut |
|----------|----------|
| Send Message | Enter |
| Newline | Shift+Enter |
| Search | Ctrl+F |
| Undo | Ctrl+Z |
| Redo | Ctrl+Shift+Z |
| Copy | Ctrl+C |
| Close Window | Escape |

### 12.2 Customizing

1. Settings → **⌨ Shortcuts**
2. Click a shortcut to edit
3. Press new key combination
4. Auto-saves

---

## 13. Data Management

### 13.1 Database

- Location: `%APPDATA%/grimoire/grimoire.db`
- Contains: tags, API configs (encrypted), chat history, favorites, presets

### 13.2 Backup & Restore

Settings → **💾 Data**:

| Button | Function |
|--------|----------|
| 📤 Export DB | Export database as `.db` file |
| 📥 Import DB | Restore from `.db` file |

---

## 14. FAQ

**Q: AI not responding to messages?**
1. Verify API provider is configured in Settings
2. Click "Test Connection" to verify
3. Click 🔄 refresh button
4. Check model is selected in dropdown

**Q: Simple AI and AI window not syncing?**
- Press **Ctrl+R** to refresh
- Switching right panel tabs triggers auto-refresh

**Q: Vision recognition fails?**
- Ensure selected model supports multimodal (e.g., GPT-4o)
- Check API key permissions

**Q: Tag library data lost?**
- Use Settings → 📥 Import Database to restore
- Or import a backed-up tag group

---

*Grimoire v7 — GPL-3.0 License*
