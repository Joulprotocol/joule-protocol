const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * FoundersVesting Tests
 *
 * OpenZeppelin VestingWallet + cliff.
 * 6 month cliff, 48 month linear vesting.
 * VestingWallet address in genesis, not founder wallet.
 */
describe("FoundersVesting — OpenZeppelin + Cliff", function () {
  let vesting, jolToken;
  let owner, founder;

  const CLIFF = 365 * 86400;           // 1 year in seconds
  const DURATION = 1461 * 86400;       // 4 years (1461 days) in seconds
  const FOUNDER_ALLOCATION = ethers.parseEther("12600000"); // 6% of 210M

  let startTime;

  beforeEach(async function () {
    [owner, founder] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    startTime = (await ethers.provider.getBlock("latest")).timestamp;

    const FoundersVesting = await ethers.getContractFactory("JOULEFoundersVesting");
    vesting = await FoundersVesting.deploy(
      founder.address,
      startTime,
      CLIFF,
      DURATION
    );

    // Fund the vesting contract with founder's allocation
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER_ROLE, owner.address);
    await jolToken.mint(vesting.target, FOUNDER_ALLOCATION);
  });

  // ─── Deployment ─────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets correct beneficiary", async function () {
      expect(await vesting.beneficiary()).to.equal(founder.address);
    });

    it("sets correct start time", async function () {
      expect(await vesting.start()).to.equal(startTime);
    });

    it("sets correct duration (48 months)", async function () {
      expect(await vesting.duration()).to.equal(DURATION);
    });

    it("sets correct cliff (6 months)", async function () {
      expect(await vesting.cliffDuration()).to.equal(CLIFF);
    });

    it("holds founder allocation", async function () {
      expect(await jolToken.balanceOf(vesting.target)).to.equal(FOUNDER_ALLOCATION);
    });
  });

  // ─── Cliff ──────────────────────────────────────────────────

  describe("Cliff — 6 Months", function () {
    it("nothing vested before cliff", async function () {
      // At start: 0
      const vested = await vesting["vestedAmount(address,uint64)"](jolToken.target, startTime + 1);
      expect(vested).to.equal(0);
    });

    it("nothing vested at 5 months", async function () {
      const fiveMonths = startTime + 5 * 30 * 86400;
      const vested = await vesting["vestedAmount(address,uint64)"](jolToken.target, fiveMonths);
      expect(vested).to.equal(0);
    });

    it("nothing releasable before cliff", async function () {
      // Advance 3 months
      await ethers.provider.send("evm_increaseTime", [3 * 30 * 86400]);
      await ethers.provider.send("evm_mine");

      const releasable = await vesting["releasable(address)"](jolToken.target);
      expect(releasable).to.equal(0);
    });

    it("cannot release tokens before cliff", async function () {
      await ethers.provider.send("evm_increaseTime", [CLIFF - 100]);
      await ethers.provider.send("evm_mine");

      await vesting["release(address)"](jolToken.target);
      expect(await jolToken.balanceOf(founder.address)).to.equal(0);
    });
  });

  // ─── Vesting After Cliff ────────────────────────────────────

  describe("Linear Vesting After Cliff", function () {
    it("vests proportionally at cliff + time", async function () {
      // At exactly cliff (1 year = 365/1461 ≈ 25% of 4 years)
      const atCliff = startTime + CLIFF;
      const vested = await vesting["vestedAmount(address,uint64)"](jolToken.target, atCliff);

      // 365/1461 ≈ 25% of allocation
      const expected = FOUNDER_ALLOCATION * 365n / 1461n;
      // Allow small rounding (within 10 JOL)
      expect(vested).to.be.closeTo(expected, ethers.parseEther("10"));
    });

    it("releases tokens after cliff", async function () {
      // Advance past cliff
      await ethers.provider.send("evm_increaseTime", [CLIFF + 86400]);
      await ethers.provider.send("evm_mine");

      await vesting["release(address)"](jolToken.target);
      const balance = await jolToken.balanceOf(founder.address);
      expect(balance).to.be.gt(0);
    });

    it("50% vested at 2 years", async function () {
      const halfWay = startTime + (DURATION / 2);
      const vested = await vesting["vestedAmount(address,uint64)"](jolToken.target, halfWay);

      const expected = FOUNDER_ALLOCATION / 2n;
      expect(vested).to.be.closeTo(expected, ethers.parseEther("100"));
    });

    it("100% vested at 48 months", async function () {
      const end = startTime + DURATION;
      const vested = await vesting["vestedAmount(address,uint64)"](jolToken.target, end);
      expect(vested).to.equal(FOUNDER_ALLOCATION);
    });

    it("100% vested after 48 months", async function () {
      const after = startTime + DURATION + 365 * 86400;
      const vested = await vesting["vestedAmount(address,uint64)"](jolToken.target, after);
      expect(vested).to.equal(FOUNDER_ALLOCATION);
    });
  });

  // ─── Full Release Cycle ─────────────────────────────────────

  describe("Full Release Cycle", function () {
    it("founder receives all tokens over 48 months", async function () {
      // Advance to end
      await ethers.provider.send("evm_increaseTime", [DURATION + 86400]);
      await ethers.provider.send("evm_mine");

      await vesting["release(address)"](jolToken.target);

      const balance = await jolToken.balanceOf(founder.address);
      expect(balance).to.equal(FOUNDER_ALLOCATION);

      // Vesting contract empty
      expect(await jolToken.balanceOf(vesting.target)).to.equal(0);
    });

    it("multiple claims over time accumulate correctly", async function () {
      // Claim at 1.5 years (past 1yr cliff)
      await ethers.provider.send("evm_increaseTime", [547 * 86400]); // ~1.5 years
      await ethers.provider.send("evm_mine");
      await vesting["release(address)"](jolToken.target);
      const bal1 = await jolToken.balanceOf(founder.address);
      expect(bal1).to.be.gt(0);

      // Claim at 2.5 years
      await ethers.provider.send("evm_increaseTime", [365 * 86400]);
      await ethers.provider.send("evm_mine");
      await vesting["release(address)"](jolToken.target);
      const bal2 = await jolToken.balanceOf(founder.address);
      expect(bal2).to.be.gt(bal1);

      // Claim at 4+ years (end)
      await ethers.provider.send("evm_increaseTime", [730 * 86400]);
      await ethers.provider.send("evm_mine");
      await vesting["release(address)"](jolToken.target);
      const balFinal = await jolToken.balanceOf(founder.address);
      expect(balFinal).to.equal(FOUNDER_ALLOCATION);
    });
  });
});
