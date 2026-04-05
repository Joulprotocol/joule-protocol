// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./JOLToken.sol";
import "./EnergyRegistry.sol";

/**
 * @title PoEMining
 * @notice Proof-of-Energy mining with fixed 3× reward multiplier.
 *
 * 70% total mining = PoW blocks + PoE rewards = 147,000,000 JOL
 * PoE producers get 3× the reward per kWh vs base PoW block reward.
 * Supply cap enforced by JOLToken (210M MAX_SUPPLY).
 *
 * ONLY renewable energy: Solar, Wind, Hydro, Geothermal.
 * No biomass, no nuclear, no fossil. Period.
 */
contract PoEMining is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    uint256 public constant ORACLE_FEE_BPS = 200;              // 2%
    uint256 public constant POE_REWARD_MULTIPLIER = 3;          // PoE gets 3× vs PoW from same pool
    uint256 public constant ADJUSTMENT_INTERVAL = 10_000;       // blocks between adjustments (~42h)
    uint256 public constant MULTIPLIER_STEP = 100;              // 0.1x in basis points (1000 = 1x)
    uint256 public constant BASE_MULTIPLIER = 1000;             // 1.0x = 1000 basis points
    uint256 public constant HARMONIC_EPOCH = 432;               // blocks between harmonic checks

    JOLToken public jolToken;
    EnergyRegistry public registry;

    uint256 public lastAdjustmentBlock;

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

    /**
     * @notice Get current JOL reward per kWh.
     * PoE gets 3× the base PoW reward from the same 147M mining pool.
     * Base: 1 JOL per kWh × POE_REWARD_MULTIPLIER (3×)
     */
    function getJolPerKWh() public pure returns (uint256) {
        return POE_REWARD_MULTIPLIER * 1 ether;
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

        // Calculate reward: kWh × 3× multiplier (from same 147M mining pool)
        uint256 jolPerKWh = getJolPerKWh();
        uint256 grossReward = _verifiedKWh * jolPerKWh;

        // Supply cap enforced by JOLToken.mint (MAX_SUPPLY = 210M)

        // Daily cap check
        uint256 today = block.timestamp / 1 days;
        dailyProduction[_facilityId][today] += _verifiedKWh;

        (, , , uint256 capacityKW, , , , , , , , , ) = registry.facilities(_facilityId);
        require(
            dailyProduction[_facilityId][today] <= capacityKW * MAX_DAILY_HOURS,
            "Daily cap exceeded"
        );

        address producer = registry.facilityOwner(_facilityId);

        // Calculate distributions
        uint256 oracleFee = (grossReward * ORACLE_FEE_BPS) / 10000;
        uint256 producerReward = grossReward - oracleFee;

        // Accrue rewards
        pendingRewards[producer] += producerReward;
        oracleEarnings[msg.sender] += oracleFee;

        totalPoEMinted += grossReward;
        totalKWhRewarded += _verifiedKWh;

        emit RewardAccrued(producer, _facilityId, _verifiedKWh, producerReward, POE_REWARD_MULTIPLIER);
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

    function getClaimable(address _account) external view returns (uint256) {
        return pendingRewards[_account];
    }
}
