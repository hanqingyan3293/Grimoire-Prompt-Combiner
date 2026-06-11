# -*- coding: utf-8 -*-
"""魔导书 - AI绘画提示词组合器 (桌面版)"""
import json, os, sys, time, random
from pathlib import Path
import customtkinter as ctk
from tkinter import messagebox, filedialog

# ---- 路径 ----
if getattr(sys, 'frozen', False):
    BASE = Path(sys._MEIPASS)
    RUNTIME = Path(os.path.dirname(sys.executable))
else:
    BASE = Path(__file__).parent
    RUNTIME = BASE

DATA_DIR = BASE / "data"
PRESETS_DIR = RUNTIME / "presets"
HISTORY_DIR = RUNTIME / "history"

for d in [PRESETS_DIR, HISTORY_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ---- 配置 ----
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")
QW = ['masterpiece', 'best quality']
FONT = ("Microsoft YaHei", 12)
FONT_SM = ("Microsoft YaHei", 11)

# ---- 工具 ----
def rjson(p, d=None):
    if Path(p).exists():
        with open(p, "r", encoding="utf-8") as f: return json.load(f)
    return d if d is not None else {}

def wjson(p, d):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f: json.dump(d, f, ensure_ascii=False, indent=2)

def load_tags():
    return rjson(DATA_DIR / "tags.json", {"categories":[],"presets":[]})

# ---- 主应用 ----
class GrimoireApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("魔导书 - AI绘画提示词组合器")
        self.geometry("1400x850")
        self.minsize(1000, 600)

        # 状态
        self.all_data = load_tags()
        self.pos_tags = []      # [{en,zh,weight,category,subcategory}]
        self.neg_tags = []
        self.active_tab = "positive"
        self.auto_sort = True
        self.use_quality = True
        self.active_cat = None
        self.active_sc = None
        self.favs = self._load_favs()
        self.search_mode = False

        # 布局
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # 左侧栏
        self.sidebar = ctk.CTkFrame(self, width=250, corner_radius=0, fg_color="#21232b")
        self.sidebar.grid(row=0, column=0, sticky="nswe")
        self.sidebar.grid_propagate(False)
        self._build_sidebar()

        # 中间
        self.main_area = ctk.CTkFrame(self, corner_radius=0, fg_color="#1a1b23")
        self.main_area.grid(row=0, column=1, sticky="nswe")
        self._build_main()

        # 右侧
        self.right_panel = ctk.CTkFrame(self, width=430, corner_radius=0, fg_color="#21232b")
        self.right_panel.grid(row=0, column=2, sticky="nswe")
        self.right_panel.grid_propagate(False)
        self._build_right()

    # ========== 左侧栏 ==========
    def _build_sidebar(self):
        self.sidebar.grid_columnconfigure(0, weight=1)
        self.sidebar.grid_rowconfigure(6, weight=1)

        # 搜索
        sf = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        sf.grid(row=0, column=0, sticky="ew", padx=8, pady=(8,4))
        sf.grid_columnconfigure(0, weight=1)
        self.search_var = ctk.StringVar()
        self.search_var.trace_add("write", lambda *a: self._do_search())
        self.search_entry = ctk.CTkEntry(sf, placeholder_text="搜索标签 (中/英文)...", textvariable=self.search_var, height=30, font=FONT_SM)
        self.search_entry.grid(row=0, column=0, sticky="ew")

        # 标题
        hdr = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        hdr.grid(row=1, column=0, sticky="ew", padx=8, pady=(4,0))
        ctk.CTkLabel(hdr, text="📁 标签分类", font=(FONT[0],11,"bold"), text_color="#6b6d82").pack(side="left")

        # 分类树
        self.tree_frame = ctk.CTkScrollableFrame(self.sidebar, fg_color="transparent")
        self.tree_frame.grid(row=2, column=0, sticky="nswe", padx=2, pady=4)
        self.tree_frame.grid_columnconfigure(0, weight=1)
        self._build_tree()

        # 收藏
        ctk.CTkLabel(self.sidebar, text="⭐ 我的收藏", font=(FONT[0],11,"bold"), text_color="#6b6d82", anchor="w").grid(row=3, column=0, sticky="ew", padx=12, pady=(8,2))
        self.fav_frame = ctk.CTkScrollableFrame(self.sidebar, fg_color="transparent", height=80)
        self.fav_frame.grid(row=4, column=0, sticky="ew", padx=2, pady=2)
        self._render_favs()

        # 预设
        ctk.CTkLabel(self.sidebar, text="📦 预设组合", font=(FONT[0],11,"bold"), text_color="#6b6d82", anchor="w").grid(row=5, column=0, sticky="ew", padx=12, pady=(8,2))
        self.pre_frame = ctk.CTkScrollableFrame(self.sidebar, fg_color="transparent", height=100)
        self.pre_frame.grid(row=6, column=0, sticky="nswe", padx=2, pady=2)
        self._render_presets()

    def _build_tree(self):
        for w in self.tree_frame.winfo_children():
            w.destroy()

        cats = self.all_data.get("categories", [])
        row = 0
        for cat in cats:
            is_nsfw = cat["name"] in ("NSFW", "NSFW标签")
            arrow = "▶" if self.active_cat != cat["name"] else "▼"

            cat_btn = ctk.CTkButton(self.tree_frame, text=f"{arrow} {cat['name']}  ({len(cat['subcategories'])})",
                                     anchor="w", fg_color="transparent", text_color="#a0a0b8" if not is_nsfw else "#e0556a",
                                     hover_color="#313442", font=FONT_SM, height=28, corner_radius=4,
                                     command=lambda c=cat["name"]: self._toggle_cat(c))
            cat_btn.grid(row=row, column=0, sticky="ew", padx=4, pady=1)
            row += 1

            if self.active_cat == cat["name"]:
                for sc in cat.get("subcategories", []):
                    is_active = self.active_sc == sc["name"] and self.active_cat == cat["name"]
                    fg = "#7c6ff7" if is_active else "#6b6d82"
                    bg = "#3a3d52" if is_active else "transparent"
                    sc_btn = ctk.CTkButton(self.tree_frame, text=f"  {sc['name']} ({len(sc['tags'])})",
                                            anchor="w", fg_color=bg, text_color=fg, hover_color="#313442",
                                            font=FONT_SM, height=26, corner_radius=4,
                                            command=lambda cn=cat["name"], sn=sc["name"]: self._select_sc(cn, sn))
                    sc_btn.grid(row=row, column=0, sticky="ew", padx=(16,4), pady=1)
                    row += 1

    def _toggle_cat(self, name):
        if self.active_cat == name:
            self.active_cat = None
            self.active_sc = None
        else:
            self.active_cat = name
            self.active_sc = None
        self._build_tree()
        self._render_tags()

    def _select_sc(self, cat, sc):
        self.search_mode = False
        self.search_var.set("")
        self.active_cat = cat
        self.active_sc = sc
        self._build_tree()
        self._render_tags()

    def _render_favs(self):
        for w in self.fav_frame.winfo_children():
            w.destroy()
        if not self.favs:
            ctk.CTkLabel(self.fav_frame, text="  点击标签旁的 ⭐ 收藏", font=FONT_SM, text_color="#6b6d82").pack(anchor="w", padx=8)
            return
        for en in self.favs:
            zh = self._find_zh(en)
            btn = ctk.CTkButton(self.fav_frame, text=f"⭐ {zh or en}", anchor="w",
                                 fg_color="transparent", text_color="#a0a0b8", hover_color="#313442",
                                 font=FONT_SM, height=26, corner_radius=4,
                                 command=lambda e=en, z=zh: self._add_tag(e, z or e))
            btn.pack(fill="x", padx=4, pady=1)

    def _render_presets(self):
        for w in self.pre_frame.winfo_children():
            w.destroy()
        presets = self.all_data.get("presets", [])
        # 用户存档
        user = []
        if PRESETS_DIR.exists():
            for f in PRESETS_DIR.glob("*.json"):
                p = rjson(f); p["_fn"] = f.stem; user.append(p)

        all_p = [("📌", p) for p in presets] + [("💾", p) for p in user]
        for icon, p in all_p:
            txt = f"{icon} {p.get('name','?')}"
            tags_count = len(p.get("tags",[]))
            btn = ctk.CTkButton(self.pre_frame, text=txt, anchor="w",
                                 fg_color="transparent", text_color="#a0a0b8", hover_color="#313442",
                                 font=FONT_SM, height=26, corner_radius=4,
                                 command=lambda p=p: self._apply_preset(p))
            btn.pack(fill="x", padx=4, pady=1)

    # ========== 中间主区域 ==========
    def _build_main(self):
        self.main_area.grid_columnconfigure(0, weight=1)
        self.main_area.grid_rowconfigure(1, weight=1)

        self.main_title = ctk.CTkLabel(self.main_area, text="请从左侧选择一个子类别", font=(FONT[0],14,"bold"), anchor="w")
        self.main_title.grid(row=0, column=0, sticky="ew", padx=16, pady=(12,4))

        self.tag_container = ctk.CTkScrollableFrame(self.main_area, fg_color="transparent")
        self.tag_container.grid(row=1, column=0, sticky="nswe", padx=12, pady=4)

    def _render_tags(self):
        for w in self.tag_container.winfo_children():
            w.destroy()

        if self.search_mode or not self.active_sc:
            if not self.search_mode:
                self.main_title.configure(text="请从左侧选择一个子类别")
            return

        # 查找当前子类别的标签
        all_tags = []
        for cat in self.all_data.get("categories", []):
            if cat["name"] == self.active_cat:
                for sc in cat.get("subcategories", []):
                    if sc["name"] == self.active_sc:
                        all_tags = sc["tags"]
                        break
                break

        self.main_title.configure(text=f"{self.active_cat} › {self.active_sc} ({len(all_tags)}个标签)")

        # 添加标签按钮
        add_btn = ctk.CTkButton(self.tag_container, text="✚ 添加标签到当前子类别", fg_color="#5b50c0", hover_color="#7c6ff7",
                                 font=FONT_SM, height=28, command=lambda: self._add_custom_tag_dlg())
        add_btn.pack(pady=(4,8))

        # 标签网格
        frame = ctk.CTkFrame(self.tag_container, fg_color="transparent")
        frame.pack(fill="both", expand=True)
        row, col = 0, 0
        max_cols = max(1, (self.main_area.winfo_width() - 40) // 160)

        for t in all_tags:
            is_pos = any(x["en"] == t["en"] for x in self.pos_tags)
            is_neg = any(x["en"] == t["en"] for x in self.neg_tags)
            fg = "#c8c0ff" if (is_pos or is_neg) else "#a0a0b8"
            bg = "#3a3560" if (is_pos or is_neg) else "#2a2c38"
            border = "#7c6ff7" if (is_pos or is_neg) else "#3a3d52"

            tag_frame = ctk.CTkFrame(frame, fg_color=bg, border_width=1, border_color=border, corner_radius=6)
            tag_frame.grid(row=row, column=col, padx=3, pady=3, sticky="ew")

            zh_text = t.get("zh", "") or t["en"]
            # 截断显示
            display = zh_text[:12] + (".." if len(zh_text) > 12 else "")
            lbl = ctk.CTkButton(tag_frame, text=display, fg_color="transparent", text_color=fg,
                                 hover_color="#3a3d52", font=FONT_SM, height=28, width=120,
                                 command=lambda en=t["en"], zh=t.get("zh",""): self._tag_click(en, zh))
            lbl.pack(side="left", padx=(2,0))

            # 星标
            is_fav = t["en"] in self.favs
            star = ctk.CTkButton(tag_frame, text="★" if is_fav else "☆", fg_color="transparent",
                                  text_color="#e0a050" if is_fav else "#4a4a5a",
                                  hover_color="#313442", font=("",11), width=24, height=28,
                                  command=lambda en=t["en"]: self._toggle_fav(en))
            star.pack(side="right", padx=(0,2))

            col += 1
            if col >= max_cols:
                col = 0; row += 1

    def _tag_click(self, en, zh):
        panel = self.neg_tags if self.active_tab == "negative" else self.pos_tags
        existing = [t for t in panel if t["en"] == en]
        if existing:
            panel[:] = [t for t in panel if t["en"] != en]
        else:
            info = self._find_cat(en) or {}
            panel.append({"en": en, "zh": zh or en, "weight": 1.0,
                          "category": info.get("category",""), "subcategory": info.get("subcategory","")})
        self._refresh_right()
        self._render_tags()

    def _add_tag(self, en, zh):
        panel = self.neg_tags if self.active_tab == "negative" else self.pos_tags
        if any(t["en"] == en for t in panel): return
        info = self._find_cat(en) or {}
        panel.append({"en": en, "zh": zh or en, "weight": 1.0,
                      "category": info.get("category",""), "subcategory": info.get("subcategory","")})
        self._refresh_right()

    def _toggle_fav(self, en):
        if en in self.favs: del self.favs[en]
        else: self.favs[en] = True
        self._save_favs()
        self._render_favs()
        self._render_tags()

    def _do_search(self):
        q = self.search_var.get().strip().lower()
        if not q:
            self.search_mode = False
            self._build_tree()
            self._render_tags()
            return

        self.search_mode = True
        self.main_title.configure(text=f"搜索结果: {q}")
        for w in self.tag_container.winfo_children():
            w.destroy()

        data = self.all_data
        row = 0
        for cat in data.get("categories", []):
            for sc in cat.get("subcategories", []):
                matches = [t for t in sc["tags"] if q in t["en"].lower() or q in t["zh"].lower()]
                if not matches: continue

                lbl = ctk.CTkLabel(self.tag_container, text=f"{cat['name']} › {sc['name']} ({len(matches)})",
                                    font=FONT_SM, text_color="#7c6ff7", anchor="w")
                lbl.grid(row=row, column=0, sticky="ew", padx=8, pady=(8,2))
                row += 1

                # tags
                tag_row = ctk.CTkFrame(self.tag_container, fg_color="transparent")
                tag_row.grid(row=row, column=0, sticky="ew", padx=4)
                c = 0
                for t in matches:
                    is_pos = any(x["en"] == t["en"] for x in self.pos_tags)
                    is_neg = any(x["en"] == t["en"] for x in self.neg_tags)
                    fg = "#c8c0ff" if (is_pos or is_neg) else "#a0a0b8"
                    bg = "#3a3560" if (is_pos or is_neg) else "#2a2c38"

                    b = ctk.CTkButton(tag_row, text=(t.get("zh","") or t["en"])[:14],
                                       fg_color=bg, text_color=fg, hover_color="#3a3d52",
                                       font=FONT_SM, height=26, width=100, corner_radius=4,
                                       command=lambda en=t["en"], zh=t.get("zh",""): self._tag_click(en, zh))
                    b.grid(row=0, column=c, padx=2, pady=2)
                    c += 1
                    if c >= 6: c = 0; row += 1
                row += 1

    # ========== 右侧面板 ==========
    def _build_right(self):
        self.right_panel.grid_columnconfigure(0, weight=1)
        self.right_panel.grid_rowconfigure(3, weight=1)

        # 标签切换
        tabs = ctk.CTkFrame(self.right_panel, fg_color="transparent")
        tabs.grid(row=0, column=0, sticky="ew", padx=4, pady=(8,0))
        tabs.grid_columnconfigure(0, weight=1)
        tabs.grid_columnconfigure(1, weight=1)
        self.btn_pos = ctk.CTkButton(tabs, text="✅ 正面提示词", fg_color="#5b50c0", font=FONT_SM, height=32,
                                      command=lambda: self._switch_tab("positive"))
        self.btn_pos.grid(row=0, column=0, padx=2, sticky="ew")
        self.btn_neg = ctk.CTkButton(tabs, text="❌ 负面提示词", fg_color="#282a36", font=FONT_SM, height=32,
                                      command=lambda: self._switch_tab("negative"))
        self.btn_neg.grid(row=0, column=1, padx=2, sticky="ew")

        # 排序/计数
        topbar = ctk.CTkFrame(self.right_panel, fg_color="transparent")
        topbar.grid(row=1, column=0, sticky="ew", padx=8, pady=4)
        self.sort_var = ctk.BooleanVar(value=True)
        self.sort_cb = ctk.CTkCheckBox(topbar, text="自动按权重排序", variable=self.sort_var,
                                        font=FONT_SM, checkbox_height=18, checkbox_width=18,
                                        command=self._refresh_right)
        self.sort_cb.pack(side="left")
        self.tag_count_lbl = ctk.CTkLabel(topbar, text="已选 0 个", font=FONT_SM, text_color="#6b6d82")
        self.tag_count_lbl.pack(side="right")

        # 已选标签
        self.sel_frame = ctk.CTkScrollableFrame(self.right_panel, fg_color="transparent")
        self.sel_frame.grid(row=2, column=0, sticky="nswe", padx=4)

        # 提示词预览
        prev_frame = ctk.CTkFrame(self.right_panel, fg_color="#1a1b23")
        prev_frame.grid(row=3, column=0, sticky="ew", padx=4, pady=(4,4))
        prev_frame.grid_columnconfigure(0, weight=1)

        ph = ctk.CTkFrame(prev_frame, fg_color="transparent")
        ph.grid(row=0, column=0, sticky="ew", padx=8, pady=(6,0))
        ctk.CTkLabel(ph, text="📝 生成的提示词", font=(FONT[0],12,"bold")).pack(side="left")

        self.fmt_var = ctk.StringVar(value="通用格式")
        fmt_menu = ctk.CTkOptionMenu(ph, values=["通用格式", "NovelAI", "SD WebUI"], variable=self.fmt_var,
                                      font=FONT_SM, height=24, width=110, command=lambda _: self._update_preview())
        fmt_menu.pack(side="right")

        self.prompt_text = ctk.CTkTextbox(prev_frame, height=100, font=("Consolas",11), fg_color="#1a1b23",
                                           border_width=0, wrap="word")
        self.prompt_text.grid(row=1, column=0, sticky="ew", padx=8, pady=4)
        self.prompt_text.insert("1.0", "选择标签后这里会显示完整提示词...")
        self.prompt_text.configure(state="disabled")

        btns = ctk.CTkFrame(prev_frame, fg_color="transparent")
        btns.grid(row=2, column=0, sticky="ew", padx=8, pady=(0,6))
        ctk.CTkButton(btns, text="📋 复制英文", fg_color="#7c6ff7", font=FONT_SM, height=28,
                       command=self._copy_en).pack(side="left", padx=2)
        ctk.CTkButton(btns, text="📋 复制中文", fg_color="#5b50c0", font=FONT_SM, height=28,
                       command=self._copy_cn).pack(side="left", padx=2)
        ctk.CTkButton(btns, text="💾 保存预设", font=FONT_SM, height=28,
                       fg_color="#282a36", command=self._save_preset_dlg).pack(side="left", padx=2)
        ctk.CTkButton(btns, text="🎲 随机", font=FONT_SM, height=28,
                       fg_color="#282a36", command=self._random).pack(side="right", padx=2)
        ctk.CTkButton(btns, text="🗑 清空", font=FONT_SM, height=28,
                       fg_color="#e0556a", command=self._clear_all).pack(side="right", padx=2)

        self._refresh_right()

    def _switch_tab(self, tab):
        self.active_tab = tab
        if tab == "positive":
            self.btn_pos.configure(fg_color="#5b50c0")
            self.btn_neg.configure(fg_color="#282a36")
        else:
            self.btn_pos.configure(fg_color="#282a36")
            self.btn_neg.configure(fg_color="#5b50c0")
        self._refresh_right()
        self._render_tags()

    def _refresh_right(self):
        panel = self.neg_tags if self.active_tab == "negative" else self.pos_tags
        self.auto_sort = self.sort_var.get()
        sorted_tags = sorted(panel, key=lambda t: -t["weight"]) if self.auto_sort else panel

        self.tag_count_lbl.configure(text=f"已选 {len(panel)} 个")

        for w in self.sel_frame.winfo_children():
            w.destroy()

        if not sorted_tags:
            ctk.CTkLabel(self.sel_frame, text="点击左侧标签添加到此处", font=FONT_SM, text_color="#6b6d82").pack(pady=20)
        else:
            # 按分类分组
            groups = {}
            for t in sorted_tags:
                cat = t.get("category","") or "未分类"
                groups.setdefault(cat, []).append(t)

            for cat, tags in groups.items():
                ctk.CTkLabel(self.sel_frame, text=f"● {cat} ({len(tags)})", font=(FONT[0],10,"bold"),
                              text_color="#7c6ff7", anchor="w").pack(fill="x", padx=6, pady=(6,2))
                for t in tags:
                    row = ctk.CTkFrame(self.sel_frame, fg_color="#282a36", corner_radius=4)
                    row.pack(fill="x", padx=4, pady=1)
                    row.grid_columnconfigure(1, weight=1)

                    zh = t.get("zh","") or t["en"]
                    ctk.CTkLabel(row, text=zh[:16], font=FONT_SM, anchor="w", width=100).grid(row=0, column=0, padx=(6,2))

                    wv = ctk.DoubleVar(value=t["weight"])
                    def on_w_change(v, en=t["en"]):
                        for x in panel:
                            if x["en"] == en: x["weight"] = round(v, 1); break
                        self._update_preview()

                    slider = ctk.CTkSlider(row, from_=0.5, to=2.0, number_of_steps=15, variable=wv,
                                            width=80, height=14, command=lambda v, e=t["en"]: on_w_change(v, e))
                    slider.grid(row=0, column=1, padx=4, sticky="ew")

                    val_lbl = ctk.CTkLabel(row, text=f"{t['weight']:.1f}", font=FONT_SM, text_color="#7c6ff7", width=30)
                    val_lbl.grid(row=0, column=2, padx=2)
                    # 更新标签
                    def mk_updater(lbl, en=t["en"]):
                        def updater(v):
                            lbl.configure(text=f"{v:.1f}")
                            for x in panel:
                                if x["en"] == en: x["weight"] = round(v, 1); break
                            self._update_preview()
                        return updater
                    slider.configure(command=mk_updater(val_lbl, t["en"]))

                    del_btn = ctk.CTkButton(row, text="✕", fg_color="transparent", text_color="#6b6d82",
                                             hover_color="#e0556a", width=24, height=24, font=("",12),
                                             command=lambda en=t["en"]: self._remove_tag(en))
                    del_btn.grid(row=0, column=3, padx=(0,4))

        self._update_preview()

    def _update_preview(self):
        pos = self.pos_tags
        neg = self.neg_tags
        if self.auto_sort:
            pos = sorted(pos, key=lambda t: -t["weight"])
            neg = sorted(neg, key=lambda t: -t["weight"])

        fmt = self.fmt_var.get()
        fmt_map = {"通用格式": "generic", "NovelAI": "novelai", "SD WebUI": "sdwebui"}
        f = fmt_map.get(fmt, "generic")

        def gen(tags):
            p = []
            for t in tags:
                if abs(t["weight"] - 1.0) < 0.01:
                    p.append(t["en"])
                elif f == "novelai":
                    if t["weight"] > 1.0:
                        n = min(round((t["weight"]-1.0)*10), 5)
                        p.append("{"*n + t["en"] + "}"*n)
                    else:
                        n = min(round((1.0-t["weight"])*10), 5)
                        p.append("["*n + t["en"] + "]"*n)
                else:
                    p.append(f"({t['en']}:{t['weight']:.1f})" if t["weight"]>1.0 else f"[{t['en']}:{t['weight']:.1f}]")
            return ", ".join(p)

        parts = []
        if self.use_quality and pos:
            parts.append(", ".join(QW))
        if pos:
            parts.append(gen(pos))

        txt = ", ".join(parts)
        if neg:
            txt += "\n--neg " + gen(neg)

        self.prompt_text.configure(state="normal")
        self.prompt_text.delete("1.0", "end")
        self.prompt_text.insert("1.0", txt or "选择标签后这里会显示完整提示词...")
        self.prompt_text.configure(state="disabled")

    def _remove_tag(self, en):
        self.pos_tags[:] = [t for t in self.pos_tags if t["en"] != en]
        self.neg_tags[:] = [t for t in self.neg_tags if t["en"] != en]
        self._refresh_right()
        self._render_tags()

    def _clear_all(self):
        self.pos_tags.clear()
        self.neg_tags.clear()
        self._refresh_right()
        self._render_tags()

    def _copy_en(self):
        txt = self.prompt_text.get("1.0", "end-1c")
        if txt and "选择标签" not in txt:
            self.clipboard_clear(); self.clipboard_append(txt)
            self._save_history(txt)
            messagebox.showinfo("复制成功", "英文提示词已复制到剪贴板!")

    def _copy_cn(self):
        pos = self.pos_tags
        neg = self.neg_tags
        if self.auto_sort:
            pos = sorted(pos, key=lambda t: -t["weight"])
            neg = sorted(neg, key=lambda t: -t["weight"])
        def gen_cn(tags):
            p = []
            for t in tags:
                zh = t.get("zh","") or t["en"]
                if abs(t["weight"]-1.0)<0.01: p.append(zh)
                else: p.append(f"({zh}:{t['weight']:.1f})" if t["weight"]>1.0 else f"[{zh}:{t['weight']:.1f}]")
            return ", ".join(p)
        txt = gen_cn(pos)
        if neg: txt += "\n--neg " + gen_cn(neg)
        if txt:
            self.clipboard_clear(); self.clipboard_append(txt)
            messagebox.showinfo("复制成功", "中文提示词已复制到剪贴板!")

    def _save_history(self, txt):
        ts = time.strftime("%Y%m%d_%H%M%S")
        wjson(HISTORY_DIR / f"{ts}.json", {
            "prompt": txt,
            "tags": [t["en"] for t in self.pos_tags],
            "negative_tags": [t["en"] for t in self.neg_tags],
            "created": time.strftime("%Y-%m-%d %H:%M:%S")
        })

    def _random(self):
        self.pos_tags.clear()
        self.neg_tags.clear()
        all_avail = []
        for cat in self.all_data.get("categories", []):
            if cat["name"] in ("NSFW", "NSFW标签"): continue
            for sc in cat.get("subcategories", []):
                for t in sc["tags"]:
                    all_avail.append({"en": t["en"], "zh": t.get("zh",""), "category": cat["name"], "subcategory": sc["name"]})

        cnt = random.randint(3, 8)
        picked = []
        seen = set()
        while len(picked) < cnt and all_avail:
            idx = random.randint(0, len(all_avail)-1)
            t = all_avail[idx]
            if t["en"] not in seen:
                seen.add(t["en"])
                picked.append({**t, "weight": round(random.uniform(1.0, 1.5), 1)})
            all_avail.pop(idx)

        self.pos_tags = picked
        self._refresh_right()
        self._render_tags()

    def _apply_preset(self, preset):
        self.pos_tags.clear()
        self.neg_tags.clear()
        wmap = preset.get("weights", {})
        for en in preset.get("tags", []):
            zh = self._find_zh(en)
            info = self._find_cat(en) or {}
            self.pos_tags.append({"en": en, "zh": zh or en, "weight": wmap.get(en, 1.0),
                                   "category": info.get("category",""), "subcategory": info.get("subcategory","")})
        nw = preset.get("negative_weights", {})
        for en in preset.get("negative_tags", []):
            zh = self._find_zh(en)
            info = self._find_cat(en) or {}
            self.neg_tags.append({"en": en, "zh": zh or en, "weight": nw.get(en, 1.0),
                                   "category": info.get("category",""), "subcategory": info.get("subcategory","")})
        self._refresh_right()
        self._render_tags()

    def _save_preset_dlg(self):
        if not self.pos_tags and not self.neg_tags:
            messagebox.showwarning("提示", "请先选择标签")
            return
        dlg = ctk.CTkInputDialog(title="保存预设", text="请输入预设名称:")
        name = dlg.get_input()
        if name:
            wmap = {t["en"]: t["weight"] for t in self.pos_tags}
            nw = {t["en"]: t["weight"] for t in self.neg_tags}
            preset = {
                "name": name,
                "tags": [t["en"] for t in self.pos_tags],
                "weights": wmap,
                "negative_tags": [t["en"] for t in self.neg_tags],
                "negative_weights": nw,
                "created": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            safe = "".join(c for c in name if c.isalnum() or c in "._- ")
            wjson(PRESETS_DIR / f"{safe}.json", preset)
            self._render_presets()
            messagebox.showinfo("成功", f"预设已保存: {name}")

    def _add_custom_tag_dlg(self):
        dlg = ctk.CTkInputDialog(title="添加标签", text="输入标签 (英文|中文):")
        val = dlg.get_input()
        if val:
            parts = val.split("|")
            en = parts[0].strip()
            zh = parts[1].strip() if len(parts) > 1 else en
            if en:
                # 添加到当前子类别
                self.pos_tags.append({"en": en, "zh": zh, "weight": 1.0,
                                       "category": self.active_cat or "",
                                       "subcategory": self.active_sc or ""})
                self._refresh_right()
                messagebox.showinfo("成功", f"标签已添加: {zh}")

    # ---- 工具 ----
    def _find_zh(self, en):
        for cat in self.all_data.get("categories", []):
            for sc in cat.get("subcategories", []):
                for t in sc["tags"]:
                    if t["en"] == en: return t.get("zh","")
        return None

    def _find_cat(self, en):
        for cat in self.all_data.get("categories", []):
            for sc in cat.get("subcategories", []):
                for t in sc["tags"]:
                    if t["en"] == en:
                        return {"category": cat["name"], "subcategory": sc["name"]}
        return None

    def _load_favs(self):
        fp = RUNTIME / "favorites.json"
        return rjson(fp, {})

    def _save_favs(self):
        wjson(RUNTIME / "favorites.json", self.favs)

if __name__ == "__main__":
    app = GrimoireApp()
    app.mainloop()
