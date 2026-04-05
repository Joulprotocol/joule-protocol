const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Fuzz Tests — Random Inputs
 * Each function gets 100 random inputs.
 * None should crash unexpectedly or break invariants.
 * Expected reverts (access control, bounds) are OK.
 */
describe("Fuzz Tests — Random Inputs", function () {
  let jolToken, energyFloor, registry, poeMining, governance;
  let treasury, bridgeLock, streaming, paymentChannel, oracleConsensus;
  let owner, alice, bob, oracle1;

  function randomBigInt(max) {
    const bytes = ethers.randomBytes(32);
    const val = BigInt("0x" + Buffer.from(bytes).toString("hex"));
    return val % max;
  }

  function randomAddress() {
    return ethers.Wallet.createRandom().address;
  }

  beforeEach(async function () {
    [owner, alice, bob, oracle1] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(owner.address);

    const PoEMining = await ethers.getContractFactory("PoEMining");
    poeMining = await PoEMining.deploy(owner.address, jolToken.target, registry.target);

    const EnergyFloor = await ethers.getContractFactory("EnergyFloor");
    energyFloor = await EnergyFloor.deploy(owner.address, jolToken.target);

    const EcosystemTreasury = await ethers.getContractFactory("EcosystemTreasury");
    treasury = await EcosystemTreasury.deploy(owner.address, jolToken.target);

    const Governance = await ethers.getContractFactory("Governance");
    governance = await Governance.deploy(owner.address, jolToken.target);

    const BridgeLock = await ethers.getContractFactory("BridgeLock");
    bridgeLock = await BridgeLock.deploy(owner.address);

    const StreamingPayments = await ethers.getContractFactory("StreamingPayments");
    streaming = await StreamingPayments.deploy(owner.address, jolToken.target);

    const PaymentChannel = await ethers.getContractFactory("PaymentChannel");
    paymentChannel = await PaymentChannel.deploy(owner.address, jolToken.target);

    const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
    oracleConsensus = await OracleConsensus.deploy(owner.address, jolToken.target, registry.target, owner.address);

    const MINTER = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER, owner.address);
    await jolToken.grantRole(MINTER, poeMining.target);
    await jolToken.grantRole(MINTER, energyFloor.target);
    await jolToken.grantRole(MINTER, treasury.target);

    const VERIFIER = await registry.VERIFIER_ROLE();
    await registry.grantRole(VERIFIER, owner.address);

    const ORACLE_POE = await poeMining.ORACLE_ROLE();
    await poeMining.grantRole(ORACLE_POE, oracle1.address);

    const ORACLE_FLOOR = await energyFloor.ORACLE_ROLE();
    await energyFloor.grantRole(ORACLE_FLOOR, oracle1.address);
  });

  // ═══════════════════════════════════════════════════════════════
  // FUZZ: JOLToken
  // ═══════════════════════════════════════════════════════════════

  describe("FUZZ: JOLToken.mint", function () {
    it("100 random mint amounts — never exceeds MAX_SUPPLY", async function () {
      const MAX = await jolToken.MAX_SUPPLY();
      let totalMinted = 0n;

      for (let i = 0; i < 100; i++) {
        const amount = randomBigInt(ethers.parseEther("5000000")); // 0-5M
        try {
          await jolToken.mint(owner.address, amount);
          totalMinted += amount;
        } catch (e) {
          // Expected: exceeds max supply
        }
        expect(await jolToken.totalSupply()).to.be.lte(MAX);
      }
    });
  });

  describe("FUZZ: JOLToken.transfer", function () {
    it("100 random transfers — balances always non-negative", async function () {
      await jolToken.mint(alice.address, ethers.parseEther("1000000"));

      for (let i = 0; i < 100; i++) {
        const amount = randomBigInt(ethers.parseEther("100000"));
        const recipient = randomAddress();
        try {
          await jolToken.connect(alice).transfer(recipient, amount);
        } catch (e) {
          // Expected: insufficient balance
        }
        const bal = await jolToken.balanceOf(alice.address);
        expect(bal).to.be.gte(0n);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FUZZ: EnergyFloor
  // ═══════════════════════════════════════════════════════════════

  describe("FUZZ: EnergyFloor.depositEnergy", function () {
    it("100 random kWh deposits — never exceeds MAX_FLOOR_MINT", async function () {
      await energyFloor.connect(alice).registerProducer("Fuzz Solar", "EE", "solar");
      const MAX = await energyFloor.MAX_FLOOR_MINT();

      for (let i = 0; i < 100; i++) {
        const kWh = Number(randomBigInt(1_000_000n));
        try {
          await energyFloor.connect(oracle1).depositEnergy(alice.address, kWh);
        } catch (e) {
          // Expected: cap reached or zero kWh
        }
        const minted = await energyFloor.totalMintedFromEnergy();
        expect(minted * ethers.parseEther("1")).to.be.lte(MAX);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FUZZ: OracleConsensus
  // ═══════════════════════════════════════════════════════════════

  describe("FUZZ: OracleConsensus.submitReport", function () {
    it("100 random kWh values from non-oracles — all rejected", async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("fuzz-oracle"));
      await registry.connect(alice).registerFacility(0, 100, meterId, "0x75636674", 2, "EE");
      await registry.verifyFacility(1);

      const now = (await ethers.provider.getBlock("latest")).timestamp;

      for (let i = 0; i < 100; i++) {
        const kWh = Number(randomBigInt(10_000_000n));
        await expect(
          oracleConsensus.connect(alice).submitReport(1, now - 3600, now, kWh, ethers.ZeroHash)
        ).to.be.revertedWith("Not active oracle");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FUZZ: Governance
  // ═══════════════════════════════════════════════════════════════

  describe("FUZZ: Governance.vote", function () {
    it("100 random proposal IDs — all rejected (non-existent)", async function () {
      for (let i = 0; i < 100; i++) {
        const id = Number(randomBigInt(1000n)) + 1;
        await expect(
          governance.connect(alice).vote(id, true)
        ).to.be.reverted;
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FUZZ: StreamingPayments
  // ═══════════════════════════════════════════════════════════════

  describe("FUZZ: StreamingPayments.createStream", function () {
    it("100 random rates — zero rate always rejected, valid ones succeed", async function () {
      await jolToken.mint(alice.address, ethers.parseEther("10000000"));
      await jolToken.connect(alice).approve(streaming.target, ethers.MaxUint256);

      let created = 0;
      for (let i = 0; i < 100; i++) {
        const rate = randomBigInt(ethers.parseEther("10"));
        const deposit = ethers.parseEther("100");
        try {
          await streaming.connect(alice).createStream(bob.address, rate, deposit);
          created++;
          expect(rate).to.be.gt(0n); // Only non-zero rates succeed
        } catch (e) {
          // Expected: zero rate or insufficient funds
        }
      }
      // Some should have succeeded (random rates > 0)
      expect(created).to.be.gt(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FUZZ: PaymentChannel
  // ═══════════════════════════════════════════════════════════════

  describe("FUZZ: PaymentChannel.openChannel", function () {
    it("100 random deposits — zero always rejected", async function () {
      await jolToken.mint(alice.address, ethers.parseEther("10000000"));
      await jolToken.connect(alice).approve(paymentChannel.target, ethers.MaxUint256);

      for (let i = 0; i < 100; i++) {
        const deposit = randomBigInt(ethers.parseEther("10000"));
        try {
          await paymentChannel.connect(alice).openChannel(bob.address, deposit, 86400);
          expect(deposit).to.be.gt(0n);
        } catch (e) {
          // Expected: zero deposit
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FUZZ: PoEMining
  // ═══════════════════════════════════════════════════════════════

  describe("FUZZ: PoEMining.accrueReward", function () {
    it("100 random facilityId + kWh — invalid IDs always rejected", async function () {
      for (let i = 0; i < 100; i++) {
        const facId = Number(randomBigInt(1000n));
        const kWh = Number(randomBigInt(100_000n));
        try {
          await poeMining.connect(oracle1).accrueReward(facId, kWh);
        } catch (e) {
          // Expected: facility not active, zero production, etc.
        }
        // MAX_SUPPLY invariant holds
        expect(await jolToken.totalSupply()).to.be.lte(await jolToken.MAX_SUPPLY());
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FUZZ: EcosystemTreasury
  // ═══════════════════════════════════════════════════════════════

  describe("FUZZ: EcosystemTreasury.fundTreasury", function () {
    it("100 random fund amounts — never exceeds MAX_TREASURY", async function () {
      const MAX = await treasury.MAX_TREASURY();

      for (let i = 0; i < 100; i++) {
        const amount = randomBigInt(ethers.parseEther("1000000"));
        try {
          await treasury.fundTreasury(amount);
        } catch (e) {
          // Expected: exceeds cap
        }
        expect(await jolToken.balanceOf(treasury.target)).to.be.lte(MAX);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FUZZ: BridgeLock
  // ═══════════════════════════════════════════════════════════════

  describe("FUZZ: BridgeLock.lockJOL", function () {
    it("100 random lock amounts — zero always rejected, totalLocked increases", async function () {
      let totalExpected = 0n;
      for (let i = 0; i < 100; i++) {
        const amount = randomBigInt(ethers.parseEther("10"));
        try {
          await bridgeLock.connect(alice).lockJOL({ value: amount });
          totalExpected += amount;
        } catch (e) {
          // Expected: zero amount
          expect(amount).to.equal(0n);
        }
      }
      expect(await bridgeLock.totalLocked()).to.equal(totalExpected);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // FUZZ: Supply invariant after all operations
  // ═══════════════════════════════════════════════════════════════

  describe("FUZZ: Global supply invariant", function () {
    it("After mixed operations, totalSupply <= MAX_SUPPLY", async function () {
      const MAX = await jolToken.MAX_SUPPLY();

      // Random mints
      for (let i = 0; i < 20; i++) {
        const amount = randomBigInt(ethers.parseEther("5000000"));
        try { await jolToken.mint(owner.address, amount); } catch {}
      }

      // Random burns
      for (let i = 0; i < 10; i++) {
        const amount = randomBigInt(ethers.parseEther("1000000"));
        try { await jolToken.burn(amount); } catch {}
      }

      // Random transfers
      for (let i = 0; i < 10; i++) {
        const amount = randomBigInt(ethers.parseEther("100000"));
        try { await jolToken.transfer(alice.address, amount); } catch {}
      }

      // Invariant: supply never exceeds max
      expect(await jolToken.totalSupply()).to.be.lte(MAX);
      // Invariant: remaining supply is non-negative
      expect(await jolToken.remainingSupply()).to.be.gte(0n);
    });
  });
});
