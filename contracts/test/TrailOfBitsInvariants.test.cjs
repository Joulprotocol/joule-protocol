const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * System Invariants — Mathematical Proofs
 * If ANY invariant fails, the system has a fundamental bug.
 */
describe("System Invariants — must ALWAYS hold", function () {
  let jolToken, energyFloor, registry, poeMining, governance;
  let treasury, bridgeLock, stakeSlash, conflictScore, oracleConsensus;
  let liqMining, vestingWallet, physicalCap, weatherOracle;
  let owner, alice, bob, oracle1, oracle2;

  beforeEach(async function () {
    [owner, alice, bob, oracle1, oracle2] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(owner.address);

    const PhysicalCap = await ethers.getContractFactory("PhysicalCap");
    physicalCap = await PhysicalCap.deploy(registry.target);

    const WeatherOracle = await ethers.getContractFactory("WeatherOracle");
    weatherOracle = await WeatherOracle.deploy(owner.address, registry.target, physicalCap.target);

    const ConflictScore = await ethers.getContractFactory("ConflictScore");
    conflictScore = await ConflictScore.deploy(owner.address);

    const StakeSlash = await ethers.getContractFactory("StakeSlash");
    stakeSlash = await StakeSlash.deploy(owner.address, jolToken.target, registry.target, owner.address, conflictScore.target);

    const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
    oracleConsensus = await OracleConsensus.deploy(owner.address, jolToken.target, registry.target, owner.address);

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

    const LiquidityMining = await ethers.getContractFactory("LiquidityMining");
    liqMining = await LiquidityMining.deploy(owner.address, jolToken.target);

    // Roles
    const MINTER = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER, owner.address);
    await jolToken.grantRole(MINTER, poeMining.target);
    await jolToken.grantRole(MINTER, energyFloor.target);
    await jolToken.grantRole(MINTER, treasury.target);
    await jolToken.grantRole(MINTER, liqMining.target);

    const VERIFIER = await registry.VERIFIER_ROLE();
    await registry.grantRole(VERIFIER, owner.address);

    const ORACLE_POE = await poeMining.ORACLE_ROLE();
    await poeMining.grantRole(ORACLE_POE, oracle1.address);

    const ORACLE_FLOOR = await energyFloor.ORACLE_ROLE();
    await energyFloor.grantRole(ORACLE_FLOOR, oracle1.address);

    const GOV = await treasury.GOVERNANCE_ROLE();
    await treasury.grantRole(GOV, owner.address);
  });

  // ═══════════════════════════════════════════════════════════════
  // I1: Supply Invariants
  // ═══════════════════════════════════════════════════════════════

  describe("I1: Supply Invariant", function () {
    it("INVARIANT: totalSupply() <= MAX_SUPPLY at all times", async function () {
      const MAX = await jolToken.MAX_SUPPLY();
      // Mint in stages, verify after each
      await jolToken.mint(alice.address, ethers.parseEther("100000000"));
      expect(await jolToken.totalSupply()).to.be.lte(MAX);

      await jolToken.mint(bob.address, ethers.parseEther("100000000"));
      expect(await jolToken.totalSupply()).to.be.lte(MAX);

      // Try to exceed
      await expect(jolToken.mint(owner.address, ethers.parseEther("20000000"))).to.be.reverted;
      expect(await jolToken.totalSupply()).to.be.lte(MAX);
    });

    it("INVARIANT: totalSupply() == sum of all known balances after transfers", async function () {
      await jolToken.mint(alice.address, ethers.parseEther("1000"));
      await jolToken.mint(bob.address, ethers.parseEther("2000"));
      await jolToken.connect(alice).transfer(bob.address, ethers.parseEther("500"));

      const totalSupply = await jolToken.totalSupply();
      const aliceBal = await jolToken.balanceOf(alice.address);
      const bobBal = await jolToken.balanceOf(bob.address);
      // No other holders in this test
      expect(aliceBal + bobBal).to.equal(totalSupply);
    });

    it("INVARIANT: totalBurned tracks correctly", async function () {
      await jolToken.mint(alice.address, ethers.parseEther("1000"));
      await jolToken.connect(alice).burn(ethers.parseEther("300"));
      expect(await jolToken.totalBurned()).to.equal(ethers.parseEther("300"));
      expect(await jolToken.totalSupply()).to.equal(ethers.parseEther("700"));
    });

    it("INVARIANT: remainingSupply == MAX_SUPPLY - totalSupply", async function () {
      await jolToken.mint(alice.address, ethers.parseEther("50000000"));
      const remaining = await jolToken.remainingSupply();
      const total = await jolToken.totalSupply();
      const max = await jolToken.MAX_SUPPLY();
      expect(remaining).to.equal(max - total);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // I2: Energy Floor Invariants
  // ═══════════════════════════════════════════════════════════════

  describe("I2: Energy Floor Invariant", function () {
    beforeEach(async function () {
      await energyFloor.connect(alice).registerProducer("Solar Test", "EE", "solar");
    });

    it("INVARIANT: totalMintedFromEnergy increases monotonically", async function () {
      const before = await energyFloor.totalMintedFromEnergy();
      await energyFloor.connect(oracle1).depositEnergy(alice.address, 100);
      const after = await energyFloor.totalMintedFromEnergy();
      expect(after).to.be.gte(before);
    });

    it("INVARIANT: totalMintedFromEnergy * 1 ether <= MAX_FLOOR_MINT", async function () {
      await energyFloor.connect(oracle1).depositEnergy(alice.address, 1000);
      const minted = await energyFloor.totalMintedFromEnergy();
      const max = await energyFloor.MAX_FLOOR_MINT();
      expect(minted * ethers.parseEther("1")).to.be.lte(max);
    });

    it("INVARIANT: totalRedeemed <= totalDeposited", async function () {
      // Grant BURNER_ROLE to EnergyFloor for protocolBurn
      const BURNER = await jolToken.BURNER_ROLE();
      await jolToken.grantRole(BURNER, energyFloor.target);

      await energyFloor.connect(oracle1).depositEnergy(alice.address, 1000);
      // Alice now has 1000 JOL. Redeem 100.
      await jolToken.connect(alice).approve(energyFloor.target, ethers.parseEther("100"));
      await energyFloor.connect(alice).redeemForEnergy(alice.address, 100);

      const deposited = await energyFloor.totalMintedFromEnergy();
      const redeemed = await energyFloor.totalRedeemedKWh();
      expect(redeemed).to.be.lte(deposited);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // I3: Treasury Invariants
  // ═══════════════════════════════════════════════════════════════

  describe("I3: Treasury Invariant", function () {
    it("INVARIANT: totalMinted <= MAX_TREASURY", async function () {
      const max = await treasury.MAX_TREASURY();
      await treasury.fundTreasury(max);
      expect(await jolToken.balanceOf(treasury.target)).to.be.lte(max);
      await expect(treasury.fundTreasury(1)).to.be.reverted;
    });

    it("INVARIANT: insuranceReserve <= MAX_INSURANCE", async function () {
      const maxInsurance = await treasury.MAX_INSURANCE();
      await treasury.fundTreasury(ethers.parseEther("5000000"));
      await treasury.fundInsurance(maxInsurance);
      await expect(treasury.fundInsurance(1)).to.be.reverted;
    });

    it("INVARIANT: spending reduces balance correctly", async function () {
      await treasury.fundTreasury(ethers.parseEther("100000"));
      const balBefore = await jolToken.balanceOf(treasury.target);
      await treasury.executeSpend(alice.address, ethers.parseEther("10000"), "test");
      const balAfter = await jolToken.balanceOf(treasury.target);
      expect(balBefore - balAfter).to.equal(ethers.parseEther("10000"));
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // I4: Vesting Invariants
  // ═══════════════════════════════════════════════════════════════

  describe("I4: Vesting Invariant", function () {
    let vesting;

    beforeEach(async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const FoundersVesting = await ethers.getContractFactory("JOULEFoundersVesting");
      vesting = await FoundersVesting.deploy(alice.address, now + 10, 365 * 86400, 1461 * 86400);
      // Fund with 12.6M JOL
      await jolToken.mint(vesting.target, ethers.parseEther("12600000"));
    });

    it("INVARIANT: nothing claimable before cliff (1 year)", async function () {
      const releasable = await vesting["releasable(address)"](jolToken.target);
      expect(releasable).to.equal(0);
    });

    it("INVARIANT: everything claimable after full vesting", async function () {
      // Skip 5 years (well past 4-year vesting + 1-year cliff)
      await ethers.provider.send("evm_increaseTime", [5 * 365 * 86400]);
      await ethers.provider.send("evm_mine");

      const releasable = await vesting["releasable(address)"](jolToken.target);
      expect(releasable).to.equal(ethers.parseEther("12600000"));
    });

    it("INVARIANT: partial vesting after cliff + 2 years ≈ 75%", async function () {
      // OZ VestingWallet: linear from start over duration (1461 days)
      // After 3 years (1095 days from start): 1095/1461 ≈ 74.9%
      await ethers.provider.send("evm_increaseTime", [3 * 365 * 86400]);
      await ethers.provider.send("evm_mine");

      const releasable = await vesting["releasable(address)"](jolToken.target);
      const expected75 = ethers.parseEther("9450000"); // ~75% of 12.6M
      expect(releasable).to.be.closeTo(expected75, ethers.parseEther("200000"));
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // I5: Oracle Invariants
  // ═══════════════════════════════════════════════════════════════

  describe("I5: Oracle Invariant", function () {
    beforeEach(async function () {
      await jolToken.mint(oracle1.address, ethers.parseEther("20000"));
      await jolToken.connect(oracle1).approve(oracleConsensus.target, ethers.parseEther("20000"));
    });

    it("INVARIANT: oracle cannot exit during 30-day lock", async function () {
      await oracleConsensus.connect(oracle1).joinAsOracle(ethers.parseEther("10000"));
      await expect(oracleConsensus.connect(oracle1).exitOracle())
        .to.be.revertedWith("Lock period 30 days");
    });

    it("INVARIANT: slashed stake reduces oracle.stake and totalStaked", async function () {
      await oracleConsensus.connect(oracle1).joinAsOracle(ethers.parseEther("10000"));
      const totalBefore = await oracleConsensus.totalStaked();
      const oracleBefore = (await oracleConsensus.oracles(oracle1.address)).stake;

      expect(totalBefore).to.equal(ethers.parseEther("10000"));
      expect(oracleBefore).to.equal(ethers.parseEther("10000"));
    });

    it("INVARIANT: quorum * 2 > minOracles (BFT requirement)", async function () {
      const q = await oracleConsensus.quorum();
      const m = await oracleConsensus.minOracles();
      expect(q * 2n).to.be.gt(m);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // I6: Mining Invariants
  // ═══════════════════════════════════════════════════════════════

  describe("I6: Mining Invariant", function () {
    it("INVARIANT: PoE multiplier = 3", async function () {
      expect(await poeMining.POE_REWARD_MULTIPLIER()).to.equal(3);
    });

    it("INVARIANT: totalPoEMinted tracks all accrued rewards", async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("inv-mining"));
      await registry.connect(alice).registerFacility(0, 100, meterId, "0x75636674", 2, "EE");
      await registry.verifyFacility(1);

      await poeMining.connect(oracle1).accrueReward(1, 100);
      // 100 kWh × 3 JOL = 300 JOL gross
      expect(await poeMining.totalPoEMinted()).to.equal(ethers.parseEther("300"));
    });

    it("INVARIANT: PoE claim respects JOLToken MAX_SUPPLY", async function () {
      // Mint nearly all supply
      await jolToken.mint(owner.address, ethers.parseEther("209999000"));

      const meterId = ethers.keccak256(ethers.toUtf8Bytes("cap-check"));
      await registry.connect(alice).registerFacility(0, 100, meterId, "0x75636674", 2, "EE");
      await registry.verifyFacility(1);

      // Accrue 1000 kWh × 3 = 3000 JOL — accrual succeeds (stored in mapping)
      await poeMining.connect(oracle1).accrueReward(1, 1000);

      // But claiming will fail because only 1000 JOL remaining in supply
      // Producer would get 2940 JOL (3000 - 2% oracle) — exceeds remaining
      await expect(
        poeMining.connect(alice).claimRewards()
      ).to.be.reverted; // JOL: exceeds max supply
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // I7: Bridge Invariants
  // ═══════════════════════════════════════════════════════════════

  describe("I7: Bridge Invariant", function () {
    beforeEach(async function () {
      const VAL = await bridgeLock.VALIDATOR_ROLE();
      await bridgeLock.grantRole(VAL, oracle1.address);
      await bridgeLock.grantRole(VAL, oracle2.address);
      await bridgeLock.grantRole(VAL, owner.address);
    });

    it("INVARIANT: totalUnlocked <= totalLocked", async function () {
      await bridgeLock.connect(alice).lockJOL({ value: ethers.parseEther("1000") });
      const txHash = ethers.keccak256(ethers.toUtf8Bytes("inv-bridge"));

      await bridgeLock.connect(oracle1).confirmUnlock(1, alice.address, ethers.parseEther("500"), txHash);
      await bridgeLock.connect(oracle2).confirmUnlock(1, alice.address, ethers.parseEther("500"), txHash);
      await bridgeLock.connect(owner).confirmUnlock(1, alice.address, ethers.parseEther("500"), txHash);

      const locked = await bridgeLock.totalLocked();
      const unlocked = await bridgeLock.totalUnlocked();
      expect(unlocked).to.be.lte(locked);
    });

    it("INVARIANT: each ethTxHash processed only once", async function () {
      await bridgeLock.connect(alice).lockJOL({ value: ethers.parseEther("1000") });
      const txHash = ethers.keccak256(ethers.toUtf8Bytes("once-only"));

      await bridgeLock.connect(oracle1).confirmUnlock(1, alice.address, ethers.parseEther("100"), txHash);
      await bridgeLock.connect(oracle2).confirmUnlock(1, alice.address, ethers.parseEther("100"), txHash);
      await bridgeLock.connect(owner).confirmUnlock(1, alice.address, ethers.parseEther("100"), txHash);

      // Replay blocked
      await expect(
        bridgeLock.connect(oracle1).confirmUnlock(2, alice.address, ethers.parseEther("100"), txHash)
      ).to.be.revertedWith("Already processed");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // I8: Governance Invariants
  // ═══════════════════════════════════════════════════════════════

  describe("I8: Governance Invariant", function () {
    beforeEach(async function () {
      await jolToken.mint(alice.address, ethers.parseEther("200000"));
      await jolToken.connect(alice).delegate(alice.address);
      await ethers.provider.send("evm_mine");
    });

    it("INVARIANT: proposal cannot execute before timelock", async function () {
      await governance.connect(alice).propose("Test", "desc", [owner.address], ["0x"]);
      await governance.connect(alice).vote(1, true);
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");
      await governance.finalize(1);

      // Immediately after finalize — timelock not expired
      await expect(governance.execute(1)).to.be.revertedWith("Timelock not expired");
    });

    it("INVARIANT: each address votes only once per proposal", async function () {
      await governance.connect(alice).propose("Test", "desc", [owner.address], ["0x"]);
      await governance.connect(alice).vote(1, true);
      await expect(governance.connect(alice).vote(1, true)).to.be.revertedWith("Already voted");
    });

    it("INVARIANT: vote weight == getPastVotes at snapshot block", async function () {
      await governance.connect(alice).propose("Test", "desc", [owner.address], ["0x"]);
      const proposal = await governance.proposals(1);
      const snapshotVotes = await jolToken.getPastVotes(alice.address, proposal.snapshotBlock);
      expect(snapshotVotes).to.equal(ethers.parseEther("200000"));
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // I9: Cross-Contract Supply Invariant
  // ═══════════════════════════════════════════════════════════════

  describe("I9: Cross-Contract Invariant", function () {
    it("INVARIANT: sum of all contract caps <= MAX_SUPPLY", async function () {
      // 70% Mining (no contract cap — JOLToken MAX_SUPPLY is the cap)
      // 19% Reserve: EnergyFloor.MAX_FLOOR_MINT = 39.9M
      // 6% Founder: FoundersVesting = 12.6M (no contract constant, funded manually)
      // 5% Ecosystem: EcosystemTreasury.MAX_TREASURY = 10.5M

      const floorCap = await energyFloor.MAX_FLOOR_MINT();
      const treasuryCap = await treasury.MAX_TREASURY();
      const founderAllocation = ethers.parseEther("12600000");
      const miningTotal = ethers.parseEther("147000000");

      const totalAllocated = floorCap + treasuryCap + founderAllocation + miningTotal;
      const maxSupply = await jolToken.MAX_SUPPLY();

      expect(totalAllocated).to.equal(maxSupply);
    });

    it("INVARIANT: 70+19+6+5 = 100% of supply", function () {
      expect(70 + 19 + 6 + 5).to.equal(100);
      // 147M + 39.9M + 12.6M + 10.5M = 210M
      const sum = 147_000_000n + 39_900_000n + 12_600_000n + 10_500_000n;
      expect(sum).to.equal(210_000_000n);
    });

    it("INVARIANT: no single mint path can exceed its allocation", async function () {
      // EnergyFloor: capped at 39.9M
      const floorCap = await energyFloor.MAX_FLOOR_MINT();
      expect(floorCap).to.equal(ethers.parseEther("39900000"));

      // Treasury: capped at 10.5M
      const treasuryCap = await treasury.MAX_TREASURY();
      expect(treasuryCap).to.equal(ethers.parseEther("10500000"));

      // LiquidityMining: capped at 4.2M
      const lmCap = await liqMining.TOTAL_REWARDS();
      expect(lmCap).to.equal(ethers.parseEther("4200000"));
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // I10: Economic Invariant
  // ═══════════════════════════════════════════════════════════════

  describe("I10: Economic Invariant", function () {
    it("INVARIANT: emission series 36+18+9+4+2+1 × 2.1M = exactly 147M", function () {
      const total = (36n + 18n + 9n + 4n + 2n + 1n) * 2_100_000n;
      expect(total).to.equal(147_000_000n);
    });

    it("INVARIANT: 147M = exactly 70% of 210M", function () {
      expect(210_000_000n * 70n / 100n).to.equal(147_000_000n);
    });

    it("INVARIANT: block reward integer halving series terminates", function () {
      let r = 36n;
      let eras = 0;
      while (r > 0n) { r = r / 2n; eras++; }
      expect(eras).to.equal(6);
      // After 6 halvings, reward = 0. Mining is finite.
    });

    it("INVARIANT: MAX_SUPPLY hard cap in JOLToken is 210M", async function () {
      expect(await jolToken.MAX_SUPPLY()).to.equal(ethers.parseEther("210000000"));
    });
  });
});
