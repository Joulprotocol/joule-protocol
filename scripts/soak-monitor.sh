#!/bin/bash
# JOULE Soak Test Monitor
# Logs chain health every hour. Run with: nohup bash soak-monitor.sh &

JOULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$JOULE_DIR/soak-test-log.csv"
RPC="http://127.0.0.1:8547"

# Write CSV header
if [ ! -f "$LOG" ]; then
  echo "timestamp,block,balance_jol,peers,mining,mem_used_mb,mem_total_mb,disk_used_gb,disk_free_gb,uptime_hours" > "$LOG"
fi

echo "JOULE Soak Test Monitor started"
echo "Logging to: $LOG"
echo "Interval: 1 hour"

while true; do
  TS=$(date -Iseconds)

  # Block number
  BLOCK=$(curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "$RPC" 2>/dev/null | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null)

  if [ -z "$BLOCK" ]; then
    echo "$TS — NODE DOWN!" >> "$LOG.errors"
    echo "[$TS] NODE IS DOWN!"
    sleep 3600
    continue
  fi

  # Miner balance
  BAL=$(curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x6a79b83678d3f4a0a96ad500c43fe86a281f3e2c","latest"],"id":1}' \
    "$RPC" 2>/dev/null | python3 -c "import sys,json; print(round(int(json.load(sys.stdin)['result'],16)/1e18,2))" 2>/dev/null)

  # Peers
  PEERS=$(curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}' \
    "$RPC" 2>/dev/null | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null)

  # Mining
  MINING=$(curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_mining","params":[],"id":1}' \
    "$RPC" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])" 2>/dev/null)

  # System resources
  MEM_USED=$(free -m | awk '/Mem:/{print $3}')
  MEM_TOTAL=$(free -m | awk '/Mem:/{print $2}')
  DISK_USED=$(df -BG / | awk 'NR==2{print $3}' | tr -d 'G')
  DISK_FREE=$(df -BG / | awk 'NR==2{print $4}' | tr -d 'G')

  # gjoule uptime
  GJOULE_PID=$(pgrep -f "gjoule.*707070" | head -1)
  if [ -n "$GJOULE_PID" ]; then
    UPTIME_SEC=$(ps -o etimes= -p $GJOULE_PID 2>/dev/null | tr -d ' ')
    UPTIME_H=$(echo "scale=1; ${UPTIME_SEC:-0}/3600" | bc)
  else
    UPTIME_H=0
  fi

  # Log
  echo "$TS,$BLOCK,$BAL,$PEERS,$MINING,$MEM_USED,$MEM_TOTAL,$DISK_USED,$DISK_FREE,$UPTIME_H" >> "$LOG"
  echo "[$TS] block=$BLOCK bal=$BAL peers=$PEERS mining=$MINING mem=${MEM_USED}MB uptime=${UPTIME_H}h"

  sleep 3600
done
