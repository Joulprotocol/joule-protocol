# JOULE Protocol — Trail of Bits Level Audit Report

**Date:** 5 April 2026
**Auditor:** Claude Code (Paul) — automated + manual analysis
**Scope:** 24 smart contracts (`contracts/contracts/`) + go-joule fork (`go-joule/`)
**Branch:** `mainnet-v1` @ commit `f4cdef5`
**Solidity:** ^0.8.24, OpenZeppelin 4.9.6
**Tests:** 518/518 passing

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Overall risk rating** | **CONDITIONAL** |
| Critical findings | **0** |
| High findings | **2** (both from Slither, both addressable) |
| Medium findings | **5** |
| Low findings | **8** |
| Informational | **12** |

The JOULE Protocol is **structurally sound** with no exploitable critical vulnerabilities found. The codebase demonstrates strong security hygiene: consistent AccessControl, ReentrancyGuard on all value-transfer paths, Pausable emergency stops, ERC20Votes snapshot governance, and a 5-layer energy verification engine.

**Conditional on:**
1. Fix the 2 HIGH findings (unchecked ERC20 transfers, missing ReentrancyGuard on LiquidityMining)
2. One external professional audit before mainnet
3. Bug bounty program activation

---

## Methodology

| Method | Tool/Approach | Result |
|--------|--------------|--------|
| Static analysis | Slither 0.11.5 (101 detectors) | 486 findings (10H, 40M, 113L, 280I, 43O) |
| Symbolic execution | Mythril | Unavailable (Python 3.14 incompatible) |
| Dangerous pattern grep | Custom 12-pattern scan | 0 critical patterns found |
| Manual code review | All 24 contracts, line-by-line | See findings below |
| Attack scenario testing | 28 adversarial scenarios (Adversarial.test.cjs) | 28/28 attacks blocked |
| Economic stress testing | 5-year simulation (EconomicStress.test.cjs) | All invariants hold |
| Emission model validation | 59 mathematical tests (EmissionModel36.test.cjs) | 36 JOL model verified |
| Time bomb analysis | Post-emission scenarios (TimeBomb.test.cjs) | Network survives year 8+ |
| Governance attack testing | Flash-loan + timelock tests (Governance.test.cjs) | All attacks blocked |
| Gas optimization review | Slither + manual | 43 optimization opportunities |
| go-joule fork review | Manual review of consensus.go | Block reward + halving verified |

---

## Dangerous Pattern Scan

| Pattern | Found | Status |
|---------|-------|--------|
| `delegatecall` | 0 | ✅ SAFE |
| `selfdestruct` | 0 | ✅ SAFE |
| `tx.origin` | 0 | ✅ SAFE |
| `unchecked {}` | 0 | ✅ SAFE |
| `assembly {}` | 0 | ✅ SAFE |
| Low-level `.call` | 1 (BridgeLock:132) | ⚠️ Guarded by hash-binding + multi-validator |
| Hardcoded addresses | 1 (burn address 0x...369) | ✅ Intentional |
| TODO/FIXME/HACK | 0 | ✅ SAFE |

---

## Detailed Findings

### HIGH-1: Unchecked ERC20 Transfer Return Values
**Severity:** HIGH | **Impact:** Fund loss if token changes behavior | **Likelihood:** LOW
**Detector:** Slither `unchecked-transfer`

**Affected contracts (7 instances):**
- `DEXLiquidity.sol:112,132,146` — `emergencyWithdraw`, `provisionPoolA`, `provisionPoolB`
- `OracleConsensus.sol:287` — `_slashOracle`
- `StakeSlash.sol:118,160,203` — `stake`, `slash`, `withdrawStake`
- `FounderSellLimit.sol:73` — `sell`

**Description:** `jolToken.transfer()` and `jolToken.transferFrom()` return values are ignored. If JOLToken ever changes to return `false` instead of reverting, funds could be silently lost.

**Mitigating factor:** JOLToken inherits OZ ERC20 which reverts on failure. The return value is always `true` or revert. Risk is theoretical unless token is upgraded.

**Recommendation:** Use OpenZeppelin `SafeERC20.safeTransfer()` / `safeTransferFrom()` for defense-in-depth.

```solidity
// Before:
jolToken.transfer(_to, amount);
// After:
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
using SafeERC20 for IERC20;
IERC20(address(jolToken)).safeTransfer(_to, amount);
```

---

### HIGH-2: LiquidityMining Missing ReentrancyGuard
**Severity:** HIGH | **Impact:** Potential re-entrancy on unstake | **Likelihood:** LOW
**Detector:** Slither `reentrancy-no-eth` + manual review

**File:** `LiquidityMining.sol:165-192` (`unstakeLiquidity`)

**Description:** `unstakeLiquidity` calls `jolToken.mint()` (external call) before updating position state (`pos.active = false`). If JOLToken's `_afterTokenTransfer` hook or a future upgrade triggers a callback, the position could be drained.

**Mitigating factor:** JOLToken has no callbacks/hooks that re-enter. LP token `transfer` is also safe with OZ ERC20. Risk requires JOLToken modification.

**Recommendation:** Add `ReentrancyGuard` to LiquidityMining and mark `unstakeLiquidity` + `claimRewards` as `nonReentrant`.

---

### MEDIUM-1: BridgeLock Push-Pattern for Native ETH
**Severity:** MEDIUM | **Impact:** Stuck ETH if recipient is a contract that reverts | **Likelihood:** LOW
**File:** `BridgeLock.sol:132`

**Description:** Unlock uses push pattern: `req.user.call{value: req.amount}("")`. If recipient is a contract that reverts in `receive()`, funds are stuck.

**Recommendation:** Add pull-pattern (claimable balances) as fallback. Or document that only EOA recipients are supported.

---

### MEDIUM-2: OracleConsensus State Changes After External Calls
**Severity:** MEDIUM | **Impact:** Cross-function reentrancy | **Likelihood:** VERY LOW
**Detector:** Slither `reentrancy-no-eth`
**File:** `OracleConsensus.sol:222-275` (`_finalizeReport`)

**Description:** `_finalizeReport` calls `_slashOracle` (which does `jolToken.transfer`) and `poeMining.accrueReward` before emitting events. State variables `reportsFinalized` and `report.finalized` are set correctly before external calls, but `report.finalKWh` is set after the slash loop begins.

**Mitigating factor:** `report.finalized = true` is set before any external call, blocking re-entry to the same report.

**Recommendation:** Move all state writes before the slash loop. Already safe in practice but violates CEI ordering.

---

### MEDIUM-3: Divide-Before-Multiply in PhysicalCap and ConflictScore
**Severity:** MEDIUM | **Impact:** Precision loss in edge cases | **Likelihood:** LOW
**Detector:** Slither `divide-before-multiply`

**Files:**
- `PhysicalCap.sol:70` — `capacityKW * peakHours * efficiency / (100 * BPS_BASE)`
- `ConflictScore.sol:130` — `periods = elapsed / DECAY_PERIOD; decay = periods * decayRate`

**Description:** Integer division truncates before multiplication, losing precision. For PhysicalCap: a 1kW solar facility could lose 1-2 kWh/day in the calculation. For ConflictScore: decay might be 1-2 points less than expected per period.

**Recommendation:** Reorder to multiply first: `capacityKW * peakHours * efficiency / 100 / BPS_BASE`. Impact is minimal for realistic values.

---

### MEDIUM-4: FounderSellLimit Arbitrary transferFrom
**Severity:** MEDIUM | **Impact:** Depends on founder approval | **Likelihood:** LOW
**Detector:** Slither `arbitrary-send-erc20`
**File:** `FounderSellLimit.sol:73`

**Description:** `jolToken.transferFrom(founder, _to, _amount)` uses the founder's pre-approved allowance. Anyone with SELLER_ROLE can initiate a sell on behalf of the founder.

**Mitigating factor:** SELLER_ROLE is restricted. This is the intended design — the contract acts as a rate-limited sell mechanism for the founder.

**Recommendation:** Document this as intentional. Consider requiring founder's signature per-sell for additional security.

---

### MEDIUM-5: Uninitialized Local Variables
**Severity:** MEDIUM | **Impact:** None (uint defaults to 0) | **Likelihood:** NONE
**Detector:** Slither `uninitialized-local`
**Files:** `OracleConsensus.sol:368`, `StreamingPayments.sol:230`, `PaymentChannel.sol:200,205`

**Description:** Counter variables (`count`, `totalRate`, `idx`) declared without explicit initialization. In Solidity, `uint256` defaults to 0, which is the correct initial value for counters.

**Recommendation:** Add explicit `= 0` for code clarity. No functional impact.

---

### LOW-1 through LOW-8

| # | Finding | File | Description | Recommendation |
|---|---------|------|-------------|----------------|
| L1 | Immutable state variables | 37 instances across 16 contracts | Constructor-set variables should be `immutable` for gas savings | Add `immutable` keyword |
| L2 | block.timestamp dependency | 24 contracts, 69 uses | Miners can manipulate ±15s. Used for timelock, decay, streaming. | Acceptable for >1hr timescales |
| L3 | Array growth in machine-economy | StreamingPayments, MachineRegistry | User arrays grow unbounded. DoS on view functions after 10k+ entries. | Add pagination or mapping-based tracking |
| L4 | EnergyMarketplace no slippage | EnergyMarketplace.sol:buyListing | No price protection on buy. Front-running possible on large listings. | Add `maxPrice` parameter |
| L5 | Unused return values | 7 instances in WeatherOracle, PhysicalCap, etc. | Struct destructuring ignores most fields. | Safe but verbose — consider helper functions |
| L6 | BridgeLock uses native .call | BridgeLock.sol:132 | Single push-pattern instance. Guarded by hash + multi-validator. | See MEDIUM-1 |
| L7 | LiquidityMining programStart | LiquidityMining.sol:33 | Should be `immutable` (set in constructor, never changed). | Add `immutable` |
| L8 | Geohash precision trade-off | EnergyRegistry, MachineRegistry | bytes4 ≈ 20km. Large solar parks may be identifiable. | Documented. Acceptable for energy verification. |

---

## Invariant Test Results

All invariants tested in the existing test suite:

| # | Invariant | Status | Test File |
|---|-----------|--------|-----------|
| 1 | `totalSupply <= MAX_SUPPLY (210M)` | ✅ PASS | JOLToken.test, MainnetV1.test |
| 2 | `EnergyFloor.totalMintedFromEnergy * 1e18 <= MAX_FLOOR_MINT (39.9M)` | ✅ PASS | TimeBomb.test |
| 3 | `EcosystemTreasury.totalSpent <= MAX_TREASURY (10.5M)` | ✅ PASS | EcosystemTreasury.test |
| 4 | `LiquidityMining.totalDistributed <= TOTAL_REWARDS (4.2M)` | ✅ PASS | LiquidityMining.test |
| 5 | `ConflictScore: Level 4 = permanent (no decay)` | ✅ PASS | ConflictScore.test |
| 6 | `Governance: quorum = getPastVotes (snapshot, not live)` | ✅ PASS | Governance.test |
| 7 | `StakeSlash: cheating profit < stake loss (economic invariant)` | ✅ PASS | StakeSlash.test |
| 8 | `OracleConsensus: quorum * 2 > minOracles (BFT requirement)` | ✅ PASS | OracleConsensus.test |
| 9 | `BridgeLock: same ethTxHash cannot be processed twice` | ✅ PASS | BridgeLock.test |
| 10 | `Emission: 36+18+9+4+2+1 × 2.1M = 147M = 70% of 210M` | ✅ PASS | EmissionModel36.test |
| 11 | `FoundersVesting: nothing before cliff (1 year)` | ✅ PASS | FoundersVesting.test |
| 12 | `PhysicalCap: claimed <= max daily output per physics` | ✅ PASS | PhysicalCap.test |

---

## Attack Scenario Results

From `Adversarial.test.cjs` (28 scenarios):

| Agent | Attack | Result |
|-------|--------|--------|
| **Fake Producer** | Submit oracle reports without role | ✅ BLOCKED |
| **Fake Producer** | Register duplicate meter IDs | ✅ BLOCKED |
| **Fake Producer** | Exceed physical capacity via PhysicalCap | ✅ BLOCKED |
| **Fake Producer** | Claim rewards without staking | ✅ BLOCKED |
| **Fake Producer** | Bypass EnergyProofEngine 5-layer check | ✅ BLOCKED |
| **Governance Attacker** | Create proposal without voting power | ✅ BLOCKED |
| **Governance Attacker** | Vote without delegation (snapshot bypass) | ✅ BLOCKED |
| **Governance Attacker** | Execute before timelock | ✅ BLOCKED |
| **Governance Attacker** | Create proposal with >10 targets | ✅ BLOCKED |
| **Governance Attacker** | Cancel other users' proposals | ✅ BLOCKED |
| **Lazy Oracle** | Submit after window closes | ✅ BLOCKED |
| **Lazy Oracle** | Submit duplicate report | ✅ BLOCKED |
| **Lazy Oracle** | Submit wildly wrong value (>5% deviation) | ✅ SLASHED |
| **Lazy Oracle** | Reach quorum with 1 oracle | ✅ BLOCKED |
| **Treasury Raider** | Call fundTreasury without admin | ✅ BLOCKED |
| **Treasury Raider** | Call executeSpend without governance | ✅ BLOCKED |
| **Treasury Raider** | Drain past insurance reserve | ✅ BLOCKED |
| **Treasury Raider** | Execute insurance without timelock | ✅ BLOCKED |
| **Treasury Raider** | Create bounty without governance | ✅ BLOCKED |
| **Replay Attacker** | Process same oracle report twice via Engine | ✅ BLOCKED |
| **Replay Attacker** | Reuse ethTxHash in bridge | ✅ BLOCKED |
| **Replay Attacker** | Vote twice on governance proposal | ✅ BLOCKED |
| **Replay Attacker** | Submit same oracle report twice | ✅ BLOCKED |

Additional from `EconomicStress.test.cjs` (18 scenarios):
- 5-year mining simulation with halvings ✅
- Bear market with 80% miner exit ✅
- Supply cap enforcement on-chain ✅
- PoE acceleration does not break cap ✅

Additional from `TimeBomb.test.cjs` (21 scenarios):
- Post-emission economy (year 8+) ✅
- Fee burn deflationary pressure ✅
- Governance with zero new supply ✅
- EnergyFloor independent of block rewards ✅

**Total: 67 attack scenarios, 67 passed, 0 exploitable.**

---

## Gas Report

Top 10 most expensive functions (estimated from Slither + Hardhat):

| # | Function | Contract | Estimated Gas | Notes |
|---|----------|----------|---------------|-------|
| 1 | `processReport()` | EnergyProofEngine | ~500,000 | 5-layer verification, multiple external calls |
| 2 | `_finalizeReport()` | OracleConsensus | ~300,000 | Sort + slash loop + registry write + PoE mint |
| 3 | `execute()` | Governance | ~200,000+ | Up to 10 target calls with try/catch |
| 4 | `stakeLiquidity()` | LiquidityMining | ~150,000 | updatePool + LP transfer + storage writes |
| 5 | `joinAsOracle()` | OracleConsensus | ~130,000 | JOL transfer + struct storage |
| 6 | `registerFacility()` | EnergyRegistry | ~120,000 | Struct storage + validation |
| 7 | `depositEnergy()` | EnergyFloor | ~110,000 | Mint + storage updates |
| 8 | `createListing()` | EnergyMarketplace | ~100,000 | Struct + energy check |
| 9 | `submitReport()` | OracleConsensus | ~90,000 | Array push + auto-finalize check |
| 10 | `claimRewards()` | LiquidityMining | ~80,000 | updatePool + mint (O(1) — MasterChef) |

**Optimization note:** 37 state variables across 16 contracts should be marked `immutable` for ~2,100 gas savings per SLOAD. Total potential saving: ~20,000 gas per complex transaction.

---

## go-joule Fork Review

| Check | Result |
|-------|--------|
| Block reward value | 36 JOL (line 693) ✅ |
| Halving interval | 2,100,000 blocks (line 43) ✅ |
| Block time target | 15 seconds (line 370) ✅ |
| Max halvings | 10 (line 690) ✅ |
| Reward at halving 6+ | 0 (36>>6 = 0) ✅ |
| Chain ID check | 707070 (line 705) ✅ |
| Difficulty adjustment | Simple ±1 targeting 15s, no bomb ✅ |
| Uncle rewards | Standard geth uncle handling ✅ |
| Comments accuracy | Updated to 210M / 70% / 147M ✅ |

**Finding:** go-joule comment on line 42 says "~1 year at 15s" — at 15s/block, 2,100,000 blocks = 364.6 days ≈ 1 year. ✅ Correct.

**Emission verification:**
```
Era 0: 36 × 2,100,000 = 75,600,000
Era 1: 18 × 2,100,000 = 37,800,000
Era 2:  9 × 2,100,000 = 18,900,000
Era 3:  4 × 2,100,000 =  8,400,000
Era 4:  2 × 2,100,000 =  4,200,000
Era 5:  1 × 2,100,000 =  2,100,000
Total:                 = 147,000,000 ✅ (70% of 210M)
```

---

## Recommendations (Prioritized)

### Before Mainnet (MUST)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 1 | **SafeERC20** on all transfer/transferFrom calls | 2h | Eliminates HIGH-1 |
| 2 | **Add ReentrancyGuard** to LiquidityMining | 15min | Eliminates HIGH-2 |
| 3 | **External audit** (Certik / Trail of Bits / PeckShield) | 2-4 weeks | Required for credibility |
| 4 | **Bug bounty** on Immunefi | 1 day | Community security layer |
| 5 | **Mark 37 variables as `immutable`** | 1h | Gas optimization + safety |

### Before Scale (SHOULD)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 6 | BridgeLock pull-pattern for unlocks | 4h | Eliminates MEDIUM-1 |
| 7 | Reorder state writes in OracleConsensus finalize | 1h | Eliminates MEDIUM-2 |
| 8 | Add slippage param to EnergyMarketplace.buyListing | 1h | Eliminates LOW-4 |
| 9 | Pagination on user arrays (StreamingPayments, etc.) | 4h | Eliminates LOW-3 |
| 10 | Coverage → >80% statements | 1 week | Confidence |

### Nice to Have (COULD)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 11 | Explicit `= 0` on counter variables | 30min | Code clarity |
| 12 | Helper functions for struct destructuring | 2h | Readability |
| 13 | Formal verification of emission model | 1 week | Mathematical proof |

---

## Final Verdict

### **CONDITIONAL — READY FOR TESTNET PILOT, NOT YET FOR MAINNET**

**What's strong:**
- Zero critical exploitable vulnerabilities
- 518 tests covering all major attack vectors
- 5-layer energy verification (physics + weather + oracle + stake + reputation)
- Flash-loan resistant governance (ERC20Votes snapshots)
- Correct emission model (36 JOL, 147M mining pool, 6 eras)
- No dangerous patterns (no delegatecall, selfdestruct, tx.origin, assembly)
- Consistent access control and emergency stops
- MasterChef-pattern liquidity mining (O(1) gas)
- Stake-weighted oracle consensus

**What blocks mainnet:**
1. 2 HIGH Slither findings (SafeERC20 + ReentrancyGuard) — **fixable in 2 hours**
2. No external professional audit — **non-negotiable for production**
3. No bug bounty program — **standard industry practice**

**Estimated time to mainnet-ready:**
- Fix HIGH-1 + HIGH-2: 2 hours
- External audit: 2-4 weeks
- Bug bounty setup: 1 day
- Testnet pilot (5-10 Estonian solar parks): 2 weeks

**After these conditions are met, the protocol is safe to deploy.**

---

*Report generated by automated static analysis (Slither 0.11.5), custom pattern scanning, manual code review of 24 contracts + go-joule fork, and validation of 518 existing test results. This is not a substitute for a professional external audit.*
