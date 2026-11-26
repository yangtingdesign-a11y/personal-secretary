#!/bin/bash
cd "$(dirname "$0")"
ROOT="$(pwd)"
APP="$HOME/Library/Application Support/today-do"
LABEL="local.today-do"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
PYTHON="$(command -v python3)"
UID_NUM="$(id -u)"
URL="http://127.0.0.1:8787/"

mkdir -p "$APP/static" "$APP/data" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$ROOT/server.py" "$APP/server.py"
rm -rf "$APP/static"
cp -R "$ROOT/static" "$APP/static"

if [ -f "$ROOT/data/app.json" ] && [ ! -L "$ROOT/data/app.json" ]; then
  if [ ! -f "$APP/data/app.json" ] || [ "$ROOT/data/app.json" -nt "$APP/data/app.json" ]; then
    cp "$ROOT/data/app.json" "$APP/data/app.json"
  fi
  rm "$ROOT/data/app.json"
  ln -s "$APP/data/app.json" "$ROOT/data/app.json"
elif [ ! -e "$APP/data/app.json" ] && [ -f "$ROOT/data/app.json" ]; then
  cp "$ROOT/data/app.json" "$APP/data/app.json"
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PYTHON}</string>
    <string>-u</string>
    <string>${APP}/server.py</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${APP}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/today-do.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/today-do.err.log</string>
</dict>
</plist>
EOF

healthy() {
  curl -sf --max-time 2 "${URL}api/health" >/dev/null
}

PIDS="$(lsof -nP -t -iTCP:8787 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  kill $PIDS 2>/dev/null || true
  sleep 0.4
fi
launchctl bootout "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"

for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if healthy; then
    open "$URL"
    echo "已经在后台运行。这个窗口可以关掉。"
    echo "以后直接打开 ${URL}"
    exit 0
  fi
  sleep 0.4
done

echo "还没有打开。可以再双击一次。"
exit 1
