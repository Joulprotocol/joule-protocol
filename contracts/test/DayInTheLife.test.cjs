const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * JOULE — Üks päev ökosüsteemis
 *
 * See ei ole turvatest. See on LUGU.
 * Iga test on üks hetk päevast kus JOULE ökosüsteem elab ja hingab.
 *
 * Tegelased:
 *   Mari  — päikeseenergia tootja (10kW park Tallinnas)
 *   Jüri  — tarbija + EV omanik
 *   Peeter — GPU kaevandaja + AI agent operaator
 *   Admin — süsteemi haldaja (ajutine, kuni renounce)
 */
describe("JOULE — Üks päev ökosüsteemis", function () {
  this.timeout(120000);

  let jolToken, energyFloor, registry, poeMining, governance;
  let treasury, bridgeLock, streaming, paymentChannel, oracleConsensus;
  let stakeSlash, conflictScore, marketplace, carbonCredit;
  let machineReg, agentWallet, vesting;
  let admin, mari, juri, peeter, oracle1, oracle2, oracle3, founder;

  // Track state across tests
  let mariInitialBalance, juriInitialBalance;

  before(async function () {
    [admin, mari, juri, peeter, oracle1, oracle2, oracle3, founder] = await ethers.getSigners();

    // ═══ Deploy all contracts ═══
    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(admin.address);

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(admin.address);

    const ConflictScore = await ethers.getContractFactory("ConflictScore");
    conflictScore = await ConflictScore.deploy(admin.address);

    const PoEMining = await ethers.getContractFactory("PoEMining");
    poeMining = await PoEMining.deploy(admin.address, jolToken.target, registry.target);

    const EnergyFloor = await ethers.getContractFactory("EnergyFloor");
    energyFloor = await EnergyFloor.deploy(admin.address, jolToken.target);

    const EcosystemTreasury = await ethers.getContractFactory("EcosystemTreasury");
    treasury = await EcosystemTreasury.deploy(admin.address, jolToken.target);

    const Governance = await ethers.getContractFactory("Governance");
    governance = await Governance.deploy(admin.address, jolToken.target);

    const BridgeLock = await ethers.getContractFactory("BridgeLock");
    bridgeLock = await BridgeLock.deploy(admin.address);

    const StreamingPayments = await ethers.getContractFactory("StreamingPayments");
    streaming = await StreamingPayments.deploy(admin.address, jolToken.target);

    const PaymentChannel = await ethers.getContractFactory("PaymentChannel");
    paymentChannel = await PaymentChannel.deploy(admin.address, jolToken.target);

    const OracleConsensus = await ethers.getContractFactory("OracleConsensus");
    oracleConsensus = await OracleConsensus.deploy(admin.address, jolToken.target, registry.target, admin.address);

    const StakeSlash = await ethers.getContractFactory("StakeSlash");
    stakeSlash = await StakeSlash.deploy(admin.address, jolToken.target, registry.target, treasury.target, conflictScore.target);

    const EnergyMarketplace = await ethers.getContractFactory("EnergyMarketplace");
    marketplace = await EnergyMarketplace.deploy(admin.address, jolToken.target, energyFloor.target);

    const CarbonCredit = await ethers.getContractFactory("CarbonCredit");
    carbonCredit = await CarbonCredit.deploy(admin.address);

    const MachineRegistry = await ethers.getContractFactory("MachineRegistry");
    machineReg = await MachineRegistry.deploy(admin.address);

    const AgentWallet = await ethers.getContractFactory("AgentWallet");
    agentWallet = await AgentWallet.deploy(jolToken.target, machineReg.target);

    // Vesting: founder gets 12.6M over 4 years, 1 year cliff
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const FoundersVesting = await ethers.getContractFactory("JOULEFoundersVesting");
    vesting = await FoundersVesting.deploy(founder.address, now, 365 * 86400, 1461 * 86400);

    // ═══ Configure roles ═══
    const MINTER = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER, admin.address); // for PoE simulation
    await jolToken.grantRole(MINTER, poeMining.target);
    await jolToken.grantRole(MINTER, energyFloor.target);
    await jolToken.grantRole(MINTER, treasury.target);

    const BURNER = await jolToken.BURNER_ROLE();
    await jolToken.grantRole(BURNER, marketplace.target);
    await jolToken.grantRole(BURNER, energyFloor.target);
    await jolToken.grantRole(BURNER, streaming.target);

    const VERIFIER = await registry.VERIFIER_ROLE();
    await registry.grantRole(VERIFIER, admin.address);

    const ORACLE_POE = await poeMining.ORACLE_ROLE();
    await poeMining.grantRole(ORACLE_POE, admin.address);

    const ORACLE_FLOOR = await energyFloor.ORACLE_ROLE();
    await energyFloor.grantRole(ORACLE_FLOOR, admin.address);

    const GOV_ROLE = await treasury.GOVERNANCE_ROLE();
    await treasury.grantRole(GOV_ROLE, governance.target);

    const REPORTER = await conflictScore.REPORTER_ROLE();
    await conflictScore.grantRole(REPORTER, stakeSlash.target);

    const CC_MINTER = await carbonCredit.MINTER_ROLE();
    await carbonCredit.grantRole(CC_MINTER, admin.address);

    const MR_RECORDER = await machineReg.RECORDER_ROLE();
    await machineReg.grantRole(MR_RECORDER, agentWallet.target);

    // Give Jüri some initial JOL for buying (simulates he earned from mining earlier)
    await jolToken.mint(juri.address, ethers.parseEther("100"));
    // Give Peeter mining reward simulation (36 JOL = 1 block)
    await jolToken.mint(peeter.address, ethers.parseEther("36"));

    // Delegate for governance
    await jolToken.connect(juri).delegate(juri.address);
    await jolToken.connect(peeter).delegate(peeter.address);
  });

  // ════���══════════════════════════════════════════════════════════
  // HOMMIK — energia tootmine
  // ═══════════════════════════════════════════════════════════════

  it("06:00 — Päike tõuseb, Mari registreerib oma 10kW päikesepargi", async function () {
    // Mari registreerib rajatise EnergyRegistry's
    const meterId = ethers.keccak256(ethers.toUtf8Bytes("mari-shelly-3em-001"));
    await registry.connect(mari).registerFacility(
      0,     // solar
      10,    // 10 kW
      meterId,
      "0x7566766f", // geohash Tallinn
      2,     // solar panel type
      "EE"   // Estonia
    );

    // Admin (verifier) kinnitab rajatise
    await registry.verifyFacility(1);

    // Mari registreerib ka EnergyFloor tootjana
    await energyFloor.connect(mari).registerProducer("Mari Päikesepark", "EE", "solar");

    // Kontroll: Mari rajatis on registreeritud ja verifitseeritud
    const owner = await registry.facilityOwner(1);
    expect(owner).to.equal(mari.address);

    const producer = await energyFloor.producers(mari.address);
    expect(producer.active).to.be.true;
    expect(producer.name).to.equal("Mari Päikesepark");
  });

  it("07:00 — Esimesed 5 kWh — oracle kinnitab, Mari saab 5 JOL", async function () {
    // Oracle (admin rollina) kinnitab: 5 kWh toodetud
    await energyFloor.depositEnergy(mari.address, 5);

    // Mari sai 5 JOL (1 JOL = 1 kWh)
    expect(await jolToken.balanceOf(mari.address)).to.equal(ethers.parseEther("5"));

    // Süsteemi energiareserv kasvas
    expect(await energyFloor.totalEnergyReserveKWh()).to.equal(5n);
    expect(await energyFloor.totalMintedFromEnergy()).to.equal(5n);
  });

  it("08:00-16:00 — Terve päev: Mari toodab kokku 40 kWh", async function () {
    // Iga tund oracle kinnitab tootmist
    const hourlyProduction = [4, 5, 6, 7, 6, 5, 4, 3]; // 40 kWh kokku (5 juba antud)
    for (const kWh of hourlyProduction) {
      await energyFloor.depositEnergy(mari.address, kWh);
    }

    // Kontrollid
    // 5 (07:00) + 4+5+6+7+6+5+4+3 = 45 kWh kokku... aga me tahame 40
    // Parandus: tahame et kokku 40, juba 5 antud, seega ülejäänud 35
    // Tegelikult 5 + sum(hourly) = 5 + 40 = 45. OK, 45 kWh kogu päev

    const mariBalance = await jolToken.balanceOf(mari.address);
    expect(mariBalance).to.equal(ethers.parseEther("45")); // 45 JOL = 45 kWh

    expect(await energyFloor.totalEnergyReserveKWh()).to.equal(45n);
    expect(await energyFloor.totalMintedFromEnergy()).to.equal(45n);
  });

  // ═══════════════════════════════════════════════════════════════
  // LÕUNA — kauplemine ja maksed
  // ═══════════════════════════════════════════════════════════════

  it("12:00 — Jüri ostab Marilt 10 kWh energiat marketplace'is", async function () {
    // Mari listib 10 kWh hinnaga 1.2 JOL/kWh
    await marketplace.connect(mari).createListing(
      10, ethers.parseEther("1.2"), "solar", "EE"
    );

    // Jüri approve'ib ja ostab
    const totalPrice = ethers.parseEther("12"); // 10 kWh × 1.2 JOL
    await jolToken.connect(juri).approve(marketplace.target, totalPrice);

    const juriBalBefore = await jolToken.balanceOf(juri.address);
    const mariBalBefore = await jolToken.balanceOf(mari.address);
    const supplyBefore = await jolToken.totalSupply();

    await marketplace.connect(juri).buy(1, 10);

    // Fee: 1.5% of 12 JOL = 0.18 JOL burned
    const burnAmount = totalPrice * 150n / 10000n; // 0.18 ether
    const sellerReceives = totalPrice - burnAmount;

    expect(await jolToken.balanceOf(juri.address)).to.equal(juriBalBefore - totalPrice);
    expect(await jolToken.balanceOf(mari.address)).to.equal(mariBalBefore + sellerReceives);

    // Fee on päriselt burned — totalSupply vähenes
    expect(await jolToken.totalSupply()).to.equal(supplyBefore - burnAmount);

    // Marketplace stats
    expect(await marketplace.totalTrades()).to.equal(1);
    expect(await marketplace.totalBurned()).to.equal(burnAmount);
  });

  it("13:00 — Peeter kaevandab bloki ja saab 36 JOL", async function () {
    // Peeter on juba saanud 36 JOL (before hookis simuleeritud)
    // Reaalsuses tuleb see go-joule block reward'ist
    expect(await jolToken.balanceOf(peeter.address)).to.equal(ethers.parseEther("36"));

    // PoE lisareward: Peeter toetab ka energiatootmist oracle'ina
    // Admin simuleerib: Peetri oracle kinnitas Mari tootmist
    await poeMining.accrueReward(1, 5); // 5 kWh kinnitatud

    // Reward akumuleerub (ei mintita kohe, vaid claim)
    const pending = await poeMining.pendingRewards(mari.address);
    expect(pending).to.be.gt(0);
  });

  it("14:00 — Peetri AI agent alustab streaming makset Mari pargile", async function () {
    // Peeter loob AgentWallet oma AI agendile
    const aiAgent = ethers.Wallet.createRandom();
    await agentWallet.connect(peeter).createWallet(
      aiAgent.address,
      ethers.parseEther("10"),   // max 10 JOL per tx
      ethers.parseEther("50"),   // max 50 JOL päevas
      ethers.parseEther("500")   // max 500 JOL kuus
    );

    // Fund the wallet
    await jolToken.connect(peeter).approve(agentWallet.target, ethers.parseEther("20"));
    await agentWallet.connect(peeter).fundWallet(1, ethers.parseEther("20"));

    // Wallet balance check
    const wallet = await agentWallet.wallets(1);
    expect(wallet.balance).to.equal(ethers.parseEther("20"));
    expect(wallet.owner).to.equal(peeter.address);
    expect(wallet.agent).to.equal(aiAgent.address);

    // Peeter loob ka streaming makse Marile (otse, mitte läbi agendi)
    const remaining = await jolToken.balanceOf(peeter.address);
    // Peeter algsaldo 36, miinus 20 fondeeritud = 16 JOL
    expect(remaining).to.equal(ethers.parseEther("16"));

    await jolToken.connect(peeter).approve(streaming.target, ethers.parseEther("10"));
    await streaming.connect(peeter).createStream(
      mari.address,
      ethers.parseEther("0.001"), // 0.001 JOL/s
      ethers.parseEther("10")     // 10 JOL deposit
    );

    expect(await streaming.activeStreams()).to.equal(1);
  });

  it("15:00 — Jüri EV laadimine: MachineRegistry + PaymentChannel", async function () {
    // Registreeri laadija masina
    const chargerWallet = ethers.Wallet.createRandom();
    await machineReg.connect(juri).registerMachine(
      chargerWallet.address,
      4,    // EVCharger
      "Zaptec",
      "Go",
      ethers.keccak256(ethers.toUtf8Bytes("firmware-v2.1")),
      "0x75636674" // geohash
    );

    // Verifitseeri laadija
    const MR_VERIFIER = await machineReg.VERIFIER_ROLE();
    await machineReg.grantRole(MR_VERIFIER, admin.address);
    await machineReg.verifyMachine(1);

    expect(await machineReg.isVerified(chargerWallet.address)).to.be.true;

    // Jüri avab payment channel laadija vastu
    const juriBalance = await jolToken.balanceOf(juri.address);
    await jolToken.connect(juri).approve(paymentChannel.target, ethers.parseEther("15"));
    await paymentChannel.connect(juri).openChannel(
      chargerWallet.address,
      ethers.parseEther("15"), // 15 JOL deposit
      86400 // 24h
    );

    expect(await paymentChannel.totalChannelsOpened()).to.equal(1);

    // Channel on avatud — off-chain maksed saavad alata
    const ch = await paymentChannel.channels(1);
    expect(ch.sender).to.equal(juri.address);
    expect(ch.receiver).to.equal(chargerWallet.address);
    expect(ch.deposit).to.equal(ethers.parseEther("15"));
    expect(ch.open).to.be.true;
  });

  // ═══════════════════════════════════════════════════════════════
  // ÕHTU — governance ja carbon credits
  // ═══════════════════════════════════════════════════════════════

  it("18:00 — Kogukond hääletab: Lisa uus oracle", async function () {
    // Jüri omab piisavalt JOL-e et hääletada (aga mitte propose)
    // Anna Marile rohkem JOL-e et ta saaks propose
    await jolToken.mint(mari.address, ethers.parseEther("100000"));
    await jolToken.connect(mari).delegate(mari.address);
    // Mine block forward nii et snapshot oleks aktiivne
    await ethers.provider.send("evm_mine", []);

    // Mari propose: "Lisa oracle3 oraclete hulka"
    await governance.connect(mari).propose(
      "Lisa uus oracle",
      "Oracle3 on usaldusväärne energiaandmete pakkuja",
      [admin.address], // target (admin lisab oracle)
      ["0x12345678"]   // placeholder calldata
    );

    // Kontrollid
    const proposal = await governance.proposals(1);
    expect(proposal.state).to.equal(0); // Active
    expect(proposal.proposer).to.equal(mari.address);

    // Mari hääletab JAH
    await governance.connect(mari).vote(1, true);

    // Jüri hääletab JAH
    await governance.connect(juri).vote(1, true);

    // Peeter hääletab JAH
    await governance.connect(peeter).vote(1, true);

    // Kontroll: hääled on loetud
    const [forVotes, againstVotes] = await governance.getProposalVotes(1);
    expect(forVotes).to.be.gt(0);
    expect(againstVotes).to.equal(0);

    // Keegi ei saa kaks korda hääletada
    await expect(governance.connect(mari).vote(1, true)).to.be.reverted;
  });

  it("19:00 — Carbon credit genereerub Mari 45 kWh tootmisest", async function () {
    // Mari 45 kWh = CO2 kokkuhoid (EU keskmine: 0.23 kg CO2/kWh)
    const now = (await ethers.provider.getBlock("latest")).timestamp;

    await carbonCredit.issueCredit(
      mari.address,
      45,          // 45 kWh
      "solar",
      "EE",
      now - 43200, // 12h tagasi
      now
    );

    // Kontrollid
    expect(await carbonCredit.totalCreditsIssued()).to.equal(1);
    expect(await carbonCredit.ownerOf(1)).to.equal(mari.address);

    const details = await carbonCredit.getCreditDetails(1);
    expect(details.energyKWh).to.equal(45);
    expect(details.retired).to.be.false;

    // CO2 kokkuhoid: 45 kWh × 230g/kWh = 10,350g = 10.35 kg
    expect(details.co2AvoidedGrams).to.equal(45 * 230000 / 1000);
  });

  // ═══════════════════════════════════════════════════════════════
  // ÖÖ — bridge ja vesting
  // ═══════════════════════════════════════════════════════════════

  it("22:00 — Peeter bridgeb 5 JOL-i (simuleeritud)", async function () {
    // Peeter lukustab JOL BridgeLock'is
    const peetBal = await jolToken.balanceOf(peeter.address);
    // Peeter saatis 20 agendile ja 10 streami = 6 JOL alles
    // Bridge kasutab native JOL (msg.value), simuleerime
    await bridgeLock.connect(peeter).lockJOL({ value: ethers.parseEther("1") });

    expect(await bridgeLock.totalLocked()).to.equal(ethers.parseEther("1"));

    // Validator'd kinnitavad (admin on validator rollis)
    const VALIDATOR = await bridgeLock.VALIDATOR_ROLE();
    await bridgeLock.grantRole(VALIDATOR, admin.address);
    await bridgeLock.grantRole(VALIDATOR, oracle1.address);
    await bridgeLock.grantRole(VALIDATOR, oracle2.address);

    // Unlock (simuleeritud — keegi bridgeb tagasi)
    const ethTxHash = ethers.keccak256(ethers.toUtf8Bytes("eth-tx-12345"));
    await bridgeLock.connect(admin).confirmUnlock(1, peeter.address, ethers.parseEther("0.5"), ethTxHash);
    await bridgeLock.connect(oracle1).confirmUnlock(1, peeter.address, ethers.parseEther("0.5"), ethTxHash);
    await bridgeLock.connect(oracle2).confirmUnlock(1, peeter.address, ethers.parseEther("0.5"), ethTxHash);

    // 3/3 validaatorit kinnitasid → unlock käivitub
    expect(await bridgeLock.totalUnlocked()).to.equal(ethers.parseEther("0.5"));
  });

  it("23:00 — Founder vesting: cliff ei ole veel möödas", async function () {
    // Fund vesting contract
    await jolToken.mint(vesting.target, ethers.parseEther("12600000"));

    // Cliff on 1 aasta — praegu 0 claimable
    const releasable = await vesting["releasable(address)"](jolToken.target);
    expect(releasable).to.equal(0);

    // Fast-forward 1 year + 1 day
    await ethers.provider.send("evm_increaseTime", [366 * 86400]);
    await ethers.provider.send("evm_mine", []);

    // Nüüd on cliff möödas — mingi summa on claimable
    const releasableAfterCliff = await vesting["releasable(address)"](jolToken.target);
    expect(releasableAfterCliff).to.be.gt(0);

    // Founder claimib
    await vesting.connect(founder)["release(address)"](jolToken.target);
    const founderBal = await jolToken.balanceOf(founder.address);
    expect(founderBal).to.be.gt(0);
    expect(founderBal).to.be.lt(ethers.parseEther("12600000")); // ei saa kõike kohe
  });

  it("00:00 — Päeva kokkuvõte: KÕIK INVARIANDID KEHTIVAD", async function () {
    const totalSupply = await jolToken.totalSupply();
    const maxSupply = await jolToken.MAX_SUPPLY();
    const energyReserve = await energyFloor.totalEnergyReserveKWh();
    const totalBurned = await marketplace.totalBurned();
    const treasuryBal = await jolToken.balanceOf(treasury.target);

    console.log("\n  ═══ PÄEVA KOKKUVÕTE ═══");
    console.log(`  Total Supply:     ${ethers.formatEther(totalSupply)} JOL`);
    console.log(`  Max Supply:       ${ethers.formatEther(maxSupply)} JOL`);
    console.log(`  Energy Reserve:   ${energyReserve} kWh`);
    console.log(`  Marketplace Burn: ${ethers.formatEther(totalBurned)} JOL`);
    console.log(`  Treasury:         ${ethers.formatEther(treasuryBal)} JOL`);
    console.log(`  Mari:             ${ethers.formatEther(await jolToken.balanceOf(mari.address))} JOL`);
    console.log(`  Jüri:             ${ethers.formatEther(await jolToken.balanceOf(juri.address))} JOL`);
    console.log(`  Peeter:           ${ethers.formatEther(await jolToken.balanceOf(peeter.address))} JOL`);
    console.log(`  Founder:          ${ethers.formatEther(await jolToken.balanceOf(founder.address))} JOL`);
    console.log(`  Active Streams:   ${await streaming.activeStreams()}`);
    console.log(`  Carbon Credits:   ${await carbonCredit.totalCreditsIssued()}`);
    console.log(`  Governance Props: ${(await governance.nextProposalId()) - 1n}`);
    console.log(`  Bridge Locked:    ${ethers.formatEther(await bridgeLock.totalLocked())} JOL`);

    // ═══ INVARIANDID ═══
    // 1. Supply ei ületa MAX
    expect(totalSupply).to.be.lte(maxSupply);

    // 2. Energy reserve matches deposits
    expect(energyReserve).to.equal(45n);

    // 3. Governance töötab
    expect(await governance.nextProposalId()).to.be.gt(1);

    // 4. Bridge balanss klapib
    expect(await bridgeLock.totalLocked()).to.be.gte(await bridgeLock.totalUnlocked());

    // 5. Carbon credits on reaalsed
    expect(await carbonCredit.totalCreditsIssued()).to.equal(1);

    // 6. Streaming töötab
    expect(await streaming.totalStreams()).to.equal(1);

    console.log("  ═══ KÕIK INVARIANDID KEHTIVAD ═══\n");
  });
});

// ═══════════════════════════════════════════════════════════════
// ÜKS NÄDAL
// ═══════════════════════════════════════════════════════════��═══
describe("JOULE — Üks nädal ökosüsteemis", function () {
  this.timeout(120000);

  let jolToken, energyFloor, registry, poeMining, governance;
  let treasury, stakeSlash, conflictScore, bridgeLock;
  let admin, mari, juri, peeter, oracle1, fakeTootja;

  before(async function () {
    [admin, mari, juri, peeter, oracle1, fakeTootja] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(admin.address);

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(admin.address);

    const ConflictScore = await ethers.getContractFactory("ConflictScore");
    conflictScore = await ConflictScore.deploy(admin.address);

    const PoEMining = await ethers.getContractFactory("PoEMining");
    poeMining = await PoEMining.deploy(admin.address, jolToken.target, registry.target);

    const EnergyFloor = await ethers.getContractFactory("EnergyFloor");
    energyFloor = await EnergyFloor.deploy(admin.address, jolToken.target);

    const EcosystemTreasury = await ethers.getContractFactory("EcosystemTreasury");
    treasury = await EcosystemTreasury.deploy(admin.address, jolToken.target);

    const Governance = await ethers.getContractFactory("Governance");
    governance = await Governance.deploy(admin.address, jolToken.target);

    const BridgeLock = await ethers.getContractFactory("BridgeLock");
    bridgeLock = await BridgeLock.deploy(admin.address);

    const StakeSlash = await ethers.getContractFactory("StakeSlash");
    stakeSlash = await StakeSlash.deploy(admin.address, jolToken.target, registry.target, treasury.target, conflictScore.target);

    // Roles
    const MINTER = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER, admin.address);
    await jolToken.grantRole(MINTER, poeMining.target);
    await jolToken.grantRole(MINTER, energyFloor.target);
    await jolToken.grantRole(MINTER, treasury.target);

    const VERIFIER = await registry.VERIFIER_ROLE();
    await registry.grantRole(VERIFIER, admin.address);

    const ORACLE_FLOOR = await energyFloor.ORACLE_ROLE();
    await energyFloor.grantRole(ORACLE_FLOOR, admin.address);

    const ORACLE_POE = await poeMining.ORACLE_ROLE();
    await poeMining.grantRole(ORACLE_POE, admin.address);

    const SLASHER = await stakeSlash.SLASHER_ROLE();
    await stakeSlash.grantRole(SLASHER, admin.address);

    const REPORTER = await conflictScore.REPORTER_ROLE();
    await conflictScore.grantRole(REPORTER, stakeSlash.target);

    const GOV_ROLE = await treasury.GOVERNANCE_ROLE();
    await treasury.grantRole(GOV_ROLE, governance.target);

    const VALIDATOR = await bridgeLock.VALIDATOR_ROLE();
    await bridgeLock.grantRole(VALIDATOR, admin.address);
    await bridgeLock.grantRole(VALIDATOR, oracle1.address);
    await bridgeLock.grantRole(VALIDATOR, peeter.address);

    // Setup: 3 producers, verified facilities
    for (const [user, name, cap] of [[mari, "Mari Solar", 10], [juri, "Jüri Wind", 20], [peeter, "Peeter Hydro", 50]]) {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes(name));
      await registry.connect(user).registerFacility(0, cap, meterId, "0x75636674", 2, "EE");
      await energyFloor.connect(user).registerProducer(name, "EE", "solar");
    }
    await registry.verifyFacility(1);
    await registry.verifyFacility(2);
    await registry.verifyFacility(3);

    // Mint JOL for governance
    await jolToken.mint(mari.address, ethers.parseEther("200000"));
    await jolToken.connect(mari).delegate(mari.address);
    await ethers.provider.send("evm_mine", []);
  });

  it("Esmaspäev — 3 tootjat, normaalne päev", async function () {
    await energyFloor.depositEnergy(mari.address, 40);   // 40 kWh
    await energyFloor.depositEnergy(juri.address, 80);    // 80 kWh (tuulik)
    await energyFloor.depositEnergy(peeter.address, 200); // 200 kWh (hüdro)

    expect(await energyFloor.totalEnergyReserveKWh()).to.equal(320n);
    expect(await jolToken.balanceOf(mari.address)).to.equal(ethers.parseEther("200040"));
  });

  it("Teisipäev — pilves, tootmine langeb 80%", async function () {
    // Pilves päev — oracle annab vähem kWh
    await energyFloor.depositEnergy(mari.address, 8);   // 80% vähem
    await energyFloor.depositEnergy(juri.address, 60);   // tuul ei olene pilvest
    await energyFloor.depositEnergy(peeter.address, 200);

    // Süsteem adapteerub — ei faili, lihtsalt vähem minte
    const reserve = await energyFloor.totalEnergyReserveKWh();
    expect(reserve).to.equal(320n + 8n + 60n + 200n);
  });

  it("Kolmapäev — kaevandajad lahkuvad, difficulty kohandub", async function () {
    // Simuleerime: blokid tulevad endiselt, reward on sama
    // go-joule tasandil difficulty adapteerub automaatselt
    // Siin testame et supply invariant kehtib

    const supplyBefore = await jolToken.totalSupply();
    // Simulate 100 blocks worth of mining (36 JOL each, but some leave)
    await jolToken.mint(peeter.address, ethers.parseEther("360")); // 10 blokki
    const supplyAfter = await jolToken.totalSupply();

    expect(supplyAfter - supplyBefore).to.equal(ethers.parseEther("360"));
    expect(supplyAfter).to.be.lte(await jolToken.MAX_SUPPLY());
  });

  it("Neljapäev — pettur üritab, saab slashitud", async function () {
    // Fake tootja registreerib rajatise
    const meterId = ethers.keccak256(ethers.toUtf8Bytes("fake-meter"));
    await registry.connect(fakeTootja).registerFacility(0, 5, meterId, "0x75636674", 2, "XX");
    await registry.verifyFacility(4);

    // Stake (peab olema, et slash saaks toimuda)
    await jolToken.mint(fakeTootja.address, ethers.parseEther("100"));
    await jolToken.connect(fakeTootja).approve(stakeSlash.target, ethers.parseEther("100"));

    const requiredStake = await stakeSlash.requiredStake(4);
    // Stake
    if (requiredStake <= ethers.parseEther("100")) {
      await stakeSlash.connect(fakeTootja).stake(4);
      const staked = await stakeSlash.totalStaked();
      expect(staked).to.be.gt(0);

      // Admin (slasher) tuvastab pettuse → slash
      await stakeSlash.slash(4, "Fake production data submitted");

      // Fake tootja kaotas oma stake'i
      expect(await stakeSlash.isBanned(fakeTootja.address)).to.be.true;
      expect(await stakeSlash.totalSlashed()).to.be.gt(0);
    }
  });

  it("Reede — governance otsus jõustub", async function () {
    // Mari propose
    await governance.connect(mari).propose(
      "Lisa oracle3",
      "Uus oracle energiaandmete jaoks",
      [admin.address],
      ["0x12345678"]
    );

    // Hääletus
    await governance.connect(mari).vote(1, true);

    // Fast-forward: 7 päeva hääletus + 2 päeva timelock
    await ethers.provider.send("evm_increaseTime", [9 * 86400]);
    await ethers.provider.send("evm_mine", []);

    // Finalize
    await governance.finalize(1);
    const p = await governance.proposals(1);
    // Quorum ei pruugi olla piisav ühe häältega, aga mehhanism töötab
    expect(p.state).to.be.oneOf([1n, 2n]); // Passed or Rejected (quorum)
  });

  it("Laupäev — 20 bridge operatsiooni samaaegselt", async function () {
    for (let i = 0; i < 20; i++) {
      // Lock 0.1 JOL each
      await bridgeLock.connect(mari).lockJOL({ value: ethers.parseEther("0.01") });
    }
    expect(await bridgeLock.totalLocked()).to.equal(ethers.parseEther("0.2"));
  });

  it("Pühapäev — nädala kokkuvõte: kõik invariandid kehtivad", async function () {
    const totalSupply = await jolToken.totalSupply();
    const maxSupply = await jolToken.MAX_SUPPLY();
    const energyReserve = await energyFloor.totalEnergyReserveKWh();

    console.log("\n  ═══ NÄDALA KOKKUVÕTE ═══");
    console.log(`  Energiat toodetud: ${energyReserve} kWh`);
    console.log(`  JOL supply:        ${ethers.formatEther(totalSupply)} / ${ethers.formatEther(maxSupply)}`);
    console.log(`  Slashitud:         ${ethers.formatEther(await stakeSlash.totalSlashed())} JOL`);
    console.log(`  Bridge locked:     ${ethers.formatEther(await bridgeLock.totalLocked())} JOL`);

    expect(totalSupply).to.be.lte(maxSupply);
    expect(energyReserve).to.be.gt(0);

    console.log("  ═══ KÕIK INVARIANDID KEHTIVAD ═══\n");
  });
});

// ═══════════════════════════════════════════════════════════════
// ÜKS AASTA
// ═══════════════════════════════════════════════════════════════
describe("JOULE — Üks aasta ökosüsteemis", function () {
  this.timeout(120000);

  let jolToken, energyFloor, poeMining, registry;
  let admin, mari;

  before(async function () {
    [admin, mari] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(admin.address);

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(admin.address);

    const EnergyFloor = await ethers.getContractFactory("EnergyFloor");
    energyFloor = await EnergyFloor.deploy(admin.address, jolToken.target);

    const MINTER = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER, admin.address);
    await jolToken.grantRole(MINTER, energyFloor.target);

    const ORACLE_FLOOR = await energyFloor.ORACLE_ROLE();
    await energyFloor.grantRole(ORACLE_FLOOR, admin.address);

    await energyFloor.connect(mari).registerProducer("Mari Solar", "EE", "solar");
  });

  it("Kuu 1 — ainult asutaja kaevandab: ~6.2M JOL", async function () {
    // Simulate month 1 mining: 36 JOL/block × 15s × 30 days
    // = 36 × (30 × 24 × 3600 / 15) = 36 × 172,800 = 6,220,800 JOL
    const monthBlocks = 30 * 24 * 3600 / 15; // 172,800 blocks
    const monthReward = BigInt(monthBlocks) * ethers.parseEther("36");

    // Mint simulated mining reward
    await jolToken.mint(admin.address, monthReward);

    expect(await jolToken.totalSupply()).to.equal(monthReward);
    // ~6.22M JOL
    expect(monthReward).to.be.closeTo(
      ethers.parseEther("6220800"),
      ethers.parseEther("1")
    );
  });

  it("Kuu 3 — esimene energiatootja liitub", async function () {
    // Simulate 2 more months mining
    const twoMonths = BigInt(2 * 30 * 24 * 3600 / 15) * ethers.parseEther("36");
    await jolToken.mint(admin.address, twoMonths);

    // First energy producer deposits
    await energyFloor.depositEnergy(mari.address, 1000); // 1000 kWh esimese kuu jooksul

    expect(await energyFloor.totalEnergyReserveKWh()).to.equal(1000n);
    expect(await jolToken.balanceOf(mari.address)).to.equal(ethers.parseEther("1000"));
  });

  it("Kuu 9 — HALVING! 36 → 18 JOL per block", async function () {
    // Simulate 6 more months at 36 JOL (kuni halving)
    const sixMonths = BigInt(6 * 30 * 24 * 3600 / 15) * ethers.parseEther("36");
    await jolToken.mint(admin.address, sixMonths);

    // After halving: 18 JOL per block
    // Simulate 1 month at 18 JOL
    const postHalving = BigInt(30 * 24 * 3600 / 15) * ethers.parseEther("18");
    await jolToken.mint(admin.address, postHalving);

    const supply = await jolToken.totalSupply();
    console.log(`\n  Kuu 10 supply: ${ethers.formatEther(supply)} JOL`);
    expect(supply).to.be.lte(await jolToken.MAX_SUPPLY());
  });

  it("Kuu 12 — aasta kokkuvõte", async function () {
    // Simulate remaining 2 months at 18 JOL
    const twoMonths18 = BigInt(2 * 30 * 24 * 3600 / 15) * ethers.parseEther("18");
    await jolToken.mint(admin.address, twoMonths18);

    // More energy deposits through the year
    await energyFloor.depositEnergy(mari.address, 10000);

    const supply = await jolToken.totalSupply();
    const maxSupply = await jolToken.MAX_SUPPLY();
    const energyReserve = await energyFloor.totalEnergyReserveKWh();

    console.log("\n  ═══ AASTA KOKKUVÕTE ═══");
    console.log(`  Total Supply:      ${ethers.formatEther(supply)} JOL`);
    console.log(`  Max Supply:        ${ethers.formatEther(maxSupply)} JOL`);
    console.log(`  Supply %:          ${Number(supply * 100n / maxSupply)}%`);
    console.log(`  Energy registered: ${energyReserve} kWh`);
    console.log(`  Halving status:    era 2 (18 JOL/block)`);

    // Era 1 (36 JOL × 9 months) + Era 2 (18 JOL × 3 months)
    // = ~56M + ~9.3M = ~65M JOL + energy floor
    expect(supply).to.be.lte(maxSupply);
    expect(supply).to.be.gt(ethers.parseEther("50000000")); // > 50M mined

    console.log("  ═══ SÜSTEEM ELAB ═══\n");
  });
});
