# JOULE Implementation Roadmap

## Overview

```
2026 Q2 (Apr-Jun)     → Foundation: Fork, contracts, testnet
2026 Q3 (Jul-Sep)     → Testing: Public testnet, mining software, audit
2026 Q4 (Oct-Dec)     → LAUNCH: Mainnet, DEX, community
2027 H1 (Jan-Jun)     → Growth: Energy producers, CEX, bridge
2027 H2 (Jul-Dec)     → Scale: Oracle decentralization, marketplace
2028+                  → Enterprise: Carbon credits, Vosges integration
```

---

## Phase 1: Foundation (April — June 2026)

### Week 1-2: Blockchain Fork
- [ ] Fork go-ethereum v1.13
- [ ] Modify consensus to EtHash-J
  - Change DAG parameters
  - Increase mix rounds
  - Implement halving schedule
- [ ] Configure genesis block
  - Chain ID assignment
  - Initial difficulty
  - Genesis contracts deployment
  - Ecosystem fund allocation
- [ ] Build `gjoule` binary
- [ ] Test: Single node runs and produces blocks

### Week 3-4: Smart Contracts
- [ ] Implement EnergyRegistry.sol
- [ ] Implement OracleConsensus.sol
- [ ] Implement PoEMining.sol
- [ ] Implement Governance.sol
- [ ] Implement Marketplace.sol (basic)
- [ ] Unit tests for all contracts (Hardhat/Foundry)
- [ ] Deploy to local testnet

### Week 5-6: Mining Software
- [ ] Fork ethminer → jminer
- [ ] Modify for EtHash-J algorithm
- [ ] CUDA support (NVIDIA GPUs)
- [ ] OpenCL support (AMD GPUs)
- [ ] Stratum protocol support (for pools)
- [ ] Test: Mining on RTX 5080

### Week 7-8: Infrastructure
- [ ] Block explorer (fork Blockscout)
- [ ] Web wallet (MetaMask compatible — just add network)
- [ ] Faucet for testnet
- [ ] API endpoints (JSON-RPC)
- [ ] Documentation site
- [ ] GitHub repos setup

### Deliverables End of Phase 1:
- Working testnet on Seed node
- Mining software for NVIDIA/AMD
- Smart contracts deployed
- Block explorer running
- Documentation published

---

## Phase 2: Testing (July — September 2026)

### Month 1: Public Testnet
- [ ] Launch public testnet
- [ ] Invite community miners
- [ ] Bug bounty program ($500-5000 per bug)
- [ ] Stress testing (simulated load)
- [ ] Monitor: block times, reorgs, memory usage

### Month 2: Oracle Network
- [ ] Oracle node software (standalone binary)
- [ ] Smart meter simulator (for testing)
- [ ] Oracle registration and staking
- [ ] Test: Submit energy reports
- [ ] Test: Consensus and finalization
- [ ] Test: Slashing mechanism

### Month 3: Security + Polish
- [ ] Smart contract audit (Immunefi bounty or paid audit)
- [ ] Penetration testing on node software
- [ ] Fix all critical/high issues
- [ ] Performance optimization
- [ ] Final testnet reset (clean state)

### Community Building (parallel):
- [ ] Discord server + moderation bots
- [ ] Telegram group
- [ ] Twitter/X account
- [ ] Reddit presence (r/JOULEcoin)
- [ ] Mining tutorial videos
- [ ] Ambassador program

### Deliverables End of Phase 2:
- Stable public testnet with 50+ miners
- Audited smart contracts
- Active community (1000+ members)
- Oracle network tested
- Launch date announced

---

## Phase 3: MAINNET LAUNCH (October — December 2026)

### Launch Week
- [ ] Genesis block mined (Seed node = first miner)
- [ ] Mining pool software deployed
- [ ] Block explorer live on mainnet
- [ ] Mining tutorial published
- [ ] Social media announcement campaign
- [ ] Press release (crypto media)

### Month 1 Post-Launch
- [ ] Monitor network stability
- [ ] Support early miners
- [ ] First difficulty adjustments
- [ ] Community feedback collection
- [ ] DEX preparation (Ethereum bridge)

### Month 2: DEX Listing
- [ ] Deploy bridge contract (JOULE ↔ Ethereum)
- [ ] Mint wJOL (wrapped JOULE) on Ethereum
- [ ] Create Uniswap V3 pool: wJOL/ETH
- [ ] Add initial liquidity (~5000 EUR in ETH)
- [ ] CoinGecko listing application
- [ ] CoinMarketCap listing application

### Month 3: Stabilization
- [ ] Monitor trading volume and liquidity
- [ ] Community governance first vote
- [ ] Mining profitability reports published
- [ ] First monthly transparency report
- [ ] Plan Phase 4

---

## Phase 4: Growth (2027 H1)

- [ ] First energy producers onboarded
- [ ] Oracle network goes live on mainnet
- [ ] CEX listing (MEXC or Gate.io as first)
- [ ] Mobile wallet (React Native)
- [ ] API integrations with EU grid operators
- [ ] Partnership with solar installer company
- [ ] 500+ active miners

---

## Phase 5: Scale (2027 H2+)

- [ ] Carbon credit marketplace
- [ ] Cross-chain bridges (BSC, Polygon)
- [ ] Enterprise energy certificates
- [ ] 1000+ energy producers
- [ ] DAO governance fully operational
- [ ] Vosges hydro integration planning

---

## Technical Resource Requirements

### Hardware (seed node — sufficient)
- AMD Ryzen 9 9950X → blockchain node + oracle
- 60GB RAM → node + explorer + API
- RTX 5080 16GB → mining (initial hashrate provider)
- NVMe storage → blockchain data

### Software Stack
```
Blockchain:     Go (go-ethereum fork)
Contracts:      Solidity 0.8.20+
Mining:         C++ (ethminer fork)
Explorer:       Elixir (Blockscout fork)
Bridge:         Solidity + TypeScript
Oracle:         Go + TypeScript
Website:        Next.js
API:            JSON-RPC (built into gjoule)
```

### External Services
```
Domain:         joule.energy or joulechoin.io (~50 EUR/yr)
VPS (backup):   Hetzner 1x CX31 (~15 EUR/mo)
DNS:            Cloudflare (free)
CI/CD:          GitHub Actions (free for open source)
```

### Human Resources
```
Phase 1-2:  core team oversight
Phase 3:    core team + 2-3 community moderators
Phase 4+:   core team + community + contributors
```

---

## Risk Checkpoints

Iga faasi lõpus — STOP ja hinda:

### Phase 1 End
- ❓ Kas testnet töötab stabiilselt?
- ❓ Kas mining software on usable?
- ❓ Kas community huvi on olemas?
- ❓ Kas legaalne olukord on selge?
→ Kui EI: itereeri, ära liigu edasi

### Phase 2 End
- ❓ Kas audit läbitud ilma kriitiliste bugideta?
- ❓ Kas 50+ testnet minerit aktiivsed?
- ❓ Kas community on 500+ inimest?
- ❓ Kas launch budget (10k EUR) on olemas?
→ Kui EI: lükka launch edasi

### Phase 3 End
- ❓ Kas network on stabiilne 30 päeva?
- ❓ Kas DEX liquidity on piisav?
- ❓ Kas on tekkinud tõsiseid probleeme?
→ Kui PROBLEEMID: paus, paranda, siis jätka
