#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Stopping any running TimeMap servers..."

# Kill by port — catches whatever is actually listening
for port in 3001 5173 5174 5175; do
  pids=$(lsof -ti tcp:"$port" 2>/dev/null) || true
  if [ -n "$pids" ]; then
    echo "  Port $port: killing PIDs $pids"
    kill $pids 2>/dev/null || true
  fi
done

# Kill by process pattern — catches parent watchers and alternate-port instances
# Scoped to this project directory so other projects are unaffected
pkill -f "$SCRIPT_DIR/backend" 2>/dev/null || true
pkill -f "$SCRIPT_DIR/frontend" 2>/dev/null || true

sleep 1
echo "Done."
echo ""

echo "Starting backend..."
cd "$SCRIPT_DIR/backend"
npm run dev > "$SCRIPT_DIR/backend.log" 2>&1 &

echo "Starting frontend..."
cd "$SCRIPT_DIR/frontend"
npm run dev > "$SCRIPT_DIR/frontend.log" 2>&1 &

echo ""
echo "Backend  → http://localhost:3001   (logs: backend.log)"
echo "Frontend → http://localhost:5173   (logs: frontend.log)"
echo ""
echo "To stop: pkill -f '$SCRIPT_DIR/backend'; pkill -f '$SCRIPT_DIR/frontend'"
