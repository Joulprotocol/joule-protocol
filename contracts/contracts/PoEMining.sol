// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./JOLToken.sol";
import "./EnergyRegistry.sol";

/**
 * @title PoEMining
 * @notice Proof-of-Energy mining with DYNAMIC reward multiplier.
 *
 * The multiplier adjusts automatically based on the ratio of energy producers
 * to total miners — like Bitcoin's difficulty adjustment, but for incentives.
 *
 * Few energy producers  → high multiplier (attract them)
 * Many energy producers → lower multiplier (they come for the ecosystem)
 *
 * Recalculated every 10,000 blocks (~42 hours).
 * Smooth transitions: moves 0.1x at a time, never jumps.
 * DAO can set minimum floor (default 1.2x — energy always valued more than GPU).
 *
 * ONLY renewable energy: Solar, Wind, Hydro, Geothermal.
 * No biomass, no nuclear, no fossil. Period.
 */
contract PoEMining is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    uint256 public constant ORACLE_FEE_BPS = 200;              // 2%
    uint256 public constant MAX_POE_SUPPLY = 42_000_000 ether;  // 20% of total
    uint256 public constant ADJUSTMENT_INTERVAL = 10_000;       // blocks between adjustments (~42h)
    uint256 public constant MULTIPLIER_STEP = 100;              // 0.1x in basis points (1000 = 1x)
    uint256 public constant BASE_MULTIPLIER = 1000;             // 1.0x = 1000 basis points

    JOLToken public jolToken;
    EnergyRegistry public registry;

    // ─── Dynamic Multiplier State ──────────────────────────────
    uint256 public currentMultiplier = 5000;  // starts at 5.0x (bootstrap phase)
    uint256 public minMultiplier = 1200;      // floor 1.2x — energy ALWAYS valued more
    uint256 public maxMultiplier = 5000;      // ceiling 5.0x
    uint256 public lastAdjustmentBlock;

    // Tracking for ratio calculation
    uint256 public currentEpochPoEMiners;     // unique PoE miners this epoch
    uint256 public currentEpochPoWBlocks;     // PoW blocks mined this epoch (approximated by interval)
    mapping(uint256 => mapping(address => bool)) public epochPoEActive; // epoch → address → counted

    // ─── Core State ────────────────────────────────────────────
    uint256 public totalPoEMinted;
    uint256 public totalKWhRewarded;

    mapping(address => uint256) public pendingRewards;
    mapping(address => uint256) public totalClaimed;
    mapping(address => uint256) public oracleEarnings;

    // Daily caps
    mapping(uint256 => mapping(uint256 => uint256)) public dailyProduction;
    uint256 public constant MAX_DAILY_HOURS = 24;

    // ─── Events ────────────────────────────────────────────────
    event RewardAccrued(address indexed producer, uint256 facilityId, uint256 kWh, uint256 jolReward, uint256 multiplier);
    event RewardClaimed(address indexed producer, uint256 amount);
    event OracleFeePaid(address indexed oracle, uint256 amount);
    event MultiplierAdjusted(uint256 oldMultiplier, uint256 newMultiplier, uint256 poeMiners, uint256 epoch);
    event MinMultiplierUpdated(uint256 newMin);

    constructor(
        address admin,
        address _jolToken,
        address _registry
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
        registry = EnergyRegistry(_registry);
        lastAdjustmentBlock = block.number;
    }

    // ─── Dynamic Multiplier Logic ──────────────────────────────

    /**
     * @notice Get current JOL reward per kWh (dynamic)
     *
     * Base: 1 JOL per kWh × multiplier
     * Multiplier adjusts based on PoE adoption:
     *   0-10% PoE miners  → 5.0x (aggressive bootstrap)
     *   10-30%             → 3.0x (growth phase)
     *   30-50%             → 2.0x (maturity)
     *   50%+               → 1.5x (ecosystem established)
     *   Floor:             → 1.2x (energy always valued more)
     */
    function getJolPerKWh() public view returns (uint256) {
        // currentMultiplier is in basis points: 5000 = 5.0x, 1200 = 1.2x
        // Return in wei: multiplier/1000 * 1 ether
        return (currentMultiplier * 1 ether) / 1000;
    }

    /**
     * @notice Recalculate multiplier based on PoE/PoW ratio.
     * Called automatically during accrueReward, or manually by anyone.
     */
    function adjustMultiplier() public {
        if (block.number < lastAdjustmentBlock + ADJUSTMENT_INTERVAL) return;

        uint256 oldMultiplier = currentMultiplier;
        uint256 targetMultiplier;

        // Calculate PoE ratio
        // Use currentEpochPoEMiners vs ADJUSTMENT_INTERVAL as proxy
        // (PoW blocks ≈ ADJUSTMENT_INTERVAL since 1 block = 1 PoW miner action)
        uint256 poeCount = currentEpochPoEMiners;
        uint256 totalActivity = ADJUSTMENT_INTERVAL; // PoW blocks in epoch

        if (totalActivity == 0) {
            targetMultiplier = maxMultiplier;
        } else {
            // PoE ratio as percentage (0-100)
            uint256 poePercent = 0;
            if (poeCount > 0) {
                // Approximate: each PoE miner is "equivalent" to ~100 blocks of activity
                poePercent = (poeCount * 100 * 100) / (poeCount * 100 + totalActivity);
            }

            if (poePercent < 10) {
                targetMultiplier = 5000;       // 5.0x — bootstrap
            } else if (poePercent < 30) {
                targetMultiplier = 3000;       // 3.0x — growth
            } else if (poePercent < 50) {
                targetMultiplier = 2000;       // 2.0x — maturity
            } else {
                targetMultiplier = 1500;       // 1.5x — established
            }
        }

        // Enforce floor
        if (targetMultiplier < minMultiplier) {
            targetMultiplier = minMultiplier;
        }

        // Smooth transition: move max 0.1x per epoch
        if (targetMultiplier > currentMultiplier) {
            uint256 diff = targetMultiplier - currentMultiplier;
            if (diff > MULTIPLIER_STEP) diff = MULTIPLIER_STEP;
            currentMultiplier += diff;
        } else if (targetMultiplier < currentMultiplier) {
            uint256 diff = currentMultiplier - targetMultiplier;
            if (diff > MULTIPLIER_STEP) diff = MULTIPLIER_STEP;
            currentMultiplier -= diff;
        }

        // Enforce bounds
        if (currentMultiplier < minMultiplier) currentMultiplier = minMultiplier;
        if (currentMultiplier > maxMultiplier) currentMultiplier = maxMultiplier;

        // Reset epoch counters
        lastAdjustmentBlock = block.number;
        currentEpochPoEMiners = 0;

        emit MultiplierAdjusted(oldMultiplier, currentMultiplier, poeCount, block.number / ADJUSTMENT_INTERVAL);
    }

    /**
     * @notice DAO can update minimum multiplier floor.
     * Energy production should ALWAYS be rewarded more than pure GPU mining.
     */
    function setMinMultiplier(uint256 _newMin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newMin >= 1000 && _newMin <= 5000, "Min must be 1.0x-5.0x");
        minMultiplier = _newMin;
        if (currentMultiplier < minMultiplier) currentMultiplier = minMultiplier;
        emit MinMultiplierUpdated(_newMin);
    }

    // ─── Core Mining Logic ─────────────────────────────────────

    /**
     * @notice Accrue PoE reward for verified energy production.
     * Reward = kWh × dynamic multiplier × (1 - oracle fee).
     */
    function accrueReward(
        uint256 _facilityId,
        uint256 _verifiedKWh
    ) external onlyRole(ORACLE_ROLE) {
        require(_verifiedKWh > 0, "Zero production");

        // Try to adjust multiplier if epoch passed
        adjustMultiplier();

        // Calculate dynamic reward
        uint256 jolPerKWh = getJolPerKWh();
        uint256 grossReward = _verifiedKWh * jolPerKWh;
        require(totalPoEMinted + grossReward <= MAX_POE_SUPPLY, "PoE supply exhausted");

        // Daily cap check
        uint256 today = block.timestamp / 1 days;
        dailyProduction[_facilityId][today] += _verifiedKWh;

        (, , , uint256 capacityKW, , , , , , , , , ) = registry.facilities(_facilityId);
        require(
            dailyProduction[_facilityId][today] <= capacityKW * MAX_DAILY_HOURS,
            "Daily cap exceeded"
        );

        // Track unique PoE miners this epoch
        address producer = registry.facilityOwner(_facilityId);
        uint256 currentEpoch = block.number / ADJUSTMENT_INTERVAL;
        if (!epochPoEActive[currentEpoch][producer]) {
            epochPoEActive[currentEpoch][producer] = true;
            currentEpochPoEMiners++;
        }

        // Calculate distributions
        uint256 oracleFee = (grossReward * ORACLE_FEE_BPS) / 10000;
        uint256 producerReward = grossReward - oracleFee;

        // Accrue rewards
        pendingRewards[producer] += producerReward;
        oracleEarnings[msg.sender] += oracleFee;

        totalPoEMinted += grossReward;
        totalKWhRewarded += _verifiedKWh;

        emit RewardAccrued(producer, _facilityId, _verifiedKWh, producerReward, currentMultiplier);
    }

    /**
     * @notice Claim accrued PoE mining rewards
     */
    function claimRewards() external {
        uint256 amount = pendingRewards[msg.sender];
        require(amount > 0, "No pending rewards");

        pendingRewards[msg.sender] = 0;
        totalClaimed[msg.sender] += amount;

        jolToken.mint(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }

    /**
     * @notice Claim oracle earnings
     */
    function claimOracleEarnings() external {
        uint256 amount = oracleEarnings[msg.sender];
        require(amount > 0, "No oracle earnings");

        oracleEarnings[msg.sender] = 0;
        jolToken.mint(msg.sender, amount);
        emit OracleFeePaid(msg.sender, amount);
    }

    // ─── Views ─────────────────────────────────────────────────

    function remainingPoESupply() external view returns (uint256) {
        return MAX_POE_SUPPLY - totalPoEMinted;
    }

    function getClaimable(address _account) external view returns (uint256) {
        return pendingRewards[_account];
    }

    /**
     * @notice Current multiplier as human-readable string (e.g., "3.5x")
     */
    function getMultiplierDisplay() external view returns (uint256 whole, uint256 decimal) {
        whole = currentMultiplier / 1000;
        decimal = (currentMultiplier % 1000) / 100;
    }

    /**
     * @notice Blocks until next multiplier adjustment
     */
    function blocksUntilAdjustment() external view returns (uint256) {
        uint256 nextAdjustment = lastAdjustmentBlock + ADJUSTMENT_INTERVAL;
        if (block.number >= nextAdjustment) return 0;
        return nextAdjustment - block.number;
    }
}
