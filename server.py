#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""计划本的本地后台。

网页只负责写下和查看。这个进程跑在你自己的电脑上，做两件事：
把记录写进 data/notes.json，到了提醒时间就弹出系统通知。
plans 预留给下一版计划表，提醒以后和记录共用这一套到点检查。
"""

import json
import os
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from datetime import datetime

try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except (AttributeError, OSError):
    pass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DATA_FILE = ROOT / "data" / "notes.json"
STATE_FILE = ROOT / "data" / "app.json"
HOST = "127.0.0.1"
PORT = 8787
MAX_CONTENT = 4000

lock = threading.Lock()
last_notify_error_at = 0.0


def now_local():
    return datetime.now().replace(microsecond=0)


def iso_now():
    return now_local().isoformat(timespec="seconds")


def parse_date(value):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError("日期格式不对")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise ValueError("日期格式不对")
    return value


def parse_remind_at(value):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError("提醒时间格式不对")
    text = value.strip()
    if len(text) == 16:
        text = text + ":00"
    try:
        datetime.strptime(text, "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        raise ValueError("提醒时间格式不对")
    return text


def empty_store():
    return {"version": 1, "notes": [], "plans": []}


def load_app_state():
    if not STATE_FILE.exists():
        return None
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get("version") not in (1, 2, 3, 4):
        return None
    if not isinstance(data.get("currentWeek"), dict) or not isinstance(data.get("homeTasks"), list):
        return None
    return data


def save_app_state(data):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_FILE.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(STATE_FILE)


def load_store():
    if not DATA_FILE.exists():
        return empty_store()
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print("记录文件读不出来，这一次先按空的打开：", exc)
        return empty_store()
    if not isinstance(data, dict):
        return empty_store()
    notes = data.get("notes", [])
    plans = data.get("plans", [])
    if not isinstance(notes, list):
        notes = []
    if not isinstance(plans, list):
        plans = []
    data["version"] = 1
    data["notes"] = [
        note
        for note in notes
        if isinstance(note, dict) and note.get("id") and isinstance(note.get("content"), str)
    ]
    data["plans"] = plans
    return data


def save_store(store):
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = DATA_FILE.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(store, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(DATA_FILE)


def osa_escape(text):
    return (
        text.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\r", " ")
        .replace("\n", " ")
    )


def notify(title, body):
    global last_notify_error_at
    script = 'display notification "%s" with title "%s"' % (
        osa_escape(body)[:180],
        osa_escape(title)[:40],
    )
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=8,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        remember_notify_error(str(exc))
        return False
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "系统没有允许通知").strip()
        remember_notify_error(message)
        return False
    return True


def remember_notify_error(message):
    global last_notify_error_at
    current = time.time()
    if current - last_notify_error_at < 60:
        return
    last_notify_error_at = current
    print("提醒没有弹出：", message)


def snippet(content):
    text = " ".join((content or "").split())
    if len(text) > 70:
        return text[:70] + "…"
    return text or "有一条记录到时间了"


def due_notes(notes):
    current = now_local()
    found = []
    for note in notes:
        if note.get("seenAt") or note.get("notifiedAt"):
            continue
        remind_at = note.get("remindAt")
        if not remind_at:
            continue
        try:
            when = datetime.strptime(remind_at, "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            continue
        if when <= current:
            found.append(note)
    return found


def fire_due():
    with lock:
        store = load_store()
        due = due_notes(store["notes"])
        previews = [(note["id"], snippet(note.get("content"))) for note in due]
    if not previews:
        return
    if len(previews) == 1:
        sent = notify("计划本", previews[0][1])
    else:
        sent = notify("计划本", "有 %d 条记录到提醒时间了" % len(previews))
    if not sent:
        return
    due_ids = set(item[0] for item in previews)
    stamp = iso_now()
    with lock:
        store = load_store()
        for note in store["notes"]:
            if note.get("id") in due_ids and not note.get("seenAt") and not note.get("notifiedAt"):
                note["notifiedAt"] = stamp
        save_store(store)
    print("已弹出提醒，共 %d 条" % len(due_ids))


def reminder_loop():
    while True:
        try:
            fire_due()
        except Exception as exc:
            print("检查提醒时出错：", exc)
        threading.Event().wait(10)


def find_note(store, note_id):
    for note in store["notes"]:
        if note.get("id") == note_id:
            return note
    return None


def public_note(note):
    return {
        "id": note.get("id"),
        "content": note.get("content") or "",
        "date": note.get("date"),
        "remindAt": note.get("remindAt"),
        "notifiedAt": note.get("notifiedAt"),
        "seenAt": note.get("seenAt"),
        "createdAt": note.get("createdAt"),
        "updatedAt": note.get("updatedAt"),
    }


def validate_note_fields(body, partial):
    if not isinstance(body, dict):
        raise ValueError("内容格式不对")
    result = {}
    if "content" in body or not partial:
        content = body.get("content", "")
        if not isinstance(content, str):
            raise ValueError("记录内容格式不对")
        content = content.strip()
        if not content:
            raise ValueError("先写下一句再保存")
        if len(content) > MAX_CONTENT:
            raise ValueError("这一条太长了，请分成几条")
        result["content"] = content
    if "date" in body or not partial:
        result["date"] = parse_date(body.get("date"))
    if "remindAt" in body or not partial:
        result["remindAt"] = parse_remind_at(body.get("remindAt"))
    if "seen" in body:
        if not isinstance(body["seen"], bool):
            raise ValueError("已读标记不对")
        result["seen"] = body["seen"]
    return result


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/health":
            self.send_json({"ok": True, "service": "计划本"})
            return
        if path == "/api/state":
            with lock:
                data = load_app_state()
            if data is None:
                self.send_json({"error": "还没有保存"}, 404)
                return
            self.send_json(data)
            return
        if path == "/api/notes":
            with lock:
                store = load_store()
            notes = [public_note(note) for note in store["notes"]]
            notes.sort(
                key=lambda note: (note.get("date") or "", note.get("createdAt") or ""),
                reverse=True,
            )
            self.send_json({"notes": notes})
            return
        self.serve_static(path)

    def do_PUT(self):
        path = unquote(urlparse(self.path).path)
        if path != "/api/state":
            self.send_json({"error": "没有这个地址"}, 404)
            return
        try:
            data = self.read_state()
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        with lock:
            save_app_state(data)
        self.send_json({"ok": True})

    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        if path != "/api/notes":
            self.send_json({"error": "没有这个地址"}, 404)
            return
        try:
            fields = validate_note_fields(self.read_json(), partial=False)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        stamp = iso_now()
        note = {
            "id": uuid.uuid4().hex[:12],
            "content": fields["content"],
            "date": fields["date"],
            "remindAt": fields["remindAt"],
            "notifiedAt": None,
            "seenAt": None,
            "createdAt": stamp,
            "updatedAt": stamp,
        }
        with lock:
            store = load_store()
            store["notes"].append(note)
            save_store(store)
        self.send_json({"note": public_note(note)}, 201)

    def do_PATCH(self):
        note_id = self.note_id_from_path()
        if note_id is None:
            self.send_json({"error": "没有这个地址"}, 404)
            return
        try:
            fields = validate_note_fields(self.read_json(), partial=True)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
            return
        with lock:
            store = load_store()
            note = find_note(store, note_id)
            if note is None:
                self.send_json({"error": "找不到这条记录"}, 404)
                return
            if "content" in fields:
                note["content"] = fields["content"]
            if "date" in fields:
                note["date"] = fields["date"]
            if "remindAt" in fields and fields["remindAt"] != note.get("remindAt"):
                note["remindAt"] = fields["remindAt"]
                note["notifiedAt"] = None
                note["seenAt"] = None
            elif "remindAt" in fields:
                note["remindAt"] = fields["remindAt"]
            if fields.get("seen") is True:
                note["seenAt"] = iso_now()
            elif fields.get("seen") is False:
                note["seenAt"] = None
            note["updatedAt"] = iso_now()
            save_store(store)
            payload = public_note(note)
        self.send_json({"note": payload})

    def do_DELETE(self):
        note_id = self.note_id_from_path()
        if note_id is None:
            self.send_json({"error": "没有这个地址"}, 404)
            return
        with lock:
            store = load_store()
            kept = [note for note in store["notes"] if note.get("id") != note_id]
            if len(kept) == len(store["notes"]):
                self.send_json({"error": "找不到这条记录"}, 404)
                return
            store["notes"] = kept
            save_store(store)
        self.send_json({"ok": True})

    def note_id_from_path(self):
        path = unquote(urlparse(self.path).path)
        prefix = "/api/notes/"
        if not path.startswith(prefix):
            return None
        note_id = path[len(prefix):]
        if not note_id or "/" in note_id:
            return None
        return note_id

    def read_body(self, limit):
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            raise ValueError("内容格式不对")
        if length < 0 or length > limit:
            raise ValueError("内容太长了")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("内容格式不对")

    def read_json(self):
        return self.read_body(200000)

    def read_state(self):
        data = self.read_body(2000000)
        if not isinstance(data, dict) or data.get("version") not in (1, 2, 3, 4):
            raise ValueError("内容格式不对")
        if not isinstance(data.get("currentWeek"), dict) or not isinstance(data.get("homeTasks"), list):
            raise ValueError("内容格式不对")
        return data

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        relative = path.lstrip("/")
        file = (STATIC / relative).resolve()
        static_root = STATIC.resolve()
        inside = file == static_root or str(file).startswith(str(static_root) + os.sep)
        if not inside or not file.is_file():
            self.send_error(404)
            return
        types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
        }
        data = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", types.get(file.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


class Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    worker = threading.Thread(target=reminder_loop, name="reminders", daemon=True)
    worker.start()
    try:
        server = Server((HOST, PORT), Handler)
    except OSError as exc:
        print("端口 %s 打不开：%s" % (PORT, exc))
        print("如果计划本已经在运行，直接打开 http://%s:%s" % (HOST, PORT))
        raise SystemExit(1)
    url = "http://%s:%s" % (HOST, PORT)
    print("今天做什么已启动：%s" % url)
    print("使用中的数据保存在 %s" % STATE_FILE)
    if os.environ.get("OPEN_BROWSER") == "1":
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
        server.server_close()


if __name__ == "__main__":
    main()
