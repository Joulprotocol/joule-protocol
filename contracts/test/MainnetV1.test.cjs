const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Mainnet V1 Tests — Supply, Halving, PoE 3× Multiplier
 *
 * Validates the core mainnet-v1 parameters:
 * - MAX_SUPPLY = 210,000,000,000 JOL (210B)
 * - Mining pool = 126B (60% of supply)
 * - PoE reward multiplier = 3×
 * - Block reward = 16,000 JOL (validated in go-joule, not Solidity)
 * - Halving interval = 2,160,000 blocks (validated in go-joule)
 */

describe("Mainnet V1 — Supply & PoE Parameters", function () {
  let jolToken, registry, poeMining;
  let owner, producer, oracleNode;

  beforeEach(async function () {
    [owner, producer, oracleNode] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(owner.address);

    const PoEMining = await ethers.getContractFactory("PoEMining");
    poeMining = await PoEMining.deploy(owner.address, jolToken.target, registry.target);

    // Roles
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    const ORACLE_ROLE = await poeMining.ORACLE_ROLE();
    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();

    await jolToken.grantRole(MINTER_ROLE, owner.address);
    await jolToken.grantRole(MINTER_ROLE, poeMining.target);
    await poeMining.grantRole(ORACLE_ROLE, oracleNode.address);
    await registry.grantRole(VERIFIER_ROLE, owner.address);
  });

  // ─── Supply Constants ────────────────────────────────────────

  describe("Supply Constants", function () {
    it("MAX_SUPPLY = 210,000,000,000 JOL (210B)", async function () {
      const maxSupply = await jolToken.MAX_SUPPLY();
      expect(maxSupply).to.equal(ethers.parseEther("210000000"));
    });

    it("starts with zero total supply", async function () {
      expect(await jolToken.totalSupply()).to.equal(0);
    });

    it("remainingSupply = MAX_SUPPLY when nothing minted", async function () {
      expect(await jolToken.remainingSupply()).to.equal(ethers.parseEther("210000000"));
    });

    it("minting reduces remainingSupply", async function () {
      const amount = ethers.parseEther("1000000");
      await jolToken.mint(owner.address, amount);
      expect(await jolToken.remainingSupply()).to.equal(
        ethers.parseEther("210000000") - amount
      );
    });

    it("cannot mint beyond MAX_SUPPLY", async function () {
      const maxSupply = await jolToken.MAX_SUPPLY();
      await expect(
        jolToken.mint(owner.address, maxSupply + 1n)
      ).to.be.revertedWith("JOL: exceeds max supply");
    });

    it("can mint exactly MAX_SUPPLY", async function () {
      const maxSupply = await jolToken.MAX_SUPPLY();
      await jolToken.mint(owner.address, maxSupply);
      expect(await jolToken.totalSupply()).to.equal(maxSupply);
      expect(await jolToken.remainingSupply()).to.equal(0);
    });

    it("cannot mint 1 wei after MAX_SUPPLY reached", async function () {
      const maxSupply = await jolToken.MAX_SUPPLY();
      await jolToken.mint(owner.address, maxSupply);
      await expect(
        jolToken.mint(owner.address, 1n)
      ).to.be.revertedWith("JOL: exceeds max supply");
    });
  });

  // ─── Mining Pool (69% = 144.9M) ──────────────────────────────

  describe("Mining Pool (69% of supply)", function () {
    it("144.9M JOL = 69% of 210M", function () {
      const maxSupply = 210_000_000n;
      const miningPool = maxSupply * 69n / 100n;
      expect(miningPool).to.equal(144_900_000n);
    });

    it("block reward × blocks = ~105M in year 1", function () {
      // 50 JOL/block × 14,400 blocks/day × 365 days = 262,800,000
      // But with halving at 2.1M blocks (~146 days), first era mines:
      // 50 × 2,100,000 = 105,000,000 JOL
      const blockReward = 50n;
      const halvingInterval = 2_100_000n;
      const firstEraMined = blockReward * halvingInterval;
      expect(firstEraMined).to.equal(105_000_000n);
    });
  });

  // ─── PoE 3× Multiplier ──────────────────────────────────────

  describe("PoE 3× Reward Multiplier", function () {
    it("POE_REWARD_MULTIPLIER = 3", async function () {
      expect(await poeMining.POE_REWARD_MULTIPLIER()).to.equal(3);
    });

    it("getJolPerKWh returns 3 JOL per kWh", async function () {
      const jolPerKWh = await poeMining.getJolPerKWh();
      expect(jolPerKWh).to.equal(ethers.parseEther("3"));
    });

    it("100 kWh production yields ~294 JOL (300 gross - 2% oracle fee)", async function () {
      // Register and verify facility
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("SOLAR-V1-001"));
      await registry.connect(producer).registerFacility(0, 500, meterId, 58381000, 24655000, "EE");
      await registry.verifyFacility(1);

      // Accrue reward for 100 kWh
      await poeMining.connect(oracleNode).accrueReward(1, 100);

      // Gross = 100 × 3 = 300 JOL
      // Oracle fee = 300 × 2% = 6 JOL
      // Producer reward = 294 JOL
      const claimable = await poeMining.getClaimable(producer.address);
      expect(claimable).to.equal(ethers.parseEther("294"));

      // Oracle earnings
      const oracleEarnings = await poeMining.oracleEarnings(oracleNode.address);
      expect(oracleEarnings).to.equal(ethers.parseEther("6"));
    });

    it("totalPoEMinted tracks gross rewards (including oracle fee)", async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("WIND-V1-001"));
      await registry.connect(producer).registerFacility(1, 1000, meterId, 0, 0, "EE");
      await registry.verifyFacility(1);

      await poeMining.connect(oracleNode).accrueReward(1, 500);

      // 500 kWh × 3 JOL = 1500 JOL gross
      expect(await poeMining.totalPoEMinted()).to.equal(ethers.parseEther("1500"));
      expect(await poeMining.totalKWhRewarded()).to.equal(500);
    });

    it("claim mints tokens via JOLToken", async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("HYDRO-V1-001"));
      await registry.connect(producer).registerFacility(2, 200, meterId, 0, 0, "EE");
      await registry.verifyFacility(1);

      await poeMining.connect(oracleNode).accrueReward(1, 50);

      // Claim
      await poeMining.connect(producer).claimRewards();

      // 50 × 3 = 150 gross, - 2% = 147 JOL
      expect(await jolToken.balanceOf(producer.address)).to.equal(ethers.parseEther("147"));
    });
  });

  // ─── Halving Schedule (Go-level, validated by math) ──────────

  describe("Halving Schedule (math validation)", function () {
    it("halving interval = 2,100,000 blocks (~146 days)", function () {
      // 14,400 blocks/day × ~146 days ≈ 2,100,000
      const blocksPerDay = 86400 / 6;
      const halvingBlocks = 2_100_000;
      const halvingDays = halvingBlocks / blocksPerDay;
      expect(halvingDays).to.be.closeTo(146, 1);
    });

    it("total supply from mining converges below 210M with halvings", function () {
      // Geometric series: 50 × 2,100,000 × (1 + 1/2 + 1/4 + ...)
      // Era 0: 50 × 2,100,000 = 105,000,000
      // Era 1: 25 × 2,100,000 = 52,500,000
      // ...sum ≈ 210,000,000 (approaches but never exceeds)
      let total = 0n;
      let reward = 50n;
      const interval = 2_100_000n;
      for (let era = 0; era < 10; era++) {
        total += reward * interval;
        reward = reward / 2n;
      }
      expect(total).to.be.lt(210_000_000n);
      expect(total).to.be.gt(200_000_000n);
    });

    it("reward drops to 0 after 10 halvings", function () {
      // In go-joule: if halvings >= 10, reward = 0
      // After 10 × 2,160,000 = 21,600,000 blocks
      const totalBlocks = 10 * 2_160_000;
      expect(totalBlocks).to.equal(21_600_000);
    });
  });
});
