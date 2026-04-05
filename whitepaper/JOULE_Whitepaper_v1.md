# JOULE: A Proof-of-Work Cryptocurrency with Energy-Productive Mining

**Whitepaper v1.0 — April 2026**

---

## Abstract

JOULE (JOL) is a novel cryptocurrency that solves crypto's greatest contradiction: the massive energy waste inherent in Proof-of-Work consensus. JOULE introduces **Proof-of-Energy (PoE)** — a supplementary mining mechanism where verified renewable energy producers earn enhanced block rewards. The base layer is a GPU-mineable, ASIC-resistant Proof-of-Work blockchain compatible with the Ethereum Virtual Machine (EVM). This dual-mining approach creates an economic flywheel: traditional miners secure the network while energy producers add real-world value backing. As adoption grows, JOULE becomes the first cryptocurrency where mining makes the world *better*, not worse.

**Ticker:** JOL
**Consensus:** EtHash-J (modified Ethash, ASIC-resistant) + Proof-of-Energy oracle
**Block time:** 15 seconds
**Smart contracts:** Full EVM compatibility
**Max supply:** 210,000,000 JOL (hard cap)

---

## 1. The Problem

### 1.1 Crypto's Energy Paradox

Bitcoin consumes ~150 TWh annually — more than many countries. This creates:
- Environmental damage and public backlash
- Regulatory pressure (EU considering PoW bans)
- No productive output from the energy consumed
- Concentration of mining in cheap-energy regions, not clean-energy regions

### 1.2 Proof-of-Stake Isn't the Answer

PoS solved energy waste but created new problems:
- Wealth concentration (rich get richer)
- No participation path for average users (no mining)
- Validator cartels and centralization
- Reduced security guarantees vs. PoW

### 1.3 The Missing Piece

No existing blockchain **rewards** real-world energy production. Solar panel owners, wind turbine operators, and small hydro producers create real value but have no crypto-native way to monetize their production beyond selling to the grid at suppressed prices.

---

## 2. The JOULE Solution

### 2.1 Dual Mining Architecture

JOULE uses two complementary mining mechanisms:

**Layer 1: Standard PoW Mining (EtHash-J)**
- GPU-mineable, ASIC-resistant
- Anyone with a GPU can mine
- Secures the network through computational work
- Earns base block rewards

**Layer 2: Proof-of-Energy Mining (PoE)**
- Verified renewable energy producers register on-chain
- Smart meter data is submitted via oracle network
- Verified energy production earns **Energy Credits (eJOL)**
- eJOL converts to JOL at 3x the standard mining rate per kWh equivalent

### 2.2 How Proof-of-Energy Works

```
[Smart Meter] → [IoT Bridge] → [Oracle Network] → [PoE Contract] → [JOL Reward]
     |                |               |                   |
  Physical        Data relay      Verification      Token minting
  energy          (encrypted)     (3-of-5 oracle     (3x multiplier
  production                       consensus)         vs base PoW)
```

1. **Registration:** Energy producer registers their facility on-chain, submitting location, capacity, and meter ID
2. **Verification:** Oracle nodes verify the facility exists (initially manual, later automated via API integrations with grid operators)
3. **Production reporting:** Smart meter sends encrypted production data every 15 minutes
4. **Consensus:** 3 of 5 oracle nodes must agree on the production figure
5. **Reward:** Verified kWh production is converted to JOL at the enhanced rate

### 2.3 Why This Works Economically

| Metric | Bitcoin | JOULE |
|--------|---------|-------|
| Energy per TX | ~700 kWh | ~0.02 kWh (base) |
| Mining output | Heat | Heat + verified clean energy |
| Value backing | Scarcity only | Scarcity + energy production |
| Regulatory risk | High (ESG) | Low (green narrative) |
| Mining accessibility | ASICs only | GPU + energy producers |

---

## 3. Technical Architecture

### 3.1 Blockchain Layer

JOULE is an EVM-compatible Layer 1 blockchain, forked from go-ethereum with the following modifications:

- **Consensus:** EtHash-J — modified Ethash with memory-hard parameters tuned for GPU efficiency and ASIC resistance. DAG size increases follow a steeper curve.
- **Block time:** 15 seconds
- **Block reward:** Starts at 36 JOL, halving every 2,100,000 blocks (~1 year)
- **EVM version:** Shanghai-compatible (full smart contract support)
- **State management:** Standard Merkle Patricia Trie

### 3.2 Oracle Network (Energy Verification)

The oracle network is JOULE's key innovation. It consists of:

- **Oracle nodes:** Run by staked JOL holders (minimum 10,000 JOL stake)
- **Data sources:** Smart meter APIs, grid operator feeds, satellite verification (solar)
- **Consensus:** Byzantine Fault Tolerant — 3/5 agreement required
- **Slashing:** Oracle nodes that submit false data lose their stake
- **Reward:** Oracle nodes earn 2% of PoE mining rewards they verify

### 3.3 Smart Contract Layer

Core contracts deployed at genesis:

| Contract | Purpose |
|----------|---------|
| `EnergyRegistry.sol` | Register energy production facilities |
| `OracleConsensus.sol` | Manage oracle network and voting |
| `PoEMining.sol` | Calculate and distribute PoE rewards |
| `JOLToken.sol` | Native token with burn mechanics |
| `Governance.sol` | On-chain governance for protocol upgrades |
| `Marketplace.sol` | P2P energy credit trading |

### 3.4 Mining Algorithm: EtHash-J

EtHash-J is a modified version of Ethash designed to:
- Remain GPU-friendly (consumer GPUs like RTX 3060+ are optimal)
- Resist ASIC development through dynamic parameter adjustment
- Be memory-hard (4GB+ VRAM required, scaling to 8GB over 3 years)
- Use progressive DAG growth to maintain ASIC resistance

```
EtHash-J Parameters:
  - Initial DAG: 4 GB
  - DAG growth: +256 MB per 50,000 blocks
  - Mix rounds: 128 (vs Ethash 64)
  - Memory bus utilization: >95%
  - Optimal hardware: Consumer GPUs (4-16 GB VRAM)
```

---

## 4. Tokenomics

### 4.1 Supply

| Parameter | Value |
|-----------|-------|
| **Max supply** | 210,000,000 JOL |
| **Mining (PoW + PoE)** | 70% (147M JOL) — GPU miners + energy producers |
| **Energy Reserve** | 19% (39.9M JOL) — backs the 1 JOL = 1 kWh peg |
| **Founder** | 6% (12.6M JOL) — 1-year cliff, 4-year vesting |
| **Ecosystem** | 5% (10.5M JOL) — bounties, developers, audits, DEX liquidity |

### 4.2 Emission Schedule

```
Era 0 (Year 1): 36 JOL/block  → 75.6M JOL mined
Era 1 (Year 2): 18 JOL/block  → 37.8M JOL mined
Era 2 (Year 3):  9 JOL/block  → 18.9M JOL mined
Era 3 (Year 4):  4 JOL/block  →  8.4M JOL mined
Era 4 (Year 5):  2 JOL/block  →  4.2M JOL mined
Era 5 (Year 6):  1 JOL/block  →  2.1M JOL mined
Total mining: 147M JOL (70% of supply, ~6 years)
```

### 4.3 Burn Mechanics

JOL has built-in deflationary pressure:
- **Transaction fees:** 50% burned, 50% to miners
- **Energy marketplace:** 1% of energy credit trades burned
- **Oracle slashing:** Slashed stakes are burned (not redistributed)
- **Smart contract deployment:** 10 JOL burned per contract deploy

### 4.4 Founder Revenue Model (6% allocation)

12.6M JOL locked in OpenZeppelin VestingWallet:

| Source | Mechanism |
|--------|-----------|
| Vesting allocation | 12.6M JOL over 4 years (linear after 1-year cliff) |
| Early mining | First miner, low difficulty — fair launch participation |
| Oracle node | 2% of PoE rewards for running verification infrastructure |
| DAO bounties | Compensation for development, voted by community |
| Energy production | Hydroelectric (Vosges 2029) → PoE mining |

**Founder vesting schedule:**
- Year 1: 0% (cliff — nothing released)
- Year 2-4: Linear release (~3.15M JOL/year)

This is transparent and on-chain — anyone can verify.

---

## 5. Use Cases

### 5.1 For Miners (Traditional)
- Mine JOL with consumer GPUs
- Fair launch — no premine, no ICO, no VC allocation
- Earn block rewards + transaction fees
- ASIC-resistant = decentralized

### 5.2 For Energy Producers
- Register solar panels, wind turbines, hydro installations
- Earn 3x mining rewards per verified kWh
- No hardware investment needed beyond what they already have
- Additional revenue stream on top of grid sales

### 5.3 For Traders/Holders
- Deflationary tokenomics (burn mechanics)
- Real-world value backing (energy production)
- EVM-compatible = full DeFi ecosystem possible
- Governance rights (1 JOL = 1 vote)

### 5.4 For Energy Markets
- P2P energy credit trading via Marketplace contract
- Transparent, auditable energy production records
- Carbon credit integration (future roadmap)
- Cross-border energy certificate trading

### 5.5 For Developers
- Full EVM compatibility — deploy any Solidity contract
- Energy oracle data available on-chain (free public good)
- Build DeFi, NFTs, DAOs on top of JOULE
- Green-certified blockchain for ESG-conscious projects

---

## 6. Competitive Landscape

| Project | Approach | JOULE Advantage |
|---------|----------|-----------------|
| Bitcoin | Pure PoW, energy waste | JOULE rewards energy production |
| Ethereum | PoS, no mining | JOULE keeps mining accessible |
| SolarCoin | Rewards solar only | JOULE supports all renewables + has full PoW security |
| Power Ledger | Energy trading token (no mining) | JOULE has native mining + trading |
| Energy Web | Enterprise chain (permissioned) | JOULE is fully permissionless |
| Filecoin | Proof-of-Storage | JOULE is Proof-of-Energy |

---

## 7. Roadmap

### Phase 1: Foundation (Q2 2026)
- [x] Whitepaper published
- [ ] Go-ethereum fork with EtHash-J
- [ ] Core smart contracts development
- [ ] Testnet launch (single-node, founder hardware)
- [ ] Mining software (GPU miner)

### Phase 2: Testnet (Q3 2026)
- [ ] Public testnet with community miners
- [ ] Oracle network prototype (manual verification)
- [ ] Block explorer and wallet
- [ ] Security audit of smart contracts
- [ ] Community building (Discord, Telegram, Twitter)

### Phase 3: Mainnet (Q4 2026)
- [ ] Mainnet genesis block
- [ ] Fair launch — no premine, no ICO
- [ ] DEX listing (Uniswap on Ethereum via bridge)
- [ ] First energy producers onboarded
- [ ] Mining pool software

### Phase 4: Growth (2027)
- [ ] CEX listings
- [ ] Oracle network decentralization
- [ ] Smart meter API integrations (EU grid operators)
- [ ] Mobile wallet
- [ ] First 100 energy producers

### Phase 5: Scale (2028-2029)
- [ ] Cross-chain bridges
- [ ] Carbon credit marketplace
- [ ] Enterprise energy certificates
- [ ] 1000+ energy producers
- [ ] Vosges hydro plant integration (founder milestone)

---

## 8. Team

**Core Team:** Anonymous
- JOULE is a community-driven protocol with no identified founder
- Satoshi model: code speaks, not names
- All development is open source and auditable

---

## 9. Risks and Mitigations

| Risk | Probability | Mitigation |
|------|------------|------------|
| Regulatory action | Medium | MiCA compliance from day 1, legal counsel |
| Low adoption | Medium | Fair launch + GPU mining = organic community |
| Oracle manipulation | Low | Slashing + multi-source verification |
| ASIC development | Low | Adaptive algorithm parameters |
| Competition | Medium | First-mover in PoW+PoE dual mining |
| Smart contract bugs | Medium | Audits + bug bounty program |

---

## 10. Conclusion

JOULE represents a paradigm shift in cryptocurrency mining. Instead of viewing energy consumption as a necessary evil for network security, JOULE makes energy *production* the core value proposition. Traditional GPU miners secure the network while energy producers add real-world backing.

The result is a cryptocurrency that:
- **Gets stronger** as renewable energy grows
- **Rewards** productive behavior (energy production)
- **Stays decentralized** through GPU mining
- **Enables** a new P2P energy economy
- **Aligns** financial incentives with environmental outcomes

Energy is the fundamental unit of value in physics. JOULE makes it the fundamental unit of value in crypto.

---

*This whitepaper is a living document. Updates will be published at the official JOULE repository.*

**Contact:** [To be published at launch]
**License:** CC BY-SA 4.0
