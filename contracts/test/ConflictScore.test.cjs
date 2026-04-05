const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * ConflictScore Tests — Proportional Consequences
 *
 * The system protects the ecosystem, not punishes people.
 * Automatic, proportional, fair.
 */
describe("ConflictScore — Proportional Consequences", function () {
  let conflictScore;
  let owner, reporter, user;

  beforeEach(async function () {
    [owner, reporter, user] = await ethers.getSigners();

    const ConflictScore = await ethers.getContractFactory("ConflictScore");
    conflictScore = await ConflictScore.deploy(owner.address);

    const REPORTER_ROLE = await conflictScore.REPORTER_ROLE();
    await conflictScore.grantRole(REPORTER_ROLE, reporter.address);
  });

  // ─── Penalty Values ─────────────────────────────────────────

  describe("Penalty Values", function () {
    it("infrastructure attack = 500 points", async function () {
      expect(await conflictScore.getPenalty(3)).to.equal(500);
    });

    it("node attack = 200 points", async function () {
      expect(await conflictScore.getPenalty(2)).to.equal(200);
    });

    it("false oracle data = 100 points", async function () {
      expect(await conflictScore.getPenalty(1)).to.equal(100);
    });

    it("sell limit violation = 20 points", async function () {
      expect(await conflictScore.getPenalty(0)).to.equal(20);
    });
  });

  // ─── Level Thresholds ───────────────────────────────────────

  describe("Level Thresholds", function () {
    it("starts at Level 0 (clean)", async function () {
      expect(await conflictScore.getLevel(user.address)).to.equal(0);
    });

    it("sell limit → Level 0 (score 20)", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 0);
      expect(await conflictScore.getLevel(user.address)).to.equal(0);
      const s = await conflictScore.scores(user.address);
      expect(s.score).to.equal(20);
    });

    it("false oracle → Level 1 (score 100)", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 1);
      expect(await conflictScore.getLevel(user.address)).to.equal(1);
    });

    it("node attack → Level 2 (score 200 → needs 300)", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 2); // 200
      expect(await conflictScore.getLevel(user.address)).to.equal(1);
      await conflictScore.connect(reporter).reportViolation(user.address, 1); // +100 = 300
      expect(await conflictScore.getLevel(user.address)).to.equal(2);
    });

    it("infrastructure attack → Level 3 (score 500)", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 3);
      expect(await conflictScore.getLevel(user.address)).to.equal(3);
    });

    it("double infrastructure → Level 4 (score 1000)", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 3); // 500
      await conflictScore.connect(reporter).reportViolation(user.address, 3); // +500 = 1000
      expect(await conflictScore.getLevel(user.address)).to.equal(4);
    });
  });

  // ─── Sell Limit Cap at Level 2 ──────────────────────────────

  describe("Sell Limit — Max Level 2", function () {
    it("sell limit violations capped at score 499", async function () {
      // 25 sell limit violations × 20 = 500, but capped at 499
      for (let i = 0; i < 30; i++) {
        await conflictScore.connect(reporter).reportViolation(user.address, 0);
      }

      const s = await conflictScore.scores(user.address);
      expect(s.score).to.equal(499);
      expect(await conflictScore.getLevel(user.address)).to.equal(2);
      // Never reaches Level 3 from sell limits alone
    });

    it("sell limit never causes Level 3 suspension", async function () {
      for (let i = 0; i < 50; i++) {
        await conflictScore.connect(reporter).reportViolation(user.address, 0);
      }
      expect(await conflictScore.canTrade(user.address)).to.be.true;
    });
  });

  // ─── Reward Multipliers ─────────────────────────────────────

  describe("Reward Multipliers", function () {
    it("Level 0 → 100% rewards", async function () {
      expect(await conflictScore.getRewardMultiplier(user.address)).to.equal(10000);
    });

    it("Level 1 → 75% rewards", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 1); // 100
      expect(await conflictScore.getRewardMultiplier(user.address)).to.equal(7500);
    });

    it("Level 2 → 50% rewards", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 2); // 200
      await conflictScore.connect(reporter).reportViolation(user.address, 1); // +100 = 300
      expect(await conflictScore.getRewardMultiplier(user.address)).to.equal(5000);
    });

    it("Level 3+ → 0% rewards", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 3); // 500
      expect(await conflictScore.getRewardMultiplier(user.address)).to.equal(0);
    });
  });

  // ─── Access Control ─────────────────────────────────────────

  describe("Access Control by Level", function () {
    it("Level 0-1 can govern and trade", async function () {
      expect(await conflictScore.canGovernance(user.address)).to.be.true;
      expect(await conflictScore.canTrade(user.address)).to.be.true;

      await conflictScore.connect(reporter).reportViolation(user.address, 1); // Level 1
      expect(await conflictScore.canGovernance(user.address)).to.be.true;
      expect(await conflictScore.canTrade(user.address)).to.be.true;
    });

    it("Level 2 → no governance, can still trade", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 2);
      await conflictScore.connect(reporter).reportViolation(user.address, 1);
      // Score 300 = Level 2
      expect(await conflictScore.canGovernance(user.address)).to.be.false;
      expect(await conflictScore.canTrade(user.address)).to.be.true;
    });

    it("Level 3 → no governance, no trading", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 3);
      expect(await conflictScore.canGovernance(user.address)).to.be.false;
      expect(await conflictScore.canTrade(user.address)).to.be.false;
    });
  });

  // ─── Score Decay ────────────────────────────────────────────

  describe("Score Decay", function () {
    it("Level 1 decays -20 per month", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 1); // 100
      expect(await conflictScore.getLevel(user.address)).to.equal(1);

      // Advance 1 month
      await ethers.provider.send("evm_increaseTime", [30 * 86400]);
      await ethers.provider.send("evm_mine");

      await conflictScore.applyDecay(user.address);
      const s = await conflictScore.scores(user.address);
      expect(s.score).to.equal(80); // 100 - 20
      expect(await conflictScore.getLevel(user.address)).to.equal(0);
    });

    it("Level 3 decays slower (-10 per month)", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 3); // 500

      // Advance 1 month
      await ethers.provider.send("evm_increaseTime", [30 * 86400]);
      await ethers.provider.send("evm_mine");

      await conflictScore.applyDecay(user.address);
      const s = await conflictScore.scores(user.address);
      expect(s.score).to.equal(490); // 500 - 10
    });

    it("multiple months of peace stack decay", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 2); // 200

      // Advance 5 months
      await ethers.provider.send("evm_increaseTime", [5 * 30 * 86400]);
      await ethers.provider.send("evm_mine");

      await conflictScore.applyDecay(user.address);
      const s = await conflictScore.scores(user.address);
      expect(s.score).to.equal(100); // 200 - (5 × 20)
    });

    it("score doesn't go below zero", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 0); // 20

      // Advance 3 months (would decay 60, but only 20 to decay)
      await ethers.provider.send("evm_increaseTime", [3 * 30 * 86400]);
      await ethers.provider.send("evm_mine");

      await conflictScore.applyDecay(user.address);
      const s = await conflictScore.scores(user.address);
      expect(s.score).to.equal(0);
    });

    it("Level 4 (expelled) — no decay", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 3); // 500
      await conflictScore.connect(reporter).reportViolation(user.address, 3); // 1000

      // Advance 12 months
      await ethers.provider.send("evm_increaseTime", [12 * 30 * 86400]);
      await ethers.provider.send("evm_mine");

      await conflictScore.applyDecay(user.address);
      const s = await conflictScore.scores(user.address);
      expect(s.score).to.equal(1000); // No decay for expelled
    });
  });

  // ─── Authorization ──────────────────────────────────────────

  describe("Authorization", function () {
    it("only reporter can report violations", async function () {
      await expect(
        conflictScore.connect(user).reportViolation(user.address, 0)
      ).to.be.reverted;
    });

    it("anyone can trigger decay", async function () {
      await conflictScore.connect(reporter).reportViolation(user.address, 1);

      await ethers.provider.send("evm_increaseTime", [30 * 86400]);
      await ethers.provider.send("evm_mine");

      // User triggers their own decay — no role needed
      await conflictScore.connect(user).applyDecay(user.address);
      const s = await conflictScore.scores(user.address);
      expect(s.score).to.equal(80);
    });
  });
});
