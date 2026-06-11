# -*- coding: utf-8 -*-
import subprocess, sys, os, webbrowser, time
BASE = os.path.dirname(os.path.abspath(__file__))
try:
    import flask
except ImportError:
    print("Installing dependencies...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "flask", "openpyxl", "-q"])
print("Starting Grimoire v4 on http://127.0.0.1:5810")
webbrowser.open("http://127.0.0.1:5810")
os.chdir(BASE)
subprocess.run([sys.executable, "server.py"])