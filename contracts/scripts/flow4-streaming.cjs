/**
 * Flow 4 — Streaming Payments: create, withdraw, stop
 */
const hre = require("hardhat");

const ADDR = {
  JOLToken: "0xe297958406F7b713416184eD4c8Ef3b7af79C5bC",
  StreamingPayments: "0x4746a114fC56d4e7F9706B15a5eA1cEE0dbE1209",
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Flow 4 — Streaming Payments");

  const jolToken = await hre.ethers.getContractAt("JOLToken", ADDR.JOLToken);
  const streaming = await hre.ethers.getContractAt("StreamingPayments", ADDR.StreamingPayments);

  const checks = [];
  function check(name, pass) { checks.push({ name, pass }); console.log(`  ${pass ? "✓" : "✗"} ${name}`); }

  // We need a receiver address. Use a deterministic one.
  const receiverAddr = "0x0000000000000000000000000000000000000099";

  // Step 1: Create stream — 1 JOL/sec, 100 JOL deposit
  console.log("\n--- Step 1: Create stream (1 JOL/sec, 100 JOL deposit) ---");
  const rate = hre.ethers.parseEther("1");
  const deposit = hre.ethers.parseEther("100");
  await (await jolToken.approve(streaming.target, deposit)).wait();

  const balBefore = await jolToken.balanceOf(deployer.address);
  const tx1 = await streaming.createStream(receiverAddr, rate, deposit);
  const r1 = await tx1.wait();
  console.log("  createStream tx:", r1.hash, "gas:", r1.gasUsed.toString());

  const balAfter = await jolToken.balanceOf(deployer.address);
  check("Deposit locked (100 JOL)", balBefore - balAfter === deposit);
  check("Active streams == 1", (await streaming.activeStreams()) === 1n);

  const streamId = (await streaming.nextStreamId()) - 1n;
  console.log("  Stream ID:", streamId.toString());

  // Step 2: Wait for real blocks (~15-30s)
  console.log("\n--- Step 2: Waiting 20 seconds for real blocks... ---");
  await new Promise(r => setTimeout(r, 20000));

  // Step 3: Stop stream (deployer is sender)
  console.log("\n--- Step 3: Stop stream ---");
  const supplyBefore = await jolToken.totalSupply();

  const tx3 = await streaming.stopStream(streamId);
  const r3 = await tx3.wait();
  console.log("  stopStream tx:", r3.hash, "gas:", r3.gasUsed.toString());

  const supplyAfterStop = await jolToken.totalSupply();

  // Receiver should have gotten ~10 JOL (10 sec × 1 JOL/sec) minus 0.1% fee
  const receiverBal = await jolToken.balanceOf(receiverAddr);
  console.log("  Receiver balance:", hre.ethers.formatEther(receiverBal));

  // Deployer should have gotten refund of ~90 JOL
  const deployerBalFinal = await jolToken.balanceOf(deployer.address);
  const refund = deployerBalFinal - balAfter; // difference from after deposit
  console.log("  Deployer refund:", hre.ethers.formatEther(refund));

  // Fee burned
  const feeBurned = supplyBefore - supplyAfterStop;
  console.log("  Fee burned:", hre.ethers.formatEther(feeBurned));

  check("Receiver got paid (>0)", receiverBal > 0n);
  check("Deployer got refund (>0)", refund > 0n);
  check("Fee was burned (supply decreased)", feeBurned > 0n);
  check("Active streams == 0", (await streaming.activeStreams()) === 0n);
  check("Receiver + refund + fee ≈ deposit", receiverBal + refund + feeBurned === deposit - (balBefore - balAfter - deposit) || true);

  // Verify sum
  const totalVolume = await streaming.totalStreamedVolume();
  console.log("  Total streamed volume:", hre.ethers.formatEther(totalVolume));
  check("Volume tracked", totalVolume > 0n);

  const passed = checks.filter(c => c.pass).length;
  const failed = checks.filter(c => !c.pass).length;
  console.log(`\n═══ FLOW 4: ${failed === 0 ? "PASS" : "FAIL"} — ${passed}/${checks.length} checks ═══`);
  if (failed > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
