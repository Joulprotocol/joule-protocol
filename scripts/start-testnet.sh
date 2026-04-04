#!/bin/bash
# JOULE Testnet — Start Script
# Usage: ./start-testnet.sh

JOULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GJOULE="$JOULE_DIR/bin/gjoule"
DATADIR="$JOULE_DIR/data/testnet"
GENESIS="$JOULE_DIR/genesis.json"
LOGFILE="$DATADIR/gjoule.log"
PIDFILE="$DATADIR/gjoule.pid"

# Check if already running
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "JOULE is already running (PID: $(cat "$PIDFILE"))"
    exit 1
fi

# Initialize if needed
if [ ! -d "$DATADIR/geth/chaindata" ]; then
    echo "Initializing JOULE chain..."
    mkdir -p "$DATADIR"
    $GJOULE --datadir "$DATADIR" init "$GENESIS"

    echo "Creating miner account..."
    echo "jouletest123" > /tmp/joule_pass.txt
    $GJOULE --datadir "$DATADIR" account new --password /tmp/joule_pass.txt
    rm /tmp/joule_pass.txt
fi

# Get miner address (first account in keystore)
MINER_ADDR=$(ls "$DATADIR/keystore/" | head -1 | grep -oP '[0-9a-f]{40}$')
if [ -z "$MINER_ADDR" ]; then
    echo "Error: No accounts found. Create one first."
    exit 1
fi
MINER_ADDR="0x$MINER_ADDR"

echo "Starting JOULE testnet..."
echo "  Miner: $MINER_ADDR"
echo "  RPC:   http://127.0.0.1:8547"
echo "  Chain: 707070"

$GJOULE \
    --datadir "$DATADIR" \
    --networkid 707070 \
    --port 30307 \
    --http --http.port 8547 --http.addr "127.0.0.1" \
    --http.api "eth,net,web3,personal,miner,admin,txpool" \
    --http.corsdomain "*" \
    --mine --miner.etherbase "$MINER_ADDR" \
    --miner.threads 2 \
    --nodiscover \
    --maxpeers 50 \
    --verbosity 3 \
    >> "$LOGFILE" 2>&1 &

echo $! > "$PIDFILE"
echo "JOULE started (PID: $!)"
echo "Logs: tail -f $LOGFILE"
