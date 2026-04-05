const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * OracleConsensus — Comprehensive Tests
 *
 * Covers:
 *  1. joinAsOracle — stake JOL, become active oracle
 *  2. exitOracle — return stake after 30-day lock
 *  3. submitReport — oracle submits energy report
 *  4. Quorum — 2/3 consensus finalizes report
 *  5. setQuorum — admin scales quorum with safety bounds
 *  6. Median calculation — correct median from 3 submissions
 *  7. Outlier slashing — >5% deviation = 50% slash
 *  8. Slashed funds go to treasury
 *  9. Weather hash cross-check — mismatched hashes flag anomaly
 * 10. Double submission prevention
 * 11. Report window (1 hour)
 * 12. Pausable — paused blocks submitReport
 * 13. Access control
 */

describe("OracleConsensus", function () {
  let jolToken, registry, poeMining, oracle;
  let owner, treasury, producer, oracle1, oracle2, oracle3, outsider;

  const MIN_STAKE = ethers.parseEther("10000");
  const STAKE_AMOUNT = ethers.parseEther("20000");
  const THIRTY_DAYS = 30 * 24 * 60 * 60;

  // Helpers
  async function setupFacility() {
    const meterId = ethers.keccak256(ethers.toUtf8Bytes("METER-OC-TEST"));
    // Solar, 50 kW capacity
    await registry.connect(producer).registerFacility(0, 50, meterId, "0x75636674", 2, "EE");
    await registry.connect(owner).verifyFacility(1);
    return 1; // facilityId
  }

  async function stakeOracle(signer, amount) {
    amount = amount || STAKE_AMOUNT;
    await jolToken.mint(signer.address, amount);
    await jolToken.connect(signer).approve(oracle.target, amount);
    await oracle.connect(signer).joinAsOracle(amount);
  }

  function reportId(facilityId, periodStart, periodEnd) {
    return ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "uint256", "uint256"],
        [facilityId, periodStart, periodEnd]
      )
    );
  }

  beforeEach(async function () {
    [owner, treasury, producer, oracle1, oracle2, oracle3, outsider] =
      await ethers.getSigners();

    // Deploy JOLToken
    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    // Deploy EnergyRegistry
    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(owner.address);

    // Deploy PoEMining
    const PoEMining = await ethers.getContractFactory("PoEMining");
    poeMining = await PoEMining.deploy(owner.address, jolToken.target, registry.target);

    // Deploy OracleConsensus
    const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
    oracle = await OracleConsensus.deploy(
      owner.address,
      jolToken.target,
      registry.target,
      treasury.address
    );

    // Roles setup
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER_ROLE, owner.address);
    await jolToken.grantRole(MINTER_ROLE, poeMining.target);

    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();
    await registry.grantRole(VERIFIER_ROLE, owner.address);
    await registry.grantRole(VERIFIER_ROLE, oracle.target);

    const ORACLE_ROLE = await poeMining.ORACLE_ROLE();
    await poeMining.grantRole(ORACLE_ROLE, oracle.target);

    await oracle.setPoEMining(poeMining.target);
  });

  // ─── 1. joinAsOracle ──────────────────────────────────────────

  describe("1. joinAsOracle", function () {
    it("stakes JOL and becomes active oracle", async function () {
      await stakeOracle(oracle1);

      const node = await oracle.oracles(oracle1.address);
      expect(node.active).to.be.true;
      expect(node.stake).to.equal(STAKE_AMOUNT);
      expect(node.operator).to.equal(oracle1.address);

      expect(await oracle.totalStaked()).to.equal(STAKE_AMOUNT);
      expect(await oracle.getActiveOracleCount()).to.equal(1);
    });

    it("transfers JOL from oracle to contract", async function () {
      await jolToken.mint(oracle1.address, STAKE_AMOUNT);
      await jolToken.connect(oracle1).approve(oracle.target, STAKE_AMOUNT);

      const balBefore = await jolToken.balanceOf(oracle1.address);
      await oracle.connect(oracle1).joinAsOracle(STAKE_AMOUNT);
      const balAfter = await jolToken.balanceOf(oracle1.address);

      expect(balBefore - balAfter).to.equal(STAKE_AMOUNT);
      expect(await jolToken.balanceOf(oracle.target)).to.equal(STAKE_AMOUNT);
    });

    it("emits OracleJoined event", async function () {
      await jolToken.mint(oracle1.address, STAKE_AMOUNT);
      await jolToken.connect(oracle1).approve(oracle.target, STAKE_AMOUNT);

      await expect(oracle.connect(oracle1).joinAsOracle(STAKE_AMOUNT))
        .to.emit(oracle, "OracleJoined")
        .withArgs(oracle1.address, STAKE_AMOUNT);
    });

    it("rejects stake below MIN_STAKE (10,000 JOL)", async function () {
      const tooLow = ethers.parseEther("9999");
      await jolToken.mint(oracle1.address, tooLow);
      await jolToken.connect(oracle1).approve(oracle.target, tooLow);

      await expect(
        oracle.connect(oracle1).joinAsOracle(tooLow)
      ).to.be.revertedWith("Insufficient stake");
    });

    it("rejects already active oracle", async function () {
      await stakeOracle(oracle1);

      await jolToken.mint(oracle1.address, STAKE_AMOUNT);
      await jolToken.connect(oracle1).approve(oracle.target, STAKE_AMOUNT);

      await expect(
        oracle.connect(oracle1).joinAsOracle(STAKE_AMOUNT)
      ).to.be.revertedWith("Already active");
    });

    it("accepts exact MIN_STAKE", async function () {
      await jolToken.mint(oracle1.address, MIN_STAKE);
      await jolToken.connect(oracle1).approve(oracle.target, MIN_STAKE);
      await oracle.connect(oracle1).joinAsOracle(MIN_STAKE);

      const node = await oracle.oracles(oracle1.address);
      expect(node.active).to.be.true;
      expect(node.stake).to.equal(MIN_STAKE);
    });
  });

  // ─── 2. exitOracle ────────────────────────────────────────────

  describe("2. exitOracle", function () {
    beforeEach(async function () {
      await stakeOracle(oracle1);
    });

    it("returns stake after 30-day lock", async function () {
      await ethers.provider.send("evm_increaseTime", [THIRTY_DAYS + 1]);
      await ethers.provider.send("evm_mine");

      const balBefore = await jolToken.balanceOf(oracle1.address);
      await oracle.connect(oracle1).exitOracle();
      const balAfter = await jolToken.balanceOf(oracle1.address);

      expect(balAfter - balBefore).to.equal(STAKE_AMOUNT);

      const node = await oracle.oracles(oracle1.address);
      expect(node.active).to.be.false;
      expect(node.stake).to.equal(0);
      expect(await oracle.totalStaked()).to.equal(0);
    });

    it("emits OracleExited event", async function () {
      await ethers.provider.send("evm_increaseTime", [THIRTY_DAYS + 1]);
      await ethers.provider.send("evm_mine");

      await expect(oracle.connect(oracle1).exitOracle())
        .to.emit(oracle, "OracleExited")
        .withArgs(oracle1.address, STAKE_AMOUNT);
    });

    it("rejects exit before 30-day lock expires", async function () {
      await expect(
        oracle.connect(oracle1).exitOracle()
      ).to.be.revertedWith("Lock period 30 days");
    });

    it("rejects exit from non-active oracle", async function () {
      await expect(
        oracle.connect(outsider).exitOracle()
      ).to.be.revertedWith("Not active oracle");
    });

    it("rejects exit at 29 days (needs >30 days)", async function () {
      // 29 days is clearly within the 30-day lock
      await ethers.provider.send("evm_increaseTime", [THIRTY_DAYS - 86400]);
      await ethers.provider.send("evm_mine");

      await expect(
        oracle.connect(oracle1).exitOracle()
      ).to.be.revertedWith("Lock period 30 days");
    });
  });

  // ─── 3. submitReport ──────────────────────────────────────────

  describe("3. submitReport", function () {
    let facilityId, now;

    beforeEach(async function () {
      await stakeOracle(oracle1);
      await stakeOracle(oracle2);
      facilityId = await setupFacility();
      now = (await ethers.provider.getBlock("latest")).timestamp;
    });

    it("oracle submits an energy report", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny-20C"));
      const periodStart = now - 7200;
      const periodEnd = now;
      const kWh = 80; // 50 kW * 2 hours = 100 max, 80 is valid

      await expect(
        oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, kWh, weatherHash)
      )
        .to.emit(oracle, "ReportSubmitted")
        .withArgs(
          reportId(facilityId, periodStart, periodEnd),
          oracle1.address,
          kWh
        );

      const rId = reportId(facilityId, periodStart, periodEnd);
      const voters = await oracle.getReportVoters(rId);
      expect(voters.length).to.equal(1);
      expect(voters[0]).to.equal(oracle1.address);
    });

    it("rejects submission from non-oracle", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));
      await expect(
        oracle.connect(outsider).submitReport(facilityId, now - 3600, now, 50, weatherHash)
      ).to.be.revertedWith("Not active oracle");
    });

    it("rejects submission for non-active facility", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));
      const nonExistent = 999;
      await expect(
        oracle.connect(oracle1).submitReport(nonExistent, now - 3600, now, 50, weatherHash)
      ).to.be.revertedWith("Facility not active");
    });
  });

  // ─── 4. Quorum — 2/3 consensus finalizes report ──────────────

  describe("4. Quorum finalization", function () {
    let facilityId, periodStart, periodEnd;

    beforeEach(async function () {
      await stakeOracle(oracle1);
      await stakeOracle(oracle2);
      await stakeOracle(oracle3);
      facilityId = await setupFacility();
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      periodStart = now - 7200;
      periodEnd = now;
    });

    it("finalizes report when quorum (2) is reached", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));
      const kWh = 80;

      // First submission — no finalization yet
      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, kWh, weatherHash);

      const rId = reportId(facilityId, periodStart, periodEnd);
      let report = await oracle.reports(rId);
      expect(report.finalized).to.be.false;

      // Second submission — quorum reached, auto-finalize
      await expect(
        oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, kWh, weatherHash)
      )
        .to.emit(oracle, "ReportFinalized")
        .withArgs(rId, facilityId, kWh);

      report = await oracle.reports(rId);
      expect(report.finalized).to.be.true;
      expect(report.finalKWh).to.equal(kWh);
      expect(await oracle.reportsFinalized()).to.equal(1);
    });

    it("records production in registry after finalization", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));
      const kWh = 80;

      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, kWh, weatherHash);
      await oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, kWh, weatherHash);

      const facility = await registry.facilities(facilityId);
      expect(facility.totalVerifiedKWh).to.equal(kWh);
    });

    it("rejects submission to already finalized report", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));
      const kWh = 80;

      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, kWh, weatherHash);
      await oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, kWh, weatherHash);

      // Third submission after finalization
      await expect(
        oracle.connect(oracle3).submitReport(facilityId, periodStart, periodEnd, kWh, weatherHash)
      ).to.be.revertedWith("Already finalized");
    });
  });

  // ─── 5. setQuorum ─────────────────────────────────────────────

  describe("5. setQuorum", function () {
    it("admin can scale quorum", async function () {
      await expect(oracle.connect(owner).setQuorum(3, 5))
        .to.emit(oracle, "QuorumUpdated")
        .withArgs(3, 5);

      expect(await oracle.quorum()).to.equal(3);
      expect(await oracle.minOracles()).to.equal(5);
    });

    it("rejects quorum < 2", async function () {
      await expect(
        oracle.connect(owner).setQuorum(1, 3)
      ).to.be.revertedWith("Min quorum is 2");
    });

    it("rejects minOracles < 3", async function () {
      await expect(
        oracle.connect(owner).setQuorum(2, 2)
      ).to.be.revertedWith("Min oracles is 3");
    });

    it("rejects quorum <= 50% of minOracles (must be >50%)", async function () {
      // 2 * 2 = 4, 4 > 5 is false => must be >50%
      await expect(
        oracle.connect(owner).setQuorum(2, 5)
      ).to.be.revertedWith("Quorum must be >50%");
    });

    it("rejects quorum exceeding minOracles", async function () {
      await expect(
        oracle.connect(owner).setQuorum(4, 3)
      ).to.be.revertedWith("Quorum cant exceed total");
    });

    it("non-admin cannot set quorum", async function () {
      await expect(
        oracle.connect(outsider).setQuorum(3, 5)
      ).to.be.reverted;
    });

    it("accepts valid boundary: quorum=2, minOracles=3 (2*2=4 > 3)", async function () {
      await oracle.connect(owner).setQuorum(2, 3);
      expect(await oracle.quorum()).to.equal(2);
      expect(await oracle.minOracles()).to.equal(3);
    });
  });

  // ─── 6. Median calculation ────────────────────────────────────

  describe("6. Median calculation", function () {
    let facilityId, periodStart, periodEnd;

    beforeEach(async function () {
      // Set quorum to 3 so all 3 submissions count before finalization
      await stakeOracle(oracle1);
      await stakeOracle(oracle2);
      await stakeOracle(oracle3);
      await oracle.connect(owner).setQuorum(3, 3);

      facilityId = await setupFacility();
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      periodStart = now - 7200;
      periodEnd = now;
    });

    it("selects correct median from 3 submissions (80, 82, 90)", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 80, weatherHash);
      await oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, 90, weatherHash);
      // Third triggers finalization
      await oracle.connect(oracle3).submitReport(facilityId, periodStart, periodEnd, 82, weatherHash);

      const rId = reportId(facilityId, periodStart, periodEnd);
      const report = await oracle.reports(rId);
      // Sorted: [80, 82, 90] -> median index 1 = 82
      expect(report.finalKWh).to.equal(82);
    });

    it("selects correct median from 3 identical submissions", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("cloudy"));

      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 75, weatherHash);
      await oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, 75, weatherHash);
      await oracle.connect(oracle3).submitReport(facilityId, periodStart, periodEnd, 75, weatherHash);

      const rId = reportId(facilityId, periodStart, periodEnd);
      const report = await oracle.reports(rId);
      expect(report.finalKWh).to.equal(75);
    });

    it("selects correct median when submissions are in descending order (90, 82, 80)", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 90, weatherHash);
      await oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, 82, weatherHash);
      await oracle.connect(oracle3).submitReport(facilityId, periodStart, periodEnd, 80, weatherHash);

      const rId = reportId(facilityId, periodStart, periodEnd);
      const report = await oracle.reports(rId);
      // Sorted: [80, 82, 90] -> median = 82
      expect(report.finalKWh).to.equal(82);
    });
  });

  // ─── 7. Outlier slashing ──────────────────────────────────────

  describe("7. Outlier slashing (>5% deviation from median)", function () {
    let facilityId, periodStart, periodEnd;

    beforeEach(async function () {
      await stakeOracle(oracle1);
      await stakeOracle(oracle2);
      await stakeOracle(oracle3);
      await oracle.connect(owner).setQuorum(3, 3);

      facilityId = await setupFacility();
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      periodStart = now - 7200;
      periodEnd = now;
    });

    it("slashes oracle deviating >5% from median", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      // Submissions: 80, 82, 50. Sorted: [50, 80, 82]. Median = 80.
      // oracle3 submitted 50: deviation = (80-50)/80 = 37.5% > 5% -> slashed
      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 80, weatherHash);
      await oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, 82, weatherHash);

      await expect(
        oracle.connect(oracle3).submitReport(facilityId, periodStart, periodEnd, 50, weatherHash)
      ).to.emit(oracle, "OracleSlashed");

      const node = await oracle.oracles(oracle3.address);
      // 50% of 20000 slashed = 10000 remaining
      expect(node.stake).to.equal(ethers.parseEther("10000"));
      expect(node.slashCount).to.equal(1);
    });

    it("does not slash oracle within 5% deviation", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      // Submissions: 80, 82, 81. Sorted: [80, 81, 82]. Median = 81.
      // All within 5% of 81
      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 80, weatherHash);
      await oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, 82, weatherHash);
      await oracle.connect(oracle3).submitReport(facilityId, periodStart, periodEnd, 81, weatherHash);

      // All oracles should keep their full stake
      const node1 = await oracle.oracles(oracle1.address);
      const node2 = await oracle.oracles(oracle2.address);
      const node3 = await oracle.oracles(oracle3.address);
      expect(node1.stake).to.equal(STAKE_AMOUNT);
      expect(node2.stake).to.equal(STAKE_AMOUNT);
      expect(node3.stake).to.equal(STAKE_AMOUNT);
    });

    it("deactivates oracle if stake falls below MIN_STAKE after slash", async function () {
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      // oracle3 staked exactly MIN_STAKE (10000). After 50% slash = 5000 < 10000 -> deactivated.
      // Re-deploy oracle3 with exact MIN_STAKE
      // (oracle3 already staked STAKE_AMOUNT=20000, so slash leaves 10000 which equals MIN_STAKE)
      // We need a scenario where stake = MIN_STAKE so 50% slash puts it under.
      // Let's use outsider with exactly MIN_STAKE.
      await jolToken.mint(outsider.address, MIN_STAKE);
      await jolToken.connect(outsider).approve(oracle.target, MIN_STAKE);
      await oracle.connect(outsider).joinAsOracle(MIN_STAKE);

      // Need 4 oracles now, set quorum to require all 3 outlier-containing ones
      // Actually, let's just use outsider as one of 3 submitters
      // Set quorum back to 3 with minOracles 3 (already set)
      const now2 = (await ethers.provider.getBlock("latest")).timestamp;
      const ps2 = now2 - 7200;
      const pe2 = now2;

      // Register a second facility for a fresh report
      const meterId2 = ethers.keccak256(ethers.toUtf8Bytes("METER-OC-TEST-2"));
      await registry.connect(producer).registerFacility(0, 50, meterId2, "0x75636674", 2, "EE");
      await registry.connect(owner).verifyFacility(2);

      await oracle.connect(oracle1).submitReport(2, ps2, pe2, 80, weatherHash);
      await oracle.connect(oracle2).submitReport(2, ps2, pe2, 82, weatherHash);
      // Outsider submits wildly off value
      await oracle.connect(outsider).submitReport(2, ps2, pe2, 10, weatherHash);

      const node = await oracle.oracles(outsider.address);
      // 50% of 10000 = 5000 remaining, which is < MIN_STAKE
      expect(node.stake).to.equal(ethers.parseEther("5000"));
      expect(node.active).to.be.false;
    });
  });

  // ─── 8. Slashed funds go to treasury ──────────────────────────

  describe("8. Slashed funds go to treasury", function () {
    it("transfers slashed JOL to treasury address", async function () {
      await stakeOracle(oracle1);
      await stakeOracle(oracle2);
      await stakeOracle(oracle3);
      await oracle.connect(owner).setQuorum(3, 3);

      const facilityId = await setupFacility();
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const periodStart = now - 7200;
      const periodEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      const treasuryBefore = await jolToken.balanceOf(treasury.address);

      // oracle3 will be slashed: median will be ~80, oracle3 submits 50
      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 80, weatherHash);
      await oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, 82, weatherHash);
      await oracle.connect(oracle3).submitReport(facilityId, periodStart, periodEnd, 50, weatherHash);

      const treasuryAfter = await jolToken.balanceOf(treasury.address);
      const slashAmount = ethers.parseEther("10000"); // 50% of 20000
      expect(treasuryAfter - treasuryBefore).to.equal(slashAmount);

      // Contract balance should not retain slashed funds
      expect(await oracle.totalSlashed()).to.equal(slashAmount);
    });
  });

  // ─── 9. Weather hash cross-check ─────────────────────────────

  describe("9. Weather hash cross-check", function () {
    let facilityId, periodStart, periodEnd;

    beforeEach(async function () {
      await stakeOracle(oracle1);
      await stakeOracle(oracle2);
      await stakeOracle(oracle3);
      await oracle.connect(owner).setQuorum(3, 3);

      facilityId = await setupFacility();
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      periodStart = now - 7200;
      periodEnd = now;
    });

    it("flags anomaly when weather hashes do not agree", async function () {
      const hash1 = ethers.keccak256(ethers.toUtf8Bytes("sunny-20C"));
      const hash2 = ethers.keccak256(ethers.toUtf8Bytes("rainy-10C"));
      const hash3 = ethers.keccak256(ethers.toUtf8Bytes("cloudy-15C"));

      // All different hashes — no majority
      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 80, hash1);
      await oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, 80, hash2);
      await expect(
        oracle.connect(oracle3).submitReport(facilityId, periodStart, periodEnd, 80, hash3)
      )
        .to.emit(oracle, "AnomalyFlagged")
        .withArgs(
          reportId(facilityId, periodStart, periodEnd),
          facilityId,
          "Weather hash mismatch"
        );

      const rId = reportId(facilityId, periodStart, periodEnd);
      const report = await oracle.reports(rId);
      expect(report.anomalyFlagged).to.be.true;
    });

    it("does not flag anomaly when majority of weather hashes match", async function () {
      const hashSame = ethers.keccak256(ethers.toUtf8Bytes("sunny-20C"));
      const hashDiff = ethers.keccak256(ethers.toUtf8Bytes("rainy-10C"));

      // 2 out of 3 match — majority achieved
      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 80, hashSame);
      await oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, 80, hashSame);
      await oracle.connect(oracle3).submitReport(facilityId, periodStart, periodEnd, 80, hashDiff);

      const rId = reportId(facilityId, periodStart, periodEnd);
      const report = await oracle.reports(rId);
      expect(report.anomalyFlagged).to.be.false;
    });
  });

  // ─── 10. Double submission prevention ─────────────────────────

  describe("10. Double submission prevention", function () {
    it("rejects second submission from same oracle", async function () {
      await stakeOracle(oracle1);
      await stakeOracle(oracle2);
      const facilityId = await setupFacility();
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const periodStart = now - 7200;
      const periodEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 80, weatherHash);

      await expect(
        oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 85, weatherHash)
      ).to.be.revertedWith("Already submitted");
    });
  });

  // ─── 11. Report window (1 hour) ──────────────────────────────

  describe("11. Report window (1 hour)", function () {
    it("rejects submission after report window closes", async function () {
      await stakeOracle(oracle1);
      await stakeOracle(oracle2);
      const facilityId = await setupFacility();
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const periodStart = now - 7200;
      const periodEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      // First submission opens the window
      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 80, weatherHash);

      // Advance time past 1 hour
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      await expect(
        oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, 80, weatherHash)
      ).to.be.revertedWith("Report window closed");
    });

    it("allows submission within the 1-hour window", async function () {
      await stakeOracle(oracle1);
      await stakeOracle(oracle2);
      const facilityId = await setupFacility();
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const periodStart = now - 7200;
      const periodEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      await oracle.connect(oracle1).submitReport(facilityId, periodStart, periodEnd, 80, weatherHash);

      // Advance 30 minutes — still within window
      await ethers.provider.send("evm_increaseTime", [1800]);
      await ethers.provider.send("evm_mine");

      // Should succeed and finalize (quorum=2)
      await expect(
        oracle.connect(oracle2).submitReport(facilityId, periodStart, periodEnd, 80, weatherHash)
      ).to.emit(oracle, "ReportFinalized");
    });
  });

  // ─── 12. Pausable ─────────────────────────────────────────────

  describe("12. Pausable", function () {
    it("paused contract blocks submitReport", async function () {
      await stakeOracle(oracle1);
      const facilityId = await setupFacility();
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      await oracle.connect(owner).pause();

      await expect(
        oracle.connect(oracle1).submitReport(facilityId, now - 3600, now, 80, weatherHash)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("paused contract blocks joinAsOracle", async function () {
      await oracle.connect(owner).pause();

      await jolToken.mint(oracle1.address, STAKE_AMOUNT);
      await jolToken.connect(oracle1).approve(oracle.target, STAKE_AMOUNT);

      await expect(
        oracle.connect(oracle1).joinAsOracle(STAKE_AMOUNT)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("unpausing restores functionality", async function () {
      await oracle.connect(owner).pause();
      await oracle.connect(owner).unpause();

      await stakeOracle(oracle1);
      const node = await oracle.oracles(oracle1.address);
      expect(node.active).to.be.true;
    });

    it("only admin can pause/unpause", async function () {
      await expect(oracle.connect(outsider).pause()).to.be.reverted;
      await expect(oracle.connect(outsider).unpause()).to.be.reverted;
    });
  });

  // ─── 13. Access control ───────────────────────────────────────

  describe("13. Access control", function () {
    it("only admin can setPoEMining", async function () {
      await expect(
        oracle.connect(outsider).setPoEMining(ethers.ZeroAddress)
      ).to.be.reverted;
    });

    it("only admin can setQuorum", async function () {
      await expect(
        oracle.connect(outsider).setQuorum(3, 5)
      ).to.be.reverted;
    });

    it("admin has DEFAULT_ADMIN_ROLE", async function () {
      const DEFAULT_ADMIN_ROLE = await oracle.DEFAULT_ADMIN_ROLE();
      expect(await oracle.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await oracle.hasRole(DEFAULT_ADMIN_ROLE, outsider.address)).to.be.false;
    });

    it("non-oracle cannot submit reports", async function () {
      const facilityId = await setupFacility();
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("sunny"));

      await expect(
        oracle.connect(outsider).submitReport(facilityId, now - 3600, now, 80, weatherHash)
      ).to.be.revertedWith("Not active oracle");
    });
  });
});
