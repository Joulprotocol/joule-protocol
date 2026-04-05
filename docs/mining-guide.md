# JOULE Mining Guide

Step-by-step GPU mining on the JOULE network.

## Requirements

- **OS:** Linux (Ubuntu 22.04+), macOS, or Windows with WSL
- **GPU:** Any modern GPU (NVIDIA/AMD) — EtHash-J algorithm
- **RAM:** 4 GB minimum
- **Disk:** 20 GB free space
- **Go:** 1.21+ (for building from source)

## Step 1 — Build gjoule

```bash
git clone https://github.com/Joulprotocol/joule-protocol.git
cd joule-protocol/go-joule
go build -o ../bin/gjoule ./cmd/geth
```

Verify the build:
```bash
./bin/gjoule version
```

## Step 2 — Initialize the chain

```bash
cd ..
./bin/gjoule --datadir ./data init genesis.json
```

## Step 3 — Create a miner account

```bash
./bin/gjoule --datadir ./data account new
```

Save your password securely. Copy the address (0x...) — this is your miner address.

## Step 4 — Start mining

```bash
./bin/gjoule \
  --datadir ./data \
  --networkid 707070 \
  --port 30307 \
  --http --http.port 8547 --http.addr "127.0.0.1" \
  --http.api "eth,net,web3,miner" \
  --mine \
  --miner.etherbase 0xYOUR_ADDRESS_HERE \
  --miner.threads 2 \
  --bootnodes "enode://4fe9a8ffee1731a9666a24afcb8b4cd44f236cc22d1b327cd2663646bbc25f6215b6bc361a25e4982c5f7e4b23d591c41995c567159e8d833f0adccec6634846@204.168.211.136:30307" \
  --maxpeers 50 \
  --verbosity 3
```

### Flag explanation

| Flag | Purpose |
|------|---------|
| `--networkid 707070` | JOULE chain ID |
| `--mine` | Enable mining |
| `--miner.etherbase` | Your reward address |
| `--miner.threads 2` | CPU threads for mining (adjust to your hardware) |
| `--bootnodes` | Connect to the JOULE network |
| `--maxpeers 50` | Maximum peer connections |

## Step 5 — Check your balance

Open a new terminal:

```bash
./bin/gjoule attach ./data/geth.ipc
```

In the console:
```javascript
eth.getBalance(eth.coinbase)
// Returns balance in wei. Divide by 1e18 for JOL.

web3.fromWei(eth.getBalance(eth.coinbase), "ether")
// Returns balance in JOL
```

## Step 6 — Add to MetaMask

1. Open MetaMask → Settings → Networks → Add Network
2. Fill in:

| Setting | Value |
|---------|-------|
| Network Name | JOULE |
| RPC URL | http://localhost:8547 |
| Chain ID | 707070 |
| Currency Symbol | JOL |

3. Import your miner account using the private key from your keystore file

## Mining Economics

| Parameter | Value |
|-----------|-------|
| Block reward | 50 JOL |
| Block time | ~6 seconds |
| Blocks per day | ~14,400 |
| JOL per day (solo) | Up to 720,000 JOL |
| Halving interval | Every 2,100,000 blocks (~1 year) |
| Halving schedule | 50 → 25 → 12.5 → 6.25 → ... |

Note: Solo mining rewards depend on your hash rate relative to network difficulty.

## Running as a Background Service

### Using the provided script

```bash
bash scripts/start-testnet.sh
```

### Using systemd (recommended for production)

Create `/etc/systemd/system/gjoule.service`:

```ini
[Unit]
Description=JOULE Node
After=network.target

[Service]
Type=simple
User=joule
ExecStart=/opt/joule/bin/gjoule \
  --datadir /opt/joule/data \
  --networkid 707070 \
  --mine --miner.etherbase 0xYOUR_ADDRESS \
  --miner.threads 2 \
  --bootnodes "enode://369ca...@bootnode.joule.energy:30307" \
  --maxpeers 50
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable gjoule
sudo systemctl start gjoule
sudo journalctl -u gjoule -f  # follow logs
```

### Using the watchdog script

```bash
nohup bash scripts/joule-watchdog.sh > /dev/null 2>&1 &
```

This automatically restarts gjoule if it crashes.

## Monitoring

Check node status:
```bash
bash scripts/status.sh
```

Start continuous monitoring:
```bash
nohup bash scripts/soak-monitor.sh > /dev/null 2>&1 &
cat soak-test-log.csv
```

## Troubleshooting

### Node won't start
- Check if another instance is running: `ps aux | grep gjoule`
- Check logs: `tail -100 data/testnet/gjoule.log`
- Ensure port 30307 is open in your firewall

### No peers
- Verify bootnode is reachable
- Check firewall allows UDP/TCP on port 30307
- Try adding `--nat extip:YOUR_PUBLIC_IP` if behind NAT

### Low hashrate
- Increase `--miner.threads` (up to your CPU core count)
- GPU mining via OpenCL/CUDA support (EtHash-J compatible)

### DAG generation slow
- First run generates the DAG (~2 GB). This is normal and takes a few minutes.
- DAG regenerates every 30,000 blocks (epoch change)

---

*JOULE — Energy is value. Start mining, start earning.*
