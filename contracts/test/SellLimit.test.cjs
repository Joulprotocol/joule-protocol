const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * SellLimit Tests — Square Root Harmony
 *
 * Larger producers protect the price longer.
 * Small producers get guaranteed minimum.
 */
describe("SellLimit — Square Root Harmony", function () {
  let sellLimit;
  let owner, seller;

  beforeEach(async function () {
    [owner, seller] = await ethers.getSigners();
    const SellLimit = await ethers.getContractFactory("SellLimit");
    sellLimit = await SellLimit.deploy();
  });

  // ─── Square Root Function ───────────────────────────────────

  describe("Square Root", function () {
    it("sqrt(0) = 0", async function () {
      expect(await sellLimit.sqrt(0)).to.equal(0);
    });

    it("sqrt(1) = 1", async function () {
      expect(await sellLimit.sqrt(1)).to.equal(1);
    });

    it("sqrt(4) = 2", async function () {
      expect(await sellLimit.sqrt(4)).to.equal(2);
    });

    it("sqrt(1000000) = 1000", async function () {
      expect(await sellLimit.sqrt(1000000)).to.equal(1000);
    });

    it("sqrt(large number) works", async function () {
      const large = ethers.parseEther("1000000"); // 1M × 10^18
      const result = await sellLimit.sqrt(large);
      expect(result).to.be.gt(0);
    });
  });

  // ─── Daily Sell Limit Calculations ──────────────────────────

  describe("Daily Sell Limit", function () {
    it("zero production → zero limit", async function () {
      const limit = await sellLimit.dailySellLimit(0, ethers.parseEther("1000000"));
      expect(limit).to.equal(0);
    });

    it("small producer gets 0.5% minimum guarantee", async function () {
      // 100 JOL daily production, very low market volume
      const production = ethers.parseEther("100");
      const volume = 0n; // zero volume → sqrt formula gives 0, min guarantee kicks in

      const limit = await sellLimit.dailySellLimit(production, volume);
      const minGuarantee = production * 50n / 10000n; // 0.5%

      // sqrt formula gives tiny amount, so min kicks in
      expect(limit).to.equal(minGuarantee);
    });

    it("large producer capped at 5% maximum", async function () {
      // 1M JOL daily, huge market volume
      const production = ethers.parseEther("1000000");
      const volume = ethers.parseEther("100000000"); // 100M volume

      const limit = await sellLimit.dailySellLimit(production, volume);
      const maxCap = production * 500n / 10000n; // 5%

      expect(limit).to.equal(maxCap);
    });

    it("sqrt formula works in middle range", async function () {
      // 10000 JOL daily, 10M market volume
      const production = ethers.parseEther("10000");
      const volume = ethers.parseEther("10000000");

      const limit = await sellLimit.dailySellLimit(production, volume);
      const minGuarantee = production * 50n / 10000n;
      const maxCap = production * 500n / 10000n;

      // Should be between min and max
      expect(limit).to.be.gte(minGuarantee);
      expect(limit).to.be.lte(maxCap);
    });

    it("larger producer has proportionally smaller sell %", async function () {
      const volume = ethers.parseEther("1000000");

      // Small: 100 JOL/day
      const smallProd = ethers.parseEther("100");
      const smallLimit = await sellLimit.dailySellLimit(smallProd, volume);
      const smallPct = smallLimit * 10000n / smallProd;

      // Large: 100000 JOL/day
      const largeProd = ethers.parseEther("100000");
      const largeLimit = await sellLimit.dailySellLimit(largeProd, volume);
      const largePct = largeLimit * 10000n / largeProd;

      // Square root: larger producer has smaller percentage
      // (unless both hit min/max caps)
      expect(largePct).to.be.lte(smallPct);
    });
  });

  // ─── Sell Tracking ──────────────────────────────────────────

  describe("Sell Tracking", function () {
    const production = ethers.parseEther("10000");
    const volume = ethers.parseEther("1000000");

    it("records sell and deducts from allowance", async function () {
      const limit = await sellLimit.dailySellLimit(production, volume);

      // First sell: small amount
      const smallSell = limit / 2n;
      const tx = await sellLimit.checkSell(seller.address, smallSell, production, volume);
      await expect(tx).to.emit(sellLimit, "SellLimitChecked").withArgs(
        seller.address, smallSell, limit, true
      );

      // Check remaining
      const remaining = await sellLimit.remainingAllowance(seller.address, production, volume);
      expect(remaining).to.equal(limit - smallSell);
    });

    it("rejects sell exceeding daily limit", async function () {
      const limit = await sellLimit.dailySellLimit(production, volume);
      const overLimit = limit + 1n;

      const result = await sellLimit.checkSell.staticCall(
        seller.address, overLimit, production, volume
      );
      expect(result).to.be.false;
    });

    it("multiple sells accumulate within day", async function () {
      const limit = await sellLimit.dailySellLimit(production, volume);
      const chunk = limit / 4n;

      // Sell 4 chunks (= 100% of limit)
      for (let i = 0; i < 4; i++) {
        const result = await sellLimit.checkSell.staticCall(
          seller.address, chunk, production, volume
        );
        expect(result).to.be.true;
        await sellLimit.checkSell(seller.address, chunk, production, volume);
      }

      // 5th chunk should fail
      const result = await sellLimit.checkSell.staticCall(
        seller.address, chunk, production, volume
      );
      expect(result).to.be.false;
    });

    it("limit resets next day", async function () {
      const limit = await sellLimit.dailySellLimit(production, volume);

      // Use full limit today
      await sellLimit.checkSell(seller.address, limit, production, volume);

      // Should be blocked today
      const remaining = await sellLimit.remainingAllowance(seller.address, production, volume);
      expect(remaining).to.equal(0);

      // Advance 1 day
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine");

      // Should have full limit again
      const newRemaining = await sellLimit.remainingAllowance(seller.address, production, volume);
      expect(newRemaining).to.equal(limit);
    });
  });
});
