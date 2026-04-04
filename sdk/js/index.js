/**
 * JOULE SDK — Programmable Energy Payments
 *
 * Usage:
 *   import { Joule } from 'joule-sdk';
 *   const joule = new Joule('http://rpc.joule.energy');
 *   await joule.pay('0xRecipient...', 1.5);  // pay 1.5 JOL
 *
 * For machines:
 *   const agent = joule.createAgent(privateKey, { dailyLimit: 100 });
 *   await agent.payForCompute('0xGPU...', 0.001);  // per-inference
 *
 * For energy:
 *   await joule.redeemEnergy('0xProducer...', 50);  // 50 kWh
 */

import { ethers } from 'ethers';

// Contract ABIs (minimal)
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const ENERGY_PEG_ABI = [
  'function redeemForEnergy(address producer, uint256 kWh) external',
  'function floorPriceUSDCents() view returns (uint256)',
  'function totalEnergyReserveKWh() view returns (uint256)',
  'function backingRatio() view returns (uint256)',
];

const PAYMENT_CHANNEL_ABI = [
  'function openChannel(address receiver, uint256 deposit, uint256 duration) returns (uint256)',
  'function closeChannel(uint256 channelId, uint256 amount, bytes signature) external',
  'function getMessageHash(uint256 channelId, uint256 amount) view returns (bytes32)',
];

const STREAMING_ABI = [
  'function createStream(address receiver, uint256 ratePerSecond, uint256 deposit) returns (uint256)',
  'function stopStream(uint256 streamId) external',
  'function withdrawFromStream(uint256 streamId) external',
  'function getAvailableBalance(uint256 streamId) view returns (uint256)',
];

const AGENT_WALLET_ABI = [
  'function createWallet(address agent, uint256 maxPerTx, uint256 maxDaily, uint256 maxMonthly) returns (uint256)',
  'function fundWallet(uint256 walletId, uint256 amount) external',
  'function agentSpend(address to, uint256 amount, string memo) external',
  'function freezeWallet(uint256 walletId) external',
  'function getRemainingDailyBudget(uint256 walletId) view returns (uint256)',
];

const MACHINE_REGISTRY_ABI = [
  'function registerMachine(address wallet, uint8 type, string manufacturer, string model, bytes32 firmwareHash, int64 lat, int64 lon) returns (uint256)',
  'function isVerified(address wallet) view returns (bool)',
  'function getReputation(address wallet) view returns (uint256)',
  'function getDID(uint256 id) view returns (string)',
];

const CARBON_CREDIT_ABI = [
  'function totalCO2OffsetTonnes() view returns (uint256)',
  'function totalCreditsIssued() view returns (uint256)',
  'function getCreditDetails(uint256 id) view returns (address, uint256, uint256, string, string, bool, bool)',
];

// Default contract addresses (testnet)
const TESTNET_ADDRESSES = {
  JOLToken: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  EnergyPeg: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  PaymentChannel: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
  StreamingPayments: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
  AgentWallet: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
  MachineRegistry: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
  CarbonCredit: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
};

/**
 * Main JOULE SDK class
 */
export class Joule {
  constructor(rpcUrl = 'http://127.0.0.1:8547', options = {}) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.addresses = options.addresses || TESTNET_ADDRESSES;
    this.chainId = 707070;
  }

  /**
   * Connect with a private key (for sending transactions)
   */
  connect(privateKey) {
    this.signer = new ethers.Wallet(privateKey, this.provider);
    return this;
  }

  /**
   * Connect with a wallet/signer
   */
  connectSigner(signer) {
    this.signer = signer;
    return this;
  }

  // ─── Token Operations ──────────────────────────────────────────

  /**
   * Get JOL balance for an address
   */
  async getBalance(address) {
    const token = new ethers.Contract(this.addresses.JOLToken, ERC20_ABI, this.provider);
    const balance = await token.balanceOf(address);
    return parseFloat(ethers.formatEther(balance));
  }

  /**
   * Pay JOL to someone — the simplest operation
   * @example await joule.pay('0x123...', 1.5)
   */
  async pay(to, amount) {
    this._requireSigner();
    const token = new ethers.Contract(this.addresses.JOLToken, ERC20_ABI, this.signer);
    const tx = await token.transfer(to, ethers.parseEther(amount.toString()));
    return tx.wait();
  }

  /**
   * Get total supply and circulating info
   */
  async getSupplyInfo() {
    const token = new ethers.Contract(this.addresses.JOLToken, ERC20_ABI, this.provider);
    const total = await token.totalSupply();
    return {
      totalSupply: parseFloat(ethers.formatEther(total)),
      maxSupply: 210_000_000,
    };
  }

  // ─── Energy Operations ─────────────────────────────────────────

  /**
   * Get the energy floor price (1 JOL = 1 kWh)
   */
  async getFloorPrice() {
    const peg = new ethers.Contract(this.addresses.EnergyPeg, ENERGY_PEG_ABI, this.provider);
    const cents = await peg.floorPriceUSDCents();
    return Number(cents) / 100; // return in USD
  }

  /**
   * Get total energy backing the network
   */
  async getEnergyReserve() {
    const peg = new ethers.Contract(this.addresses.EnergyPeg, ENERGY_PEG_ABI, this.provider);
    const kWh = await peg.totalEnergyReserveKWh();
    return Number(kWh);
  }

  /**
   * Redeem JOL for energy (1 JOL = 1 kWh)
   * @example await joule.redeemEnergy('0xProducer', 50) // get 50 kWh
   */
  async redeemEnergy(producerAddress, kWh) {
    this._requireSigner();
    const peg = new ethers.Contract(this.addresses.EnergyPeg, ENERGY_PEG_ABI, this.signer);
    const tx = await peg.redeemForEnergy(producerAddress, kWh);
    return tx.wait();
  }

  // ─── Payment Channels (Micropayments) ──────────────────────────

  /**
   * Open a payment channel for micropayments
   * @example const ch = await joule.openChannel('0xCharger', 10, 3600) // 10 JOL, 1 hour
   */
  async openChannel(receiver, depositJOL, durationSeconds) {
    this._requireSigner();
    const token = new ethers.Contract(this.addresses.JOLToken, ERC20_ABI, this.signer);
    const channel = new ethers.Contract(this.addresses.PaymentChannel, PAYMENT_CHANNEL_ABI, this.signer);
    const amount = ethers.parseEther(depositJOL.toString());

    await (await token.approve(this.addresses.PaymentChannel, amount)).wait();
    const tx = await channel.openChannel(receiver, amount, durationSeconds);
    const receipt = await tx.wait();
    return receipt;
  }

  /**
   * Sign an off-chain micropayment (FREE, INSTANT)
   * @example const sig = await joule.signMicropayment(channelId, 0.001)
   */
  async signMicropayment(channelId, amountJOL) {
    this._requireSigner();
    const channel = new ethers.Contract(this.addresses.PaymentChannel, PAYMENT_CHANNEL_ABI, this.provider);
    const amount = ethers.parseEther(amountJOL.toString());
    const hash = await channel.getMessageHash(channelId, amount);
    const signature = await this.signer.signMessage(ethers.getBytes(hash));
    return { channelId, amount: amountJOL, signature };
  }

  // ─── Streaming Payments ────────────────────────────────────────

  /**
   * Start streaming payments (per-second)
   * @example await joule.startStream('0xGPU', 0.001, 100) // 0.001 JOL/sec, 100 JOL deposit
   */
  async startStream(receiver, jolPerSecond, depositJOL) {
    this._requireSigner();
    const token = new ethers.Contract(this.addresses.JOLToken, ERC20_ABI, this.signer);
    const streaming = new ethers.Contract(this.addresses.StreamingPayments, STREAMING_ABI, this.signer);
    const deposit = ethers.parseEther(depositJOL.toString());
    const rate = ethers.parseEther(jolPerSecond.toString());

    await (await token.approve(this.addresses.StreamingPayments, deposit)).wait();
    const tx = await streaming.createStream(receiver, rate, deposit);
    return tx.wait();
  }

  /**
   * Stop a stream
   */
  async stopStream(streamId) {
    this._requireSigner();
    const streaming = new ethers.Contract(this.addresses.StreamingPayments, STREAMING_ABI, this.signer);
    const tx = await streaming.stopStream(streamId);
    return tx.wait();
  }

  // ─── AI Agent Wallets ──────────────────────────────────────────

  /**
   * Create an autonomous wallet for an AI agent
   * @example const walletId = await joule.createAgentWallet('0xAgent', 1, 50, 500)
   */
  async createAgentWallet(agentAddress, maxPerTxJOL, maxDailyJOL, maxMonthlyJOL) {
    this._requireSigner();
    const agent = new ethers.Contract(this.addresses.AgentWallet, AGENT_WALLET_ABI, this.signer);
    const tx = await agent.createWallet(
      agentAddress,
      ethers.parseEther(maxPerTxJOL.toString()),
      ethers.parseEther(maxDailyJOL.toString()),
      ethers.parseEther(maxMonthlyJOL.toString())
    );
    return tx.wait();
  }

  /**
   * Fund an agent wallet
   */
  async fundAgent(walletId, amountJOL) {
    this._requireSigner();
    const token = new ethers.Contract(this.addresses.JOLToken, ERC20_ABI, this.signer);
    const agent = new ethers.Contract(this.addresses.AgentWallet, AGENT_WALLET_ABI, this.signer);
    const amount = ethers.parseEther(amountJOL.toString());

    await (await token.approve(this.addresses.AgentWallet, amount)).wait();
    const tx = await agent.fundWallet(walletId, amount);
    return tx.wait();
  }

  /**
   * Emergency freeze an agent wallet
   */
  async freezeAgent(walletId) {
    this._requireSigner();
    const agent = new ethers.Contract(this.addresses.AgentWallet, AGENT_WALLET_ABI, this.signer);
    const tx = await agent.freezeWallet(walletId);
    return tx.wait();
  }

  // ─── Machine Identity ──────────────────────────────────────────

  /**
   * Check if a machine is verified
   */
  async isMachineVerified(walletAddress) {
    const reg = new ethers.Contract(this.addresses.MachineRegistry, MACHINE_REGISTRY_ABI, this.provider);
    return reg.isVerified(walletAddress);
  }

  /**
   * Get machine reputation (0-100%)
   */
  async getMachineReputation(walletAddress) {
    const reg = new ethers.Contract(this.addresses.MachineRegistry, MACHINE_REGISTRY_ABI, this.provider);
    const score = await reg.getReputation(walletAddress);
    return Number(score) / 100; // basis points to percent
  }

  // ─── Carbon Credits ────────────────────────────────────────────

  /**
   * Get total CO2 offset by the network
   */
  async getTotalCO2Offset() {
    const carbon = new ethers.Contract(this.addresses.CarbonCredit, CARBON_CREDIT_ABI, this.provider);
    const tonnes = await carbon.totalCO2OffsetTonnes();
    return Number(tonnes);
  }

  // ─── Network Info ──────────────────────────────────────────────

  /**
   * Get current block number
   */
  async getBlockNumber() {
    return this.provider.getBlockNumber();
  }

  /**
   * Get current mining era and reward
   */
  async getMiningInfo() {
    const block = await this.provider.getBlockNumber();
    const halvingInterval = 2_102_400;
    const era = Math.floor(block / halvingInterval);
    const reward = era >= 10 ? 0 : 50 / Math.pow(2, era);
    return {
      blockNumber: block,
      era,
      blockReward: reward,
      nextHalving: (era + 1) * halvingInterval,
      blocksUntilHalving: ((era + 1) * halvingInterval) - block,
    };
  }

  // ─── Internal ──────────────────────────────────────────────────

  _requireSigner() {
    if (!this.signer) {
      throw new Error('No signer connected. Call joule.connect(privateKey) first.');
    }
  }
}

/**
 * Agent class — for AI agents that spend JOL autonomously
 */
export class JouleAgent {
  constructor(joule, privateKey) {
    this.joule = joule;
    this.signer = new ethers.Wallet(privateKey, joule.provider);
    this.agentWallet = new ethers.Contract(
      joule.addresses.AgentWallet,
      AGENT_WALLET_ABI,
      this.signer
    );
  }

  /**
   * Spend JOL for a service (within limits set by human owner)
   * @example await agent.spend('0xGPUProvider', 0.001, 'inference-gpt4')
   */
  async spend(to, amountJOL, memo = '') {
    const tx = await this.agentWallet.agentSpend(
      to,
      ethers.parseEther(amountJOL.toString()),
      memo
    );
    return tx.wait();
  }

  /**
   * Check remaining daily budget
   */
  async getRemainingBudget(walletId) {
    const remaining = await this.agentWallet.getRemainingDailyBudget(walletId);
    return parseFloat(ethers.formatEther(remaining));
  }
}

// Default export
export default Joule;
