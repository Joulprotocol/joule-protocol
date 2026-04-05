const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying JOULE v0.7.0 contracts with:", deployer.address);
  console.log("Model: 70% Mining (147M), 19% Reserve (39.9M), 6% Founder (12.6M), 5% Ecosystem (10.5M)");
  console.log("Block reward: 36 JOL/block, halving every 2,100,000 blocks (~1 year)\n");

  const addr = {}; // Track all addresses

  // ═══════════════════════════════════════════════════════════════
  // Phase 1: Core Token + Registry (no dependencies)
  // ═══════════════════════════════════════════════════════════════

  const JOLToken = await hre.ethers.getContractFactory("JOLToken");
  const jolToken = await JOLToken.deploy(deployer.address);
  await jolToken.waitForDeployment();
  addr.JOLToken = await jolToken.getAddress();
  console.log("1. JOLToken:", addr.JOLToken);

  const EnergyRegistry = await hre.ethers.getContractFactory("EnergyRegistry");
  const registry = await EnergyRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  addr.EnergyRegistry = await registry.getAddress();
  console.log("2. EnergyRegistry:", addr.EnergyRegistry);

  // ═══════════════════════════════════════════════════════════════
  // Phase 2: Verification Layer (depends on Registry)
  // ═══════════════════════════════════════════════════════════════

  const PhysicalCap = await hre.ethers.getContractFactory("PhysicalCap");
  const physicalCap = await PhysicalCap.deploy(addr.EnergyRegistry);
  await physicalCap.waitForDeployment();
  addr.PhysicalCap = await physicalCap.getAddress();
  console.log("3. PhysicalCap:", addr.PhysicalCap);

  const WeatherOracle = await hre.ethers.getContractFactory("WeatherOracle");
  const weatherOracle = await WeatherOracle.deploy(deployer.address, addr.EnergyRegistry, addr.PhysicalCap);
  await weatherOracle.waitForDeployment();
  addr.WeatherOracle = await weatherOracle.getAddress();
  console.log("4. WeatherOracle:", addr.WeatherOracle);

  const ConflictScore = await hre.ethers.getContractFactory("ConflictScore");
  const conflictScore = await ConflictScore.deploy(deployer.address);
  await conflictScore.waitForDeployment();
  addr.ConflictScore = await conflictScore.getAddress();
  console.log("5. ConflictScore:", addr.ConflictScore);

  // ═══════════════════════════════════════════════════════════════
  // Phase 3: Staking + Oracle (depends on Token, Registry, ConflictScore)
  // ═══════════════════════════════════════════════════════════════

  const StakeSlash = await hre.ethers.getContractFactory("StakeSlash");
  const stakeSlash = await StakeSlash.deploy(
    deployer.address, addr.JOLToken, addr.EnergyRegistry, deployer.address, addr.ConflictScore
  );
  await stakeSlash.waitForDeployment();
  addr.StakeSlash = await stakeSlash.getAddress();
  console.log("6. StakeSlash:", addr.StakeSlash);

  const OracleConsensus = await hre.ethers.getContractFactory("OracleConsensus");
  const oracleConsensus = await OracleConsensus.deploy(
    deployer.address, addr.JOLToken, addr.EnergyRegistry, deployer.address
  );
  await oracleConsensus.waitForDeployment();
  addr.OracleConsensus = await oracleConsensus.getAddress();
  console.log("7. OracleConsensus:", addr.OracleConsensus);

  // ═══════════════════════════════════════════════════════════════
  // Phase 4: Mining + Floor (depends on Token, Registry)
  // ═══════════════════════════════════════════════════════════════

  const PoEMining = await hre.ethers.getContractFactory("PoEMining");
  const poeMining = await PoEMining.deploy(deployer.address, addr.JOLToken, addr.EnergyRegistry);
  await poeMining.waitForDeployment();
  addr.PoEMining = await poeMining.getAddress();
  console.log("8. PoEMining:", addr.PoEMining);

  const EnergyFloor = await hre.ethers.getContractFactory("EnergyFloor");
  const energyFloor = await EnergyFloor.deploy(deployer.address, addr.JOLToken);
  await energyFloor.waitForDeployment();
  addr.EnergyFloor = await energyFloor.getAddress();
  console.log("9. EnergyFloor:", addr.EnergyFloor);

  // ═══════════════════════════════════════════════════════════════
  // Phase 5: EnergyProofEngine (depends on ALL verification layers)
  // ═══════════════════════════════════════════════════════════════

  const EnergyProofEngine = await hre.ethers.getContractFactory("EnergyProofEngine");
  const engine = await EnergyProofEngine.deploy(
    deployer.address, addr.JOLToken, addr.EnergyRegistry,
    addr.PhysicalCap, addr.WeatherOracle, addr.OracleConsensus,
    addr.StakeSlash, addr.ConflictScore, addr.PoEMining, addr.EnergyFloor
  );
  await engine.waitForDeployment();
  addr.EnergyProofEngine = await engine.getAddress();
  console.log("10. EnergyProofEngine:", addr.EnergyProofEngine);

  // ═══════════════════════════════════════════════════════════════
  // Phase 6: Governance + Treasury
  // ═══════════════════════════════════════════════════════════════

  const Governance = await hre.ethers.getContractFactory("Governance");
  const governance = await Governance.deploy(deployer.address, addr.JOLToken);
  await governance.waitForDeployment();
  addr.Governance = await governance.getAddress();
  console.log("11. Governance:", addr.Governance);

  const EcosystemTreasury = await hre.ethers.getContractFactory("EcosystemTreasury");
  const treasury = await EcosystemTreasury.deploy(deployer.address, addr.JOLToken);
  await treasury.waitForDeployment();
  addr.EcosystemTreasury = await treasury.getAddress();
  console.log("12. EcosystemTreasury:", addr.EcosystemTreasury);

  // ═══════════════════════════════════════════════════════════════
  // Phase 7: Machine Economy
  // ═══════════════════════════════════════════════════════════════

  const MachineRegistry = await hre.ethers.getContractFactory("MachineRegistry");
  const machineReg = await MachineRegistry.deploy(deployer.address);
  await machineReg.waitForDeployment();
  addr.MachineRegistry = await machineReg.getAddress();
  console.log("13. MachineRegistry:", addr.MachineRegistry);

  const AgentWallet = await hre.ethers.getContractFactory("AgentWallet");
  const agentWallet = await AgentWallet.deploy(addr.JOLToken, addr.MachineRegistry);
  await agentWallet.waitForDeployment();
  addr.AgentWallet = await agentWallet.getAddress();
  console.log("14. AgentWallet:", addr.AgentWallet);

  const PaymentChannel = await hre.ethers.getContractFactory("PaymentChannel");
  const payChannel = await PaymentChannel.deploy(deployer.address, addr.JOLToken);
  await payChannel.waitForDeployment();
  addr.PaymentChannel = await payChannel.getAddress();
  console.log("15. PaymentChannel:", addr.PaymentChannel);

  const StreamingPayments = await hre.ethers.getContractFactory("StreamingPayments");
  const streaming = await StreamingPayments.deploy(deployer.address, addr.JOLToken);
  await streaming.waitForDeployment();
  addr.StreamingPayments = await streaming.getAddress();
  console.log("16. StreamingPayments:", addr.StreamingPayments);

  const EnergyMarketplace = await hre.ethers.getContractFactory("EnergyMarketplace");
  const marketplace = await EnergyMarketplace.deploy(deployer.address, addr.JOLToken, addr.EnergyFloor);
  await marketplace.waitForDeployment();
  addr.EnergyMarketplace = await marketplace.getAddress();
  console.log("17. EnergyMarketplace:", addr.EnergyMarketplace);

  // ═══════════════════════════════════════════════════════════════
  // Phase 8: Financial instruments
  // ═══════════════════════════════════════════════════════════════

  const LiquidityMining = await hre.ethers.getContractFactory("LiquidityMining");
  const liqMining = await LiquidityMining.deploy(deployer.address, addr.JOLToken);
  await liqMining.waitForDeployment();
  addr.LiquidityMining = await liqMining.getAddress();
  console.log("18. LiquidityMining:", addr.LiquidityMining);

  const DEXLiquidity = await hre.ethers.getContractFactory("DEXLiquidity");
  const dex = await DEXLiquidity.deploy(deployer.address, addr.JOLToken);
  await dex.waitForDeployment();
  addr.DEXLiquidity = await dex.getAddress();
  console.log("19. DEXLiquidity:", addr.DEXLiquidity);

  const SellLimit = await hre.ethers.getContractFactory("SellLimit");
  const sellLimit = await SellLimit.deploy(deployer.address);
  await sellLimit.waitForDeployment();
  addr.SellLimit = await sellLimit.getAddress();
  console.log("20. SellLimit:", addr.SellLimit);

  const FounderSellLimit = await hre.ethers.getContractFactory("FounderSellLimit");
  const founderSellLimit = await FounderSellLimit.deploy(addr.JOLToken, deployer.address, deployer.address);
  await founderSellLimit.waitForDeployment();
  addr.FounderSellLimit = await founderSellLimit.getAddress();
  console.log("21. FounderSellLimit:", addr.FounderSellLimit);

  const BridgeLock = await hre.ethers.getContractFactory("BridgeLock");
  const bridge = await BridgeLock.deploy(deployer.address);
  await bridge.waitForDeployment();
  addr.BridgeLock = await bridge.getAddress();
  console.log("22. BridgeLock:", addr.BridgeLock);

  const CarbonCredit = await hre.ethers.getContractFactory("CarbonCredit");
  const carbon = await CarbonCredit.deploy(deployer.address);
  await carbon.waitForDeployment();
  addr.CarbonCredit = await carbon.getAddress();
  console.log("23. CarbonCredit:", addr.CarbonCredit);

  // FoundersVesting: deploy at mainnet launch with correct timestamps
  // const now = Math.floor(Date.now() / 1000);
  // const FoundersVesting = await hre.ethers.getContractFactory("JOULEFoundersVesting");
  // const vesting = await FoundersVesting.deploy(FOUNDER_ADDRESS, now, 365*86400, 1461*86400);
  // Fund with: jolToken.mint(vesting.address, ethers.parseEther("12600000"));
  console.log("24. FoundersVesting: deploy at mainnet launch");

  // ═══════════════════════════════════════════════════════════════
  // Phase 9: Configure ALL roles
  // ═══════════════════════════════════════════════════════════════
  console.log("\n--- Configuring roles ---");

  // JOLToken: MINTER_ROLE
  const MINTER = await jolToken.MINTER_ROLE();
  await jolToken.grantRole(MINTER, addr.PoEMining);
  await jolToken.grantRole(MINTER, addr.EnergyFloor);
  await jolToken.grantRole(MINTER, addr.EcosystemTreasury);
  await jolToken.grantRole(MINTER, addr.LiquidityMining);
  console.log("MINTER_ROLE → PoEMining, EnergyFloor, Treasury, LiquidityMining");

  // JOLToken: BURNER_ROLE
  const BURNER = await jolToken.BURNER_ROLE();
  await jolToken.grantRole(BURNER, addr.EnergyMarketplace);
  await jolToken.grantRole(BURNER, addr.EnergyFloor);
  await jolToken.grantRole(BURNER, addr.StreamingPayments);
  console.log("BURNER_ROLE → Marketplace, EnergyFloor, StreamingPayments");

  // EnergyRegistry: VERIFIER_ROLE
  const VERIFIER = await registry.VERIFIER_ROLE();
  await registry.grantRole(VERIFIER, addr.OracleConsensus);
  console.log("VERIFIER_ROLE → OracleConsensus");

  // PoEMining: ORACLE_ROLE → EnergyProofEngine (not OracleConsensus directly)
  const ORACLE_POE = await poeMining.ORACLE_ROLE();
  await poeMining.grantRole(ORACLE_POE, addr.EnergyProofEngine);
  console.log("PoEMining.ORACLE_ROLE → EnergyProofEngine");

  // EnergyFloor: ORACLE_ROLE → EnergyProofEngine
  const ORACLE_FLOOR = await energyFloor.ORACLE_ROLE();
  await energyFloor.grantRole(ORACLE_FLOOR, addr.EnergyProofEngine);
  console.log("EnergyFloor.ORACLE_ROLE → EnergyProofEngine");

  // EnergyProofEngine: ENGINE_OPERATOR
  const ENGINE_OP = await engine.ENGINE_OPERATOR();
  await engine.grantRole(ENGINE_OP, deployer.address); // Deployer operates initially
  console.log("ENGINE_OPERATOR → deployer (temporary)");

  // OracleConsensus: link PoEMining
  await oracleConsensus.setPoEMining(addr.PoEMining);
  console.log("OracleConsensus.setPoEMining → PoEMining");

  // EcosystemTreasury: GOVERNANCE_ROLE → Governance
  const GOV_ROLE = await treasury.GOVERNANCE_ROLE();
  await treasury.grantRole(GOV_ROLE, addr.Governance);
  console.log("GOVERNANCE_ROLE → Governance");

  // MachineRegistry: RECORDER_ROLE → AgentWallet
  const RECORDER = await machineReg.RECORDER_ROLE();
  await machineReg.grantRole(RECORDER, addr.AgentWallet);
  console.log("RECORDER_ROLE → AgentWallet");

  // ConflictScore: REPORTER_ROLE → StakeSlash
  const REPORTER = await conflictScore.REPORTER_ROLE();
  await conflictScore.grantRole(REPORTER, addr.StakeSlash);
  console.log("REPORTER_ROLE → StakeSlash");

  // WeatherOracle: ORACLE_ROLE → (set per oracle node at runtime)
  console.log("WeatherOracle.ORACLE_ROLE → set per oracle node at runtime");

  // ═══════════════════════════════════════════════════════════════
  // Phase 10: Verification
  // ═══════════════════════════════════════════════════════════════
  console.log("\n--- Verifying deployment ---");
  console.log("MAX_SUPPLY:", (await jolToken.MAX_SUPPLY()).toString());
  console.log("MAX_FLOOR_MINT:", (await energyFloor.MAX_FLOOR_MINT()).toString());
  console.log("MAX_TREASURY:", (await treasury.MAX_TREASURY()).toString());
  console.log("PoE multiplier:", (await poeMining.POE_REWARD_MULTIPLIER()).toString());

  // ═══════════════════════════════════════════════════════════════
  // SECURITY NOTE: Admin renounce
  // ═══════════════════════════════════════════════════════════════
  console.log("\n⚠️  BEFORE MAINNET: Uncomment admin renounce lines below:");
  console.log("// await jolToken.renounceAdmin();   // Makes token immutable");
  console.log("// await registry.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);");

  console.log("\n═══ JOULE v0.7.0 — Deployment Complete ═══");
  console.log("Total contracts: 23 (+1 FoundersVesting at mainnet)");
  console.log("Distribution: 70/19/6/5 — 36 JOL/block — 210M hard cap");
  console.log(addr);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
