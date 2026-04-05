const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * LiquidityMining Tests
 *
 * 180 days, 4.2B JOL, early bird 2× first 30 days.
 * Ring must be complete from day one.
 */
describe("LiquidityMining — Launch Day Liquidity", function () {
  let liqMining, jolToken;
  let owner, lp1, lp2;

  beforeEach(async function () {
    [owner, lp1, lp2] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    const LiquidityMining = await ethers.getContractFactory("LiquidityMining");
    liqMining = await LiquidityMining.deploy(owner.address, jolToken.target);

    // Grant minter role to LiquidityMining
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER_ROLE, liqMining.target);
  });

  // ─── Program Constants ──────────────────────────────────────

  describe("Program Constants", function () {
    it("total rewards = 4.2B JOL", async function () {
      expect(await liqMining.TOTAL_REWARDS()).to.equal(ethers.parseEther("4200000000"));
    });

    it("program duration = 180 days", async function () {
      expect(await liqMining.PROGRAM_DURATION()).to.equal(180 * 86400);
    });

    it("early bird period = 30 days", async function () {
      expect(await liqMining.EARLY_BIRD_PERIOD()).to.equal(30 * 86400);
    });

    it("base daily reward = 20M JOL", async function () {
      expect(await liqMining.BASE_DAILY_REWARD()).to.equal(ethers.parseEther("20000000"));
    });

    it("weighted days: 30×2 + 150×1 = 210", async function () {
      expect(await liqMining.WEIGHTED_DAYS()).to.equal(210);
    });

    it("4.2B / 210 weighted days = 20M/day", function () {
      const total = 4_200_000_000n;
      const weighted = 210n;
      expect(total / weighted).to.equal(20_000_000n);
    });
  });

  // ─── Program State ──────────────────────────────────────────

  describe("Program State", function () {
    it("starts active", async function () {
      expect(await liqMining.isActive()).to.be.true;
    });

    it("starts in early bird", async function () {
      expect(await liqMining.isEarlyBird()).to.be.true;
    });

    it("starts at day 0", async function () {
      expect(await liqMining.currentDay()).to.equal(0);
    });

    it("day advances with time", async function () {
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");
      expect(await liqMining.currentDay()).to.equal(1);
    });
  });

  // ─── Staking ────────────────────────────────────────────────

  describe("LP Staking", function () {
    it("stakes LP tokens in JOL/USDC pool", async function () {
      const amount = ethers.parseEther("1000");
      const tx = await liqMining.connect(lp1).stakeLiquidity(amount, 0);
      await expect(tx).to.emit(liqMining, "LPStaked");

      const pos = await liqMining.positions(1);
      expect(pos.provider).to.equal(lp1.address);
      expect(pos.amount).to.equal(amount);
      expect(pos.pool).to.equal(0);
      expect(pos.active).to.be.true;
    });

    it("stakes LP tokens in JOL/ETH pool", async function () {
      const amount = ethers.parseEther("500");
      await liqMining.connect(lp1).stakeLiquidity(amount, 1);

      const pos = await liqMining.positions(1);
      expect(pos.pool).to.equal(1);
    });

    it("rejects invalid pool (2+)", async function () {
      await expect(
        liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("100"), 2)
      ).to.be.revertedWith("Invalid pool");
    });

    it("rejects zero amount", async function () {
      await expect(
        liqMining.connect(lp1).stakeLiquidity(0, 0)
      ).to.be.revertedWith("Zero amount");
    });

    it("tracks total staked", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);
      await liqMining.connect(lp2).stakeLiquidity(ethers.parseEther("500"), 1);

      expect(await liqMining.totalLPStaked()).to.equal(ethers.parseEther("1500"));
      expect(await liqMining.activeLPCount()).to.equal(2);
    });
  });

  // ─── Rewards ────────────────────────────────────────────────

  describe("Rewards", function () {
    it("sole LP gets full daily reward", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      // Advance 1 day
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      const pending = await liqMining.pendingRewards(1);
      // Day 0 = early bird, so 20M × 2 = 40M
      expect(pending).to.equal(ethers.parseEther("40000000"));
    });

    it("early bird: 2× rewards first 30 days", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      // Advance 1 day (still in early bird)
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      const earlyReward = await liqMining.pendingRewards(1);
      expect(earlyReward).to.equal(ethers.parseEther("40000000")); // 20M × 2
    });

    it("after early bird: 1× rewards", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      // Skip past early bird (30 days) and claim first
      await ethers.provider.send("evm_increaseTime", [30 * 86400]);
      await ethers.provider.send("evm_mine");
      await liqMining.connect(lp1).claimRewards(1);

      // Advance 1 more day (day 31, no bonus)
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      const normalReward = await liqMining.pendingRewards(1);
      expect(normalReward).to.equal(ethers.parseEther("20000000")); // 20M × 1
    });

    it("two LPs split rewards proportionally", async function () {
      // LP1: 750, LP2: 250 = 3:1 ratio
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("750"), 0);
      await liqMining.connect(lp2).stakeLiquidity(ethers.parseEther("250"), 0);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      const reward1 = await liqMining.pendingRewards(1);
      const reward2 = await liqMining.pendingRewards(2);

      // Early bird: total 40M/day, 75% and 25%
      expect(reward1).to.equal(ethers.parseEther("30000000")); // 75%
      expect(reward2).to.equal(ethers.parseEther("10000000")); // 25%
    });
  });

  // ─── Claiming ───────────────────────────────────────────────

  describe("Claiming", function () {
    it("claims rewards and mints JOL", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      const tx = await liqMining.connect(lp1).claimRewards(1);
      await expect(tx).to.emit(liqMining, "RewardsClaimed");

      expect(await jolToken.balanceOf(lp1.address)).to.equal(ethers.parseEther("40000000"));
      expect(await liqMining.totalDistributed()).to.equal(ethers.parseEther("40000000"));
    });

    it("no double-claim for same day", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      await liqMining.connect(lp1).claimRewards(1);

      // Second claim same day → no rewards
      await expect(
        liqMining.connect(lp1).claimRewards(1)
      ).to.be.revertedWith("No rewards");
    });
  });

  // ─── Unstaking ──────────────────────────────────────────────

  describe("Unstaking", function () {
    it("unstakes and claims pending", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      const tx = await liqMining.connect(lp1).unstakeLiquidity(1);
      await expect(tx).to.emit(liqMining, "LPUnstaked");

      // Got rewards on unstake
      expect(await jolToken.balanceOf(lp1.address)).to.be.gt(0);
      expect(await liqMining.activeLPCount()).to.equal(0);
    });

    it("rejects non-owner unstake", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);
      await expect(
        liqMining.connect(lp2).unstakeLiquidity(1)
      ).to.be.revertedWith("Not owner");
    });
  });

  // ─── Program End ────────────────────────────────────────────

  describe("Program End", function () {
    it("rejects staking after 180 days", async function () {
      await ethers.provider.send("evm_increaseTime", [181 * 86400]);
      await ethers.provider.send("evm_mine");

      await expect(
        liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0)
      ).to.be.revertedWith("Program ended");

      expect(await liqMining.isActive()).to.be.false;
    });
  });

  // ─── Program Stats ──────────────────────────────────────────

  describe("Stats", function () {
    it("returns comprehensive stats", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      const stats = await liqMining.programStats();
      expect(stats._totalStaked).to.equal(ethers.parseEther("1000"));
      expect(stats._totalDistributed).to.equal(0);
      expect(stats._remainingRewards).to.equal(ethers.parseEther("4200000000"));
      expect(stats._isActive).to.be.true;
      expect(stats._isEarlyBird).to.be.true;
    });
  });
});
