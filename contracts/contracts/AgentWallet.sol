// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./JOLToken.sol";
import "./MachineRegistry.sol";

/**
 * @title AgentWallet
 * @notice Autonomous wallets for AI agents and machines.
 *
 * AI agents need to spend money WITHOUT human approval for every transaction.
 * But humans need GUARDRAILS to prevent runaway spending.
 *
 * AgentWallet solves this:
 * - Human sets spending limits (per-tx, daily, monthly)
 * - Human whitelists allowed recipients
 * - Agent spends autonomously within limits
 * - Emergency kill switch (human can freeze instantly)
 * - Full audit trail on-chain
 *
 * Use cases:
 * - Claude/GPT agent buys compute on JOULE network
 * - Trading bot executes within daily limit
 * - IoT device pays for energy autonomously
 * - Fleet of EVs each has own wallet with fuel budget
 */
contract AgentWallet is ReentrancyGuard {
    JOLToken public jolToken;
    MachineRegistry public machineRegistry;

    struct Wallet {
        uint256 id;
        address owner;          // human controller
        address agent;          // AI/machine address that can spend
        uint256 balance;
        // Limits
        uint256 maxPerTransaction;
        uint256 maxDailySpend;
        uint256 maxMonthlySpend;
        // Tracking
        uint256 dailySpent;
        uint256 monthlySpent;
        uint256 lastDayReset;
        uint256 lastMonthReset;
        uint256 totalSpent;
        uint256 totalTransactions;
        // State
        bool active;
        bool frozen;            // emergency kill switch
    }

    uint256 public nextWalletId = 1;
    mapping(uint256 => Wallet) public wallets;
    mapping(address => uint256) public agentToWallet;
    mapping(address => uint256[]) public ownerWallets;

    // Whitelist: wallet ID → allowed recipient → allowed
    mapping(uint256 => mapping(address => bool)) public whitelist;
    // If true, only whitelisted recipients allowed
    mapping(uint256 => bool) public whitelistEnabled;

    // Stats
    uint256 public totalWallets;
    uint256 public totalAgentTransactions;
    uint256 public totalAgentVolume;

    event WalletCreated(uint256 indexed id, address owner, address agent);
    event AgentSpent(uint256 indexed walletId, address to, uint256 amount, string memo);
    event WalletFunded(uint256 indexed walletId, uint256 amount);
    event WalletFrozen(uint256 indexed walletId);
    event WalletUnfrozen(uint256 indexed walletId);
    event LimitsUpdated(uint256 indexed walletId, uint256 perTx, uint256 daily, uint256 monthly);
    event WhitelistUpdated(uint256 indexed walletId, address recipient, bool allowed);

    constructor(address _jolToken, address _machineRegistry) {
        jolToken = JOLToken(_jolToken);
        machineRegistry = MachineRegistry(_machineRegistry);
    }

    // ─── Wallet Management (human owner) ───────────────────────────

    /**
     * @notice Create an agent wallet with spending limits
     */
    function createWallet(
        address _agent,
        uint256 _maxPerTransaction,
        uint256 _maxDailySpend,
        uint256 _maxMonthlySpend
    ) external returns (uint256) {
        require(_agent != address(0), "Invalid agent");
        require(agentToWallet[_agent] == 0, "Agent already has wallet");
        require(_maxPerTransaction > 0, "Zero per-tx limit");

        uint256 id = nextWalletId++;
        wallets[id] = Wallet({
            id: id,
            owner: msg.sender,
            agent: _agent,
            balance: 0,
            maxPerTransaction: _maxPerTransaction,
            maxDailySpend: _maxDailySpend,
            maxMonthlySpend: _maxMonthlySpend,
            dailySpent: 0,
            monthlySpent: 0,
            lastDayReset: block.timestamp,
            lastMonthReset: block.timestamp,
            totalSpent: 0,
            totalTransactions: 0,
            active: true,
            frozen: false
        });

        agentToWallet[_agent] = id;
        ownerWallets[msg.sender].push(id);
        totalWallets++;

        emit WalletCreated(id, msg.sender, _agent);
        return id;
    }

    /**
     * @notice Fund an agent wallet
     */
    function fundWallet(uint256 _walletId, uint256 _amount) external nonReentrant {
        Wallet storage w = wallets[_walletId];
        require(w.active, "Not active");
        w.balance += _amount;
        require(jolToken.transferFrom(msg.sender, address(this), _amount), "Transfer failed");
        emit WalletFunded(_walletId, _amount);
    }

    /**
     * @notice Emergency freeze (human can stop agent instantly)
     */
    function freezeWallet(uint256 _walletId) external {
        require(wallets[_walletId].owner == msg.sender, "Not owner");
        wallets[_walletId].frozen = true;
        emit WalletFrozen(_walletId);
    }

    function unfreezeWallet(uint256 _walletId) external {
        require(wallets[_walletId].owner == msg.sender, "Not owner");
        wallets[_walletId].frozen = false;
        emit WalletUnfrozen(_walletId);
    }

    /**
     * @notice Update spending limits
     */
    function updateLimits(
        uint256 _walletId,
        uint256 _maxPerTx,
        uint256 _maxDaily,
        uint256 _maxMonthly
    ) external {
        require(wallets[_walletId].owner == msg.sender, "Not owner");
        Wallet storage w = wallets[_walletId];
        w.maxPerTransaction = _maxPerTx;
        w.maxDailySpend = _maxDaily;
        w.maxMonthlySpend = _maxMonthly;
        emit LimitsUpdated(_walletId, _maxPerTx, _maxDaily, _maxMonthly);
    }

    /**
     * @notice Manage whitelist
     */
    function setWhitelist(uint256 _walletId, address _recipient, bool _allowed) external {
        require(wallets[_walletId].owner == msg.sender, "Not owner");
        whitelist[_walletId][_recipient] = _allowed;
        emit WhitelistUpdated(_walletId, _recipient, _allowed);
    }

    function setWhitelistEnabled(uint256 _walletId, bool _enabled) external {
        require(wallets[_walletId].owner == msg.sender, "Not owner");
        whitelistEnabled[_walletId] = _enabled;
    }

    /**
     * @notice Withdraw remaining balance (human owner only)
     */
    function withdrawBalance(uint256 _walletId, uint256 _amount) external nonReentrant {
        Wallet storage w = wallets[_walletId];
        require(w.owner == msg.sender, "Not owner");
        require(_amount <= w.balance, "Insufficient balance");
        w.balance -= _amount;
        require(jolToken.transfer(msg.sender, _amount), "Transfer failed");
    }

    // ─── Agent Spending (AI/machine calls this) ────────────────────

    /**
     * @notice Agent spends JOL autonomously within limits.
     * This is the KEY function — AI agents call this to pay for services.
     */
    function agentSpend(
        address _to,
        uint256 _amount,
        string calldata _memo
    ) external nonReentrant {
        uint256 walletId = agentToWallet[msg.sender];
        require(walletId != 0, "No wallet for this agent");

        Wallet storage w = wallets[walletId];
        require(w.active && !w.frozen, "Wallet frozen or inactive");
        require(_amount <= w.balance, "Insufficient balance");
        require(_amount <= w.maxPerTransaction, "Exceeds per-tx limit");

        // Whitelist check
        if (whitelistEnabled[walletId]) {
            require(whitelist[walletId][_to], "Recipient not whitelisted");
        }

        // Reset daily/monthly counters if needed
        _resetCounters(w);

        // Daily limit check
        require(w.dailySpent + _amount <= w.maxDailySpend, "Exceeds daily limit");
        // Monthly limit check
        require(w.monthlySpent + _amount <= w.maxMonthlySpend, "Exceeds monthly limit");

        // Execute spend
        w.balance -= _amount;
        w.dailySpent += _amount;
        w.monthlySpent += _amount;
        w.totalSpent += _amount;
        w.totalTransactions++;
        totalAgentTransactions++;
        totalAgentVolume += _amount;

        require(jolToken.transfer(_to, _amount), "Transfer failed");

        // Record in machine registry if applicable (wrapped to prevent DoS)
        try machineRegistry.recordTransaction(msg.sender, _amount, true) {} catch {}

        emit AgentSpent(walletId, _to, _amount, _memo);
    }

    function _resetCounters(Wallet storage w) internal {
        // Reset daily counter
        if (block.timestamp - w.lastDayReset >= 1 days) {
            w.dailySpent = 0;
            w.lastDayReset = block.timestamp;
        }
        // Reset monthly counter
        if (block.timestamp - w.lastMonthReset >= 30 days) {
            w.monthlySpent = 0;
            w.lastMonthReset = block.timestamp;
        }
    }

    // ─── Views ─────────────────────────────────────────────────────

    function getRemainingDailyBudget(uint256 _walletId) external view returns (uint256) {
        Wallet storage w = wallets[_walletId];
        if (block.timestamp - w.lastDayReset >= 1 days) return w.maxDailySpend;
        if (w.dailySpent >= w.maxDailySpend) return 0;
        return w.maxDailySpend - w.dailySpent;
    }

    function getRemainingMonthlyBudget(uint256 _walletId) external view returns (uint256) {
        Wallet storage w = wallets[_walletId];
        if (block.timestamp - w.lastMonthReset >= 30 days) return w.maxMonthlySpend;
        if (w.monthlySpent >= w.maxMonthlySpend) return 0;
        return w.maxMonthlySpend - w.monthlySpent;
    }

    function getWalletByAgent(address _agent) external view returns (uint256) {
        return agentToWallet[_agent];
    }

    function getOwnerWallets(address _owner) external view returns (uint256[] memory) {
        return ownerWallets[_owner];
    }
}
