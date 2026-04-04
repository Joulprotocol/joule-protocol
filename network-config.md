# JOULE Network — Connection Details

## MetaMask / Wallet Setup

| Parameter | Value |
|-----------|-------|
| Network Name | JOULE Testnet |
| RPC URL | http://127.0.0.1:8547 |
| Chain ID | 707070 |
| Currency Symbol | JOL |
| Block Explorer | (coming soon) |

## Mining

```bash
# Start miner
./scripts/start-testnet.sh

# Stop miner
./scripts/stop-testnet.sh

# Check status
./scripts/status.sh
```

## JSON-RPC

```bash
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8547
```
