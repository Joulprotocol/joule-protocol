const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * DEXLiquidity Tests — Launch Day Liquidity
 *
 * 3% supply = 6.3B JOL across two Uniswap v3 pools.
 * Producer must be able to sell from day one.
 */
describe("DEXLiquidity — Uniswap v3 Provisioning", function () {
  let dexLiquidity, jolToken;
  let owner, provisioner, poolA, poolB, recipient;

  beforeEach(async function () {
    [owner, provisioner, poolA, poolB, recipient] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    const DEXLiquidity = await ethers.getContractFactory("DEXLiquidity");
    dexLiquidity = await DEXLiquidity.deploy(owner.address, jolToken.target);

    // Fund the DEX contract with allocation
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER_ROLE, owner.address);
    await jolToken.mint(dexLiquidity.target, ethers.parseEther("6300000"));

    // Grant provisioner role
    const PROVISIONER_ROLE = await dexLiquidity.PROVISIONER_ROLE();
    await dexLiquidity.grantRole(PROVISIONER_ROLE, provisioner.address);
  });

  // ─── Constants ──────────────────────────────────────────────

  describe("Constants", function () {
    it("total DEX allocation = 6.3M JOL (3% of 210M)", async function () {
      expect(await dexLiquidity.TOTAL_DEX_ALLOCATION()).to.equal(ethers.parseEther("6300000"));
      // Verify: 3% of 210M
      const total = 210_000_000n;
      expect(total * 3n / 100n).to.equal(6_300_000n);
    });

    it("Pool A (JOL/USDC) = 60% = 3.78M JOL", async function () {
      expect(await dexLiquidity.poolAAllocation()).to.equal(ethers.parseEther("3780000"));
    });

    it("Pool B (JOL/ETH) = 40% = 2.52M JOL", async function () {
      expect(await dexLiquidity.poolBAllocation()).to.equal(ethers.parseEther("2520000"));
    });

    it("A + B = total allocation", async function () {
      const a = await dexLiquidity.poolAAllocation();
      const b = await dexLiquidity.poolBAllocation();
      expect(a + b).to.equal(ethers.parseEther("6300000"));
    });

    it("fee tier = 3000 (0.3%)", async function () {
      expect(await dexLiquidity.FEE_TIER()).to.equal(3000);
    });

    it("price range: 0.10 – 2.00 USDC", async function () {
      expect(await dexLiquidity.PRICE_LOWER()).to.equal(100000);  // 0.10 USDC
      expect(await dexLiquidity.PRICE_UPPER()).to.equal(2000000); // 2.00 USDC
    });
  });

  // ─── Pool Configuration ─────────────────────────────────────

  describe("Pool Configuration", function () {
    it("sets pool addresses", async function () {
      const tx = await dexLiquidity.setPoolAddresses(poolA.address, poolB.address);
      await expect(tx).to.emit(dexLiquidity, "PoolAddressSet");

      expect(await dexLiquidity.poolJOLUSDC()).to.equal(poolA.address);
      expect(await dexLiquidity.poolJOLETH()).to.equal(poolB.address);
    });

    it("rejects zero addresses", async function () {
      await expect(
        dexLiquidity.setPoolAddresses(ethers.ZeroAddress, poolB.address)
      ).to.be.revertedWith("Zero address");
    });

    it("only admin can set pool addresses", async function () {
      await expect(
        dexLiquidity.connect(provisioner).setPoolAddresses(poolA.address, poolB.address)
      ).to.be.reverted;
    });
  });

  // ─── Provisioning ───────────────────────────────────────────

  describe("Provisioning", function () {
    it("provisions Pool A with 3.78B JOL", async function () {
      const amount = await dexLiquidity.poolAAllocation();
      const tx = await dexLiquidity.connect(provisioner).provisionPoolA(recipient.address);

      await expect(tx).to.emit(dexLiquidity, "LiquidityProvisioned").withArgs("JOL/USDC", amount);
      expect(await jolToken.balanceOf(recipient.address)).to.equal(amount);
      expect(await dexLiquidity.poolAProvisioned()).to.be.true;
      expect(await dexLiquidity.provisionedPoolA()).to.equal(amount);
    });

    it("provisions Pool B with 2.52B JOL", async function () {
      const amount = await dexLiquidity.poolBAllocation();
      const tx = await dexLiquidity.connect(provisioner).provisionPoolB(recipient.address);

      await expect(tx).to.emit(dexLiquidity, "LiquidityProvisioned").withArgs("JOL/ETH", amount);
      expect(await jolToken.balanceOf(recipient.address)).to.equal(amount);
      expect(await dexLiquidity.poolBProvisioned()).to.be.true;
    });

    it("both pools provisioned → fullyProvisioned = true", async function () {
      await dexLiquidity.connect(provisioner).provisionPoolA(recipient.address);
      expect(await dexLiquidity.fullyProvisioned()).to.be.false;

      await dexLiquidity.connect(provisioner).provisionPoolB(recipient.address);
      expect(await dexLiquidity.fullyProvisioned()).to.be.true;
    });

    it("contract empty after both provisions", async function () {
      await dexLiquidity.connect(provisioner).provisionPoolA(recipient.address);
      await dexLiquidity.connect(provisioner).provisionPoolB(recipient.address);
      expect(await dexLiquidity.remainingBalance()).to.equal(0);
    });

    it("rejects double provisioning Pool A", async function () {
      await dexLiquidity.connect(provisioner).provisionPoolA(recipient.address);
      await expect(
        dexLiquidity.connect(provisioner).provisionPoolA(recipient.address)
      ).to.be.revertedWith("Pool A already provisioned");
    });

    it("rejects double provisioning Pool B", async function () {
      await dexLiquidity.connect(provisioner).provisionPoolB(recipient.address);
      await expect(
        dexLiquidity.connect(provisioner).provisionPoolB(recipient.address)
      ).to.be.revertedWith("Pool B already provisioned");
    });

    it("rejects zero recipient", async function () {
      await expect(
        dexLiquidity.connect(provisioner).provisionPoolA(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero recipient");
    });

    it("rejects unauthorized provisioning", async function () {
      await expect(
        dexLiquidity.connect(recipient).provisionPoolA(recipient.address)
      ).to.be.reverted;
    });
  });

  // ─── Emergency Withdraw ─────────────────────────────────────

  describe("Emergency Withdraw", function () {
    it("admin can withdraw before provisioning", async function () {
      const balance = await dexLiquidity.remainingBalance();
      const tx = await dexLiquidity.emergencyWithdraw(owner.address);
      await expect(tx).to.emit(dexLiquidity, "EmergencyWithdraw");
      expect(await jolToken.balanceOf(owner.address)).to.equal(balance);
    });

    it("blocked after any provisioning", async function () {
      await dexLiquidity.connect(provisioner).provisionPoolA(recipient.address);
      await expect(
        dexLiquidity.emergencyWithdraw(owner.address)
      ).to.be.revertedWith("Already provisioned");
    });

    it("only admin can emergency withdraw", async function () {
      await expect(
        dexLiquidity.connect(provisioner).emergencyWithdraw(provisioner.address)
      ).to.be.reverted;
    });
  });
});
