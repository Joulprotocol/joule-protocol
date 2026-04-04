# JOULE — Programmable Energy

### 1 JOL = 1 kWh verified renewable energy

The first cryptocurrency where mining **produces** energy instead of wasting it.

GPU-mineable. Fair launch. No premine. No founder allocation. No VC.

---

## Why JOULE

- **Energy floor price** — 1 JOL is always redeemable for 1 kWh. Price can't go below energy cost.
- **Carbon credits** — Every PoE-mined JOL is a verified green kWh. Companies must buy these (EU law).
- **Machine payments** — AI agents, EVs, IoT devices pay each other in JOL. Per-second. Sub-cent.
- **Deflationary** — 210M max supply. All fees burned. Supply only shrinks after year ~6.

## Mine JOULE in 5 minutes

### 1. Build

```bash
git clone https://github.com/joule-energy/joule-protocol.git
cd joule-protocol/go-joule
go build -o ../bin/gjoule ./cmd/geth
```

### 2. Initialize

```bash
./bin/gjoule --datadir ./data init genesis.json
./bin/gjoule --datadir ./data account new
```

### 3. Mine

```bash
./bin/gjoule \
  --datadir ./data \
  --networkid 707070 \
  --mine --miner.etherbase YOUR_ADDRESS \
  --bootnodes "enode://369ca3173dbbdbcff271c45a920012f30dc92c6b93d60f95c0695877014d9459cb3fba7754210f0318372877656037082d78f7a0a9d83b59633aa050bb4d7ef3@SEED_NODE_IP:30307"
```

### 4. Add to MetaMask

| Setting | Value |
|---------|-------|
| Network Name | JOULE |
| RPC URL | http://localhost:8547 |
| Chain ID | 707070 |
| Symbol | JOL |

---

## How it works

```
GPU Miners (PoW)                    Energy Producers (PoE)
─────────────────                   ──────────────────────
Solve math puzzles                  Produce solar/wind/hydro
Earn 50 JOL/block                   Earn 1-5 JOL per kWh (dynamic)
Secure the network                  Back the network with real energy

         Both earn JOL. Both are essential.
         PoW secures. PoE gives value.
```

### Dynamic PoE Multiplier

Energy rewards adjust automatically — like Bitcoin's difficulty, but for incentives:

| Energy Producer Adoption | Multiplier |
|--------------------------|------------|
| 0-10% of miners | 5.0x (bootstrap) |
| 10-30% | 3.0x (growth) |
| 30-50% | 2.0x (maturity) |
| 50%+ | 1.5x (established) |
| Minimum floor | 1.2x (always) |

Recalculated every 10,000 blocks (~42 hours). Smooth transitions.

### Tokenomics

```
Max Supply:     210,000,000 JOL (hard cap, forever)
Mining:         75% — GPU miners + energy producers
Energy Reserve: 20% — backs the 1 JOL = 1 kWh peg
Ecosystem:       5% — bounties, DEX liquidity
Founder:         0% — Satoshi model
```

Block reward halves yearly: 50 → 25 → 12.5 → ... → 0

### Allowed Energy Types

```
✓ Solar        ✓ Wind        ✓ Hydro        ✓ Geothermal
✗ Biomass      ✗ Nuclear     ✗ Fossil fuels
```

---

## Smart Contracts (live on chain 707070)

| Contract | Address | Purpose |
|----------|---------|---------|
| JOLToken | `0x5FbD...0aa3` | ERC-20, 210M cap, burn mechanics |
| EnergyPeg | `0x0165...8F5e` | 1 JOL = 1 kWh floor price |
| EnergyRegistry | `0xe7f1...0512` | Facility registration |
| OracleConsensus | `0xCf7E...0Fc9` | 3/5 BFT energy verification |
| PoEMining | `0x9fE4...fa6e0` | Dynamic energy rewards |
| CarbonCredit | `0x6101...F5e` | NFT carbon credits |
| MachineRegistry | `0xa513...C853` | IoT/AI device identity |
| PaymentChannel | `0x2279...eBe6` | Micropayments |
| StreamingPayments | `0x8A79...F318` | Per-second billing |
| AgentWallet | `0xB7f8...4F5e` | AI autonomous wallets |
| Governance | `0xDc64...F6C9` | DAO voting |
| EnergyMarketplace | `0x5FC8...5707` | P2P energy trading |
| BridgeLock | *mainnet* | Ethereum bridge (deployed at mainnet launch) |

## Ways to earn JOL

| Method | Who | How |
|--------|-----|-----|
| **GPU mining** | Anyone with a GPU | Run gjoule with --mine |
| **Energy production** | Solar/wind/hydro owners | Connect smart meter, earn 1-5x JOL per kWh |
| **Oracle node** | Technical operators | Stake 10,000 JOL, verify energy data, earn 2% of PoE rewards |
| **Bounties** | Developers | Build tools (explorer, SDK, wallet), earn JOL from Ecosystem Treasury |
| **Bootnode** | Infrastructure operators | Run a seed node, earn community reputation |

### Ecosystem Treasury

5% of total supply (10.5M JOL) is managed by DAO governance:
- Bug bounties, development grants, DEX liquidity, security audits
- No single person controls it — community votes on every spend
- Fully on-chain, transparent, auditable

## SDK

```javascript
import { Joule } from 'joule-sdk';

const joule = new Joule('http://rpc.joule.energy');
joule.connect(privateKey);

// Pay
await joule.pay('0x...', 1.5);

// Stream payments (per-second)
await joule.startStream('0xGPU', 0.001, 100);

// AI agent wallet
await joule.createAgentWallet('0xAgent', 10, 100, 1000);

// Redeem energy
await joule.redeemEnergy('0xProducer', 50); // 50 kWh
```

## Smart Meter Integration

Supported hardware (auto-detected):
- **Shelly Pro 3EM** — WiFi, REST API (~120 EUR)
- **Victron Energy GX** — Modbus/MQTT (~450 EUR)
- **P1 port readers** — SlimmeLezer+ (~30 EUR)

```bash
METER_IP=192.168.1.100 node adapters/smart-meter/meter-bridge.js
# [Bridge] Detected: Shelly Pro 3EM
# [Bridge] Initial reading: 12,450.23 kWh total export
```

## Verification (3 layers)

1. **Hardware** — MID-certified smart meters (EU Directive 2014/32/EU). Tamper-proof.
2. **Oracle network** — 3/5 BFT consensus. Stake to participate. Lie = lose stake.
3. **Cross-check** — Weather correlation (solar at night? → reject), capacity limits, anomaly detection.

## Tests

```bash
cd contracts
npx hardhat test    # 38 passing (1s)
```

## License

MIT

---

*JOULE Protocol — Energy is money.*
