#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 YOUBIQUO S.r.l.
#
# Installs (or removes) a macOS LaunchAgent that periodically mirrors this
# repository from GitHub to the internal GitLab remote.
#
# Usage:
#   scripts/install-sync-agent.sh                 # install, every 900s
#   AETOS_SYNC_INTERVAL=3600 scripts/install-sync-agent.sh
#   scripts/install-sync-agent.sh --uninstall
#   scripts/install-sync-agent.sh --status
#
# The agent mirrors origin/main, so it works regardless of the state of your
# working copy and picks up commits made through the GitHub web interface.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS. On other systems use cron or systemd timers." >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
label="it.aetos-ai.office-assistant.sync"
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/aetos-sync.log"
interval="${AETOS_SYNC_INTERVAL:-900}"
domain="gui/$(id -u)"

case "${1:-}" in
  --uninstall)
    launchctl bootout "$domain/$label" 2>/dev/null || true
    rm -f "$plist"
    echo "Removed $label."
    exit 0
    ;;
  --status)
    if launchctl print "$domain/$label" >/dev/null 2>&1; then
      launchctl print "$domain/$label" | grep -E '^\s+(state|program|last exit code|runs) =' | sed 's/^ *//'
      echo "log: $log"
    else
      echo "Not installed."
    fi
    exit 0
    ;;
esac

for tool in git node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Required tool not found: $tool" >&2; exit 1; }
done

if ! git -C "$root" remote get-url gitlab >/dev/null 2>&1; then
  echo "Remote 'gitlab' is not configured in $root" >&2
  exit 1
fi

node_dir="$(dirname "$(command -v node)")"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$root/macos/build"

cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$root/scripts/sync-gitlab.sh</string>
    <string>main</string>
  </array>
  <key>WorkingDirectory</key><string>$root</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$node_dir:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
    <key>AETOS_SYNC_FROM</key><string>origin</string>
    <key>GIT_TERMINAL_PROMPT</key><string>0</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>$interval</integer>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
PLIST

plutil -lint "$plist" >/dev/null

launchctl bootout "$domain/$label" 2>/dev/null || true
launchctl bootstrap "$domain" "$plist"
launchctl enable "$domain/$label"

echo "Installed $label"
echo "  interval: ${interval}s"
echo "  plist:    $plist"
echo "  log:      $log"
echo "  run now:  launchctl kickstart -k $domain/$label"
