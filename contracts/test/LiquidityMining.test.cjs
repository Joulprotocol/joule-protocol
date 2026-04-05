const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * LiquidityMining Tests — MasterChef Pattern (O(1) claims)
 *
 * 180 days, 4.2M JOL, early bird 2× first 30 days.
 * accRewardPerShare / rewardDebt — no loops, constant gas.
 */
describe("LiquidityMining — MasterChef Pattern", function () {
  let liqMining, jolToken, lpTokenA, lpTokenB;
  let owner, lp1, lp2;

  beforeEach(async function () {
    [owner, lp1, lp2] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    lpTokenA = await JOLToken.deploy(owner.address);
    lpTokenB = await JOLToken.deploy(owner.address);

    const LiquidityMining = await ethers.getContractFactory("LiquidityMining");
    liqMining = await LiquidityMining.deploy(owner.address, jolToken.target);

    await liqMining.setLPTokens(lpTokenA.target, lpTokenB.target);

    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER_ROLE, liqMining.target);

    const LP_MINTER = await lpTokenA.MINTER_ROLE();
    await lpTokenA.grantRole(LP_MINTER, owner.address);
    await lpTokenB.grantRole(LP_MINTER, owner.address);
    await lpTokenA.mint(lp1.address, ethers.parseEther("100000"));
    await lpTokenA.mint(lp2.address, ethers.parseEther("100000"));
    await lpTokenB.mint(lp1.address, ethers.parseEther("100000"));
    await lpTokenB.mint(lp2.address, ethers.parseEther("100000"));
    await lpTokenA.connect(lp1).approve(liqMining.target, ethers.MaxUint256);
    await lpTokenA.connect(lp2).approve(liqMining.target, ethers.MaxUint256);
    await lpTokenB.connect(lp1).approve(liqMining.target, ethers.MaxUint256);
    await lpTokenB.connect(lp2).approve(liqMining.target, ethers.MaxUint256);
  });

  // ─── Program Constants ──────────────────────────────────────

  describe("Program Constants", function () {
    it("total rewards = 4.2M JOL", async function () {
      expect(await liqMining.TOTAL_REWARDS()).to.equal(ethers.parseEther("4200000"));
    });

    it("program duration = 180 days", async function () {
      expect(await liqMining.PROGRAM_DURATION()).to.equal(180 * 86400);
    });

    it("early bird period = 30 days", async function () {
      expect(await liqMining.EARLY_BIRD_PERIOD()).to.equal(30 * 86400);
    });

    it("base daily reward = 20k JOL", async function () {
      expect(await liqMining.BASE_DAILY_REWARD()).to.equal(ethers.parseEther("20000"));
    });

    it("REWARD_PER_SECOND = 20,000 ether / 86,400", async function () {
      const rps = await liqMining.REWARD_PER_SECOND();
      expect(rps).to.equal(231481481481481481n);
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

  // ─── Multiplier ─────────────────────────────────────────────

  describe("Multiplier", function () {
    it("early bird: 1 day = 2 × 86400 weighted seconds", async function () {
      const start = await liqMining.programStart();
      const m = await liqMining.getMultiplier(start, start + 86400n);
      expect(m).to.equal(86400n * 2n);
    });

    it("after early bird: 1 day = 86400 weighted seconds", async function () {
      const start = await liqMining.programStart();
      const earlyEnd = start + 30n * 86400n;
      const m = await liqMining.getMultiplier(earlyEnd, earlyEnd + 86400n);
      expect(m).to.equal(86400n);
    });

    it("spans boundary correctly", async function () {
      const start = await liqMining.programStart();
      const earlyEnd = start + 30n * 86400n;
      // 1 day before early end + 1 day after
      const from = earlyEnd - 86400n;
      const to = earlyEnd + 86400n;
      const m = await liqMining.getMultiplier(from, to);
      // 86400 × 2 (early) + 86400 × 1 (normal) = 259,200
      expect(m).to.equal(86400n * 3n);
    });

    it("returns 0 after program end", async function () {
      const start = await liqMining.programStart();
      const end = start + 180n * 86400n;
      const m = await liqMining.getMultiplier(end, end + 86400n);
      expect(m).to.equal(0);
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
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("500"), 1);
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

  describe("Rewards (MasterChef O(1))", function () {
    it("sole LP gets ~40k JOL for 1 day during early bird", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      const pending = await liqMining.pendingRewards(1);
      // 86,400 sec × 2 (early bird) × REWARD_PER_SECOND = ~40,000 JOL
      // Slight rounding from integer division
      const expected = ethers.parseEther("40000");
      const tolerance = ethers.parseEther("1"); // 1 JOL tolerance
      expect(pending).to.be.closeTo(expected, tolerance);
    });

    it("after early bird: ~20k JOL/day", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      // Skip past early bird
      await ethers.provider.send("evm_increaseTime", [30 * 86400]);
      await ethers.provider.send("evm_mine");
      await liqMining.connect(lp1).claimRewards(1);

      // 1 more day (normal rate)
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      const pending = await liqMining.pendingRewards(1);
      const expected = ethers.parseEther("20000");
      expect(pending).to.be.closeTo(expected, ethers.parseEther("1"));
    });

    it("two LPs split rewards proportionally (3:1)", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("750"), 0);
      await liqMining.connect(lp2).stakeLiquidity(ethers.parseEther("250"), 0);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      const reward1 = await liqMining.pendingRewards(1);
      const reward2 = await liqMining.pendingRewards(2);

      // Total ~40k/day (early bird), 75%/25%
      expect(reward1).to.be.closeTo(ethers.parseEther("30000"), ethers.parseEther("1"));
      expect(reward2).to.be.closeTo(ethers.parseEther("10000"), ethers.parseEther("1"));
    });

    it("rewards are O(1) even after 100 days", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      // Skip 100 days — no claim in between
      await ethers.provider.send("evm_increaseTime", [100 * 86400]);
      await ethers.provider.send("evm_mine");

      // This should NOT loop 100 times — O(1) with MasterChef
      const pending = await liqMining.pendingRewards(1);
      expect(pending).to.be.gt(0);

      // 30d × 40k + 70d × 20k = 1,200,000 + 1,400,000 = 2,600,000
      expect(pending).to.be.closeTo(ethers.parseEther("2600000"), ethers.parseEther("100"));
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

      const bal = await jolToken.balanceOf(lp1.address);
      expect(bal).to.be.closeTo(ethers.parseEther("40000"), ethers.parseEther("1"));
    });

    it("no double-claim for same time", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      await liqMining.connect(lp1).claimRewards(1);

      // Mine same block — no time elapsed, no new rewards
      // Need to ensure no time passes between claim and re-claim
      // In Hardhat, each tx mines a block (+1 sec), so tiny reward accrues
      // Instead, verify balance didn't change significantly
      const balBefore = await jolToken.balanceOf(lp1.address);
      await liqMining.connect(lp1).claimRewards(1);
      const balAfter = await jolToken.balanceOf(lp1.address);
      // Only ~1 second of rewards accrued (trivial)
      expect(balAfter - balBefore).to.be.lt(ethers.parseEther("1"));
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

    it("total rewards capped at 4.2M", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      // Skip entire program
      await ethers.provider.send("evm_increaseTime", [181 * 86400]);
      await ethers.provider.send("evm_mine");

      const pending = await liqMining.pendingRewards(1);
      // Should be close to 4.2M total (sole LP for full duration)
      expect(pending).to.be.lte(ethers.parseEther("4200000"));
      expect(pending).to.be.closeTo(ethers.parseEther("4200000"), ethers.parseEther("100"));
    });
  });

  // ─── Program Stats ──────────────────────────────────────────

  describe("Stats", function () {
    it("returns comprehensive stats", async function () {
      await liqMining.connect(lp1).stakeLiquidity(ethers.parseEther("1000"), 0);

      const stats = await liqMining.programStats();
      expect(stats._totalStaked).to.equal(ethers.parseEther("1000"));
      expect(stats._remainingRewards).to.equal(ethers.parseEther("4200000"));
      expect(stats._isActive).to.be.true;
      expect(stats._isEarlyBird).to.be.true;
    });
  });
});
