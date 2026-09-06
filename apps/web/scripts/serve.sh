#!/usr/bin/env bash
# Serves apps/web/dist for testing, on this machine and on the local network.
#
# The network address matters more than it looks: this is a phone-first
# product, and the only honest way to judge it is on a phone. `vite preview`
# binds to localhost only unless told otherwise.
#
# Detached with `setsid` where it exists and a double-fork where it does not
# (macOS has no setsid), so closing the terminal — or whatever started this —
# does not take the server with it.
#
#   scripts/serve.sh          start it
#   scripts/serve.sh stop     stop it
#   scripts/serve.sh status   is it running, and on what address
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
PORT="${PORT:-8083}"
LOG="${TMPDIR:-/tmp}/openpixels-serve.log"
PIDFILE="${TMPDIR:-/tmp}/openpixels-serve.pid"

lan_address() {
  for iface in en0 en1 en2 eth0; do
    addr="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    [ -n "$addr" ] && { echo "$addr"; return; }
  done
  # Linux fallback.
  hostname -I 2>/dev/null | awk '{print $1}'
}

running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

case "${1:-start}" in
  stop)
    if running; then
      kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE"
      echo "stopped"
    else
      # It may have been started some other way.
      pkill -f "vite.*preview.*$PORT" 2>/dev/null && echo "stopped" || echo "not running"
    fi
    exit 0
    ;;
  status)
    if running && curl -sS -o /dev/null --max-time 3 "http://localhost:$PORT/"; then
      echo "running on http://localhost:$PORT/ (pid $(cat "$PIDFILE"))"
    else
      echo "not running"
      exit 1
    fi
    exit 0
    ;;
esac

[ -f "$WEB_DIR/dist/index.html" ] || {
  echo "serve.sh: no build in dist/ — run 'npm run build' first" >&2
  exit 1
}
[ -d "$WEB_DIR/dist/models" ] || {
  echo "serve.sh: dist/ has no models — run 'npm run build', not just 'vite build'" >&2
  exit 1
}

running && { echo "already running: http://localhost:$PORT/"; exit 0; }

cd "$WEB_DIR"
if command -v setsid >/dev/null 2>&1; then
  setsid nohup node node_modules/vite/bin/vite.js preview --port "$PORT" --host 0.0.0.0 \
    > "$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
else
  # macOS: no setsid. Python detaches into its own session the same way.
  python3 - "$WEB_DIR" "$PORT" "$LOG" "$PIDFILE" <<'PY'
import os, sys
web, port, log, pidfile = sys.argv[1:5]
if os.fork():                      # parent returns to the shell
    raise SystemExit
os.setsid()                        # new session: no controlling terminal
if os.fork():                      # the session leader exits, so nothing can
    raise SystemExit               # ever reattach one
open(pidfile, "w").write(str(os.getpid()))
fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
os.dup2(os.open(os.devnull, os.O_RDONLY), 0)
os.dup2(fd, 1)
os.dup2(fd, 2)
os.chdir(web)
os.execvp("node", ["node", "node_modules/vite/bin/vite.js", "preview",
                   "--port", port, "--host", "0.0.0.0"])
PY
fi

for _ in $(seq 40); do
  curl -sS -o /dev/null --max-time 1 "http://localhost:$PORT/" 2>/dev/null && break
  sleep 0.5
done

if ! curl -sS -o /dev/null --max-time 2 "http://localhost:$PORT/" 2>/dev/null; then
  echo "serve.sh: the server did not come up — see $LOG" >&2
  tail -5 "$LOG" >&2
  exit 1
fi

lan="$(lan_address)"
echo "OpenPixels is serving:"
echo "  this machine   http://localhost:$PORT/"
[ -n "$lan" ] && echo "  your phone     http://$lan:$PORT/    (same Wi-Fi)"
echo
echo "  log     $LOG"
echo "  stop    scripts/serve.sh stop"
