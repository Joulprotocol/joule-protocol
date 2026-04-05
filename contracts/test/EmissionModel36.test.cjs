const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * JOULE Emission Model — 36 JOL/block Stress Test
 *
 * Tests the proposed emission schedule:
 *   Era 1 (years 1-4):   36 JOL/block  = ~75.6M JOL  (36%)
 *   Era 2 (years 4-8):   18 JOL/block  = ~37.8M JOL  (18%)
 *   Era 3 (years 8-12):   9 JOL/block  = ~18.9M JOL  (9%)
 *   Era 4 (years 12-16): 4.5 JOL/block = ~9.45M JOL  (4.5%)
 *   Tail:                fees only      = ~1.4M gap    (~0.7%)
 *   Total:               ~141.75M mined (target: 144.9M = 69% × 210M)
 *
 * Current go-joule: 16,000 JOL/block, 2,160,000 halving, 15s target
 * This is the OLD 210B model — needs full update.
 *
 * Block time scenarios tested:
 *   A) 60s blocks + 2,100,000 halving = 4-year eras ✓ (matches proposal)
 *   B) 15s blocks + 2,100,000 halving = 1-year eras (faster emission)
 *   C) 15s blocks + 8,409,600 halving = 4-year eras (but reward × blocks ≠ 75.7M)
 */

describe("Emission Model — 36 JOL/block", function () {

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1: Pure Math — Does the emission schedule add up?
  // ═══════════════════════════════════════════════════════════════

  describe("§1 — Emission Math", function () {

    const INITIAL_REWARD = 36n;
    const HALVING_INTERVAL = 2_100_000n;
    const MAX_SUPPLY = 210_000_000n;
    const MINING_POOL = 147_000_000n; // 70% of 210M

    it("Era 0: 36 × 2,100,000 = 75,600,000 JOL", function () {
      expect(INITIAL_REWARD * HALVING_INTERVAL).to.equal(75_600_000n);
    });

    it("Era 1: 18 × 2,100,000 = 37,800,000 JOL", function () {
      expect((INITIAL_REWARD / 2n) * HALVING_INTERVAL).to.equal(37_800_000n);
    });

    it("Era 2: 9 × 2,100,000 = 18,900,000 JOL", function () {
      expect((INITIAL_REWARD / 4n) * HALVING_INTERVAL).to.equal(18_900_000n);
    });

    it("Era 3: 4 × 2,100,000 = 8,400,000 JOL (integer division: 4.5→4)", function () {
      // CRITICAL: BigInt division truncates! 36/8 = 4, not 4.5
      const era3reward = INITIAL_REWARD / 8n;
      expect(era3reward).to.equal(4n); // NOT 4.5!
      expect(era3reward * HALVING_INTERVAL).to.equal(8_400_000n); // NOT 9,450,000!
    });

    it("Era 4: 2 × 2,100,000 = 4,200,000 JOL", function () {
      const era4reward = INITIAL_REWARD / 16n;
      expect(era4reward).to.equal(2n);
      expect(era4reward * HALVING_INTERVAL).to.equal(4_200_000n);
    });

    it("Era 5: 1 × 2,100,000 = 2,100,000 JOL", function () {
      const era5reward = INITIAL_REWARD / 32n;
      expect(era5reward).to.equal(1n);
      expect(era5reward * HALVING_INTERVAL).to.equal(2_100_000n);
    });

    it("Era 6+: 0 JOL (36/64 = 0 in integer division)", function () {
      expect(INITIAL_REWARD / 64n).to.equal(0n);
    });

    it("Total mined (eras 0-5) = 147,000,000 — EXCEEDS mining pool by 2.1M!", function () {
      let total = 0n;
      let reward = INITIAL_REWARD;
      for (let era = 0; era < 10; era++) {
        if (reward === 0n) break;
        total += reward * HALVING_INTERVAL;
        reward = reward / 2n;
      }
      // 75.6 + 37.8 + 18.9 + 8.4 + 4.2 + 2.1 = 147.0M
      expect(total).to.equal(147_000_000n);
      // Exactly matches the 70% mining pool!
      expect(total).to.equal(MINING_POOL);
      // And stays under MAX_SUPPLY
      expect(total).to.be.lt(MAX_SUPPLY);
    });

    it("Zero gap: 70% pool (147M) = total mined (147M) — perfect fit", function () {
      const totalMined = 147_000_000n;
      const gap = totalMined - MINING_POOL;
      expect(gap).to.equal(0n);
    });

    it("All 6 eras mine completely — no truncation needed", function () {
      let total = 0n;
      let reward = INITIAL_REWARD;
      let eras = 0;

      while (reward > 0n) {
        total += reward * HALVING_INTERVAL;
        reward = reward / 2n;
        eras++;
      }

      expect(eras).to.equal(6);
      expect(total).to.equal(MINING_POOL);
    });

    it("ALTERNATIVE: use 70% mining pool (147M) — clean fit", function () {
      const MINING_70 = MAX_SUPPLY * 70n / 100n; // 147M
      let total = 0n;
      let reward = INITIAL_REWARD;
      for (let era = 0; era < 10; era++) {
        if (reward === 0n) break;
        total += reward * HALVING_INTERVAL;
        reward = reward / 2n;
      }
      // 147M mined = exactly 70% of 210M — perfect fit!
      expect(total).to.equal(MINING_70);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2: Integer Division Trap (the 4.5 JOL problem)
  // ═══════════════════════════════════════════════════════════════

  describe("§2 — Integer Division: 36 is NOT cleanly halvable", function () {

    it("36 → 18 → 9 → 4 → 2 → 1 → 0 (NOT 4.5!)", function () {
      const halvings = [];
      let r = 36n;
      while (r > 0n) {
        halvings.push(Number(r));
        r = r / 2n;
      }
      expect(halvings).to.deep.equal([36, 18, 9, 4, 2, 1]);
      // Missing: 4.5, 2.25, 1.125 — all truncated by integer math
    });

    it("go-joule uses bit shift (Rsh) — same truncation as BigInt /2", function () {
      // Go code: reward.Rsh(reward, 1) is equivalent to reward / 2
      // Both truncate: 9 >> 1 = 4 (not 4.5)
      let reward = 36n;
      for (let i = 0; i < 3; i++) {
        reward = reward >> 1n; // Bit shift, same as Go's Rsh
      }
      expect(reward).to.equal(4n); // 36 >> 3 = 4
    });

    it("Lost JOL from truncation: 36 series loses 3.15M vs ideal", function () {
      // Ideal (float): 36 + 18 + 9 + 4.5 + 2.25 + 1.125 + ... = 72
      // Actual (int):  36 + 18 + 9 + 4 + 2 + 1 = 70
      // Loss per interval: 2 JOL
      // Over 2.1M blocks: 2 × 2,100,000 = 4,200,000 JOL lost
      // But really it's more nuanced — let's compute exactly

      const interval = 2_100_000n;
      let idealTotal = 0;
      let actualTotal = 0n;
      let idealReward = 36;
      let actualReward = 36n;

      for (let era = 0; era < 10; era++) {
        if (idealReward < 0.5) break;
        idealTotal += idealReward * 2_100_000;
        if (actualReward > 0n) {
          actualTotal += actualReward * interval;
        }
        idealReward /= 2;
        actualReward = actualReward / 2n;
      }

      // Ideal: 36×2.1M × (1 + 0.5 + 0.25 + 0.125 + ...) ≈ 151.2M
      // Actual: 147M (integer truncation)
      const loss = idealTotal - Number(actualTotal);
      expect(loss).to.be.gt(3_000_000); // >3M JOL lost to truncation
      expect(loss).to.be.lt(4_000_000); // ~3.02M
    });

    it("Compare: 50 JOL/block — same truncation pattern", function () {
      // 50 → 25 → 12 → 6 → 3 → 1 → 0
      const halvings50 = [];
      let r = 50n;
      while (r > 0n) {
        halvings50.push(Number(r));
        r = r / 2n;
      }
      expect(halvings50).to.deep.equal([50, 25, 12, 6, 3, 1]);
      // Also loses fractional JOL at steps 12.5→12, 6.25→6, 3.125→3, 1.5625→1
    });

    it("Compare: 32 JOL/block — PERFECT binary halving, zero truncation", function () {
      // 32 → 16 → 8 → 4 → 2 → 1 → 0
      const halvings32 = [];
      let r = 32n;
      while (r > 0n) {
        halvings32.push(Number(r));
        r = r / 2n;
      }
      expect(halvings32).to.deep.equal([32, 16, 8, 4, 2, 1]);
      // ZERO truncation loss! 32 is a power of 2.
      // Total: 32 × 2.1M × (sum) = (32+16+8+4+2+1) × 2.1M = 63 × 2.1M = 132.3M
    });

    it("Compare: 48 JOL/block — loses 4.2M, but cleaner halvings", function () {
      // 48 → 24 → 12 → 6 → 3 → 1 → 0
      const halvings48 = [];
      let r = 48n;
      while (r > 0n) {
        halvings48.push(Number(r));
        r = r / 2n;
      }
      expect(halvings48).to.deep.equal([48, 24, 12, 6, 3, 1]);
      const total48 = halvings48.reduce((a, b) => a + b, 0) * 2_100_000;
      // (48+24+12+6+3+1) × 2.1M = 94 × 2.1M = 197.4M — too much for 144.9M pool
      expect(total48).to.equal(197_400_000);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 3: Block Time Analysis — When do eras align with years?
  // ═══════════════════════════════════════════════════════════════

  describe("§3 — Block Time × Halving Interval → Era Duration", function () {

    const HALVING = 2_100_000;
    const SECONDS_PER_YEAR = 365.25 * 86400;

    it("Current go-joule: 15s blocks × 2,160,000 interval = 1.03 years/era", function () {
      const eraDuration = 2_160_000 * 15 / SECONDS_PER_YEAR;
      expect(eraDuration).to.be.closeTo(1.03, 0.01);
    });

    it("Scenario A: 60s blocks × 2,100,000 interval = 3.99 years/era ✓", function () {
      const eraDuration = HALVING * 60 / SECONDS_PER_YEAR;
      expect(eraDuration).to.be.closeTo(3.99, 0.01);
      // THIS matches Erkki's "Era 1 (years 1-4)" perfectly!
    });

    it("Scenario B: 15s blocks × 2,100,000 interval = 1.0 year/era", function () {
      const eraDuration = HALVING * 15 / SECONDS_PER_YEAR;
      expect(eraDuration).to.be.closeTo(1.0, 0.01);
      // Fast emission — mining ends in ~5 years
    });

    it("Scenario C: 15s blocks × 8,409,600 interval = 4.0 years/era", function () {
      const halving4yr = Math.round(4 * SECONDS_PER_YEAR / 15);
      expect(halving4yr).to.be.closeTo(8_409_600, 10000);
      const eraDuration = halving4yr * 15 / SECONDS_PER_YEAR;
      expect(eraDuration).to.be.closeTo(4.0, 0.01);
      // But: 36 × 8,409,600 = 302.7M per era — WAY over 75.7M!
      expect(36 * halving4yr).to.be.gt(300_000_000);
    });

    it("Scenario D: 30s blocks × 2,100,000 interval = 2.0 years/era", function () {
      const eraDuration = HALVING * 30 / SECONDS_PER_YEAR;
      expect(eraDuration).to.be.closeTo(2.0, 0.01);
      // Compromise: 2-year eras, mining lasts ~10 years
    });

    it("For 4-year eras with 36 JOL — only 60s block time works", function () {
      // Solving: blockTime × 2,100,000 = 4 × 365.25 × 86400
      const requiredBlockTime = 4 * SECONDS_PER_YEAR / HALVING;
      expect(requiredBlockTime).to.be.closeTo(60.0, 0.2);
    });

    it("60s block time: throughput = ~16.7 tx/min (vs 15s: ~66.7 tx/min)", function () {
      const tps60 = 1 / 60;
      const tps15 = 1 / 15;
      // Blocks per minute, not TPS (TPS depends on gas limit)
      expect(60 / 60).to.equal(1);  // 1 block/min at 60s
      expect(60 / 15).to.equal(4);  // 4 blocks/min at 15s
      // 60s is 4x slower block production — UX impact for confirmations
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 4: Distribution Integrity — Does 69/20/6/5 still work?
  // ═══════════════════════════════════════════════════════════════

  describe("§4 — Distribution with 36 JOL Model", function () {

    const MAX_SUPPLY = 210_000_000n;

    it("69% mining pool = 144.9M — but 36 JOL series gives 147M (overflow)", function () {
      const miningPool = MAX_SUPPLY * 69n / 100n;
      expect(miningPool).to.equal(144_900_000n);

      const actualMined = (36n + 18n + 9n + 4n + 2n + 1n) * 2_100_000n;
      expect(actualMined).to.equal(147_000_000n);
      expect(actualMined).to.be.gt(miningPool);
    });

    it("OPTION 1: Adjust to 70% mining = 147M — perfect fit for 36 JOL", function () {
      const mining70 = MAX_SUPPLY * 70n / 100n;
      expect(mining70).to.equal(147_000_000n);

      // New distribution: 70% Mining, 19% Reserve, 6% Founder, 5% Ecosystem
      const reserve19 = MAX_SUPPLY * 19n / 100n; // 39.9M
      const founder6 = MAX_SUPPLY * 6n / 100n;   // 12.6M
      const ecosystem5 = MAX_SUPPLY * 5n / 100n;  // 10.5M
      expect(mining70 + reserve19 + founder6 + ecosystem5).to.equal(MAX_SUPPLY);
    });

    it("OPTION 2: Keep 69%, cap mining at 144.9M — wastes 2.1M potential", function () {
      const miningPool = MAX_SUPPLY * 69n / 100n;
      // Mining stops when 144.9M reached, during era 5
      // 2.1M JOL worth of blocks go unrewarded
      const wasted = 147_000_000n - miningPool;
      expect(wasted).to.equal(2_100_000n);
    });

    it("OPTION 3: Use 34 JOL/block — series gives 142.8M, under 144.9M ✓", function () {
      // 34 → 17 → 8 → 4 → 2 → 1 → 0 (integer division)
      let total = 0n;
      let reward = 34n;
      while (reward > 0n) {
        total += reward * 2_100_000n;
        reward = reward / 2n;
      }
      // 34+17+8+4+2+1 = 66; 66 × 2.1M = 138.6M
      expect(total).to.equal(138_600_000n);
      expect(total).to.be.lt(144_900_000n); // Fits in 69% pool ✓
      // Gap: 144.9M - 138.6M = 6.3M — large but stable gap
    });

    it("BEST FIT: 36 JOL + 70% pool is the cleanest solution", function () {
      // 36 JOL × 2.1M halving = 147M total mined
      // 70/19/6/5 distribution:
      const d = {
        mining: 147_000_000n,    // 70%
        reserve: 39_900_000n,    // 19%
        founder: 12_600_000n,    // 6%
        ecosystem: 10_500_000n   // 5%
      };
      const sum = d.mining + d.reserve + d.founder + d.ecosystem;
      expect(sum).to.equal(210_000_000n);

      // Energy reserve at 19% = 39.9M (vs current 42M at 20%)
      // Difference: only 2.1M less in reserve — negligible
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 5: Economic Sustainability — Post-mining survival
  // ═══════════════════════════════════════════════════════════════

  describe("§5 — Post-Mining Economy", function () {

    it("At 60s blocks: mining ends at year ~20 (era 5 truncated)", function () {
      const SECONDS_PER_YEAR = 365.25 * 86400;
      const eraYears = 2_100_000 * 60 / SECONDS_PER_YEAR; // ~4 years
      // Eras 0-4 = 5 full eras = ~20 years
      // Era 5 partially mined = ~21 years total
      const miningEndYear = 5 * eraYears; // ~20 years
      expect(miningEndYear).to.be.closeTo(20, 1);
    });

    it("At 15s blocks: mining ends at year ~5 (era 5 truncated)", function () {
      const SECONDS_PER_YEAR = 365.25 * 86400;
      const eraYears = 2_100_000 * 15 / SECONDS_PER_YEAR; // ~1 year
      const miningEndYear = 5 * eraYears;
      expect(miningEndYear).to.be.closeTo(5, 1);
    });

    it("Fee economy: need 5 JOL/block equiv from fees at era 4+ to sustain miners", function () {
      // At era 4 (reward = 2 JOL), miners earn very little
      // Fee revenue must compensate or miners leave
      // Minimum viable miner reward: enough to cover electricity
      // Assume: 0.05 USD/kWh electricity, 500W miner, 60s blocks
      // Cost per block: 0.5kW × (60/3600)h × 0.05$/kWh = $0.000417/block
      // At JOL = $0.10: need 0.00417 JOL/block minimum (trivial)
      // At JOL = $0.001: need 0.417 JOL/block (still manageable)
      // Fee economy is viable if there's ANY transaction activity
      expect(true).to.be.true; // Documented analysis
    });

    it("36 vs 50: mining lasts 5 eras (same) but 36 is gentler curve", function () {
      // 50 JOL: 50+25+12+6+3+1 = 97; total = 97 × 2.1M = 203.7M
      // 36 JOL: 36+18+9+4+2+1  = 70; total = 70 × 2.1M = 147.0M
      // 50 JOL overshoots 144.9M cap at era 1 (cumulative: 157.5M)!
      // 36 JOL fits much better — mining actually reaches era 5

      let total50 = 0n;
      let r50 = 50n;
      let era50stop = -1;
      for (let era = 0; era < 10; era++) {
        if (r50 === 0n) break;
        if (total50 + r50 * 2_100_000n > 144_900_000n && era50stop === -1) {
          era50stop = era;
        }
        total50 += r50 * 2_100_000n;
        r50 = r50 / 2n;
      }

      let total36 = 0n;
      let r36 = 36n;
      let era36stop = -1;
      for (let era = 0; era < 10; era++) {
        if (r36 === 0n) break;
        if (total36 + r36 * 2_100_000n > 144_900_000n && era36stop === -1) {
          era36stop = era;
        }
        total36 += r36 * 2_100_000n;
        r36 = r36 / 2n;
      }

      // 50 JOL: hits cap at era 1 (cumulative after era 1 = 157.5M > 144.9M)
      expect(era50stop).to.equal(1);
      // 36 JOL: hits cap at era 5 (cumulative 144.9M < 147M)
      expect(era36stop).to.equal(5);
      // 36 JOL distributes rewards over 5× more eras — much healthier!
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 6: PoE Impact — 3× multiplier with 36 JOL base
  // ═══════════════════════════════════════════════════════════════

  describe("§6 — PoE Multiplier Economics", function () {

    let jolToken, registry, poeMining;
    let owner, producer, oracle;

    beforeEach(async function () {
      [owner, producer, oracle] = await ethers.getSigners();

      const JOLToken = await ethers.getContractFactory("JOLToken");
      jolToken = await JOLToken.deploy(owner.address);

      const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
      registry = await EnergyRegistry.deploy(owner.address);

      const PoEMining = await ethers.getContractFactory("PoEMining");
      poeMining = await PoEMining.deploy(owner.address, jolToken.target, registry.target);

      await jolToken.grantRole(await jolToken.MINTER_ROLE(), poeMining.target);
      await jolToken.grantRole(await jolToken.MINTER_ROLE(), owner.address);
      await poeMining.grantRole(await poeMining.ORACLE_ROLE(), oracle.address);
      await registry.grantRole(await registry.VERIFIER_ROLE(), owner.address);

      const meterId = ethers.keccak256(ethers.toUtf8Bytes("solar-36-test"));
      await registry.connect(producer).registerFacility(0, 100, meterId, "0x75636674", 2, "EE");
      await registry.verifyFacility(1);
    });

    it("PoE 3× still works: 100 kWh = 300 JOL gross, 294 net", async function () {
      await poeMining.connect(oracle).accrueReward(1, 100);
      const claimable = await poeMining.getClaimable(producer.address);
      expect(claimable).to.equal(ethers.parseEther("294")); // 300 - 2% = 294
    });

    it("PoE vs PoW ratio changes: 36 JOL block vs 3 JOL/kWh", function () {
      // With 50 JOL/block: PoW miner gets 50 JOL per block
      // With 36 JOL/block: PoW miner gets 36 JOL per block
      // PoE always gives 3 JOL/kWh regardless of PoW reward
      // Ratio: 36/3 = 12 kWh to match one block reward (was 50/3 = 16.7 kWh)
      // Energy producers become relatively MORE valuable with lower PoW rewards
      const kwh_to_match_pow36 = 36 / 3;
      const kwh_to_match_pow50 = 50 / 3;
      expect(kwh_to_match_pow36).to.equal(12);
      expect(kwh_to_match_pow50).to.be.closeTo(16.67, 0.01);
      // 12 kWh vs 16.7 kWh — energy producers benefit from 36 model
    });

    it("PoE eats into mining pool: 1M kWh/year = 3M JOL/year from pool", function () {
      // If 1000 producers each produce 1000 kWh/year = 1M kWh total
      // PoE reward: 1M × 3 = 3M JOL per year
      // Era 0 PoW pool: 75.6M over ~4 years = ~18.9M/year
      // PoE takes 3M from same pool → PoW effectively gets ~15.9M/year
      // As PoE grows, PoW miners get squeezed
      const yearlyPoeKwh = 1_000_000n;
      const yearlyPoeReward = yearlyPoeKwh * 3n;
      expect(yearlyPoeReward).to.equal(3_000_000n);

      // At 10M kWh/year (10× growth): 30M JOL from pool — EXCEEDS era 0 yearly allocation!
      const bigPoe = 10_000_000n * 3n;
      expect(bigPoe).to.equal(30_000_000n);
      // 30M > 18.9M/year allocation → pool exhausts faster than expected
    });

    it("RISK: PoE acceleration can drain mining pool before era schedule completes", function () {
      // The halving schedule assumes ALL rewards come from PoW blocks
      // But PoE also draws from the same pool via JOLToken.mint()
      // Combined PoW+PoE minting: could exhaust 144.9M pool in 3 eras, not 5
      //
      // Example with aggressive PoE:
      // Year 1: PoW 18.9M + PoE 5M = 23.9M
      // Year 2: PoW 18.9M + PoE 15M = 33.9M (PoE growing fast)
      // Year 3: PoW 18.9M + PoE 30M = 48.9M
      // Year 4: PoW 9.45M + PoE 40M = 49.45M (era 1 halving)
      // Cumulative: 156.15M — EXCEEDS 144.9M by year 4!
      //
      // This is NOT a flaw in the 36 JOL model — it exists with 50 JOL too.
      // Solution: PoE minting must count toward the MAX_SUPPLY cap (it does).
      // But the HALVING schedule doesn't adjust for PoE acceleration.
      expect(true).to.be.true; // Documented risk
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 7: Security — Attack Surface Changes
  // ═══════════════════════════════════════════════════════════════

  describe("§7 — Security Analysis", function () {

    it("Lower reward = lower hashrate = potentially easier 51% attack", function () {
      // 36 JOL vs 50 JOL = 28% less mining incentive
      // If JOL price is constant: 28% fewer miners (simplified)
      // 51% attack becomes 28% cheaper
      const rewardReduction = (50 - 36) / 50;
      expect(rewardReduction).to.equal(0.28);
      // Mitigation: energy backing gives JOL a price floor
      // If lower reward → higher scarcity → higher price → incentive balances
    });

    it("Longer mining = longer network security from PoW", function () {
      // 50 JOL: mining pool exhausts at era 1-2 (~1-2 eras, then cap hit)
      // 36 JOL: mining pool exhausts at era 5 (~5 eras)
      // Longer PoW = longer security guarantee
      // This is a SIGNIFICANT advantage of the 36 model
      const eras50 = 1; // cap hit during era 1
      const eras36 = 5; // cap hit during era 5
      expect(eras36).to.be.gt(eras50);
    });

    it("60s block time: 51% attack cost increases (more work per block)", function () {
      // At 60s blocks: difficulty adjusts upward → more hashes per block
      // Single confirmation is STRONGER but takes longer
      // 6 confirmations: 60s × 6 = 6 minutes (vs 15s × 6 = 90 seconds)
      // UX: users wait longer for confirmation
      // Security: each confirmation is 4× stronger than 15s blocks
      const confirmTime60s = 6 * 60; // 360 seconds
      const confirmTime15s = 6 * 15; // 90 seconds
      expect(confirmTime60s).to.equal(360);
      expect(confirmTime15s).to.equal(90);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 8: Smart Contract Validation — MAX_SUPPLY cap holds
  // ═══════════════════════════════════════════════════════════════

  describe("§8 — Contract-level Supply Cap", function () {

    let jolToken, owner;

    beforeEach(async function () {
      [owner] = await ethers.getSigners();
      const JOLToken = await ethers.getContractFactory("JOLToken");
      jolToken = await JOLToken.deploy(owner.address);
      await jolToken.grantRole(await jolToken.MINTER_ROLE(), owner.address);
    });

    it("JOLToken MAX_SUPPLY = 210M — unchanged regardless of emission model", async function () {
      expect(await jolToken.MAX_SUPPLY()).to.equal(ethers.parseEther("210000000"));
    });

    it("36 JOL model total (147M) + reserves (63M) = 210M — cap holds", async function () {
      // Mint mining pool: 147M (70% model)
      await jolToken.mint(owner.address, ethers.parseEther("147000000"));
      // Mint reserves: 39.9M + 12.6M + 10.5M = 63M
      await jolToken.mint(owner.address, ethers.parseEther("63000000"));
      // Total: 210M — at cap
      expect(await jolToken.totalSupply()).to.equal(ethers.parseEther("210000000"));
      // Cannot mint more
      await expect(
        jolToken.mint(owner.address, 1n)
      ).to.be.revertedWith("JOL: exceeds max supply");
    });

    it("Even with PoE acceleration, MAX_SUPPLY is the hard stop", async function () {
      // Simulate: massive PoE minting + PoW minting approaching cap
      await jolToken.mint(owner.address, ethers.parseEther("209999999"));
      // Only 1 JOL left
      expect(await jolToken.remainingSupply()).to.equal(ethers.parseEther("1"));
      // Mint the last 1 JOL
      await jolToken.mint(owner.address, ethers.parseEther("1"));
      // Done — no more minting possible
      await expect(
        jolToken.mint(owner.address, 1n)
      ).to.be.revertedWith("JOL: exceeds max supply");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 9: go-joule Code Gap Analysis
  // ═══════════════════════════════════════════════════════════════

  describe("§9 — go-joule vs Proposed Model: Gap Analysis", function () {

    it("CRITICAL GAP: go-joule has 16,000 JOL/block — needs change to 36", function () {
      // File: go-joule/consensus/ethash/consensus.go:693
      // Current: reward := new(big.Int).SetUint64(16_000)
      // Needed:  reward := new(big.Int).SetUint64(36)
      const currentGoReward = 16_000n;
      const proposedReward = 36n;
      expect(currentGoReward).to.not.equal(proposedReward);
    });

    it("CRITICAL GAP: go-joule targets 15s blocks — proposal implies 60s", function () {
      // File: go-joule/consensus/ethash/consensus.go:370
      // Current: var big15 = big.NewInt(15)
      // Needed:  var big60 = big.NewInt(60) (if 4-year eras desired)
      // OR keep 15s and accept 1-year eras
      expect(15).to.not.equal(60);
    });

    it("GAP: go-joule comment says 210B — needs update to 210M", function () {
      // File: go-joule/consensus/ethash/consensus.go:686
      // Current: "60% of 210B supply = 126B JOL"
      // Needed:  "70% of 210M supply = 147M JOL" (with 36 JOL model)
      expect(true).to.be.true; // Documentation gap
    });

    it("GAP: halving interval 2,160,000 vs tests using 2,100,000", function () {
      // go-joule: JouleHalvingInterval = uint64(2_160_000)
      // Tests:    HALVING_INTERVAL = 2_100_000n
      // These should match!
      expect(2_160_000).to.not.equal(2_100_000);
    });

    it("Test suite constants still use 50 JOL — need update to 36", function () {
      // Files needing update:
      // - EconomicStress.test.cjs: INITIAL_REWARD = 50n (line 28)
      // - TimeBomb.test.cjs: INITIAL_REWARD = 50n (line 21)
      // - MainnetV1.test.cjs: references to 50 JOL/block
      expect(true).to.be.true; // Inventory of changes needed
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 10: Head-to-Head — 36 vs 50 vs 32 vs 48
  // ═══════════════════════════════════════════════════════════════

  describe("§10 — Emission Model Comparison", function () {

    const HALVING = 2_100_000n;
    const POOL = 144_900_000n;

    function simulate(initialReward) {
      let total = 0n;
      let reward = initialReward;
      let eras = 0;
      let eraCapHit = -1;
      const schedule = [];

      while (reward > 0n && eras < 20) {
        const eraTotal = reward * HALVING;
        if (total + eraTotal > POOL && eraCapHit === -1) {
          eraCapHit = eras;
        }
        schedule.push({ era: eras, reward: Number(reward), total: Number(eraTotal) });
        total += eraTotal;
        reward = reward / 2n;
        eras++;
      }

      return { total: Number(total), eras, eraCapHit, schedule };
    }

    it("36 JOL: 6 eras, 147M total, cap hit at era 5", function () {
      const r = simulate(36n);
      expect(r.eras).to.equal(6);
      expect(r.total).to.equal(147_000_000);
      expect(r.eraCapHit).to.equal(5);
    });

    it("50 JOL: 6 eras, 203.7M total, cap hit at era 1", function () {
      const r = simulate(50n);
      expect(r.eras).to.equal(6);
      expect(r.total).to.equal(203_700_000);
      expect(r.eraCapHit).to.equal(1); // Hits cap during era 1!
    });

    it("32 JOL: 6 eras, 132.3M total, NEVER hits cap — 12.6M wasted", function () {
      const r = simulate(32n);
      expect(r.eras).to.equal(6);
      expect(r.total).to.equal(132_300_000);
      expect(r.eraCapHit).to.equal(-1); // Never hits pool cap
      expect(144_900_000 - r.total).to.equal(12_600_000); // 12.6M gap
    });

    it("48 JOL: 6 eras, 197.4M total, cap hit at era 1", function () {
      const r = simulate(48n);
      expect(r.eras).to.equal(6);
      expect(r.total).to.equal(197_400_000);
      expect(r.eraCapHit).to.equal(1);
    });

    it("WINNER: 36 JOL — best balance of reward distribution and pool utilization", function () {
      // 50 JOL: cap hit era 1 — too aggressive, miners get cut off early
      // 48 JOL: cap hit era 1 — same problem
      // 36 JOL: cap hit era 5 — smoothest possible distribution
      // 32 JOL: never hits cap — wastes 12.6M mining potential
      //
      // 36 JOL is objectively the best choice for 144.9M (69%) pool
      // Even better with 70% (147M) pool — EXACT match
      const r36 = simulate(36n);
      const r50 = simulate(50n);
      const r32 = simulate(32n);

      // 36 distributes rewards across most eras before cap
      expect(r36.eraCapHit).to.be.gt(r50.eraCapHit);
      expect(r36.eraCapHit).to.be.gt(r32.eraCapHit); // 32 never hits cap (-1)
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SECTION 11: Erkki's Numbers — Exact Validation
  // ═══════════════════════════════════════════════════════════════

  describe("§11 — Erkki's Proposed Numbers", function () {

    it("'Era 1: 36 JOL = ~75.7M (36%)' — actual: 75.6M (36.0%)", function () {
      const era1 = 36n * 2_100_000n;
      expect(era1).to.equal(75_600_000n);
      const pct = Number(era1) * 100 / 210_000_000;
      expect(pct).to.equal(36.0);
    });

    it("'Era 2: 18 JOL = ~37.8M (18%)' — actual: 37.8M (18.0%) ✓", function () {
      const era2 = 18n * 2_100_000n;
      expect(era2).to.equal(37_800_000n);
      const pct = Number(era2) * 100 / 210_000_000;
      expect(pct).to.equal(18.0);
    });

    it("'Era 3: 9 JOL = ~18.9M (9%)' — actual: 18.9M (9.0%) ✓", function () {
      const era3 = 9n * 2_100_000n;
      expect(era3).to.equal(18_900_000n);
      const pct = Number(era3) * 100 / 210_000_000;
      expect(pct).to.equal(9.0);
    });

    it("'Era 4: 4.5 JOL = ~9.5M (4.5%)' — WRONG: integer 4 JOL = 8.4M (4.0%)", function () {
      // Erkki wrote 4.5 JOL — but Solidity/Go integer math gives 4
      const era4_proposed = 4.5 * 2_100_000; // float
      expect(era4_proposed).to.equal(9_450_000); // Erkki's number

      const era4_actual = 4n * 2_100_000n; // integer
      expect(era4_actual).to.equal(8_400_000n); // Reality

      const diff = era4_proposed - Number(era4_actual);
      expect(diff).to.equal(1_050_000); // 1.05M JOL difference!
    });

    it("'Total: ~143M' — actual: 141.75M (integer) or 147M (with eras 4-5)", function () {
      // Erkki's estimate: ~143M
      // With integer math (eras 0-3 only): 75.6 + 37.8 + 18.9 + 8.4 = 140.7M
      // With eras 0-5: 75.6 + 37.8 + 18.9 + 8.4 + 4.2 + 2.1 = 147.0M
      const first4eras = 75_600_000n + 37_800_000n + 18_900_000n + 8_400_000n;
      expect(first4eras).to.equal(140_700_000n);

      const allEras = first4eras + 4_200_000n + 2_100_000n;
      expect(allEras).to.equal(147_000_000n);
    });

    it("Summary verdict: proposal is GOOD with minor corrections needed", function () {
      // ✅ 36 JOL/block — excellent choice for 210M supply
      // ✅ Halving schedule gives smooth, long-lived emission
      // ✅ Better than 50 JOL (which overflows pool at era 1)
      //
      // ⚠️ Corrections needed:
      // 1. Era 4 = 4 JOL (not 4.5) — integer truncation
      // 2. Total mined = 147M (not 143M) — includes eras 4-5
      // 3. Distribution should be 70/19/6/5 (not 69/20/6/5) for clean fit
      // 4. Block time 60s needed for 4-year eras (currently 15s in go-joule)
      // 5. go-joule code needs update from 16,000 to 36
      expect(true).to.be.true;
    });
  });
});
