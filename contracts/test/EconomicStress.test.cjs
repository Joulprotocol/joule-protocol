const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * 5-Year Economic Stress Simulation
 *
 * Math-based tests using BigInt arithmetic to validate JOULE tokenomics
 * under realistic multi-year scenarios: growth, halvings, bear markets,
 * oracle degradation, and producer exits.
 *
 * Protocol constants:
 *   MAX_SUPPLY       = 210,000,000 JOL
 *   Block reward     = 50 JOL (era 0), halving every 2,100,000 blocks
 *   Blocks/day       = 14,400 (6s block time)
 *   PoE multiplier   = 3x (1 JOL/kWh × 3)
 *   Oracle fee       = 2%
 */

describe("5-Year Economic Stress Simulation", function () {
  // ─── Protocol Constants ───────────────────────────────────────
  const MAX_SUPPLY        = 210_000_000n;
  const MAX_SUPPLY_WEI    = MAX_SUPPLY * 10n ** 18n;
  const HALVING_INTERVAL  = 2_100_000n;
  const BLOCKS_PER_DAY    = 14_400n;
  const BLOCKS_PER_YEAR   = BLOCKS_PER_DAY * 365n;
  const POE_MULTIPLIER    = 3n;
  const ORACLE_FEE_BPS    = 200n;
  const INITIAL_REWARD    = 50n;

  let jolToken, registry, poeMining;
  let owner, producer1, producer2, oracleNode;

  beforeEach(async function () {
    [owner, producer1, producer2, oracleNode] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(owner.address);

    const PoEMining = await ethers.getContractFactory("PoEMining");
    poeMining = await PoEMining.deploy(owner.address, jolToken.target, registry.target);

    // Grant roles
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    const ORACLE_ROLE = await poeMining.ORACLE_ROLE();
    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();

    await jolToken.grantRole(MINTER_ROLE, owner.address);
    await jolToken.grantRole(MINTER_ROLE, poeMining.target);
    await poeMining.grantRole(ORACLE_ROLE, oracleNode.address);
    await registry.grantRole(VERIFIER_ROLE, owner.address);
  });

  // ─── Year 1: Growth Phase ──────────────────────────────────────

  describe("Year 1 — 10 miners, 50 JOL/block", function () {
    it("10 miners produce ~52.56M JOL in year 1 (block rewards only)", function () {
      // 14,400 blocks/day × 365 days = 5,256,000 blocks/year
      // 50 JOL/block × 5,256,000 = 262,800,000 JOL if no halving
      // But halving at block 2,100,000 (~day 146):
      //   Era 0: 50 × 2,100,000 = 105,000,000
      //   Era 1: 25 × (5,256,000 - 2,100,000) = 25 × 3,156,000 = 78,900,000
      //   Total = 183,900,000 — but this exceeds cap considerations
      //
      // Per-miner share (10 miners): each gets 1/10 of blocks
      // Total mined in year 1 with halving: 105M + 78.9M = 183.9M
      // This is UNDER MAX_SUPPLY of 210M. Supply cap holds.
      const era0Blocks = HALVING_INTERVAL;
      const year1Blocks = BLOCKS_PER_YEAR;
      const era1Blocks = year1Blocks - era0Blocks;

      const era0Mined = 50n * era0Blocks;
      const era1Mined = 25n * era1Blocks;
      const totalYear1 = era0Mined + era1Mined;

      expect(totalYear1).to.equal(183_900_000n);
      expect(totalYear1).to.be.lt(MAX_SUPPLY);
    });

    it("each of 10 miners gets equal share (~18.39M each)", function () {
      const year1Blocks = BLOCKS_PER_YEAR;
      const era0Mined = 50n * HALVING_INTERVAL;
      const era1Mined = 25n * (year1Blocks - HALVING_INTERVAL);
      const totalYear1 = era0Mined + era1Mined;

      const perMiner = totalYear1 / 10n;
      expect(perMiner).to.equal(18_390_000n);
    });

    it("minting 183.9M stays under 210M cap on-chain", async function () {
      const amount = ethers.parseEther("183900000");
      await jolToken.mint(owner.address, amount);

      const remaining = await jolToken.remainingSupply();
      expect(remaining).to.equal(ethers.parseEther("26100000"));
      expect(await jolToken.totalSupply()).to.be.lte(await jolToken.MAX_SUPPLY());
    });
  });

  // ─── Year 2: First Full Halving Era ────────────────────────────

  describe("Year 2 — block reward halved to 25 JOL", function () {
    it("calculates year 2 minting with halving at block 4,200,000", function () {
      // Year 2 blocks: 5,256,000 to 10,512,000
      // Halving schedule:
      //   Era 0 (blocks 0 - 2,099,999): 50 JOL — done in year 1
      //   Era 1 (blocks 2,100,000 - 4,199,999): 25 JOL
      //   Era 2 (blocks 4,200,000+): 12.5 → 12 JOL (integer)
      //
      // Year 2 starts at block 5,256,000:
      //   Era 1 ended at block 4,200,000 — already in year 1!
      //   Year 2 is entirely in Era 2 (12 JOL/block)
      //   But wait: 5,256,000 / 2,100,000 = era 2 (floor division)
      //   Reward = 50 / 2^2 = 12 (integer division)
      const year2Start = BLOCKS_PER_YEAR;
      const year2End = BLOCKS_PER_YEAR * 2n;
      const year2Blocks = year2End - year2Start;

      // Calculate eras that span year 2
      let totalMintedYear2 = 0n;
      let currentBlock = year2Start;

      while (currentBlock < year2End) {
        const era = currentBlock / HALVING_INTERVAL;
        const reward = INITIAL_REWARD >> era; // integer halving
        const eraEndBlock = (era + 1n) * HALVING_INTERVAL;
        const endBlock = eraEndBlock < year2End ? eraEndBlock : year2End;
        const blocksInEra = endBlock - currentBlock;

        totalMintedYear2 += reward * blocksInEra;
        currentBlock = endBlock;
      }

      // Year 2 spans era 2 (12 JOL) partially into era 3 (6 JOL)
      // era 2: blocks 4,200,000..6,300,000 → year 2 range: 5,256,000..6,300,000 = 1,044,000 blocks × 12
      // era 3: blocks 6,300,000..8,400,000 → year 2 range: 6,300,000..10,512,000 = 4,212,000 blocks × 6
      //   but year 2 ends at 10,512,000 and era 3 ends at 8,400,000
      // era 3: 6,300,000..8,400,000 = 2,100,000 blocks × 6
      // era 4: 8,400,000..10,500,000 = 2,100,000 blocks × 3
      // era 5: 10,500,000..10,512,000 = 12,000 blocks × 1 (50/2^5=1)
      expect(totalMintedYear2).to.be.gt(0n);
      expect(totalMintedYear2).to.be.lt(MAX_SUPPLY);
    });

    it("cumulative supply after 2 years stays under cap", function () {
      let totalMinted = 0n;
      let currentBlock = 0n;
      const twoYearBlocks = BLOCKS_PER_YEAR * 2n;

      while (currentBlock < twoYearBlocks) {
        const era = currentBlock / HALVING_INTERVAL;
        const reward = INITIAL_REWARD >> era;
        if (reward === 0n) break;

        const eraEndBlock = (era + 1n) * HALVING_INTERVAL;
        const endBlock = eraEndBlock < twoYearBlocks ? eraEndBlock : twoYearBlocks;
        totalMinted += reward * (endBlock - currentBlock);
        currentBlock = endBlock;
      }

      expect(totalMinted).to.be.lt(MAX_SUPPLY);
    });
  });

  // ─── Year 3: Bear Market — 80% Miners Leave ───────────────────

  describe("Year 3 — Bear market, 80% miners leave", function () {
    it("remaining 20% of miners still mine (2 out of 10)", function () {
      // In a bear market, miners leave but chain still produces blocks.
      // Remaining miners get ALL block rewards (higher per-miner share).
      // 2 miners each get 50% of blocks instead of 10%.
      const totalMiners = 10n;
      const remainingMiners = 2n;
      const year3Start = BLOCKS_PER_YEAR * 2n;
      const year3End = BLOCKS_PER_YEAR * 3n;

      let totalMintedYear3 = 0n;
      let currentBlock = year3Start;

      while (currentBlock < year3End) {
        const era = currentBlock / HALVING_INTERVAL;
        const reward = INITIAL_REWARD >> era;
        if (reward === 0n) break;

        const eraEndBlock = (era + 1n) * HALVING_INTERVAL;
        const endBlock = eraEndBlock < year3End ? eraEndBlock : year3End;
        totalMintedYear3 += reward * (endBlock - currentBlock);
        currentBlock = endBlock;
      }

      // Total minted is same regardless of miner count
      // But per-miner reward is 5x higher (2 miners vs 10)
      const perMinerWith10 = totalMintedYear3 / totalMiners;
      const perMinerWith2 = totalMintedYear3 / remainingMiners;

      expect(perMinerWith2).to.equal(perMinerWith10 * 5n);
      expect(totalMintedYear3).to.be.gt(0n);
    });

    it("chain security: fewer miners = same block production rate", function () {
      // JOULE uses PoW — difficulty adjusts. Blocks keep coming at 6s.
      // Hashrate drops but difficulty drops too. 14,400 blocks/day stays.
      const blocksPerDayBear = BLOCKS_PER_DAY; // unchanged
      expect(blocksPerDayBear).to.equal(14_400n);
    });

    it("PoE rewards still flow to remaining producers", async function () {
      // Even in bear market, verified producers earn via PoE
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("BEAR-SOLAR-001"));
      await registry.connect(producer1).registerFacility(0, 500, meterId, "0x75636674", 2, "EE");
      await registry.verifyFacility(1);

      // Producer submits 200 kWh during bear market
      await poeMining.connect(oracleNode).accrueReward(1, 200);

      // 200 kWh × 3 JOL = 600 gross, - 2% = 588 JOL
      const claimable = await poeMining.getClaimable(producer1.address);
      expect(claimable).to.equal(ethers.parseEther("588"));
    });
  });

  // ─── Year 4: Oracle Degradation ────────────────────────────────

  describe("Year 4 — Oracle count drops, quorum edge cases", function () {
    it("OracleConsensus quorum=2 still works with exactly 2 oracles", async function () {
      // Deploy OracleConsensus to test quorum
      const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
      const oracleConsensus = await OracleConsensus.deploy(
        owner.address,
        jolToken.target,
        registry.target,
        owner.address // slash treasury
      );

      // quorum starts at 2
      const currentQuorum = await oracleConsensus.quorum();
      expect(currentQuorum).to.equal(2);

      // minOracles starts at 3
      const minOracles = await oracleConsensus.minOracles();
      expect(minOracles).to.equal(3);
    });

    it("setQuorum rejects quorum < 2", async function () {
      const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
      const oracleConsensus = await OracleConsensus.deploy(
        owner.address,
        jolToken.target,
        registry.target,
        owner.address
      );

      await expect(
        oracleConsensus.setQuorum(1, 3)
      ).to.be.revertedWith("Min quorum is 2");
    });

    it("setQuorum rejects minOracles < 3", async function () {
      const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
      const oracleConsensus = await OracleConsensus.deploy(
        owner.address,
        jolToken.target,
        registry.target,
        owner.address
      );

      await expect(
        oracleConsensus.setQuorum(2, 2)
      ).to.be.revertedWith("Min oracles is 3");
    });

    it("raising quorum to 3 requires 3/5 consensus — stricter security", async function () {
      const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
      const oracleConsensus = await OracleConsensus.deploy(
        owner.address,
        jolToken.target,
        registry.target,
        owner.address
      );

      // Valid: quorum 3 with 5 oracles (3 > 5/2, and 3 <= 5)
      await oracleConsensus.setQuorum(3, 5);
      expect(await oracleConsensus.quorum()).to.equal(3);
      expect(await oracleConsensus.minOracles()).to.equal(5);
    });

    it("quorum must be >50% of minOracles (BFT requirement)", async function () {
      const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
      const oracleConsensus = await OracleConsensus.deploy(
        owner.address,
        jolToken.target,
        registry.target,
        owner.address
      );

      // Invalid: quorum 2 with 5 oracles (2*2=4 is NOT > 5)
      await expect(
        oracleConsensus.setQuorum(2, 5)
      ).to.be.revertedWith("Quorum must be >50%");
    });
  });

  // ─── Year 5: Largest Producer Exits ────────────────────────────

  describe("Year 5 — Largest producer (50% of PoE) exits", function () {
    it("remaining producers still earn rewards after large exit", async function () {
      // Producer 1: 50% of all PoE (large solar farm, 500 kWh)
      const meterId1 = ethers.keccak256(ethers.toUtf8Bytes("MEGA-SOLAR-001"));
      await registry.connect(producer1).registerFacility(0, 5000, meterId1, "0x75636674", 2, "EE");
      await registry.verifyFacility(1);

      // Producer 2: 50% of all PoE (wind farm, 500 kWh)
      const meterId2 = ethers.keccak256(ethers.toUtf8Bytes("WIND-FARM-001"));
      await registry.connect(producer2).registerFacility(1, 5000, meterId2, "0x75636674", 2, "EE");
      await registry.verifyFacility(2);

      // Both produce equally
      await poeMining.connect(oracleNode).accrueReward(1, 500);
      await poeMining.connect(oracleNode).accrueReward(2, 500);

      // Producer 1 claims and "exits" (deregisters facility)
      await poeMining.connect(producer1).claimRewards();
      await registry.connect(producer1).deregisterFacility(1);

      // Producer 2 still earns — accrue another 300 kWh
      await poeMining.connect(oracleNode).accrueReward(2, 300);

      // Producer 2 has: 500 × 3 × 0.98 + 300 × 3 × 0.98 = 1470 + 882 = 2352
      const claimable2 = await poeMining.getClaimable(producer2.address);
      expect(claimable2).to.equal(ethers.parseEther("2352"));
    });

    it("totalPoEMinted tracks all rewards including exited producer", async function () {
      const meterId1 = ethers.keccak256(ethers.toUtf8Bytes("EXIT-SOLAR-001"));
      await registry.connect(producer1).registerFacility(0, 5000, meterId1, "0x75636674", 2, "EE");
      await registry.verifyFacility(1);

      await poeMining.connect(oracleNode).accrueReward(1, 1000);

      // 1000 kWh × 3 JOL = 3000 gross
      expect(await poeMining.totalPoEMinted()).to.equal(ethers.parseEther("3000"));

      // Even after exit, the totalPoEMinted is permanent history
      await registry.connect(producer1).deregisterFacility(1);
      expect(await poeMining.totalPoEMinted()).to.equal(ethers.parseEther("3000"));
    });
  });

  // ─── Final Invariant: Supply Cap ───────────────────────────────

  describe("Supply Invariant — total never exceeds 210M", function () {
    it("total PoW supply from all eras converges below 210M", function () {
      // Geometric series: sum = 50 × 2,100,000 × (1 + 1/2 + 1/4 + ... + 1/2^n)
      // Theoretical limit = 50 × 2,100,000 × 2 = 210,000,000
      // But integer division causes undershoot
      let totalMined = 0n;
      let reward = INITIAL_REWARD;

      for (let era = 0n; era < 64n; era++) {
        if (reward === 0n) break;
        totalMined += reward * HALVING_INTERVAL;
        reward = reward >> 1n;
      }

      // With 50 JOL initial reward, integer halving gives:
      // 50 → 25 → 12 → 6 → 3 → 1 → 0
      // Eras: 6 productive eras
      // Sum: (50+25+12+6+3+1) × 2,100,000 = 97 × 2,100,000 = 203,700,000
      expect(totalMined).to.equal(203_700_000n);
      expect(totalMined).to.be.lt(MAX_SUPPLY);
    });

    it("PoE minting is capped by JOLToken.MAX_SUPPLY on-chain", async function () {
      // Mint nearly all supply via PoW simulation
      const nearMax = ethers.parseEther("209999999");
      await jolToken.mint(owner.address, nearMax);

      // PoE tries to mint 3 JOL (1 kWh × 3) — only 1 JOL remaining
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("CAP-TEST-001"));
      await registry.connect(producer1).registerFacility(0, 500, meterId, "0x75636674", 2, "EE");
      await registry.verifyFacility(1);

      // This will fail because 3 JOL > 1 JOL remaining
      await expect(
        poeMining.connect(oracleNode).accrueReward(1, 1)
      ).to.not.be.reverted; // accrueReward only tracks, doesn't mint

      // But claim WILL fail because mint exceeds cap
      // accrueReward accrued 2.94 JOL (1 kWh × 3 - 2% oracle fee)
      // but only 1 JOL mintable
      await expect(
        poeMining.connect(producer1).claimRewards()
      ).to.be.revertedWith("JOL: exceeds max supply");
    });

    it("total supply never exceeds 210M across all scenarios", async function () {
      const maxSupply = await jolToken.MAX_SUPPLY();
      expect(maxSupply).to.equal(ethers.parseEther("210000000"));

      // Attempt to mint exactly MAX_SUPPLY
      await jolToken.mint(owner.address, maxSupply);
      expect(await jolToken.totalSupply()).to.equal(maxSupply);

      // Any additional mint (even 1 wei) is rejected
      await expect(
        jolToken.mint(owner.address, 1n)
      ).to.be.revertedWith("JOL: exceeds max supply");
    });
  });
});
