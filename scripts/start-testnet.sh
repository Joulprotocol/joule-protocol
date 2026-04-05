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

# Initialize ONLY if geth data directory does not exist yet
if [ ! -d "$DATADIR/geth" ]; then
    echo "Initializing JOULE chain..."
    mkdir -p "$DATADIR"
    $GJOULE --datadir "$DATADIR" init "$GENESIS"

    echo "Creating miner account..."
    if [ -z "$JOULE_PASSWORD" ]; then
        echo "Error: JOULE_PASSWORD env variable not set."
        echo "Usage: JOULE_PASSWORD=yourpass ./start-testnet.sh"
        exit 1
    fi
    echo "$JOULE_PASSWORD" > /tmp/joule_pass.txt
    $GJOULE --datadir "$DATADIR" account new --password /tmp/joule_pass.txt
    rm /tmp/joule_pass.txt
else
    echo "Existing chain data found, skipping init."
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
echo "  RPC:   http://0.0.0.0:8547"
echo "  Chain: 707070"

$GJOULE \
    --datadir "$DATADIR" \
    --networkid 707070 \
    --port 30307 \
    --http --http.port 8547 --http.addr "0.0.0.0" \
    --http.api "eth,net,web3,personal,miner,admin,txpool" \
    --http.corsdomain "*" \
    --syncmode full --snapshot=false \
    --mine --miner.etherbase "$MINER_ADDR" \
    --miner.threads 2 \
    --allow-insecure-unlock \
    --bootnodes "enode://70df6358dd077546d9c836a4bcbf9c217a5f15356c69f53a471ebd16fa6d00ed0b0da23c1847b85ffa152bd9ed3bf1d42ba4844f717e76925d54baeeac4f2085@204.168.211.136:30307" \
    --nodiscover \
    --maxpeers 50 \
    --verbosity 3 \
    >> "$LOGFILE" 2>&1 &

echo $! > "$PIDFILE"
echo "JOULE started (PID: $!)"
echo "Logs: tail -f $LOGFILE"
