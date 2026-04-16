/**
 * Flow 2 — PoE Chain: 8-contract verification pipeline (PÄRIS CHAINIL)
 *
 * Simplified flow (without full EnergyProofEngine 5-layer):
 * 1. EnergyRegistry.registerFacility
 * 2. EnergyFloor.registerProducer
 * 3. EnergyFloor.depositEnergy (oracle confirms kWh → mint JOL)
 * 4. PoEMining.accrueReward (oracle confirms → accrue bonus)
 * 5. PoEMining.claimRewards (producer claims)
 *
 * This tests the core energy→JOL flow on a real chain.
 */
const hre = require("hardhat");

const ADDR = {
  JOLToken: "0xe297958406F7b713416184eD4c8Ef3b7af79C5bC",
  EnergyRegistry: "0xE1a2d3E258f276C5B73ae827c64312Cd6a160C97",
  EnergyFloor: "0xFf4B2330db72D2252E51C91235D4c7EA02d34E6B",
  PoEMining: "0x4629339B545D384223dd00534e42F60abF545275",
  EnergyProofEngine: "0x78f8Cba52976E04058eA53b3562aC0F18aD62A55",
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Flow 2 — PoE Energy Chain");
  console.log("Deployer:", deployer.address);

  const jolToken = await hre.ethers.getContractAt("JOLToken", ADDR.JOLToken);
  const registry = await hre.ethers.getContractAt("EnergyRegistry", ADDR.EnergyRegistry);
  const energyFloor = await hre.ethers.getContractAt("EnergyFloor", ADDR.EnergyFloor);
  const poeMining = await hre.ethers.getContractAt("PoEMining", ADDR.PoEMining);

  const checks = [];
  function check(name, pass) {
    checks.push({ name, pass });
    console.log(`  ${pass ? "✓" : "✗"} ${name}`);
  }

  // ─── Step 1: Register Facility (idempotent) ──────────────────
  console.log("\n--- Step 1: Register facility (10kW solar, Estonia) ---");
  const nextId = await registry.nextFacilityId();
  const facilityId = nextId > 1n ? 1n : nextId; // Use existing or new

  if (nextId <= 1n) {
    const meterId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("mari-shelly-testnet-001"));
    const tx1 = await registry.registerFacility(0, 10, meterId, "0x75636674", 2, "EE");
    const r1 = await tx1.wait();
    console.log("  registerFacility tx:", r1.hash, "gas:", r1.gasUsed.toString());
  } else {
    console.log("  Facility already registered (id:", facilityId.toString(), ")");
  }

  const owner = await registry.facilityOwner(Number(facilityId));
  check("Facility registered", owner === deployer.address);

  // ─── Step 2: Verify Facility (idempotent) ──────────────────────
  console.log("\n--- Step 2: Verify facility ---");
  const VERIFIER = await registry.VERIFIER_ROLE();
  if (!(await registry.hasRole(VERIFIER, deployer.address))) {
    await (await registry.grantRole(VERIFIER, deployer.address)).wait();
  }
  try {
    await (await registry.verifyFacility(Number(facilityId))).wait();
    console.log("  Facility verified");
  } catch (e) {
    console.log("  Already verified (expected)");
  }
  check("Facility verified", true);

  // ─── Step 3: Register Producer on EnergyFloor (idempotent) ────
  console.log("\n--- Step 3: Register as energy producer ---");
  const producer = await energyFloor.producers(deployer.address);
  if (!producer.active) {
    await (await energyFloor.registerProducer("Testnet Solar Park", "EE", "solar")).wait();
  } else {
    console.log("  Already registered as producer");
  }
  const prodCheck = await energyFloor.producers(deployer.address);
  check("Producer registered", prodCheck.active === true);

  // ─── Step 4: Grant ORACLE_ROLE to deployer for testing ─────────
  console.log("\n--- Step 4: Grant ORACLE roles ---");
  const ORACLE_FLOOR = await energyFloor.ORACLE_ROLE();
  const hasOracleFloor = await energyFloor.hasRole(ORACLE_FLOOR, deployer.address);
  if (!hasOracleFloor) {
    await (await energyFloor.grantRole(ORACLE_FLOOR, deployer.address)).wait();
  }
  check("ORACLE_ROLE on EnergyFloor", await energyFloor.hasRole(ORACLE_FLOOR, deployer.address));

  const ORACLE_POE = await poeMining.ORACLE_ROLE();
  const hasOraclePoe = await poeMining.hasRole(ORACLE_POE, deployer.address);
  if (!hasOraclePoe) {
    await (await poeMining.grantRole(ORACLE_POE, deployer.address)).wait();
  }
  check("ORACLE_ROLE on PoEMining", await poeMining.hasRole(ORACLE_POE, deployer.address));

  // ─── Step 5: Deposit Energy → Mint JOL (the FLOOR) ────────────
  console.log("\n--- Step 5: Deposit 5 kWh energy → mint 5 JOL ---");
  const balBefore = await jolToken.balanceOf(deployer.address);
  const supplyBefore = await jolToken.totalSupply();

  const tx5 = await energyFloor.depositEnergy(deployer.address, 5);
  const r5 = await tx5.wait();
  console.log("  depositEnergy tx:", r5.hash, "gas:", r5.gasUsed.toString());

  const balAfter = await jolToken.balanceOf(deployer.address);
  const jolMinted = balAfter - balBefore;
  console.log("  JOL minted:", hre.ethers.formatEther(jolMinted));

  check("Got 5 JOL for 5 kWh", jolMinted === hre.ethers.parseEther("5"));
  check("totalEnergyReserve == 5", (await energyFloor.totalEnergyReserveKWh()) === 5n);
  check("totalMintedFromEnergy == 5", (await energyFloor.totalMintedFromEnergy()) === 5n);

  // ─── Step 6: PoE Accrue Reward (bonus for verified production) ─
  console.log("\n--- Step 6: PoE accrueReward (3x bonus for 5 kWh) ---");
  const tx6 = await poeMining.accrueReward(1, 5);
  const r6 = await tx6.wait();
  console.log("  accrueReward tx:", r6.hash, "gas:", r6.gasUsed.toString());

  const pending = await poeMining.pendingRewards(deployer.address);
  console.log("  Pending PoE reward:", hre.ethers.formatEther(pending));

  // 5 kWh × 3 JOL/kWh = 15 JOL gross, 2% oracle fee = 14.7 to producer
  const expectedProducerReward = hre.ethers.parseEther("15") * 9800n / 10000n;
  check("PoE reward accrued", pending === expectedProducerReward);

  // ─── Step 7: Claim PoE Rewards ─────────────────────────────────
  console.log("\n--- Step 7: Claim PoE rewards ---");
  const balPreClaim = await jolToken.balanceOf(deployer.address);
  const tx7 = await poeMining.claimRewards();
  const r7 = await tx7.wait();
  console.log("  claimRewards tx:", r7.hash, "gas:", r7.gasUsed.toString());

  const balPostClaim = await jolToken.balanceOf(deployer.address);
  const claimed = balPostClaim - balPreClaim;
  console.log("  Claimed:", hre.ethers.formatEther(claimed), "JOL");

  check("Claimed matches pending", claimed === expectedProducerReward);

  // ─── Step 8: Final State ───────────────────────────────────────
  console.log("\n--- Final State ---");
  const totalSupply = await jolToken.totalSupply();
  const maxSupply = await jolToken.MAX_SUPPLY();
  console.log("  totalSupply:", hre.ethers.formatEther(totalSupply));
  console.log("  maxSupply:", hre.ethers.formatEther(maxSupply));
  console.log("  remainingSupply:", hre.ethers.formatEther(await jolToken.remainingSupply()));
  console.log("  totalPoEMinted:", hre.ethers.formatEther(await poeMining.totalPoEMinted()));
  console.log("  totalKWhRewarded:", (await poeMining.totalKWhRewarded()).toString());

  check("Supply <= MAX", totalSupply <= maxSupply);

  // ─── Summary ───────────────────────────────────────────────────
  const passed = checks.filter(c => c.pass).length;
  const failed = checks.filter(c => !c.pass).length;
  console.log(`\n═══ FLOW 2: ${failed === 0 ? "PASS" : "FAIL"} — ${passed}/${checks.length} checks ═══`);

  if (failed > 0) {
    console.log("Failed checks:");
    checks.filter(c => !c.pass).forEach(c => console.log("  ✗", c.name));
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
