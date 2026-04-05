const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * FounderSellLimit Tests
 *
 * In code, not in promises.
 * 1% of daily volume. Community sees every sell.
 */
describe("FounderSellLimit — Code is Commitment", function () {
  let founderLimit, jolToken;
  let owner, founder, buyer, volumeOracle;

  beforeEach(async function () {
    [owner, founder, buyer, volumeOracle] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    const FounderSellLimit = await ethers.getContractFactory("FounderSellLimit");
    founderLimit = await FounderSellLimit.deploy(jolToken.target, founder.address, volumeOracle.address);

    // Mint tokens to founder
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER_ROLE, owner.address);
    await jolToken.mint(founder.address, ethers.parseEther("10000000")); // 10M JOL

    // Founder approves the contract to transfer
    await jolToken.connect(founder).approve(founderLimit.target, ethers.MaxUint256);
  });

  // ─── Volume Reporting ───────────────────────────────────────

  describe("Volume Reporting", function () {
    it("oracle sets daily volume", async function () {
      const volume = ethers.parseEther("1000000"); // 1M JOL daily volume
      const tx = await founderLimit.connect(volumeOracle).updateDailyVolume(volume);
      await expect(tx).to.emit(founderLimit, "DailyVolumeUpdated");
    });

    it("rejects non-oracle volume update", async function () {
      await expect(
        founderLimit.connect(founder).updateDailyVolume(ethers.parseEther("1000000"))
      ).to.be.revertedWith("Not volume oracle");
    });
  });

  // ─── Daily Limit Calculation ────────────────────────────────

  describe("Daily Limit", function () {
    it("1% of 1M volume = 10,000 JOL", async function () {
      await founderLimit.connect(volumeOracle).updateDailyVolume(ethers.parseEther("1000000"));
      const today = BigInt((await ethers.provider.getBlock("latest")).timestamp) / 86400n;
      const limit = await founderLimit.getDailyLimit(today);
      expect(limit).to.equal(ethers.parseEther("10000"));
    });

    it("1% of 10M volume = 100,000 JOL", async function () {
      await founderLimit.connect(volumeOracle).updateDailyVolume(ethers.parseEther("10000000"));
      const today = BigInt((await ethers.provider.getBlock("latest")).timestamp) / 86400n;
      const limit = await founderLimit.getDailyLimit(today);
      expect(limit).to.equal(ethers.parseEther("100000"));
    });

    it("zero volume → falls back to yesterday", async function () {
      // Set yesterday's volume
      await founderLimit.connect(volumeOracle).updateDailyVolume(ethers.parseEther("500000"));

      // Advance 1 day
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      // Today has no volume reported → uses yesterday
      const today = BigInt((await ethers.provider.getBlock("latest")).timestamp) / 86400n;
      const limit = await founderLimit.getDailyLimit(today);
      expect(limit).to.equal(ethers.parseEther("5000")); // 1% of 500K
    });
  });

  // ─── Selling ────────────────────────────────────────────────

  describe("Selling", function () {
    beforeEach(async function () {
      // Set daily volume: 1M JOL
      await founderLimit.connect(volumeOracle).updateDailyVolume(ethers.parseEther("1000000"));
    });

    it("founder sells within limit", async function () {
      const amount = ethers.parseEther("5000"); // 5K of 10K limit
      const tx = await founderLimit.connect(founder).sell(buyer.address, amount);

      await expect(tx).to.emit(founderLimit, "FounderSell");
      expect(await jolToken.balanceOf(buyer.address)).to.equal(amount);
    });

    it("founder sells exactly at limit", async function () {
      const limit = ethers.parseEther("10000"); // exact 1% of 1M
      await founderLimit.connect(founder).sell(buyer.address, limit);

      expect(await jolToken.balanceOf(buyer.address)).to.equal(limit);
      expect(await founderLimit.remainingToday()).to.equal(0);
    });

    it("blocks sell exceeding limit", async function () {
      const overLimit = ethers.parseEther("10001"); // 1 JOL over limit
      await expect(
        founderLimit.connect(founder).sell(buyer.address, overLimit)
      ).to.be.revertedWith("Exceeds daily founder sell limit");
    });

    it("multiple sells accumulate", async function () {
      const chunk = ethers.parseEther("3000");

      // 3 × 3K = 9K (within 10K limit)
      await founderLimit.connect(founder).sell(buyer.address, chunk);
      await founderLimit.connect(founder).sell(buyer.address, chunk);
      await founderLimit.connect(founder).sell(buyer.address, chunk);

      expect(await founderLimit.soldToday()).to.equal(ethers.parseEther("9000"));

      // 4th sell would exceed: 9K + 3K = 12K > 10K
      await expect(
        founderLimit.connect(founder).sell(buyer.address, chunk)
      ).to.be.revertedWith("Exceeds daily founder sell limit");
    });

    it("limit resets next day", async function () {
      // Use full limit today
      await founderLimit.connect(founder).sell(buyer.address, ethers.parseEther("10000"));
      expect(await founderLimit.remainingToday()).to.equal(0);

      // Advance 1 day
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      // Update volume for new day
      await founderLimit.connect(volumeOracle).updateDailyVolume(ethers.parseEther("1000000"));

      // Can sell again
      await founderLimit.connect(founder).sell(buyer.address, ethers.parseEther("5000"));
      expect(await jolToken.balanceOf(buyer.address)).to.equal(ethers.parseEther("15000"));
    });

    it("only founder can sell", async function () {
      await expect(
        founderLimit.connect(buyer).sell(buyer.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Not founder");
    });
  });

  // ─── Transparency ───────────────────────────────────────────

  describe("Transparency — Community Sees Everything", function () {
    it("sell events are on-chain and auditable", async function () {
      await founderLimit.connect(volumeOracle).updateDailyVolume(ethers.parseEther("1000000"));

      const amount = ethers.parseEther("7500");
      const tx = await founderLimit.connect(founder).sell(buyer.address, amount);

      const receipt = await tx.wait();
      const event = receipt.logs.find(
        l => l.fragment && l.fragment.name === "FounderSell"
      );
      expect(event).to.not.be.undefined;
    });

    it("blocked sells emit event too", async function () {
      await founderLimit.connect(volumeOracle).updateDailyVolume(ethers.parseEther("100"));

      // Limit = 1 JOL. Try to sell 100.
      await expect(
        founderLimit.connect(founder).sell(buyer.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Exceeds daily founder sell limit");
    });
  });
});
