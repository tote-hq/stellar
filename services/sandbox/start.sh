#!/bin/sh
# One X server on :99. A second Xvfb exits with "Server is already active"
# and x11vnc then fails to open the display. Reuse a live server. Remove
# the lock only when the recorded pid is not running.
set -eu
export DISPLAY=:99
mkdir -p /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix

wait_for_display() {
  python3 - <<'PY'
import ctypes
import sys
import time

lib = ctypes.CDLL("libX11.so.6")
lib.XOpenDisplay.restype = ctypes.c_void_p
lib.XCloseDisplay.argtypes = [ctypes.c_void_p]
for _ in range(100):
    display = lib.XOpenDisplay(b":99")
    if display:
        lib.XCloseDisplay(display)
        sys.exit(0)
    time.sleep(0.1)
sys.exit(1)
PY
}

xvfb_pid=""
if [ -f /tmp/.X99-lock ]; then
  pid=$(tr -cd '0-9' < /tmp/.X99-lock)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "Xvfb already running on :99 (pid $pid)"
  else
    rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
    Xvfb :99 -screen 0 1366x900x24 -nolisten tcp &
    xvfb_pid=$!
  fi
else
  Xvfb :99 -screen 0 1366x900x24 -nolisten tcp &
  xvfb_pid=$!
fi

if ! wait_for_display; then
  echo "display :99 did not open" >&2
  exit 1
fi

x11vnc -display :99 -localhost -rfbport 5901 -forever -nopw -shared -noclipboard -nosel -quiet &
vnc_pid=$!
uv run uvicorn server:app --host 0.0.0.0 --port "${PORT:-8080}" &
api_pid=$!

cleanup() {
  kill "$api_pid" "$vnc_pid" 2>/dev/null || true
  if [ -n "$xvfb_pid" ]; then
    kill "$xvfb_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM
wait "$api_pid"
