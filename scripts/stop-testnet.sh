#!/bin/bash
# JOULE Testnet — Stop Script

JOULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$JOULE_DIR/data/testnet/gjoule.pid"

if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping JOULE (PID: $PID)..."
        kill "$PID"
        sleep 3
        if kill -0 "$PID" 2>/dev/null; then
            echo "Force killing..."
            kill -9 "$PID"
        fi
        rm "$PIDFILE"
        echo "JOULE stopped."
    else
        echo "JOULE not running (stale PID file)"
        rm "$PIDFILE"
    fi
else
    echo "No PID file. Checking for process..."
    pkill -f "gjoule.*707070" && echo "Killed." || echo "Not running."
fi
