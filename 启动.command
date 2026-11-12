#!/bin/bash
cd "$(dirname "$0")"
echo "今天做什么正在启动。浏览器会打开。"
echo "这个窗口要留着，关掉以后页面就打不开了。"
OPEN_BROWSER=1 exec python3 -u server.py
