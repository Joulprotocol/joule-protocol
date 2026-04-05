const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * JOULE Protocol — Adversarial Agent Tests
 *
 * Five attack scenarios simulating real-world adversaries:
 * 1. Fake Producer — tries to game energy registration/reporting
 * 2. Governance Attacker — tries to hijack DAO governance
 * 3. Lazy Oracle — submits late/duplicate/wrong data
 * 4. Treasury Raider — tries to drain ecosystem treasury
 * 5. Replay Attacker — tries to double-process transactions
 *
 * Every attack MUST fail. Success count MUST be 0.
 */

describe("JOULE Adversarial Agents", function () {
  let jolToken, registry, poeMining, oracleConsensus, governance;
  let energyPeg, physicalCap, weatherOracle, stakeSlash, conflictScore;
  let ecosystemTreasury, bridgeLock, energyProofEngine;

  let admin, attacker, legitimateOracle1, legitimateOracle2, legitimateOracle3;
  let legitimateProducer, otherUser, treasuryAddr;

  const ORACLE_STAKE = ethers.parseEther("10000"); // 10,000 JOL minimum
  const LARGE_MINT = ethers.parseEther("1000000");

  beforeEach(async function () {
    [admin, attacker, legitimateOracle1, legitimateOracle2, legitimateOracle3,
     legitimateProducer, otherUser, treasuryAddr] = await ethers.getSigners();

    // ─── Deploy all contracts ─────────────────────────────────
    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(admin.address);

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(admin.address);

    const ConflictScore = await ethers.getContractFactory("ConflictScore");
    conflictScore = await ConflictScore.deploy(admin.address);

    const PhysicalCap = await ethers.getContractFactory("PhysicalCap");
    physicalCap = await PhysicalCap.deploy(registry.target);

    const WeatherOracle = await ethers.getContractFactory("WeatherOracle");
    weatherOracle = await WeatherOracle.deploy(admin.address, registry.target, physicalCap.target);

    const PoEMining = await ethers.getContractFactory("PoEMining");
    poeMining = await PoEMining.deploy(admin.address, jolToken.target, registry.target);

    const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
    oracleConsensus = await OracleConsensus.deploy(
      admin.address, jolToken.target, registry.target, treasuryAddr.address
    );

    const EnergyPeg = await ethers.getContractFactory("EnergyPeg");
    energyPeg = await EnergyPeg.deploy(admin.address, jolToken.target);

    const StakeSlash = await ethers.getContractFactory("StakeSlash");
    stakeSlash = await StakeSlash.deploy(
      admin.address, jolToken.target, registry.target, treasuryAddr.address, conflictScore.target
    );

    const Governance = await ethers.getContractFactory("Governance");
    governance = await Governance.deploy(admin.address, jolToken.target);

    const EcosystemTreasury = await ethers.getContractFactory("EcosystemTreasury");
    ecosystemTreasury = await EcosystemTreasury.deploy(admin.address, jolToken.target);

    const BridgeLock = await ethers.getContractFactory("BridgeLock");
    bridgeLock = await BridgeLock.deploy(admin.address);

    const EnergyProofEngine = await ethers.getContractFactory("EnergyProofEngine");
    energyProofEngine = await EnergyProofEngine.deploy(
      admin.address,
      jolToken.target,
      registry.target,
      physicalCap.target,
      weatherOracle.target,
      oracleConsensus.target,
      stakeSlash.target,
      conflictScore.target,
      poeMining.target,
      energyPeg.target
    );

    // ─── Configure roles ──────────────────────────────────────
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    const BURNER_ROLE = await jolToken.BURNER_ROLE();
    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();
    const ORACLE_ROLE_MINING = await poeMining.ORACLE_ROLE();
    const REPORTER_ROLE = await conflictScore.REPORTER_ROLE();
    const SLASHER_ROLE = await stakeSlash.SLASHER_ROLE();
    const ORACLE_ROLE_PEG = await energyPeg.ORACLE_ROLE();
    const ENGINE_OPERATOR = await energyProofEngine.ENGINE_OPERATOR();
    const ORACLE_ROLE_WEATHER = await weatherOracle.ORACLE_ROLE();

    // Token minting roles
    await jolToken.grantRole(MINTER_ROLE, admin.address);
    await jolToken.grantRole(MINTER_ROLE, poeMining.target);
    await jolToken.grantRole(MINTER_ROLE, energyPeg.target);
    await jolToken.grantRole(MINTER_ROLE, ecosystemTreasury.target);
    await jolToken.grantRole(BURNER_ROLE, energyPeg.target);

    // Registry roles
    await registry.grantRole(VERIFIER_ROLE, oracleConsensus.target);
    await registry.grantRole(VERIFIER_ROLE, admin.address);

    // Oracle consensus → PoEMining link
    await poeMining.grantRole(ORACLE_ROLE_MINING, oracleConsensus.target);
    await poeMining.grantRole(ORACLE_ROLE_MINING, energyProofEngine.target);
    await oracleConsensus.setPoEMining(poeMining.target);

    // EnergyPeg oracle
    await energyPeg.grantRole(ORACLE_ROLE_PEG, energyProofEngine.target);
    await energyPeg.grantRole(ORACLE_ROLE_PEG, admin.address);

    // StakeSlash roles
    await stakeSlash.grantRole(SLASHER_ROLE, admin.address);
    await conflictScore.grantRole(REPORTER_ROLE, stakeSlash.target);
    await conflictScore.grantRole(REPORTER_ROLE, admin.address);

    // EnergyProofEngine operator
    await energyProofEngine.grantRole(ENGINE_OPERATOR, admin.address);

    // WeatherOracle
    await weatherOracle.grantRole(ORACLE_ROLE_WEATHER, admin.address);

    // Bridge validators
    const VALIDATOR_ROLE = await bridgeLock.VALIDATOR_ROLE();
    await bridgeLock.grantRole(VALIDATOR_ROLE, legitimateOracle1.address);
    await bridgeLock.grantRole(VALIDATOR_ROLE, legitimateOracle2.address);
    await bridgeLock.grantRole(VALIDATOR_ROLE, legitimateOracle3.address);

    // ─── Seed legitimate oracles with JOL for staking ─────────
    await jolToken.mint(legitimateOracle1.address, ORACLE_STAKE);
    await jolToken.mint(legitimateOracle2.address, ORACLE_STAKE);
    await jolToken.mint(legitimateOracle3.address, ORACLE_STAKE);

    // Oracles approve and join OracleConsensus
    await jolToken.connect(legitimateOracle1).approve(oracleConsensus.target, ORACLE_STAKE);
    await oracleConsensus.connect(legitimateOracle1).joinAsOracle(ORACLE_STAKE);
    await jolToken.connect(legitimateOracle2).approve(oracleConsensus.target, ORACLE_STAKE);
    await oracleConsensus.connect(legitimateOracle2).joinAsOracle(ORACLE_STAKE);
    await jolToken.connect(legitimateOracle3).approve(oracleConsensus.target, ORACLE_STAKE);
    await oracleConsensus.connect(legitimateOracle3).joinAsOracle(ORACLE_STAKE);

    // ─── Set up a legitimate verified facility ────────────────
    const meterId = ethers.keccak256(ethers.toUtf8Bytes("LEGIT-METER-001"));
    await registry.connect(legitimateProducer).registerFacility(
      0, // Solar
      50, // 50 kW
      meterId,
      58381000, // Tallinn latitude
      24655000, // Tallinn longitude
      "EE"
    );
    await registry.verifyFacility(1);

    // Register producer in EnergyPeg
    await energyPeg.connect(legitimateProducer).registerProducer("Legit Solar", "EE", "solar");
  });

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 1: Pettis Tootja (Fake Producer)
  // ═══════════════════════════════════════════════════════════════════

  describe("Agent: Pettis Tootja (Fake Producer)", function () {
    let attacksAttempted = 0;
    let attacksSucceeded = 0;

    afterEach(function () {
      // Reset per-test counters handled in final test
    });

    it("cannot submit oracle reports without oracle role", async function () {
      attacksAttempted = 0;
      attacksSucceeded = 0;

      // Attempt 1: submit report to OracleConsensus without being an oracle
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("fake-weather"));

      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await oracleConsensus.connect(attacker).submitReport(
            1, now - 3600, now, 99999, weatherHash
          );
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Not active oracle"
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot register duplicate meter IDs", async function () {
      attacksAttempted = 0;
      attacksSucceeded = 0;

      const existingMeterId = ethers.keccak256(ethers.toUtf8Bytes("LEGIT-METER-001"));

      // Attempt to re-register same meter ID
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await registry.connect(attacker).registerFacility(
            0, 100, existingMeterId, 40000000, 20000000, "XX"
          );
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Meter ID already registered"
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot submit kWh exceeding physical capacity via PhysicalCap", async function () {
      attacksAttempted = 0;
      attacksSucceeded = 0;

      // Facility #1: 50 kW solar in Tallinn (subarctic ~3.0h peak, 20% efficiency)
      // maxDaily = 50 * 300 * 2000 / (100 * 10000) = 30 kWh
      // with 10% tolerance = 33 kWh
      const maxAllowed = await physicalCap.maxDailyOutput(1);

      // Try claiming 10x the physical max
      const absurdClaim = Number(maxAllowed) * 10;

      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        const result = await physicalCap.verifyProduction.staticCall(1, absurdClaim);
        if (result === true) {
          attacksSucceeded++;
        }
        // Result should be false (physics check failed)
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot claim rewards without staking (StakeSlash blocks)", async function () {
      attacksAttempted = 0;
      attacksSucceeded = 0;

      // Register a fake facility
      const fakeMeterId = ethers.keccak256(ethers.toUtf8Bytes("FAKE-METER-001"));
      await registry.connect(attacker).registerFacility(
        0, 50, fakeMeterId, 58000000, 24000000, "EE"
      );
      // Facility #2 (attacker's), not verified yet

      // Even if verified, cannot stake without JOL
      await registry.verifyFacility(2);

      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          // Attacker has no JOL, so stake() will fail on transferFrom
          await stakeSlash.connect(attacker).stake(2);
          attacksSucceeded++;
        } catch (e) {
          // Expected: transferFrom fails (no balance/allowance)
        }
      }

      // Also check isStaked returns false
      const staked = await stakeSlash.isStaked(2);
      expect(staked).to.equal(false);

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot get past EnergyProofEngine without all 5 layers", async function () {
      attacksAttempted = 0;
      attacksSucceeded = 0;

      // Set up: create oracle report for facility 1 that gets finalized
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const periodStart = now - 3600;
      const periodEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("weather-data"));

      // Have oracles submit and finalize a report (quorum=2)
      await oracleConsensus.connect(legitimateOracle1).submitReport(
        1, periodStart, periodEnd, 10, weatherHash
      );
      await oracleConsensus.connect(legitimateOracle2).submitReport(
        1, periodStart, periodEnd, 10, weatherHash
      );
      // Report is now finalized with median=10 kWh

      // Attempt 1: Process without ENGINE_OPERATOR role (attacker calls directly)
      attacksAttempted++;
      try {
        await energyProofEngine.connect(attacker).processReport(1, periodStart, periodEnd);
        attacksSucceeded++;
      } catch (e) {
        // Expected: AccessControl revert (no ENGINE_OPERATOR role)
      }

      // Attempt 2: Even admin processing should fail because facility is not staked (Layer 4)
      attacksAttempted++;
      try {
        await energyProofEngine.processReport(1, periodStart, periodEnd);
        // If it doesn't revert, check if it was rejected (event-based)
        const isProcessed = await energyProofEngine.isProcessed(1, periodStart, periodEnd);
        // It was processed but REJECTED — totalRejected should have increased
        const stats = await energyProofEngine.engineStats();
        if (stats._totalRejected > 0n && stats._totalVerifiedKWh === 0n) {
          // Rejected as expected — not a successful attack
        } else if (stats._totalVerifiedKWh > 0n) {
          attacksSucceeded++; // Should NOT happen
        }
      } catch (e) {
        // Also acceptable — hard revert
      }

      // Attempt 3: Attacker tries to process a non-existent report
      attacksAttempted++;
      try {
        await energyProofEngine.processReport(1, 0, 1);
        attacksSucceeded++;
      } catch (e) {
        // Expected: "Report not finalized by oracle consensus"
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("SCORECARD: all fake producer attacks failed", async function () {
      // Aggregate: run the full battery in one test
      let totalAttempted = 0;
      let totalSucceeded = 0;

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("fake"));

      // Attack 1: submit report without oracle role (x3)
      for (let i = 0; i < 3; i++) {
        totalAttempted++;
        try {
          await oracleConsensus.connect(attacker).submitReport(1, now - 3600, now, 99999, weatherHash);
          totalSucceeded++;
        } catch (e) { /* blocked */ }
      }

      // Attack 2: duplicate meter ID (x2)
      const usedMeter = ethers.keccak256(ethers.toUtf8Bytes("LEGIT-METER-001"));
      for (let i = 0; i < 2; i++) {
        totalAttempted++;
        try {
          await registry.connect(attacker).registerFacility(0, 50, usedMeter, 0, 0, "XX");
          totalSucceeded++;
        } catch (e) { /* blocked */ }
      }

      // Attack 3: exceed physical capacity
      const maxDaily = await physicalCap.maxDailyOutput(1);
      totalAttempted++;
      const physicsResult = await physicalCap.verifyProduction.staticCall(1, Number(maxDaily) * 100);
      if (physicsResult === true) totalSucceeded++;

      // Attack 4: stake without JOL
      const fakeMeter = ethers.keccak256(ethers.toUtf8Bytes("FAKE-SCORECARD-001"));
      await registry.connect(attacker).registerFacility(0, 50, fakeMeter, 58000000, 24000000, "EE");
      const attackFacilityId = await registry.nextFacilityId() - 1n;
      await registry.verifyFacility(attackFacilityId);
      totalAttempted++;
      try {
        await stakeSlash.connect(attacker).stake(attackFacilityId);
        totalSucceeded++;
      } catch (e) { /* blocked */ }

      // Attack 5: EnergyProofEngine without operator role
      totalAttempted++;
      try {
        await energyProofEngine.connect(attacker).processReport(1, now - 3600, now);
        totalSucceeded++;
      } catch (e) { /* blocked */ }

      expect(totalAttempted).to.be.gte(8);
      expect(totalSucceeded).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 2: Governance Ründaja (Governance Attacker)
  // ═══════════════════════════════════════════════════════════════════

  describe("Agent: Governance Ründaja", function () {

    it("cannot create proposal without enough voting power", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      // Attacker has no JOL, no voting power
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await governance.connect(attacker).propose(
            "Drain treasury",
            "Send all JOL to attacker",
            [attacker.address],
            ["0x"]
          );
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Insufficient voting power to propose (delegate first)"
        }
      }

      // Even with some tokens but below threshold (100k JOL)
      await jolToken.mint(attacker.address, ethers.parseEther("99999"));
      await jolToken.connect(attacker).delegate(attacker.address);
      // Mine a block so delegation takes effect at next block
      await ethers.provider.send("evm_mine");

      attacksAttempted++;
      try {
        await governance.connect(attacker).propose(
          "Almost enough",
          "Just under threshold",
          [attacker.address],
          ["0x"]
        );
        attacksSucceeded++;
      } catch (e) {
        // Expected: still insufficient
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot vote on proposal without delegation (snapshot)", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      // Create a legitimate proposal first
      await jolToken.mint(legitimateProducer.address, ethers.parseEther("200000"));
      await jolToken.connect(legitimateProducer).delegate(legitimateProducer.address);
      await ethers.provider.send("evm_mine");

      await governance.connect(legitimateProducer).propose(
        "Legit Proposal",
        "A real governance proposal",
        [],
        []
      );

      // Attacker gets tokens AFTER proposal (snapshot already taken)
      await jolToken.mint(attacker.address, ethers.parseEther("100000"));
      // Attacker does NOT delegate — no voting power in snapshot

      attacksAttempted++;
      try {
        await governance.connect(attacker).vote(1, true);
        attacksSucceeded++;
      } catch (e) {
        // Expected: "No voting power at snapshot (delegate before proposing)"
      }

      // Attacker delegates NOW (after proposal creation)
      await jolToken.connect(attacker).delegate(attacker.address);
      await ethers.provider.send("evm_mine");

      // Still cannot vote — snapshot was taken at proposal creation block
      attacksAttempted++;
      try {
        await governance.connect(attacker).vote(1, true);
        attacksSucceeded++;
      } catch (e) {
        // Expected: still no voting power at snapshot block
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot execute proposal before timelock expires", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      // Create and pass a proposal
      await jolToken.mint(legitimateProducer.address, ethers.parseEther("500000"));
      await jolToken.connect(legitimateProducer).delegate(legitimateProducer.address);
      await ethers.provider.send("evm_mine");

      await governance.connect(legitimateProducer).propose(
        "Test Timelock",
        "Should require timelock",
        [],
        []
      );

      // Vote
      await governance.connect(legitimateProducer).vote(1, true);

      // Fast-forward past voting period (7 days)
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");

      // Finalize
      await governance.finalize(1);

      // Try to execute immediately (before 2-day timelock)
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await governance.connect(attacker).execute(1);
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Timelock not expired"
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot create proposal with too many targets", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      await jolToken.mint(attacker.address, ethers.parseEther("200000"));
      await jolToken.connect(attacker).delegate(attacker.address);
      await ethers.provider.send("evm_mine");

      // MAX_TARGETS = 10, try with 11
      const targets = Array(11).fill(attacker.address);
      const calldatas = Array(11).fill("0x");

      attacksAttempted++;
      try {
        await governance.connect(attacker).propose(
          "Too many targets",
          "Exceed MAX_TARGETS",
          targets,
          calldatas
        );
        attacksSucceeded++;
      } catch (e) {
        // Expected: "Too many targets"
      }

      // Try with 15
      const targets15 = Array(15).fill(attacker.address);
      const calldatas15 = Array(15).fill("0x");
      attacksAttempted++;
      try {
        await governance.connect(attacker).propose(
          "Way too many",
          "Even more targets",
          targets15,
          calldatas15
        );
        attacksSucceeded++;
      } catch (e) {
        // Expected: "Too many targets"
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot cancel other people's proposals", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      // Legitimate proposal
      await jolToken.mint(legitimateProducer.address, ethers.parseEther("200000"));
      await jolToken.connect(legitimateProducer).delegate(legitimateProducer.address);
      await ethers.provider.send("evm_mine");

      await governance.connect(legitimateProducer).propose(
        "Producer Proposal",
        "Only producer can cancel",
        [],
        []
      );

      // Attacker tries to cancel
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await governance.connect(attacker).cancel(1);
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Not authorized"
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("SCORECARD: all governance attacks failed", async function () {
      let totalAttempted = 0;
      let totalSucceeded = 0;

      // Attack 1: propose without voting power
      totalAttempted++;
      try {
        await governance.connect(attacker).propose("Steal", "Drain", [], []);
        totalSucceeded++;
      } catch (e) { /* blocked */ }

      // Attack 2: propose with too many targets
      await jolToken.mint(attacker.address, ethers.parseEther("200000"));
      await jolToken.connect(attacker).delegate(attacker.address);
      await ethers.provider.send("evm_mine");

      totalAttempted++;
      try {
        await governance.connect(attacker).propose(
          "Overflow", "11 targets",
          Array(11).fill(attacker.address), Array(11).fill("0x")
        );
        totalSucceeded++;
      } catch (e) { /* blocked */ }

      // Create a legit proposal for further attacks
      await jolToken.mint(legitimateProducer.address, ethers.parseEther("200000"));
      await jolToken.connect(legitimateProducer).delegate(legitimateProducer.address);
      await ethers.provider.send("evm_mine");

      await governance.connect(legitimateProducer).propose("Legit", "Test", [], []);

      // Attack 3: cancel someone else's proposal
      totalAttempted++;
      try {
        await governance.connect(attacker).cancel(1);
        totalSucceeded++;
      } catch (e) { /* blocked */ }

      // Attack 4: vote and pass, then execute before timelock
      await governance.connect(legitimateProducer).vote(1, true);
      await ethers.provider.send("evm_increaseTime", [7 * 86400 + 1]);
      await ethers.provider.send("evm_mine");
      await governance.finalize(1);

      totalAttempted++;
      try {
        await governance.connect(attacker).execute(1);
        totalSucceeded++;
      } catch (e) { /* blocked — timelock */ }

      expect(totalAttempted).to.be.gte(4);
      expect(totalSucceeded).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 3: Lazy Oracle
  // ═══════════════════════════════════════════════════════════════════

  describe("Agent: Lazy Oracle", function () {

    it("cannot submit report after window closes (1h)", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const periodStart = now - 7200;
      const periodEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("weather"));

      // Oracle1 creates the report
      await oracleConsensus.connect(legitimateOracle1).submitReport(
        1, periodStart, periodEnd, 10, weatherHash
      );

      // Fast-forward past the 1-hour report window
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      // Lazy oracle tries to submit after window closed
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await oracleConsensus.connect(legitimateOracle2).submitReport(
            1, periodStart, periodEnd, 10, weatherHash
          );
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Report window closed"
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot submit duplicate reports for same period", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const periodStart = now - 7200;
      const periodEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("weather"));

      // First submission (legitimate)
      await oracleConsensus.connect(legitimateOracle1).submitReport(
        1, periodStart, periodEnd, 10, weatherHash
      );

      // Try to submit again from same oracle
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await oracleConsensus.connect(legitimateOracle1).submitReport(
            1, periodStart, periodEnd, 15, weatherHash
          );
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Already submitted"
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("gets slashed for wildly different value (>5% deviation)", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      // Facility #1: 50 kW solar in Tallinn, 2h period
      // Registry recordProduction max = 50 kW * 7200s / 3600 = 100 kWh
      // We need two oracles to submit values where one deviates >5% from median
      // With quorum=2, median of [a, b] sorted = the larger value (index 1)
      // So if oracle1 submits 20, oracle3 submits 30:
      //   sorted=[20,30], median=30. deviation of 20 from 30 = 33% > 5% → slash oracle1
      // Both values must be <= 100 kWh to pass registry capacity check

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const periodStart = now - 7200;
      const periodEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("weather-slash"));

      const stakeBefore = (await oracleConsensus.oracles(legitimateOracle1.address)).stake;

      // Oracle1 submits 20 kWh (will be the outlier relative to median)
      await oracleConsensus.connect(legitimateOracle1).submitReport(
        1, periodStart, periodEnd, 20, weatherHash
      );

      // Oracle3 submits 30 kWh — quorum reached, finalized
      // sorted=[20, 30], median=30 (index 1)
      // Oracle1: deviation from 30 = (30-20)*10000/30 = 3333 bps = 33% > 5% → SLASHED
      // Oracle3: deviation from 30 = 0% → accepted
      await oracleConsensus.connect(legitimateOracle3).submitReport(
        1, periodStart, periodEnd, 30, weatherHash
      );

      const stakeAfter = (await oracleConsensus.oracles(legitimateOracle1.address)).stake;
      const totalSlashed = await oracleConsensus.totalSlashed();

      // Verify slashing occurred — the outlier oracle got slashed
      attacksAttempted++;
      if (totalSlashed > 0n && stakeAfter < stakeBefore) {
        // Slash mechanism is working
      } else {
        attacksSucceeded++; // BAD — no slashing means broken protection
      }

      expect(totalSlashed).to.be.gt(0);
      expect(stakeAfter).to.be.lt(stakeBefore);
      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot reach quorum with only 1 oracle (quorum enforced)", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const uniqueStart = now - 900;
      const uniqueEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("weather-single"));

      // Only one oracle submits
      await oracleConsensus.connect(legitimateOracle1).submitReport(
        1, uniqueStart, uniqueEnd, 50, weatherHash
      );

      // Check the report — should NOT be finalized
      const reportId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "uint256", "uint256"],
          [1, uniqueStart, uniqueEnd]
        )
      );
      // Actually the reportId is keccak256(abi.encodePacked(...))
      const reportIdPacked = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256"],
        [1, uniqueStart, uniqueEnd]
      );

      const report = await oracleConsensus.reports(reportIdPacked);

      attacksAttempted++;
      if (report.finalized) {
        attacksSucceeded++; // BAD — should not finalize with 1 oracle
      }

      attacksAttempted++;
      // Verify quorum requires at least 2
      expect(report.finalized).to.equal(false);

      expect(attacksSucceeded).to.equal(0);
    });

    it("SCORECARD: all lazy oracle attacks blocked", async function () {
      let totalAttempted = 0;
      let totalSucceeded = 0;

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("lazy-oracle"));

      // Attack 1: late submission
      const ps1 = now - 7200;
      const pe1 = now - 3601;
      await oracleConsensus.connect(legitimateOracle1).submitReport(1, ps1, pe1, 10, weatherHash);
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      totalAttempted++;
      try {
        await oracleConsensus.connect(legitimateOracle2).submitReport(1, ps1, pe1, 10, weatherHash);
        totalSucceeded++;
      } catch (e) { /* blocked — window closed */ }

      // Attack 2: duplicate submission
      const now2 = (await ethers.provider.getBlock("latest")).timestamp;
      const ps2 = now2 - 1800;
      const pe2 = now2;
      await oracleConsensus.connect(legitimateOracle1).submitReport(1, ps2, pe2, 10, weatherHash);

      totalAttempted++;
      try {
        await oracleConsensus.connect(legitimateOracle1).submitReport(1, ps2, pe2, 12, weatherHash);
        totalSucceeded++;
      } catch (e) { /* blocked — already submitted */ }

      // Attack 3: single oracle cannot finalize
      const now3 = (await ethers.provider.getBlock("latest")).timestamp;
      const ps3 = now3 - 600;
      const pe3 = now3;
      await oracleConsensus.connect(legitimateOracle3).submitReport(1, ps3, pe3, 20, weatherHash);
      const rid3 = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256"], [1, ps3, pe3]
      );
      const rpt3 = await oracleConsensus.reports(rid3);
      totalAttempted++;
      if (rpt3.finalized) totalSucceeded++;

      expect(totalAttempted).to.be.gte(3);
      expect(totalSucceeded).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 4: Treasury Raider
  // ═══════════════════════════════════════════════════════════════════

  describe("Agent: Treasury Raider", function () {

    it("cannot call fundTreasury without admin role", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await ecosystemTreasury.connect(attacker).fundTreasury(ethers.parseEther("1000000"));
          attacksSucceeded++;
        } catch (e) {
          // Expected: AccessControl revert
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot call executeSpend without governance role", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      // Fund treasury legitimately first
      await ecosystemTreasury.fundTreasury(ethers.parseEther("100000"));

      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await ecosystemTreasury.connect(attacker).executeSpend(
            attacker.address,
            ethers.parseEther("50000"),
            "steal everything"
          );
          attacksSucceeded++;
        } catch (e) {
          // Expected: AccessControl revert (no GOVERNANCE_ROLE)
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot drain treasury past insurance reserve", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      // Fund treasury and set insurance reserve
      await ecosystemTreasury.fundTreasury(ethers.parseEther("100000"));

      const GOVERNANCE_ROLE = await ecosystemTreasury.GOVERNANCE_ROLE();
      await ecosystemTreasury.grantRole(GOVERNANCE_ROLE, admin.address);

      // Set up insurance reserve
      await ecosystemTreasury.fundInsurance(ethers.parseEther("50000"));

      // Try to spend more than balance minus insurance reserve
      // Balance = 100k, insurance = 50k, max spendable = 50k
      attacksAttempted++;
      try {
        await ecosystemTreasury.executeSpend(
          attacker.address,
          ethers.parseEther("60000"), // exceeds 50k available
          "drain past insurance"
        );
        attacksSucceeded++;
      } catch (e) {
        // Expected: "Insufficient treasury (insurance reserved)"
      }

      // Try to drain all
      attacksAttempted++;
      try {
        await ecosystemTreasury.executeSpend(
          attacker.address,
          ethers.parseEther("100000"),
          "drain everything"
        );
        attacksSucceeded++;
      } catch (e) {
        // Expected: "Insufficient treasury (insurance reserved)"
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot execute insurance payout without timelock", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      // Fund and set up insurance
      await ecosystemTreasury.fundTreasury(ethers.parseEther("100000"));
      const GOVERNANCE_ROLE = await ecosystemTreasury.GOVERNANCE_ROLE();
      await ecosystemTreasury.grantRole(GOVERNANCE_ROLE, admin.address);
      await ecosystemTreasury.fundInsurance(ethers.parseEther("50000"));

      // Request insurance payout
      await ecosystemTreasury.requestInsurancePayout(
        attacker.address,
        ethers.parseEther("10000"),
        "Hack compensation"
      );

      // Try to execute immediately (before 7-day timelock)
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await ecosystemTreasury.executeInsurancePayout(1);
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Timelock not expired"
        }
      }

      // Try after 6 days (still too early)
      await ethers.provider.send("evm_increaseTime", [6 * 86400]);
      await ethers.provider.send("evm_mine");

      attacksAttempted++;
      try {
        await ecosystemTreasury.executeInsurancePayout(1);
        attacksSucceeded++;
      } catch (e) {
        // Expected: "Timelock not expired" (need 7 days)
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot create bounty without governance role", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await ecosystemTreasury.connect(attacker).createBounty(
            "Fake bounty for self-payment",
            ethers.parseEther("100000")
          );
          attacksSucceeded++;
        } catch (e) {
          // Expected: AccessControl revert (no GOVERNANCE_ROLE)
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("SCORECARD: all treasury raids failed", async function () {
      let totalAttempted = 0;
      let totalSucceeded = 0;

      // Fund treasury
      await ecosystemTreasury.fundTreasury(ethers.parseEther("100000"));
      const GOVERNANCE_ROLE = await ecosystemTreasury.GOVERNANCE_ROLE();
      await ecosystemTreasury.grantRole(GOVERNANCE_ROLE, admin.address);
      await ecosystemTreasury.fundInsurance(ethers.parseEther("50000"));

      // Attack 1: fundTreasury without admin
      totalAttempted++;
      try {
        await ecosystemTreasury.connect(attacker).fundTreasury(ethers.parseEther("1"));
        totalSucceeded++;
      } catch (e) { /* blocked */ }

      // Attack 2: executeSpend without governance
      totalAttempted++;
      try {
        await ecosystemTreasury.connect(attacker).executeSpend(attacker.address, ethers.parseEther("1"), "steal");
        totalSucceeded++;
      } catch (e) { /* blocked */ }

      // Attack 3: drain past insurance reserve
      totalAttempted++;
      try {
        await ecosystemTreasury.executeSpend(attacker.address, ethers.parseEther("60000"), "drain");
        totalSucceeded++;
      } catch (e) { /* blocked */ }

      // Attack 4: insurance payout without timelock
      await ecosystemTreasury.requestInsurancePayout(otherUser.address, ethers.parseEther("1000"), "Test");
      totalAttempted++;
      try {
        await ecosystemTreasury.executeInsurancePayout(1);
        totalSucceeded++;
      } catch (e) { /* blocked — timelock */ }

      // Attack 5: create bounty without governance
      totalAttempted++;
      try {
        await ecosystemTreasury.connect(attacker).createBounty("fake", ethers.parseEther("1000"));
        totalSucceeded++;
      } catch (e) { /* blocked */ }

      expect(totalAttempted).to.be.gte(5);
      expect(totalSucceeded).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SCENARIO 5: Replay Attacker
  // ═══════════════════════════════════════════════════════════════════

  describe("Agent: Replay Attacker", function () {

    it("cannot process same oracle report twice through EnergyProofEngine", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const periodStart = now - 7200;
      const periodEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("weather-replay"));

      // Create and finalize an oracle report
      await oracleConsensus.connect(legitimateOracle1).submitReport(
        1, periodStart, periodEnd, 10, weatherHash
      );
      await oracleConsensus.connect(legitimateOracle2).submitReport(
        1, periodStart, periodEnd, 10, weatherHash
      );

      // First call to processReport — this will either succeed or be rejected by layers
      // (likely rejected because facility not staked, but it still marks processedReports)
      try {
        await energyProofEngine.processReport(1, periodStart, periodEnd);
      } catch (e) {
        // May fail on some layer, but the report might be marked as processed
      }

      // Check if it was processed/rejected
      const isProcessed = await energyProofEngine.isProcessed(1, periodStart, periodEnd);

      // Try to process the SAME report again
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await energyProofEngine.processReport(1, periodStart, periodEnd);
          // If this succeeds without revert, it's a replay!
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Report already processed"
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot use same ethTxHash in bridge twice", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      // Fund bridge with native ETH
      await admin.sendTransaction({ to: bridgeLock.target, value: ethers.parseEther("100") });

      const txHash = ethers.keccak256(ethers.toUtf8Bytes("eth-tx-0x123abc"));

      // 3 validators confirm unlock #1 — this should execute
      await bridgeLock.connect(legitimateOracle1).confirmUnlock(
        1, otherUser.address, ethers.parseEther("1"), txHash
      );
      await bridgeLock.connect(legitimateOracle2).confirmUnlock(
        1, otherUser.address, ethers.parseEther("1"), txHash
      );
      await bridgeLock.connect(legitimateOracle3).confirmUnlock(
        1, otherUser.address, ethers.parseEther("1"), txHash
      );

      // Verify the tx hash is now marked as processed
      expect(await bridgeLock.processedEthTxHashes(txHash)).to.equal(true);

      // Try to replay with same txHash for a new unlock request
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await bridgeLock.connect(legitimateOracle1).confirmUnlock(
            2, attacker.address, ethers.parseEther("50"), txHash
          );
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Already processed"
        }
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot vote twice on same governance proposal", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      // Create a legitimate proposal
      await jolToken.mint(legitimateProducer.address, ethers.parseEther("200000"));
      await jolToken.connect(legitimateProducer).delegate(legitimateProducer.address);
      await ethers.provider.send("evm_mine");

      await governance.connect(legitimateProducer).propose(
        "Test Replay Vote",
        "Cannot vote twice",
        [],
        []
      );

      // First vote (legitimate)
      await governance.connect(legitimateProducer).vote(1, true);

      // Try to vote again
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await governance.connect(legitimateProducer).vote(1, true);
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Already voted"
        }
      }

      // Try voting with opposite direction
      attacksAttempted++;
      try {
        await governance.connect(legitimateProducer).vote(1, false);
        attacksSucceeded++;
      } catch (e) {
        // Expected: "Already voted"
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("cannot submit same oracle report twice", async function () {
      let attacksAttempted = 0;
      let attacksSucceeded = 0;

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const periodStart = now - 7200;
      const periodEnd = now;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("weather-dup"));

      // First submission
      await oracleConsensus.connect(legitimateOracle1).submitReport(
        1, periodStart, periodEnd, 10, weatherHash
      );

      // Try to submit again from same oracle
      for (let i = 0; i < 3; i++) {
        attacksAttempted++;
        try {
          await oracleConsensus.connect(legitimateOracle1).submitReport(
            1, periodStart, periodEnd, 10, weatherHash
          );
          attacksSucceeded++;
        } catch (e) {
          // Expected: "Already submitted"
        }
      }

      // Also try after finalization — different oracle trying to add to finalized report
      await oracleConsensus.connect(legitimateOracle2).submitReport(
        1, periodStart, periodEnd, 10, weatherHash
      );
      // Now finalized (quorum=2 reached)

      attacksAttempted++;
      try {
        await oracleConsensus.connect(legitimateOracle3).submitReport(
          1, periodStart, periodEnd, 10, weatherHash
        );
        attacksSucceeded++;
      } catch (e) {
        // Expected: "Already finalized"
      }

      expect(attacksSucceeded).to.equal(0);
    });

    it("SCORECARD: all replay attacks failed", async function () {
      let totalAttempted = 0;
      let totalSucceeded = 0;

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const weatherHash = ethers.keccak256(ethers.toUtf8Bytes("replay-scorecard"));

      // Attack 1: duplicate oracle submission
      const ps1 = now - 7200;
      const pe1 = now - 3601;
      await oracleConsensus.connect(legitimateOracle1).submitReport(1, ps1, pe1, 10, weatherHash);
      totalAttempted++;
      try {
        await oracleConsensus.connect(legitimateOracle1).submitReport(1, ps1, pe1, 10, weatherHash);
        totalSucceeded++;
      } catch (e) { /* blocked — already submitted */ }

      // Attack 2: submit to finalized report
      await oracleConsensus.connect(legitimateOracle2).submitReport(1, ps1, pe1, 10, weatherHash);
      // Now finalized
      totalAttempted++;
      try {
        await oracleConsensus.connect(legitimateOracle3).submitReport(1, ps1, pe1, 10, weatherHash);
        totalSucceeded++;
      } catch (e) { /* blocked — already finalized */ }

      // Attack 3: double-process through EnergyProofEngine
      try {
        await energyProofEngine.processReport(1, ps1, pe1);
      } catch (e) { /* may fail on layer checks */ }
      totalAttempted++;
      try {
        await energyProofEngine.processReport(1, ps1, pe1);
        totalSucceeded++;
      } catch (e) { /* blocked — already processed */ }

      // Attack 4: bridge replay
      await admin.sendTransaction({ to: bridgeLock.target, value: ethers.parseEther("10") });
      const txHash = ethers.keccak256(ethers.toUtf8Bytes("replay-bridge"));
      await bridgeLock.connect(legitimateOracle1).confirmUnlock(1, otherUser.address, ethers.parseEther("1"), txHash);
      await bridgeLock.connect(legitimateOracle2).confirmUnlock(1, otherUser.address, ethers.parseEther("1"), txHash);
      await bridgeLock.connect(legitimateOracle3).confirmUnlock(1, otherUser.address, ethers.parseEther("1"), txHash);
      totalAttempted++;
      try {
        await bridgeLock.connect(legitimateOracle1).confirmUnlock(2, attacker.address, ethers.parseEther("5"), txHash);
        totalSucceeded++;
      } catch (e) { /* blocked — already processed */ }

      // Attack 5: double vote on governance
      await jolToken.mint(legitimateProducer.address, ethers.parseEther("200000"));
      await jolToken.connect(legitimateProducer).delegate(legitimateProducer.address);
      await ethers.provider.send("evm_mine");
      await governance.connect(legitimateProducer).propose("Test", "Replay", [], []);
      await governance.connect(legitimateProducer).vote(1, true);
      totalAttempted++;
      try {
        await governance.connect(legitimateProducer).vote(1, true);
        totalSucceeded++;
      } catch (e) { /* blocked — already voted */ }

      expect(totalAttempted).to.be.gte(5);
      expect(totalSucceeded).to.equal(0);
    });
  });
});
