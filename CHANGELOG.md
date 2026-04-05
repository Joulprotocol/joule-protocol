# Changelog

## [0.5.0] - 2026-04-05

### Security Fixes (Critical)
- **EnergyPeg**: Fix MAX_PEG_MINT to 42M (20% of 210M supply)
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
- JOULE Protocol core: JOLToken, EnergyPeg, EnergyRegistry
- go-joule (geth fork) with ethash mining
- Genesis block, testnet launch
