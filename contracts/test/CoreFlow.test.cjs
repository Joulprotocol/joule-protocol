const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * JOULE Core Flow Tests
 *
 * Tests the full lifecycle:
 * 1. Token mint/burn/supply cap
 * 2. Energy registration → verification → production
 * 3. PoE mining rewards
 * 4. Energy peg (1 JOL = 1 kWh)
 * 5. Payment channels (micropayments)
 * 6. Streaming payments (per-second)
 * 7. Agent wallets (AI autonomous spending)
 * 8. Carbon credits (NFT issuance + retirement)
 * 9. Machine identity + reputation
 * 10. Marketplace (P2P trading + burn)
 */

describe("JOULE Core Flow", function () {
  let jolToken, registry, poeMining, oracle, governance;
  let energyPeg, machineReg, payChannel, streaming, carbon, agentWallet, marketplace;
  let owner, producer, miner, aiAgent, buyer, oracleNode1, oracleNode2, oracleNode3;

  beforeEach(async function () {
    [owner, producer, miner, aiAgent, buyer, oracleNode1, oracleNode2, oracleNode3] =
      await ethers.getSigners();

    // Deploy core
    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(owner.address);

    const PoEMining = await ethers.getContractFactory("PoEMining");
    poeMining = await PoEMining.deploy(owner.address, jolToken.target, registry.target);

    const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
    oracle = await OracleConsensus.deploy(owner.address, jolToken.target, registry.target, owner.address);

    const Governance = await ethers.getContractFactory("Governance");
    governance = await Governance.deploy(owner.address, jolToken.target);

    // Deploy EnergyPeg before Marketplace (Marketplace references it)
    const EnergyPeg = await ethers.getContractFactory("EnergyPeg");
    energyPeg = await EnergyPeg.deploy(owner.address, jolToken.target);

    const EnergyMarketplace = await ethers.getContractFactory("EnergyMarketplace");
    marketplace = await EnergyMarketplace.deploy(owner.address, jolToken.target, energyPeg.target);

    // Deploy machine economy layer

    const MachineRegistry = await ethers.getContractFactory("MachineRegistry");
    machineReg = await MachineRegistry.deploy(owner.address);

    const PaymentChannel = await ethers.getContractFactory("PaymentChannel");
    payChannel = await PaymentChannel.deploy(jolToken.target);

    const StreamingPayments = await ethers.getContractFactory("StreamingPayments");
    streaming = await StreamingPayments.deploy(jolToken.target);

    const CarbonCredit = await ethers.getContractFactory("CarbonCredit");
    carbon = await CarbonCredit.deploy(owner.address);

    const AgentWallet = await ethers.getContractFactory("AgentWallet");
    agentWallet = await AgentWallet.deploy(jolToken.target, machineReg.target);

    // Configure roles
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    const BURNER_ROLE = await jolToken.BURNER_ROLE();
    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();
    const ORACLE_ROLE = await poeMining.ORACLE_ROLE();
    const CARBON_MINTER = await carbon.MINTER_ROLE();

    await jolToken.grantRole(MINTER_ROLE, owner.address);
    await jolToken.grantRole(MINTER_ROLE, poeMining.target);
    await jolToken.grantRole(MINTER_ROLE, energyPeg.target);
    await jolToken.grantRole(BURNER_ROLE, marketplace.target);
    await jolToken.grantRole(BURNER_ROLE, energyPeg.target);
    await registry.grantRole(VERIFIER_ROLE, oracle.target);
    await registry.grantRole(VERIFIER_ROLE, owner.address);
    await poeMining.grantRole(ORACLE_ROLE, oracle.target);
    await oracle.setPoEMining(poeMining.target);
    await carbon.grantRole(CARBON_MINTER, owner.address);

    // Grant RECORDER_ROLE to AgentWallet so it can record machine transactions
    const RECORDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("RECORDER_ROLE"));
    await machineReg.grantRole(RECORDER_ROLE, agentWallet.target);

    // Give oracle role to energyPeg for production recording
    await registry.grantRole(VERIFIER_ROLE, energyPeg.target);
  });

  // ─── 1. Token ──────────────────────────────────────────────

  describe("1. JOL Token", function () {
    it("has 210B max supply", async function () {
      expect(await jolToken.MAX_SUPPLY()).to.equal(ethers.parseEther("210000000"));
    });

    it("mints and burns correctly", async function () {
      await jolToken.mint(miner.address, ethers.parseEther("1000"));
      expect(await jolToken.balanceOf(miner.address)).to.equal(ethers.parseEther("1000"));

      await jolToken.connect(miner).burn(ethers.parseEther("200"));
      expect(await jolToken.balanceOf(miner.address)).to.equal(ethers.parseEther("800"));
      expect(await jolToken.totalBurned()).to.equal(ethers.parseEther("200"));
    });

    it("enforces max supply", async function () {
      const max = await jolToken.MAX_SUPPLY();
      await expect(jolToken.mint(miner.address, max + 1n)).to.be.revertedWith("JOL: exceeds max supply");
    });
  });

  // ─── 2. Energy Registration ────────────────────────────────

  describe("2. Energy Registration + Verification", function () {
    it("registers solar facility", async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("SHELLY-001"));
      await registry.connect(producer).registerFacility(0, 50, meterId, 58381000, 24655000, "EE");

      const facility = await registry.facilities(1);
      expect(facility.owner).to.equal(producer.address);
      expect(facility.capacityKW).to.equal(50);
      expect(facility.status).to.equal(0); // Pending
    });

    it("verifies and records production", async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("SHELLY-002"));
      await registry.connect(producer).registerFacility(1, 100, meterId, 0, 0, "EE"); // Wind
      await registry.connect(owner).verifyFacility(1);

      const facility = await registry.facilities(1);
      expect(facility.status).to.equal(1); // Verified

      const now = (await ethers.provider.getBlock("latest")).timestamp;
      // 100 kW × 2 hours = 200 kWh max
      await registry.connect(owner).recordProduction(1, 150, now - 7200, now);

      const updated = await registry.facilities(1);
      expect(updated.totalVerifiedKWh).to.equal(150);
    });

    it("rejects fossil fuel types (only 0-3 allowed)", async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("COAL-001"));
      // FacilityType enum: 0=Solar, 1=Wind, 2=Hydro, 3=Geothermal
      // Anything >= 4 should revert
      await expect(
        registry.connect(producer).registerFacility(4, 100, meterId, 0, 0, "EE")
      ).to.be.reverted;
    });
  });

  // ─── 3. Energy Peg (1 JOL = 1 kWh) ───────────────────────

  describe("3. Energy Peg", function () {
    it("deposits energy and mints JOL 1:1", async function () {
      // Register producer in peg
      await energyPeg.connect(producer).registerProducer("Solar Farm", "EE", "solar");

      // Oracle deposits verified energy
      const ORACLE_ROLE = await energyPeg.ORACLE_ROLE();
      await energyPeg.grantRole(ORACLE_ROLE, owner.address);

      await energyPeg.depositEnergy(producer.address, 100); // 100 kWh

      // Producer should have 100 JOL
      expect(await jolToken.balanceOf(producer.address)).to.equal(ethers.parseEther("100"));
      expect(await energyPeg.totalEnergyReserveKWh()).to.equal(100);
    });

    it("reports floor price", async function () {
      expect(await energyPeg.floorPriceUSDCents()).to.equal(25); // $0.25
    });
  });

  // ─── 4. Payment Channels ──────────────────────────────────

  describe("4. Payment Channels (Micropayments)", function () {
    beforeEach(async function () {
      // Give buyer some JOL
      await jolToken.mint(buyer.address, ethers.parseEther("100"));
    });

    it("opens channel, signs off-chain, closes with settlement", async function () {
      const deposit = ethers.parseEther("10");

      // Approve and open channel
      await jolToken.connect(buyer).approve(payChannel.target, deposit);
      await payChannel.connect(buyer).openChannel(producer.address, deposit, 3600);

      const channel = await payChannel.channels(1);
      expect(channel.sender).to.equal(buyer.address);
      expect(channel.receiver).to.equal(producer.address);
      expect(channel.deposit).to.equal(deposit);
      expect(channel.open).to.be.true;

      // Sign off-chain payment
      const payAmount = ethers.parseEther("3");
      const hash = await payChannel.getMessageHash(1, payAmount);
      const sig = await buyer.signMessage(ethers.getBytes(hash));

      // Receiver closes with proof
      await payChannel.connect(producer).closeChannel(1, payAmount, sig);

      // Check balances
      expect(await jolToken.balanceOf(producer.address)).to.equal(payAmount);
      expect(await jolToken.balanceOf(buyer.address)).to.equal(ethers.parseEther("97")); // 100 - 10 + 7 refund
    });
  });

  // ─── 5. Streaming Payments ────────────────────────────────

  describe("5. Streaming Payments (Per-Second)", function () {
    beforeEach(async function () {
      await jolToken.mint(buyer.address, ethers.parseEther("1000"));
    });

    it("creates stream and receiver can withdraw", async function () {
      const deposit = ethers.parseEther("100");
      const rate = ethers.parseEther("1"); // 1 JOL/second

      await jolToken.connect(buyer).approve(streaming.target, deposit);
      await streaming.connect(buyer).createStream(producer.address, rate, deposit);

      expect(await streaming.activeStreams()).to.equal(1);

      // Advance time 10 seconds
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      // Check available balance (~10 JOL minus fee)
      const available = await streaming.getAvailableBalance(1);
      expect(available).to.be.gt(ethers.parseEther("9"));

      // Withdraw
      await streaming.connect(producer).withdrawFromStream(1);
      const balance = await jolToken.balanceOf(producer.address);
      expect(balance).to.be.gt(ethers.parseEther("9"));
    });

    it("stops stream and refunds sender", async function () {
      const deposit = ethers.parseEther("100");
      const rate = ethers.parseEther("1");

      await jolToken.connect(buyer).approve(streaming.target, deposit);
      await streaming.connect(buyer).createStream(producer.address, rate, deposit);

      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine");

      await streaming.connect(buyer).stopStream(1);

      // Buyer should get most back, producer gets ~5 JOL
      const buyerBal = await jolToken.balanceOf(buyer.address);
      expect(buyerBal).to.be.gt(ethers.parseEther("990")); // got refund
    });
  });

  // ─── 6. Agent Wallets ─────────────────────────────────────

  describe("6. AI Agent Wallets", function () {
    beforeEach(async function () {
      await jolToken.mint(owner.address, ethers.parseEther("1000"));
    });

    it("creates wallet with limits and agent spends within them", async function () {
      // Owner creates wallet for AI agent
      await agentWallet.createWallet(
        aiAgent.address,
        ethers.parseEther("10"),   // max 10 JOL per tx
        ethers.parseEther("100"),  // max 100 JOL daily
        ethers.parseEther("1000")  // max 1000 JOL monthly
      );

      // Fund it
      await jolToken.approve(agentWallet.target, ethers.parseEther("500"));
      await agentWallet.fundWallet(1, ethers.parseEther("500"));

      // Agent spends
      await agentWallet.connect(aiAgent).agentSpend(
        producer.address,
        ethers.parseEther("5"),
        "compute-inference"
      );

      expect(await jolToken.balanceOf(producer.address)).to.equal(ethers.parseEther("5"));
    });

    it("rejects spend over per-tx limit", async function () {
      await agentWallet.createWallet(
        aiAgent.address,
        ethers.parseEther("10"),
        ethers.parseEther("100"),
        ethers.parseEther("1000")
      );
      await jolToken.approve(agentWallet.target, ethers.parseEther("500"));
      await agentWallet.fundWallet(1, ethers.parseEther("500"));

      await expect(
        agentWallet.connect(aiAgent).agentSpend(producer.address, ethers.parseEther("50"), "too much")
      ).to.be.revertedWith("Exceeds per-tx limit");
    });

    it("owner can freeze wallet", async function () {
      await agentWallet.createWallet(
        aiAgent.address,
        ethers.parseEther("10"),
        ethers.parseEther("100"),
        ethers.parseEther("1000")
      );
      await jolToken.approve(agentWallet.target, ethers.parseEther("100"));
      await agentWallet.fundWallet(1, ethers.parseEther("100"));

      // Freeze
      await agentWallet.freezeWallet(1);

      // Agent can't spend
      await expect(
        agentWallet.connect(aiAgent).agentSpend(producer.address, ethers.parseEther("1"), "frozen")
      ).to.be.revertedWith("Wallet frozen or inactive");
    });
  });

  // ─── 7. Carbon Credits ────────────────────────────────────

  describe("7. Carbon Credits (NFT)", function () {
    it("issues carbon credit NFT from verified energy", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;

      await carbon.issueCredit(
        producer.address,
        10000,     // 10,000 kWh
        "solar",
        "EE",
        now - 86400,
        now
      );

      expect(await carbon.ownerOf(1)).to.equal(producer.address);
      expect(await carbon.totalCreditsIssued()).to.equal(1);
      expect(await carbon.totalKWhCertified()).to.equal(10000);

      // CO2 avoided: 10000 kWh × 230,000 mg/kWh = 2,300,000,000 mg = 2,300,000 g / 1000 = 2300 kg
      expect(await carbon.totalCO2AvoidedKg()).to.equal(2300);
    });

    it("retires credit (cannot transfer after)", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      await carbon.issueCredit(producer.address, 5000, "wind", "EE", now - 3600, now);

      await carbon.connect(producer).retireCredit(1, "ESG compliance 2026");

      expect(await carbon.totalCreditsRetired()).to.equal(1);

      // Can't transfer retired credit
      await expect(
        carbon.connect(producer).transferFrom(producer.address, buyer.address, 1)
      ).to.be.revertedWith("Retired credit cannot be transferred");
    });
  });

  // ─── 8. Machine Identity ──────────────────────────────────

  describe("8. Machine Registry + Reputation", function () {
    it("registers and verifies a machine", async function () {
      const firmware = ethers.keccak256(ethers.toUtf8Bytes("firmware-v1.0"));
      const VERIFIER = await machineReg.VERIFIER_ROLE();
      await machineReg.grantRole(VERIFIER, owner.address);

      await machineReg.connect(producer).registerMachine(
        aiAgent.address,  // machine wallet
        6,                // AIAgent type
        "Anthropic",
        "Claude-v4",
        firmware,
        58381000,
        24655000
      );

      expect(await machineReg.totalMachines()).to.equal(1);

      await machineReg.verifyMachine(1);
      expect(await machineReg.isVerified(aiAgent.address)).to.be.true;
      expect(await machineReg.getReputation(aiAgent.address)).to.equal(5000); // 50% starting
    });
  });

  // ─── 9. Marketplace + Burn ────────────────────────────────

  describe("9. Energy Marketplace (P2P + Burn)", function () {
    beforeEach(async function () {
      await jolToken.mint(producer.address, ethers.parseEther("1000"));
      await jolToken.mint(buyer.address, ethers.parseEther("1000"));
    });

    it("creates listing, buyer purchases, fees burned", async function () {
      // Register producer in EnergyPeg and give credits via oracle
      await energyPeg.connect(producer).registerProducer("Test Solar", "EE", "solar");
      const ORACLE_ROLE = await energyPeg.ORACLE_ROLE();
      await energyPeg.grantRole(ORACLE_ROLE, owner.address);
      await energyPeg.depositEnergy(producer.address, 200); // 200 kWh credits

      // Producer lists 100 kWh at 1 JOL/kWh
      await marketplace.connect(producer).createListing(
        100,
        ethers.parseEther("1"),
        "solar",
        "EE"
      );

      // Buyer approves and buys 50 kWh
      const totalPrice = ethers.parseEther("50");
      await jolToken.connect(buyer).approve(marketplace.target, totalPrice);
      await marketplace.connect(buyer).buy(1, 50);

      // Check burns happened (1.5% of 50 = 0.75 JOL burned)
      expect(await marketplace.totalBurned()).to.be.gt(0);
      expect(await marketplace.totalTrades()).to.equal(1);
    });
  });

  // ─── 10. Full Lifecycle ───────────────────────────────────

  describe("10. Full Lifecycle: Energy → JOL → Payment → Burn", function () {
    it("producer generates energy, earns JOL, AI agent pays, fees burned", async function () {
      // Step 1: Register energy producer in peg
      await energyPeg.connect(producer).registerProducer("Solar Farm Tallinn", "EE", "solar");

      const ORACLE_ROLE = await energyPeg.ORACLE_ROLE();
      await energyPeg.grantRole(ORACLE_ROLE, owner.address);

      // Step 2: Oracle verifies 500 kWh production → 500 JOL minted
      await energyPeg.depositEnergy(producer.address, 500);
      expect(await jolToken.balanceOf(producer.address)).to.equal(ethers.parseEther("500"));

      // Step 3: Producer funds AI agent wallet
      await jolToken.connect(producer).approve(agentWallet.target, ethers.parseEther("100"));
      await agentWallet.connect(producer).createWallet(
        aiAgent.address,
        ethers.parseEther("5"),
        ethers.parseEther("50"),
        ethers.parseEther("200")
      );
      await agentWallet.connect(producer).fundWallet(1, ethers.parseEther("100"));

      // Step 4: AI agent pays for compute
      await agentWallet.connect(aiAgent).agentSpend(
        miner.address,
        ethers.parseEther("2"),
        "gpu-inference-batch-42"
      );

      expect(await jolToken.balanceOf(miner.address)).to.equal(ethers.parseEther("2"));

      // Step 5: Producer lists remaining energy on marketplace
      await marketplace.connect(producer).createListing(
        100,
        ethers.parseEther("1"),
        "solar",
        "EE"
      );

      // Step 6: Buyer purchases energy credits → fees BURNED
      await jolToken.mint(buyer.address, ethers.parseEther("100"));
      await jolToken.connect(buyer).approve(marketplace.target, ethers.parseEther("100"));
      await marketplace.connect(buyer).buy(1, 50);

      // Verify burn happened
      const burned = await marketplace.totalBurned();
      expect(burned).to.be.gt(0);

      // Full cycle complete:
      // Energy produced → JOL minted → AI used it → Marketplace traded → JOL burned
      // Supply decreased. Value preserved. Cycle continues.
    });
  });
});
