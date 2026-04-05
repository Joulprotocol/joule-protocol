# Changelog

## [0.7.0] - 2026-04-05

### Emission Model — 36 JOL/block
- Block reward: 50 → 36 JOL/block (go-joule updated from 16,000)
- Block time target: 15 seconds (unchanged)
- Halving interval: 2,100,000 blocks (~1 year per era)
- Distribution: 70% Mining (147M), 19% Energy Reserve (39.9M), 6% Founder, 5% Ecosystem
- EnergyFloor MAX_FLOOR_MINT: 42M → 39.9M (19% of 210M)
- 6 eras, total mined = 147M (36+18+9+4+2+1 × 2.1M blocks)
- go-joule halving interval aligned: 2,160,000 → 2,100,000
- All contracts, tests, docs, whitepaper, README aligned

## [0.6.0] - 2026-04-05

### Tokenomics Overhaul
- Distribution: 69% Mining, 20% Energy Reserve, 6% Founder, 5% Ecosystem
- FoundersVesting: 12.6M JOL (6%), 1-year cliff, 4-year linear vesting
- All contracts, docs, whitepaper, README aligned to 210M model

### New Contracts
- **EnergyProofEngine**: 5-layer verification gateway (Physics + Weather + Oracle + Stake + Reputation)
- No energy-based minting without ALL layers passing simultaneously

### Governance Hardening
- JOLToken: ERC20Votes + ERC20Permit for flashloan-resistant snapshots
- Governance: getPastVotes() snapshot at proposal creation block
- Governance: 2-day timelock, permissionless execute after timelock

### Oracle Consensus
- Staged quorum: starts 2/3, scalable to 3/5+ via setQuorum()
- Constants → configurable parameters with safety bounds

## [0.5.0] - 2026-04-05

### Security Fixes (Critical)
- **EnergyFloor**: Fix MAX_FLOOR_MINT to 42M (20% of 210M supply)
- **EcosystemTreasury**: Fix MAX_TREASURY to 10.5M (5% of 210M supply)
- **MachineRegistry**: Add RECORDER_ROLE to `recordTransaction()` and `recordEnergy()` — prevents unauthorized reputation manipulation
- **SellLimit**: Add AccessControl with EXCHANGE_ROLE to `checkSell()` — prevents sell quota exhaustion attacks
- **Governance**: Add ReentrancyGuard to `execute()` — prevents reentrancy via arbitrary `.call`
- **OracleConsensus**: Add ReentrancyGuard to `exitOracle()` — prevents reentrancy on ETH withdrawal

### Infrastructure
- Hetzner bootnode RPC locked to localhost (was 0.0.0.0 — exploitable)
- Hetzner firewall enabled (UFW: SSH + P2P only)
- Hetzner SSH password auth disabled
- Removed `admin` and `miner` from Hetzner RPC API surface
- Added systemd service for local testnet node
- Fixed `start-testnet.sh`: init guard, `--syncmode full`, `--snapshot=false`, `--nodiscover`
- Replaced hardcoded testnet password with `$JOULE_PASSWORD` env variable

### Testing
- Added fake-shelly.js (Shelly Pro 3EM simulator with 6 test modes)
- Added meter bridge integration test suite (15/15 passing)
- All 231 smart contract tests passing

## [0.4.0] - 2026-04-02

### Features
- Week 4: StakeSlash + ConflictScore integration, edge node, docs
- Week 3: Oracle 5% deviation, liquidity mining, DEX pools, founder vesting
- Week 2: PoE security layers, sell limits, conflict scoring

## [0.3.0] - 2026-03-28

### Features
- Mainnet-v1 supply model: 210M supply, 50 JOL block reward, 2.1M halving
- PoE 3x multiplier
- Clean genesis

## [0.1.0] - 2026-03-20

### Initial Release
- JOULE Protocol core: JOLToken, EnergyFloor, EnergyRegistry
- go-joule (geth fork) with ethash mining
- Genesis block, testnet launch
