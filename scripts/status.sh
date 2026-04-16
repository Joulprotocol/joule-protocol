#!/bin/bash
# JOULE — Status Check

RPC="http://127.0.0.1:8547"

echo "═══════════════════════════════════════"
echo "  JOULE Network Status"
echo "══════════════��════════════════════════"

# Block number
BLOCK=$(curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "$RPC" 2>/dev/null | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null)

if [ -z "$BLOCK" ]; then
    echo "  Status: OFFLINE"
    exit 1
fi

echo "  Status:    ONLINE"
echo "  Block:     #$BLOCK"

# Chain ID
CHAIN=$(curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":2}' \
    "$RPC" | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null)
echo "  Chain ID:  $CHAIN"

# Miner balance
JOULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MINER_ADDR=$(ls "$JOULE_DIR/data/testnet/keystore/" 2>/dev/null | head -1 | grep -oP '[0-9a-f]{40}$')
if [ -n "$MINER_ADDR" ]; then
    BAL=$(curl -s -X POST -H "Content-Type: application/json" \
        --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"0x$MINER_ADDR\",\"latest\"],\"id\":3}" \
        "$RPC" | python3 -c "import sys,json; print(round(int(json.load(sys.stdin)['result'],16)/1e18,2))" 2>/dev/null)
    echo "  Miner:     0x$MINER_ADDR"
    echo "  Balance:   $BAL JOL"
fi

# Peer count
PEERS=$(curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":4}' \
    "$RPC" | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result'],16))" 2>/dev/null)
echo "  Peers:     $PEERS"

# Calculate reward era
if [ "$BLOCK" -gt 0 ]; then
    ERA=$((BLOCK / 2100000))
    REWARD=$((36 >> ERA))
    echo "  Era:       $ERA (reward: $REWARD JOL/block)"
fi

echo "═══════════════════════════════════════"
