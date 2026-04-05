const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * BridgeLock Tests — Ethereum Bridge Layer
 *
 * Lock native JOL on JOULE chain, unlock via 3/5 multisig validators.
 * Large amounts (>100k JOL) require 24h timelock.
 */
describe("BridgeLock — Ethereum Bridge", function () {
  let bridge;
  let admin, user, v1, v2, v3, v4, v5;

  const ETH_TX_HASH = ethers.keccak256(ethers.toUtf8Bytes("eth-tx-001"));
  const ETH_TX_HASH_2 = ethers.keccak256(ethers.toUtf8Bytes("eth-tx-002"));
  const ONE_JOL = ethers.parseEther("1");
  const LARGE_AMOUNT = ethers.parseEther("100000");

  async function grantValidator(signer) {
    const VALIDATOR_ROLE = await bridge.VALIDATOR_ROLE();
    await bridge.connect(admin).grantRole(VALIDATOR_ROLE, signer.address);
  }

  async function fundBridge(amount) {
    // For large amounts, set balance directly to avoid insufficient funds
    const currentBal = await ethers.provider.getBalance(bridge.target);
    const targetBal = currentBal + amount;
    await ethers.provider.send("hardhat_setBalance", [
      bridge.target,
      "0x" + targetBal.toString(16),
    ]);
  }

  beforeEach(async function () {
    [admin, user, v1, v2, v3, v4, v5] = await ethers.getSigners();

    const BridgeLock = await ethers.getContractFactory("BridgeLock");
    bridge = await BridgeLock.deploy(admin.address);

    // Grant VALIDATOR_ROLE to 5 validators
    for (const v of [v1, v2, v3, v4, v5]) {
      await grantValidator(v);
    }
  });

  // --- lockJOL -----------------------------------------------------------

  describe("lockJOL", function () {
    it("locks native JOL and emits event", async function () {
      const tx = await bridge.connect(user).lockJOL({ value: ONE_JOL });

      await expect(tx)
        .to.emit(bridge, "JOLLocked")
        .withArgs(1, user.address, ONE_JOL);

      const req = await bridge.lockRequests(1);
      expect(req.user).to.equal(user.address);
      expect(req.amount).to.equal(ONE_JOL);
      expect(req.processed).to.be.false;
    });

    it("updates totalLocked correctly", async function () {
      await bridge.connect(user).lockJOL({ value: ONE_JOL });
      await bridge.connect(user).lockJOL({ value: ethers.parseEther("2") });

      expect(await bridge.totalLocked()).to.equal(ethers.parseEther("3"));
    });

    it("increments lockId for each lock", async function () {
      await bridge.connect(user).lockJOL({ value: ONE_JOL });
      await bridge.connect(user).lockJOL({ value: ONE_JOL });

      expect(await bridge.nextLockId()).to.equal(3);

      const req1 = await bridge.lockRequests(1);
      const req2 = await bridge.lockRequests(2);
      expect(req1.amount).to.equal(ONE_JOL);
      expect(req2.amount).to.equal(ONE_JOL);
    });

    it("contract receives the locked JOL", async function () {
      await bridge.connect(user).lockJOL({ value: ONE_JOL });

      expect(await bridge.bridgeTVL()).to.equal(ONE_JOL);
    });

    it("reverts on zero amount", async function () {
      await expect(
        bridge.connect(user).lockJOL({ value: 0 })
      ).to.be.revertedWith("Zero amount");
    });
  });

  // --- confirmUnlock — First Confirmation --------------------------------

  describe("confirmUnlock — first confirmation", function () {
    it("initializes unlock request on first confirmation", async function () {
      await fundBridge(ONE_JOL);

      const tx = await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await expect(tx).to.emit(bridge, "UnlockConfirmed").withArgs(1, v1.address);

      const req = await bridge.unlockRequests(1);
      expect(req.user).to.equal(user.address);
      expect(req.amount).to.equal(ONE_JOL);
      expect(req.ethTxHash).to.equal(ETH_TX_HASH);
      expect(req.confirmations).to.equal(1);
      expect(req.executed).to.be.false;
    });

    it("rejects confirmation from non-validator", async function () {
      await expect(
        bridge.connect(user).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH)
      ).to.be.reverted;
    });
  });

  // --- confirmUnlock — Subsequent Must Match Hash ------------------------

  describe("confirmUnlock — hash-bound validation", function () {
    beforeEach(async function () {
      await fundBridge(ONE_JOL);
      await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
    });

    it("accepts matching second confirmation", async function () {
      const tx = await bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await expect(tx).to.emit(bridge, "UnlockConfirmed").withArgs(1, v2.address);

      const req = await bridge.unlockRequests(1);
      expect(req.confirmations).to.equal(2);
    });

    it("rejects mismatched user address", async function () {
      await expect(
        bridge.connect(v2).confirmUnlock(1, admin.address, ONE_JOL, ETH_TX_HASH)
      ).to.be.revertedWith("Parameters mismatch with first confirmation");
    });

    it("rejects mismatched amount", async function () {
      await expect(
        bridge.connect(v2).confirmUnlock(1, user.address, ethers.parseEther("2"), ETH_TX_HASH)
      ).to.be.revertedWith("Parameters mismatch with first confirmation");
    });

    it("rejects mismatched ethTxHash", async function () {
      await expect(
        bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH_2)
      ).to.be.revertedWith("Parameters mismatch with first confirmation");
    });

    it("rejects double confirmation by same validator", async function () {
      await expect(
        bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH)
      ).to.be.revertedWith("Already confirmed");
    });
  });

  // --- Multi-Validator Confirmation Flow (3/5) ---------------------------

  describe("Multi-validator confirmation flow (3/5)", function () {
    it("does not execute with only 2 confirmations", async function () {
      await fundBridge(ONE_JOL);

      await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);

      const req = await bridge.unlockRequests(1);
      expect(req.confirmations).to.equal(2);
      expect(req.executed).to.be.false;
    });

    it("auto-executes on 3rd confirmation", async function () {
      await fundBridge(ONE_JOL);
      const balBefore = await ethers.provider.getBalance(user.address);

      await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      const tx = await bridge.connect(v3).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);

      await expect(tx).to.emit(bridge, "JOLUnlocked").withArgs(1, user.address, ONE_JOL);

      const req = await bridge.unlockRequests(1);
      expect(req.executed).to.be.true;
      expect(req.confirmations).to.equal(3);

      const balAfter = await ethers.provider.getBalance(user.address);
      expect(balAfter - balBefore).to.equal(ONE_JOL);
    });

    it("updates totalUnlocked after execution", async function () {
      await fundBridge(ONE_JOL);

      await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v3).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);

      expect(await bridge.totalUnlocked()).to.equal(ONE_JOL);
    });

    it("rejects 4th confirmation on already executed request", async function () {
      await fundBridge(ONE_JOL);

      await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v3).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);

      // processedEthTxHashes check fires before the executed check
      await expect(
        bridge.connect(v4).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH)
      ).to.be.revertedWith("Already processed");
    });
  });

  // --- Timelock for Large Amounts ----------------------------------------

  describe("Timelock for large amounts (>= 100k JOL)", function () {
    it("reverts when timelock not expired", async function () {
      await fundBridge(LARGE_AMOUNT);

      await bridge.connect(v1).confirmUnlock(1, user.address, LARGE_AMOUNT, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, LARGE_AMOUNT, ETH_TX_HASH);

      // 3rd confirmation triggers _executeUnlock which checks timelock
      await expect(
        bridge.connect(v3).confirmUnlock(1, user.address, LARGE_AMOUNT, ETH_TX_HASH)
      ).to.be.revertedWith("Timelock not expired for large amount");
    });

    it("executes after 24h timelock expires", async function () {
      await fundBridge(LARGE_AMOUNT);

      await bridge.connect(v1).confirmUnlock(1, user.address, LARGE_AMOUNT, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, LARGE_AMOUNT, ETH_TX_HASH);

      // Advance time by 24 hours + 1 second
      await ethers.provider.send("evm_increaseTime", [24 * 3600 + 1]);
      await ethers.provider.send("evm_mine");

      const tx = await bridge.connect(v3).confirmUnlock(1, user.address, LARGE_AMOUNT, ETH_TX_HASH);
      await expect(tx).to.emit(bridge, "JOLUnlocked").withArgs(1, user.address, LARGE_AMOUNT);

      const req = await bridge.unlockRequests(1);
      expect(req.executed).to.be.true;
    });

    it("no timelock for amounts below 100k", async function () {
      const amount = ethers.parseEther("99999");
      await fundBridge(amount);

      await bridge.connect(v1).confirmUnlock(1, user.address, amount, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, amount, ETH_TX_HASH);

      // Should execute immediately, no timelock
      const tx = await bridge.connect(v3).confirmUnlock(1, user.address, amount, ETH_TX_HASH);
      await expect(tx).to.emit(bridge, "JOLUnlocked");
    });
  });

  // --- Double-Process Prevention -----------------------------------------

  describe("Double-process prevention (same ethTxHash)", function () {
    it("marks ethTxHash as processed after execution", async function () {
      await fundBridge(ONE_JOL);

      await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v3).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);

      expect(await bridge.processedEthTxHashes(ETH_TX_HASH)).to.be.true;
    });

    it("rejects new unlock with already-processed ethTxHash", async function () {
      await fundBridge(ethers.parseEther("2"));

      // First unlock executes
      await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v3).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);

      // Attempt to replay the same ethTxHash with a different unlockId
      await expect(
        bridge.connect(v1).confirmUnlock(2, user.address, ONE_JOL, ETH_TX_HASH)
      ).to.be.revertedWith("Already processed");
    });
  });

  // --- Execute Unlock — Balance Check ------------------------------------

  describe("Execute unlock — balance checks", function () {
    it("reverts when bridge has insufficient balance", async function () {
      // Do NOT fund the bridge — no balance
      await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);

      await expect(
        bridge.connect(v3).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH)
      ).to.be.revertedWith("Insufficient bridge balance");
    });

    it("transfers exact amount to user", async function () {
      const amount = ethers.parseEther("5");
      await fundBridge(amount);

      const balBefore = await ethers.provider.getBalance(user.address);

      await bridge.connect(v1).confirmUnlock(1, user.address, amount, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, amount, ETH_TX_HASH);
      await bridge.connect(v3).confirmUnlock(1, user.address, amount, ETH_TX_HASH);

      const balAfter = await ethers.provider.getBalance(user.address);
      expect(balAfter - balBefore).to.equal(amount);
    });

    it("bridgeTVL decreases after unlock", async function () {
      await fundBridge(ethers.parseEther("10"));
      expect(await bridge.bridgeTVL()).to.equal(ethers.parseEther("10"));

      await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v3).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);

      expect(await bridge.bridgeTVL()).to.equal(ethers.parseEther("9"));
    });
  });

  // --- Edge Cases --------------------------------------------------------

  describe("Edge cases", function () {
    it("receive() allows direct funding of bridge", async function () {
      await admin.sendTransaction({ to: bridge.target, value: ONE_JOL });
      expect(await bridge.bridgeTVL()).to.equal(ONE_JOL);
    });

    it("multiple independent unlocks work correctly", async function () {
      await fundBridge(ethers.parseEther("5"));

      // Unlock 1
      await bridge.connect(v1).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v2).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);
      await bridge.connect(v3).confirmUnlock(1, user.address, ONE_JOL, ETH_TX_HASH);

      // Unlock 2 with different ethTxHash
      await bridge.connect(v1).confirmUnlock(2, user.address, ethers.parseEther("2"), ETH_TX_HASH_2);
      await bridge.connect(v2).confirmUnlock(2, user.address, ethers.parseEther("2"), ETH_TX_HASH_2);
      await bridge.connect(v3).confirmUnlock(2, user.address, ethers.parseEther("2"), ETH_TX_HASH_2);

      expect(await bridge.totalUnlocked()).to.equal(ethers.parseEther("3"));
      expect(await bridge.bridgeTVL()).to.equal(ethers.parseEther("2"));
    });

    it("LARGE_AMOUNT constant matches 100_000 ether", async function () {
      expect(await bridge.LARGE_AMOUNT()).to.equal(ethers.parseEther("100000"));
    });

    it("TIMELOCK_DURATION constant matches 24 hours", async function () {
      expect(await bridge.TIMELOCK_DURATION()).to.equal(24 * 3600);
    });

    it("requiredConfirmations is 3", async function () {
      expect(await bridge.requiredConfirmations()).to.equal(3);
    });
  });
});
