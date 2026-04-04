const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying JOULE v2 contracts with:", deployer.address);
  console.log("Model: Satoshi — 0% founder allocation, pure community");

  // ─── Core Protocol ───────────────────────────────────────────

  // 1. JOLToken
  const JOLToken = await hre.ethers.getContractFactory("JOLToken");
  const jolToken = await JOLToken.deploy(deployer.address);
  await jolToken.waitForDeployment();
  console.log("JOLToken:", await jolToken.getAddress());

  // 2. EnergyRegistry
  const EnergyRegistry = await hre.ethers.getContractFactory("EnergyRegistry");
  const registry = await EnergyRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  console.log("EnergyRegistry:", await registry.getAddress());

  // 3. PoEMining (no founder wallet)
  const PoEMining = await hre.ethers.getContractFactory("PoEMining");
  const poeMining = await PoEMining.deploy(
    deployer.address,
    await jolToken.getAddress(),
    await registry.getAddress()
  );
  await poeMining.waitForDeployment();
  console.log("PoEMining:", await poeMining.getAddress());

  // 4. OracleConsensus
  const OracleConsensus = await hre.ethers.getContractFactory("OracleConsensus");
  const oracle = await OracleConsensus.deploy(deployer.address, await registry.getAddress());
  await oracle.waitForDeployment();
  console.log("OracleConsensus:", await oracle.getAddress());

  // 5. Governance
  const Governance = await hre.ethers.getContractFactory("Governance");
  const governance = await Governance.deploy(deployer.address, await jolToken.getAddress());
  await governance.waitForDeployment();
  console.log("Governance:", await governance.getAddress());

  // 6. EnergyMarketplace (no founder wallet)
  const EnergyMarketplace = await hre.ethers.getContractFactory("EnergyMarketplace");
  const marketplace = await EnergyMarketplace.deploy(
    deployer.address,
    await jolToken.getAddress()
  );
  await marketplace.waitForDeployment();
  console.log("EnergyMarketplace:", await marketplace.getAddress());

  // ─── Machine Economy Layer ───────────────────────────────────

  // 7. EnergyPeg
  const EnergyPeg = await hre.ethers.getContractFactory("EnergyPeg");
  const energyPeg = await EnergyPeg.deploy(deployer.address, await jolToken.getAddress());
  await energyPeg.waitForDeployment();
  console.log("EnergyPeg:", await energyPeg.getAddress());

  // 8. MachineRegistry
  const MachineRegistry = await hre.ethers.getContractFactory("MachineRegistry");
  const machineReg = await MachineRegistry.deploy(deployer.address);
  await machineReg.waitForDeployment();
  console.log("MachineRegistry:", await machineReg.getAddress());

  // 9. PaymentChannel
  const PaymentChannel = await hre.ethers.getContractFactory("PaymentChannel");
  const payChannel = await PaymentChannel.deploy(await jolToken.getAddress());
  await payChannel.waitForDeployment();
  console.log("PaymentChannel:", await payChannel.getAddress());

  // 10. StreamingPayments (no founder wallet)
  const StreamingPayments = await hre.ethers.getContractFactory("StreamingPayments");
  const streaming = await StreamingPayments.deploy(await jolToken.getAddress());
  await streaming.waitForDeployment();
  console.log("StreamingPayments:", await streaming.getAddress());

  // 11. CarbonCredit
  const CarbonCredit = await hre.ethers.getContractFactory("CarbonCredit");
  const carbon = await CarbonCredit.deploy(deployer.address);
  await carbon.waitForDeployment();
  console.log("CarbonCredit:", await carbon.getAddress());

  // 12. AgentWallet
  const AgentWallet = await hre.ethers.getContractFactory("AgentWallet");
  const agentWallet = await AgentWallet.deploy(
    await jolToken.getAddress(),
    await machineReg.getAddress()
  );
  await agentWallet.waitForDeployment();
  console.log("AgentWallet:", await agentWallet.getAddress());

  // ─── Configure Roles ─────────────────────────────────────────

  const MINTER_ROLE = await jolToken.MINTER_ROLE();
  const BURNER_ROLE = await jolToken.BURNER_ROLE();
  const VERIFIER_ROLE = await registry.VERIFIER_ROLE();
  const ORACLE_ROLE = await poeMining.ORACLE_ROLE();

  await jolToken.grantRole(MINTER_ROLE, await poeMining.getAddress());
  await jolToken.grantRole(MINTER_ROLE, await energyPeg.getAddress());
  await jolToken.grantRole(BURNER_ROLE, await marketplace.getAddress());
  await jolToken.grantRole(BURNER_ROLE, await energyPeg.getAddress());
  await registry.grantRole(VERIFIER_ROLE, await oracle.getAddress());
  await poeMining.grantRole(ORACLE_ROLE, await oracle.getAddress());
  await oracle.setPoEMining(await poeMining.getAddress());

  console.log("All roles configured");

  // SECURITY: Renounce admin on JOLToken — no more role changes possible
  // This makes the token contract immutable. Only PoEMining and EnergyPeg can mint.
  // Uncomment for mainnet deploy:
  // await jolToken.renounceAdmin();
  // console.log("JOLToken admin renounced — contract is now immutable");

  console.log("\n═══ JOULE v2 — Satoshi Model — Deployment Complete ═══");
  console.log({
    // Core
    JOLToken: await jolToken.getAddress(),
    EnergyRegistry: await registry.getAddress(),
    PoEMining: await poeMining.getAddress(),
    OracleConsensus: await oracle.getAddress(),
    Governance: await governance.getAddress(),
    EnergyMarketplace: await marketplace.getAddress(),
    // Machine Economy
    EnergyPeg: await energyPeg.getAddress(),
    MachineRegistry: await machineReg.getAddress(),
    PaymentChannel: await payChannel.getAddress(),
    StreamingPayments: await streaming.getAddress(),
    CarbonCredit: await carbon.getAddress(),
    AgentWallet: await agentWallet.getAddress(),
    // Info
    Model: "Satoshi — 0% founder, pure mining",
    ChainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
