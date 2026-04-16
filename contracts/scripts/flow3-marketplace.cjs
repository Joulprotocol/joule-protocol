/**
 * Flow 3 — Marketplace: List energy, buy, verify fee burn
 */
const hre = require("hardhat");

const ADDR = {
  JOLToken: "0xe297958406F7b713416184eD4c8Ef3b7af79C5bC",
  EnergyFloor: "0xFf4B2330db72D2252E51C91235D4c7EA02d34E6B",
  EnergyMarketplace: "0x687710573d72DD21054fF053f93B914F854CDB1C",
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Flow 3 — Marketplace");
  console.log("Deployer:", deployer.address);

  const jolToken = await hre.ethers.getContractAt("JOLToken", ADDR.JOLToken);
  const marketplace = await hre.ethers.getContractAt("EnergyMarketplace", ADDR.EnergyMarketplace);
  const energyFloor = await hre.ethers.getContractAt("EnergyFloor", ADDR.EnergyFloor);

  const checks = [];
  function check(name, pass) { checks.push({ name, pass }); console.log(`  ${pass ? "✓" : "✗"} ${name}`); }

  // Deployer has 5 kWh available from Flow 2
  const producer = await energyFloor.producers(deployer.address);
  console.log("  Available kWh:", producer.availableKWh.toString());

  // Step 1: List 3 kWh at 1.5 JOL/kWh
  console.log("\n--- Step 1: Create listing (3 kWh @ 1.5 JOL/kWh) ---");
  const tx1 = await marketplace.createListing(3, hre.ethers.parseEther("1.5"), "solar", "EE");
  const r1 = await tx1.wait();
  console.log("  createListing tx:", r1.hash, "gas:", r1.gasUsed.toString());
  check("Listing created", true);

  // Step 2: Buy 3 kWh (deployer buys from self for test — just tests mechanics)
  console.log("\n--- Step 2: Buy 3 kWh = 4.5 JOL total ---");
  const totalPrice = hre.ethers.parseEther("4.5");
  const burnExpected = totalPrice * 150n / 10000n; // 1.5% = 0.0675 JOL
  const sellerExpected = totalPrice - burnExpected;

  // Approve marketplace
  await (await jolToken.approve(marketplace.target, totalPrice)).wait();

  const supplyBefore = await jolToken.totalSupply();
  const balBefore = await jolToken.balanceOf(deployer.address);

  const tx2 = await marketplace.buy(1, 3);
  const r2 = await tx2.wait();
  console.log("  buy tx:", r2.hash, "gas:", r2.gasUsed.toString());

  const supplyAfter = await jolToken.totalSupply();
  const balAfter = await jolToken.balanceOf(deployer.address);

  // Deployer is both buyer and seller, so net = -burnAmount
  const netChange = balAfter - balBefore;
  console.log("  Net balance change:", hre.ethers.formatEther(netChange));
  console.log("  Fee burned:", hre.ethers.formatEther(supplyBefore - supplyAfter));

  check("Supply decreased (fee burned)", supplyAfter < supplyBefore);
  check("Burned amount = 1.5%", supplyBefore - supplyAfter === burnExpected);
  check("totalBurned tracked", (await marketplace.totalBurned()) === burnExpected);
  check("totalTrades == 1", (await marketplace.totalTrades()) === 1n);

  // Step 3: Verify listing is consumed
  const listing = await marketplace.listings(1);
  check("Listing consumed (kWh == 0)", listing.kWh === 0n);
  check("Listing inactive", listing.active === false);

  // Summary
  const passed = checks.filter(c => c.pass).length;
  const failed = checks.filter(c => !c.pass).length;
  console.log(`\n═══ FLOW 3: ${failed === 0 ? "PASS" : "FAIL"} — ${passed}/${checks.length} checks ═══`);
  if (failed > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
