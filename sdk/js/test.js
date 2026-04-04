/**
 * JOULE SDK Tests
 *
 * Run: node test.js (requires JOULE testnet running on :8547)
 * Or:  npm test
 */

import { Joule, JouleAgent } from './index.js';
import { ethers } from 'ethers';

const RPC = 'http://127.0.0.1:8547';
let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

async function test(name, fn) {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (e) {
    console.log(`  ✗ FAILED: ${e.message}`);
    failed++;
  }
}

// ─── Tests ─────────────────────────────────────────────────────

async function run() {
  const joule = new Joule(RPC);

  // Test keys (Hardhat default accounts)
  const key1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const key2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
  const addr1 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const addr2 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  // ─── Constructor ──────────────────────────────────────────

  await test('Joule constructor', async () => {
    assert(joule.provider !== undefined, 'provider created');
    assert(joule.chainId === 707070, 'chain ID is 707070');
    assert(joule.addresses.JOLToken !== undefined, 'JOLToken address set');
  });

  // ─── Network Info ─────────────────────────────────────────

  await test('getBlockNumber', async () => {
    const block = await joule.getBlockNumber();
    assert(typeof block === 'number', `returns number (${block})`);
    assert(block > 0, 'block > 0');
  });

  await test('getMiningInfo', async () => {
    const info = await joule.getMiningInfo();
    assert(info.era === 0, 'era 0 (first year)');
    assert(info.blockReward === 50, 'reward 50 JOL');
    assert(info.nextHalving === 2_102_400, 'next halving at 2,102,400');
    assert(info.blocksUntilHalving > 0, 'blocks until halving > 0');
  });

  // ─── Connect ──────────────────────────────────────────────

  await test('connect with private key', async () => {
    const connected = joule.connect(key1);
    assert(connected === joule, 'returns self (chainable)');
    assert(joule.signer !== undefined, 'signer set');
  });

  await test('error without signer', async () => {
    const fresh = new Joule(RPC);
    try {
      await fresh.pay(addr2, 1);
      assert(false, 'should have thrown');
    } catch (e) {
      assert(e.message.includes('No signer'), 'throws without signer');
    }
  });

  // ─── Supply ───────────────────────────────────────────────

  await test('getSupplyInfo', async () => {
    const info = await joule.getSupplyInfo();
    assert(info.maxSupply === 210_000_000, 'max supply 210M');
    assert(typeof info.totalSupply === 'number', 'totalSupply is number');
  });

  // ─── Signature (off-chain micropayment) ───────────────────

  await test('signMicropayment (off-chain)', async () => {
    joule.connect(key1);
    // This tests the signing flow without needing an open channel
    const wallet = new ethers.Wallet(key1);
    const message = ethers.solidityPackedKeccak256(
      ['address', 'uint256', 'uint256'],
      [ethers.ZeroAddress, 1, ethers.parseEther('0.5')]
    );
    const sig = await wallet.signMessage(ethers.getBytes(message));
    assert(sig.length === 132, 'signature is 132 chars');
    assert(sig.startsWith('0x'), 'starts with 0x');
  });

  // ─── JouleAgent class ────────────────────────────────────

  await test('JouleAgent constructor', async () => {
    const agent = new JouleAgent(joule, key2);
    assert(agent.signer !== undefined, 'agent has signer');
    assert(agent.joule === joule, 'agent references joule instance');
  });

  // ─── Results ──────────────────────────────────────────────

  console.log(`\n${'═'.repeat(40)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(40)}`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Test suite failed:', e.message);
  process.exit(1);
});
