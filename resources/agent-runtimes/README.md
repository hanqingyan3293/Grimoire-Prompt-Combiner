# Grimoire Agent Runtimes

Place locally prepared runtime executables in these folders:

- agent-runtimes/pi/pi.exe or pi.cmd
- agent-runtimes/opencode/opencode.exe or opencode.cmd
- agent-runtimes/codex/codex.exe or codex.cmd

Grimoire checks these files and the system PATH. It does not silently download or install runtimes. Runtime preparation must preserve each upstream project's license and notices.

The current local preparation state is recorded in runtime-manifest.json. Pi and OpenCode have prepared Windows x64 artifacts; the manifest records their source, version, build command, checksum, and smoke tests. The Agent UI still reports a clear unavailable state if an artifact is missing or fails to start.

