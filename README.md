# JOULE — Energy is Money

### 1 JOL = 1 kWh verified renewable energy. Always. Forever. Immutably.

The first cryptocurrency backed by physics, not promises.

GPU-mineable. Fair launch. Energy-backed floor price.

---

## Why JOULE

- **Energy floor price** — 1 JOL is always backed by 1 kWh of verified renewable energy. Price can't go below energy cost.
- **Dual mining** — GPU miners (PoW) secure the network. Energy producers (PoE) back it with real power. Both earn from the same pool.
- **Machine payments** — AI agents, EVs, IoT devices pay each other in JOL. Per-second. Sub-cent.
- **Deflationary** — 210M max supply. All fees burned. Supply only shrinks after month ~36.

## Mine JOULE in 5 minutes

### 1. Build

```bash
git clone https://github.com/Joulprotocol/joule-protocol.git
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
  --bootnodes "enode://70df6358dd077546d9c836a4bcbf9c217a5f15356c69f53a471ebd16fa6d00ed0b0da23c1847b85ffa152bd9ed3bf1d42ba4844f717e76925d54baeeac4f2085@204.168.211.136:30307"
```

### 4. Add to MetaMask

| Setting | Value |
|---------|-------|
| Network Name | JOULE |
| RPC URL | http://localhost:8547 |
| Chain ID | 707070 |
| Symbol | JOL |

---

## How It Works

```
GPU Miners (PoW)                    Energy Producers (PoE)
─────────────────                   ──────────────────────
Solve EtHash-J puzzles              Produce solar/wind/hydro/geo
Earn 50 JOL/block               Earn 3× JOL per kWh (same pool)
Secure the network                  Back the network with real energy

         Both earn from the same 126B mining pool.
         Both are essential. PoW secures. PoE gives value.
```

### Three Layers of Proof

Every energy claim passes through three independent verification layers:

| Layer | What | How |
|-------|------|-----|
| **1. Physics** (PhysicalCap) | GPS + technology → theoretical maximum | Solar in Tallinn at 58°N can't produce like the equator |
| **2. Weather** (WeatherOracle) | Open-Meteo data → actual conditions | Cloudy day → solar park can't claim full output |
| **3. Economics** (StakeSlash) | 3-day stake → skin in the game | False data = lose stake + ban. Math forbids cheating. |

All three must agree. Physics is the judge. Weather is the witness. Economics is the enforcer.

### Tokenomics

```
Max Supply:     210,000,000 JOL (210M — hard cap, forever)

Mining (PoW+PoE):  69%  = 144.9M   Block reward: 50 JOL, halving every 2,100,000 blocks
Energy Reserve:    20%  =  42.0M   Backs the 1 JOL = 1 kWh peg
Founder:            6%  =  12.6M   1-year cliff, 4-year linear vesting (OpenZeppelin)
Ecosystem:          5%  =  10.5M   Bounties, developers, audits, DEX liquidity
  ├── 90% Development = 9.45M    Bounties, audits, DEX
  └── 10% Insurance   = 1.05M    Smart contract bug coverage (DAO + 7d timelock)
                  ────
                  100%  = 210.0M
```

Block reward halves every ~1 year: 50 → 25 → 12.5 → 6.25 → ... → 0

### Allowed Energy Types

```
✓ Solar        ✓ Wind        ✓ Hydro        ✓ Geothermal
✗ Biomass      ✗ Nuclear     ✗ Fossil fuels
```

No exceptions. No governance override. Code enforces.

---

## Security Model

### Conflict Score — Proportional Consequences

The system doesn't punish — it protects. Automatic, proportional, fair.

| Violation | Points | Max Level |
|-----------|--------|-----------|
| Sell limit breach | +20 | Level 2 |
| False oracle data | +100 | Level 4 |
| Node attack | +200 | Level 4 |
| Infrastructure attack | +500 | Level 4 |

| Level | Score | Effect |
|-------|-------|--------|
| 0 | 0-99 | Full access |
| 1 | 100-299 | 75% rewards |
| 2 | 300-499 | 50% rewards, no governance |
| 3 | 500-999 | No rewards, no trading |
| 4 | 1000+ | Permanent ban |

Score decays: -20/month (Level 1-2), -10/month (Level 3). Level 4 does not decay.

### Founder Sell Limit

Maximum 1% of daily market volume. In code, not in promises. Every sell visible on-chain.

### Producer Sell Limit

Square root harmony — larger producers protect price longer.
Min 0.5%, max 5% of daily production. Resets daily.

---

## Smart Contracts

| Contract | Purpose |
|----------|---------|
| JOLToken | ERC-20, 210M cap, burn mechanics |
| EnergyRegistry | Facility registration + verification |
| PhysicalCap | GPS + technology physics cap (10% tolerance) |
| WeatherOracle | Open-Meteo weather verification |
| OracleConsensus | 3/5 BFT consensus, 5% max deviation |
| PoEMining | 3× energy reward multiplier |
| StakeSlash | 3-day stake, automatic slash + ConflictScore |
| ConflictScore | 4 levels, proportional penalties, monthly decay |
| SellLimit | Square root harmony sell limiter |
| FounderSellLimit | 1% daily volume cap |
| FoundersVesting | OpenZeppelin VestingWallet, 6mo cliff + 48mo linear |
| LiquidityMining | 4.2B JOL, 180 days, 2× early bird |
| DEXLiquidity | 6.3B JOL, JOL/USDC + JOL/ETH pools |
| EnergyPeg | 1 JOL = 1 kWh floor price |
| PaymentChannel | Off-chain micropayments |
| StreamingPayments | Per-second billing |
| AgentWallet | AI autonomous spending with limits |
| CarbonCredit | NFT carbon credits from verified energy |
| MachineRegistry | IoT/AI device identity + reputation |
| EnergyMarketplace | P2P energy trading + fee burn |
| Governance | DAO voting |

## Ways to Earn JOL

| Method | Who | How |
|--------|-----|-----|
| **GPU mining** | Anyone with a GPU | Run gjoule with --mine |
| **Energy production** | Solar/wind/hydro/geo owners | Connect smart meter, earn 3× JOL per kWh |
| **Oracle node** | Technical operators | Stake 10,000 JOL, verify energy data, earn 2% of PoE rewards |
| **LP mining** | Token holders | Provide liquidity, earn up to 40M JOL/day (early bird) |
| **Bounties** | Developers | Build tools, earn JOL from Ecosystem Treasury |

## Smart Meter Integration

Supported hardware (auto-detected):
- **Shelly Pro 3EM** — WiFi, REST API (~120 EUR)
- **Victron Energy GX** — Modbus/MQTT (~450 EUR)
- **P1 port readers** — SlimmeLezer+ (~30 EUR)

```bash
METER_IP=192.168.1.100 node adapters/smart-meter/meter-bridge.js
```

## Tests

```bash
cd contracts
npx hardhat test    # 231 passing (3s)
```

## Chain Parameters

| Parameter | Value |
|-----------|-------|
| Chain ID | 707070 |
| Consensus | EtHash-J (Proof of Work) |
| Block time | ~6 seconds |
| Block reward | 50 JOL (halving every 2,100,000 blocks) |
| Max supply | 210,000,000 JOL |
| Gas limit | 30,000,000 |

## License

MIT

---

*JOULE Protocol — Energy is value. 1 JOL = 1 kWh. Always.*
