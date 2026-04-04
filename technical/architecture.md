# JOULE Technical Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    JOULE NETWORK                         │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  Miner   │  │  Miner   │  │  Miner   │  ← GPU PoW  │
│  │  Node    │  │  Node    │  │  Node    │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│  ┌────┴──────────────┴──────────────┴────┐              │
│  │          JOULE Blockchain              │              │
│  │  (EVM-compatible, EtHash-J PoW)        │              │
│  │                                        │              │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐ │              │
│  │  │PoE       │ │Oracle    │ │Market- │ │              │
│  │  │Mining.sol│ │Consensus │ │place   │ │ ← Contracts │
│  │  └──────────┘ └──────────┘ └────────┘ │              │
│  └────────────────────┬──────────────────┘              │
│                       │                                  │
│  ┌────────────────────┴──────────────────┐              │
│  │         Oracle Network                 │              │
│  │  ┌──────┐ ┌──────┐ ┌──────┐          │              │
│  │  │Node 1│ │Node 2│ │Node 3│ ← 3/5   │              │
│  │  └──┬───┘ └──┬───┘ └──┬───┘  BFT    │              │
│  └─────┼────────┼────────┼──────────────┘              │
│        │        │        │                              │
│  ┌─────┴────────┴────────┴──────────────┐              │
│  │      Smart Meter Bridge               │              │
│  │  [IoT Gateway] → [API] → [Oracle]    │              │
│  └───────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Blockchain Node (go-joule)

Fork of go-ethereum v1.13+ with modifications:

```
go-joule/
├── cmd/
│   ├── gjoule/          # Main node binary
│   └── jminer/          # Standalone GPU miner
├── consensus/
│   └── ethashj/         # Modified Ethash consensus
│       ├── algorithm.go # EtHash-J parameters
│       ├── dag.go       # DAG generation (steeper growth)
│       └── sealer.go    # Block sealing
├── core/
│   ├── genesis.go       # Genesis block (modified)
│   └── vm/              # Standard EVM (unmodified)
├── contracts/           # Genesis-deployed contracts
│   ├── EnergyRegistry.sol
│   ├── OracleConsensus.sol
│   ├── PoEMining.sol
│   └── Governance.sol
└── oracle/              # Oracle node software
    ├── node.go
    ├── verification.go
    └── meter_bridge.go
```

### 2. EtHash-J Consensus Modifications

Changes from standard Ethash:

```go
// EtHash-J parameters
const (
    // DAG
    InitialDAGSize    = 4 * 1024 * 1024 * 1024  // 4 GB (vs 1 GB Ethash)
    DAGGrowthPerEpoch = 256 * 1024 * 1024        // 256 MB (vs 8 MB)
    EpochLength       = 50000                     // blocks per epoch

    // Mining
    MixRounds         = 128    // vs 64 in Ethash
    HashBytes         = 128    // vs 64
    MixBytes          = 256    // vs 128

    // Block timing
    TargetBlockTime   = 15     // seconds
    DifficultyWindow  = 2048   // blocks for difficulty adjustment

    // Halving
    HalvingInterval   = 2102400  // blocks (~1 year)
    InitialReward     = 50       // JOL per block
)
```

### 3. Smart Contracts

#### EnergyRegistry.sol
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract EnergyRegistry {
    struct Facility {
        address owner;
        string facilityType;    // "solar", "wind", "hydro", "biomass"
        uint256 capacityKW;     // nameplate capacity in kW
        bytes32 meterId;        // encrypted smart meter ID
        int256 latitude;        // location (scaled by 1e6)
        int256 longitude;
        uint256 registeredAt;
        bool verified;
        uint256 totalProduced;  // cumulative kWh verified
    }

    mapping(uint256 => Facility) public facilities;
    mapping(address => uint256[]) public ownerFacilities;
    uint256 public facilityCount;

    event FacilityRegistered(uint256 indexed id, address owner, string facilityType);
    event FacilityVerified(uint256 indexed id, address verifier);
    event ProductionRecorded(uint256 indexed id, uint256 kWh, uint256 timestamp);

    function registerFacility(
        string calldata _type,
        uint256 _capacityKW,
        bytes32 _meterId,
        int256 _lat,
        int256 _lon
    ) external returns (uint256) {
        facilityCount++;
        facilities[facilityCount] = Facility({
            owner: msg.sender,
            facilityType: _type,
            capacityKW: _capacityKW,
            meterId: _meterId,
            latitude: _lat,
            longitude: _lon,
            registeredAt: block.timestamp,
            verified: false,
            totalProduced: 0
        });
        ownerFacilities[msg.sender].push(facilityCount);
        emit FacilityRegistered(facilityCount, msg.sender, _type);
        return facilityCount;
    }
}
```

#### OracleConsensus.sol
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract OracleConsensus {
    uint256 public constant MIN_STAKE = 10_000 ether; // 10,000 JOL
    uint256 public constant QUORUM = 3;               // 3 of 5
    uint256 public constant SLASH_PERCENT = 50;

    struct OracleNode {
        address operator;
        uint256 stake;
        uint256 submissionsCount;
        uint256 accuracyScore;  // basis points (10000 = 100%)
        bool active;
    }

    struct EnergyReport {
        uint256 facilityId;
        uint256 periodStart;
        uint256 periodEnd;
        uint256 kWhProduced;
        uint256 confirmations;
        bool finalized;
        mapping(address => bool) hasVoted;
        mapping(address => uint256) submissions; // oracle → reported kWh
    }

    mapping(address => OracleNode) public oracles;
    mapping(bytes32 => EnergyReport) public reports;
    address[] public activeOracles;

    function stake() external payable {
        require(msg.value >= MIN_STAKE, "Insufficient stake");
        oracles[msg.sender] = OracleNode({
            operator: msg.sender,
            stake: msg.value,
            submissionsCount: 0,
            accuracyScore: 10000,
            active: true
        });
        activeOracles.push(msg.sender);
    }

    function submitEnergyReport(
        uint256 _facilityId,
        uint256 _periodStart,
        uint256 _periodEnd,
        uint256 _kWhProduced
    ) external {
        require(oracles[msg.sender].active, "Not active oracle");
        bytes32 reportId = keccak256(abi.encodePacked(_facilityId, _periodStart, _periodEnd));

        EnergyReport storage report = reports[reportId];
        require(!report.hasVoted[msg.sender], "Already voted");

        if (report.facilityId == 0) {
            report.facilityId = _facilityId;
            report.periodStart = _periodStart;
            report.periodEnd = _periodEnd;
        }

        report.submissions[msg.sender] = _kWhProduced;
        report.hasVoted[msg.sender] = true;
        report.confirmations++;

        if (report.confirmations >= QUORUM) {
            _finalizeReport(reportId);
        }
    }

    function _finalizeReport(bytes32 _reportId) internal {
        // Median of submissions becomes the accepted value
        // Outlier oracles get accuracy score reduced
        // Severe outliers get slashed
        reports[_reportId].finalized = true;
    }
}
```

#### PoEMining.sol
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PoEMining {
    uint256 public constant JOL_PER_KWH = 3;  // 3x multiplier
    uint256 public constant ORACLE_FEE = 200;  // 2% in basis points

    address public energyRegistry;
    address public oracleConsensus;

    mapping(address => uint256) public pendingRewards;
    mapping(address => uint256) public totalClaimed;

    event RewardAccrued(address indexed producer, uint256 kWh, uint256 jolReward);
    event RewardClaimed(address indexed producer, uint256 amount);

    function accrueReward(
        uint256 _facilityId,
        uint256 _verifiedKWh
    ) external {
        // Called by oracle consensus after report finalization
        require(msg.sender == oracleConsensus, "Only oracle");

        address producer = _getFacilityOwner(_facilityId);
        uint256 reward = _verifiedKWh * JOL_PER_KWH * 1 ether;
        uint256 oracleCut = (reward * ORACLE_FEE) / 10000;

        pendingRewards[producer] += reward - oracleCut;
        emit RewardAccrued(producer, _verifiedKWh, reward - oracleCut);
    }

    function claimRewards() external {
        uint256 amount = pendingRewards[msg.sender];
        require(amount > 0, "No rewards");
        pendingRewards[msg.sender] = 0;
        totalClaimed[msg.sender] += amount;
        // Transfer JOL from PoE allocation pool
        emit RewardClaimed(msg.sender, amount);
    }

    function _getFacilityOwner(uint256 _id) internal view returns (address) {
        // Query EnergyRegistry
        return address(0); // placeholder
    }
}
```

### 4. Mining Software

#### GPU Miner (jminer)

```
jminer — JOULE GPU Mining Software

Usage:
  jminer --node <node-url> --wallet <address> --gpus <gpu-ids>

Features:
  - OpenCL and CUDA support
  - Multi-GPU mining
  - Stratum protocol for pool mining
  - Real-time hashrate monitoring
  - Auto-overclock profiles (conservative/balanced/aggressive)

Supported GPUs:
  - NVIDIA: GTX 1060+, RTX 2060+, RTX 3060+, RTX 4060+, RTX 5060+
  - AMD: RX 580+, RX 5600+, RX 6600+, RX 7600+
  - Minimum VRAM: 4 GB (6 GB recommended)
```

### 5. Infrastructure (Launch Hardware)

Seed node hardware (sufficient for testnet and initial mainnet):

```
Seed Node:
  CPU: AMD Ryzen 9 9950X (16C/32T)
  RAM: 60 GB DDR5
  GPU: RTX 5080 16 GB (mining + oracle)
  Storage: 1.8TB + 3.6TB + 1.9TB NVMe
  Network: Tailscale VPN

Roles:
  - Full node (blockchain)
  - GPU miner (initial hashrate)
  - Oracle node (energy verification)
  - Block explorer (web app)
  - API endpoints
```

### 6. Network Architecture

```
Phase 1 (Testnet):
  1 node (Seed node)
  └── Mining + Oracle + Explorer

Phase 2 (Early Mainnet):
  3-5 nodes
  ├── Seed node
  ├── 2-4 community nodes
  └── Mining pool (stratum server)

Phase 3 (Growth):
  50+ nodes
  ├── Geographic distribution
  ├── 5+ oracle nodes
  ├── 3+ mining pools
  └── DEX bridge nodes
```

### 7. Bridge to Ethereum

For DEX listing, JOULE needs a bridge to Ethereum:

```
JOULE Chain ←→ Bridge Contract ←→ Ethereum
   JOL           Lock/Mint          wJOL (ERC-20)

Mechanism:
  1. User sends JOL to bridge contract on JOULE chain
  2. Bridge validators confirm (3/5 multisig)
  3. wJOL minted on Ethereum (1:1)
  4. wJOL tradeable on Uniswap
  5. Reverse: burn wJOL → unlock JOL
```

### 8. Security Considerations

| Attack Vector | Mitigation |
|--------------|------------|
| 51% attack | Gradual difficulty increase, community monitoring |
| Oracle manipulation | BFT consensus, slashing, multi-source verification |
| Smart contract bugs | Audits, formal verification of core contracts |
| Bridge exploit | Multisig, timelock, withdrawal limits |
| Sybil (oracle) | Minimum stake requirement (10,000 JOL) |
| Selfish mining | Uncle reward penalty, timestamp validation |
