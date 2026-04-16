/**
 * Flow 1 — Lihtne: mint ja transfer (PÄRIS CHAINIL)
 */
const hre = require("hardhat");

const ADDRESSES = {
  JOLToken: "0xe297958406F7b713416184eD4c8Ef3b7af79C5bC",
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Flow 1 — Mint & Transfer");
  console.log("Deployer:", deployer.address);

  const jolToken = await hre.ethers.getContractAt("JOLToken", ADDRESSES.JOLToken);

  // Step 1: Check initial state
  const supplyBefore = await jolToken.totalSupply();
  const deployerBalBefore = await jolToken.balanceOf(deployer.address);
  console.log("\n--- Before ---");
  console.log("totalSupply:", hre.ethers.formatEther(supplyBefore));
  console.log("deployer balance:", hre.ethers.formatEther(deployerBalBefore));

  // Step 2: Mint 1000 JOL to deployer
  // Deployer has MINTER_ROLE via being admin
  const MINTER = await jolToken.MINTER_ROLE();
  const hasMinter = await jolToken.hasRole(MINTER, deployer.address);
  if (!hasMinter) {
    console.log("Granting MINTER_ROLE to deployer...");
    const tx0 = await jolToken.grantRole(MINTER, deployer.address);
    await tx0.wait();
  }

  console.log("\n--- Minting 1000 JOL ---");
  const tx1 = await jolToken.mint(deployer.address, hre.ethers.parseEther("1000"));
  const receipt1 = await tx1.wait();
  console.log("Mint tx:", receipt1.hash);
  console.log("Gas used:", receipt1.gasUsed.toString());

  const deployerBalAfterMint = await jolToken.balanceOf(deployer.address);
  console.log("Deployer balance after mint:", hre.ethers.formatEther(deployerBalAfterMint));

  // Step 3: Transfer 100 JOL to a test address
  const testAddr = "0x0000000000000000000000000000000000000042";
  console.log("\n--- Transferring 100 JOL to", testAddr, "---");
  const tx2 = await jolToken.transfer(testAddr, hre.ethers.parseEther("100"));
  const receipt2 = await tx2.wait();
  console.log("Transfer tx:", receipt2.hash);
  console.log("Gas used:", receipt2.gasUsed.toString());

  // Step 4: Verify balances
  const deployerBalFinal = await jolToken.balanceOf(deployer.address);
  const testBalFinal = await jolToken.balanceOf(testAddr);
  const supplyAfter = await jolToken.totalSupply();

  console.log("\n--- After ---");
  console.log("deployer balance:", hre.ethers.formatEther(deployerBalFinal));
  console.log("test address balance:", hre.ethers.formatEther(testBalFinal));
  console.log("totalSupply:", hre.ethers.formatEther(supplyAfter));

  // Step 5: Assertions
  const expected = deployerBalBefore + hre.ethers.parseEther("1000") - hre.ethers.parseEther("100");
  console.log("\n--- Checks ---");
  console.log("Deployer = prev + 1000 - 100?", deployerBalFinal === expected ? "✓ PASS" : "✗ FAIL");
  console.log("Test addr = 100?", testBalFinal === hre.ethers.parseEther("100") ? "✓ PASS" : "✗ FAIL");
  console.log("Supply = prev + 1000?", supplyAfter === supplyBefore + hre.ethers.parseEther("1000") ? "✓ PASS" : "✗ FAIL");
  console.log("MAX_SUPPLY:", hre.ethers.formatEther(await jolToken.MAX_SUPPLY()));
  console.log("remainingSupply:", hre.ethers.formatEther(await jolToken.remainingSupply()));

  if (deployerBalFinal === expected && testBalFinal === hre.ethers.parseEther("100")) {
    console.log("\n═══ FLOW 1: PASS — Token is LIVE! ═══");
  } else {
    console.log("\n═══ FLOW 1: FAIL ═══");
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
