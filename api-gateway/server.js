/**
 * JOULE REST API Gateway
 *
 * HTTP API for Web2 companies to integrate JOL payments
 * without learning blockchain.
 *
 * Start: node server.js
 * Docs:  GET /
 *
 * Example:
 *   POST /api/pay { "to": "0x...", "amount": 1.5 }
 *   GET  /api/balance/0x...
 *   POST /api/stream { "to": "0x...", "rate": 0.001, "deposit": 10 }
 */

import express from 'express';
import { ethers } from 'ethers';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());

const RPC_URL = process.env.JOULE_RPC || 'http://127.0.0.1:8547';
const PORT = process.env.PORT || 3100;
const CHAIN_ID = 707070;

const provider = new ethers.JsonRpcProvider(RPC_URL);

// Minimal ABIs
const TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function transfer(address, uint256) returns (bool)',
  'function approve(address, uint256) returns (bool)',
];

const ADDRESSES = {
  JOLToken: process.env.JOL_TOKEN || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
};

// ─── Routes ────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    name: 'JOULE API Gateway',
    version: '0.1.0',
    chain: `JOULE (${CHAIN_ID})`,
    endpoints: {
      // Read (no auth needed)
      'GET /api/balance/:address': 'Get JOL balance',
      'GET /api/block': 'Current block number',
      'GET /api/supply': 'Total and max supply',
      'GET /api/mining': 'Mining era, reward, halving info',
      'GET /api/floor-price': 'Energy floor price (1 JOL = 1 kWh)',
      // Write (requires X-Private-Key header or API key)
      'POST /api/pay': 'Send JOL { to, amount }',
      'POST /api/stream': 'Start stream { to, ratePerSecond, deposit }',
    },
    docs: 'https://docs.joule.energy',
  });
});

// ─── Read Endpoints (public) ───────────────────────────────────

app.get('/api/balance/:address', async (req, res) => {
  try {
    const token = new ethers.Contract(ADDRESSES.JOLToken, TOKEN_ABI, provider);
    const balance = await token.balanceOf(req.params.address);
    const nativeBalance = await provider.getBalance(req.params.address);
    res.json({
      address: req.params.address,
      jol: ethers.formatEther(balance),
      nativeJOL: ethers.formatEther(nativeBalance),
      unit: 'JOL',
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/block', async (req, res) => {
  const block = await provider.getBlockNumber();
  const blockData = await provider.getBlock(block);
  res.json({
    number: block,
    timestamp: blockData.timestamp,
    hash: blockData.hash,
    miner: blockData.miner,
    gasUsed: blockData.gasUsed.toString(),
  });
});

app.get('/api/supply', async (req, res) => {
  const token = new ethers.Contract(ADDRESSES.JOLToken, TOKEN_ABI, provider);
  const total = await token.totalSupply();
  res.json({
    totalSupply: ethers.formatEther(total),
    maxSupply: '210000000',
    unit: 'JOL',
  });
});

app.get('/api/mining', async (req, res) => {
  const block = await provider.getBlockNumber();
  const halvingInterval = 2_102_400;
  const era = Math.floor(block / halvingInterval);
  const reward = era >= 10 ? 0 : 50 / Math.pow(2, era);
  res.json({
    blockNumber: block,
    era,
    blockReward: `${reward} JOL`,
    nextHalving: (era + 1) * halvingInterval,
    blocksUntilHalving: ((era + 1) * halvingInterval) - block,
    estimatedDaysUntilHalving: Math.round((((era + 1) * halvingInterval) - block) * 15 / 86400),
  });
});

app.get('/api/network', async (req, res) => {
  const block = await provider.getBlockNumber();
  const network = await provider.getNetwork();
  res.json({
    chainId: Number(network.chainId),
    name: 'JOULE',
    blockNumber: block,
    rpc: RPC_URL,
    consensus: 'EtHash-J (Proof of Work)',
    blockTime: '15 seconds',
    currency: 'JOL',
  });
});

// ─── Write Endpoints (require signer) ──────────────────────────

function getSigner(req) {
  const key = req.headers['x-private-key'];
  if (!key) throw new Error('Missing X-Private-Key header');
  return new ethers.Wallet(key, provider);
}

app.post('/api/pay', async (req, res) => {
  try {
    const { to, amount } = req.body;
    if (!to || !amount) return res.status(400).json({ error: 'Missing to or amount' });

    const signer = getSigner(req);
    const token = new ethers.Contract(ADDRESSES.JOLToken, TOKEN_ABI, signer);
    const tx = await token.transfer(to, ethers.parseEther(amount.toString()));
    const receipt = await tx.wait();

    res.json({
      success: true,
      txHash: receipt.hash,
      from: signer.address,
      to,
      amount: `${amount} JOL`,
      blockNumber: receipt.blockNumber,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── Webhook support for payment notifications ─────────────────

const webhooks = new Map();

app.post('/api/webhooks', (req, res) => {
  const { address, url } = req.body;
  if (!address || !url) return res.status(400).json({ error: 'Missing address or url' });
  webhooks.set(address.toLowerCase(), url);
  res.json({ success: true, watching: address });
});

// ─── Start ─────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`JOULE API Gateway running on port ${PORT}`);
  console.log(`Chain: JOULE (${CHAIN_ID})`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Docs: http://localhost:${PORT}/`);
});
