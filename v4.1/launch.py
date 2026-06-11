# -*- coding: utf-8 -*-
"""魔导书 v4.1 启动器"""
import os, sys, webbrowser, threading, time
from pathlib import Path

os.chdir(Path(__file__).parent)

def open_browser():
    time.sleep(1.5)
    webbrowser.open("http://127.0.0.1:5811")

threading.Thread(target=open_browser, daemon=True).start()

from server import app
print("=" * 50)
print("  魔导书 v4.1 - AI绘画提示词工作站")
print("  浏览器将自动打开 http://127.0.0.1:5811")
print("=" * 50)
app.run(host="127.0.0.1", port=5811, debug=False)
