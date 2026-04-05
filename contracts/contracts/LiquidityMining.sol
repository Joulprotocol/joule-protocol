// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./JOLToken.sol";

/**
 * @title LiquidityMining
 * @notice 180-day liquidity mining program.
 *
 * Total rewards: 4,200,000,000 JOL (2% of 210B supply)
 * Duration: 180 days (6 months)
 * Early bird bonus: 2× rewards for first 30 days
 *
 * Energy producers must be able to sell from day one.
 * Without liquidity, there's no point in joining.
 * This program ensures the ring is complete from launch.
 *
 * DEX pools at launch:
 *   Pool A: JOL/USDC — 60% of DEX allocation
 *   Pool B: JOL/ETH  — 40% of DEX allocation
 *   Fee tier: 0.3% (standard, most liquidity)
 */
contract LiquidityMining is AccessControl {
    JOLToken public jolToken;

    uint256 public constant TOTAL_REWARDS = 4_200_000_000 ether; // 4.2B JOL
    uint256 public constant PROGRAM_DURATION = 180 days;
    uint256 public constant EARLY_BIRD_PERIOD = 30 days;
    uint256 public constant EARLY_BIRD_MULTIPLIER = 2;

    uint256 public programStart;
    uint256 public totalDistributed;

    // Daily reward = TOTAL_REWARDS / weighted days
    // Weighted days = 30 × 2 + 150 × 1 = 210 weighted days
    // Daily reward = 4,200,000,000 / 210 = 20,000,000 JOL base
    uint256 public constant WEIGHTED_DAYS = 210;
    uint256 public constant BASE_DAILY_REWARD = 20_000_000 ether; // 20M JOL/day

    struct LPPosition {
        address provider;
        uint256 amount;          // LP tokens staked
        uint256 pool;            // 0 = JOL/USDC, 1 = JOL/ETH
        uint256 stakedAt;
        uint256 lastClaimDay;
        uint256 totalClaimed;
        bool active;
    }

    uint256 public nextPositionId = 1;
    mapping(uint256 => LPPosition) public positions;
    mapping(address => uint256[]) public providerPositions;

    // Daily pool totals for reward calculation
    mapping(uint256 => uint256) public dailyTotalStaked; // day → total LP staked

    // LP token contracts (set by admin at launch)
    IERC20 public lpTokenPoolA; // JOL/USDC LP
    IERC20 public lpTokenPoolB; // JOL/ETH LP

    uint256 public totalLPStaked;
    uint256 public activeLPCount;

    event LPStaked(uint256 indexed positionId, address indexed provider, uint256 amount, uint256 pool);
    event LPUnstaked(uint256 indexed positionId, address indexed provider, uint256 amount);
    event RewardsClaimed(uint256 indexed positionId, address indexed provider, uint256 amount, uint256 forDays);

    constructor(address admin, address _jolToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
        programStart = block.timestamp;
    }

    /**
     * @notice Set LP token addresses (admin only, before staking starts)
     */
    function setLPTokens(address _poolA, address _poolB) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(address(lpTokenPoolA) == address(0), "Already set");
        require(_poolA != address(0) && _poolB != address(0), "Zero address");
        lpTokenPoolA = IERC20(_poolA);
        lpTokenPoolB = IERC20(_poolB);
    }

    /**
     * @notice Check if program is still active.
     */
    function isActive() public view returns (bool) {
        return block.timestamp < programStart + PROGRAM_DURATION;
    }

    /**
     * @notice Check if we're in early bird period.
     */
    function isEarlyBird() public view returns (bool) {
        return block.timestamp < programStart + EARLY_BIRD_PERIOD;
    }

    /**
     * @notice Get current day of the program (0-indexed).
     */
    function currentDay() public view returns (uint256) {
        if (block.timestamp < programStart) return 0;
        uint256 elapsed = block.timestamp - programStart;
        uint256 day = elapsed / 1 days;
        if (day >= 180) return 179;
        return day;
    }

    /**
     * @notice Stake LP tokens to earn JOL rewards.
     * @param _amount LP token amount
     * @param _pool 0 = JOL/USDC, 1 = JOL/ETH
     */
    function stakeLiquidity(uint256 _amount, uint256 _pool) external returns (uint256 positionId) {
        require(isActive(), "Program ended");
        require(_amount > 0, "Zero amount");
        require(_pool <= 1, "Invalid pool");

        // Transfer LP tokens from user to this contract
        IERC20 lpToken = _pool == 0 ? lpTokenPoolA : lpTokenPoolB;
        require(address(lpToken) != address(0), "LP token not set");
        require(lpToken.transferFrom(msg.sender, address(this), _amount), "LP transfer failed");

        positionId = nextPositionId++;
        uint256 day = currentDay();

        positions[positionId] = LPPosition({
            provider: msg.sender,
            amount: _amount,
            pool: _pool,
            stakedAt: block.timestamp,
            lastClaimDay: day,
            totalClaimed: 0,
            active: true
        });

        providerPositions[msg.sender].push(positionId);
        totalLPStaked += _amount;
        activeLPCount++;
        dailyTotalStaked[day] += _amount;

        emit LPStaked(positionId, msg.sender, _amount, _pool);
    }

    /**
     * @notice Unstake LP tokens. Claims pending rewards first.
     */
    function unstakeLiquidity(uint256 _positionId) external {
        LPPosition storage pos = positions[_positionId];
        require(pos.provider == msg.sender, "Not owner");
        require(pos.active, "Not active");

        // Claim pending rewards first
        uint256 pending = _calculateRewards(_positionId);
        if (pending > 0) {
            _distributeReward(msg.sender, pending);
            pos.totalClaimed += pending;
        }

        pos.active = false;
        uint256 amount = pos.amount;
        totalLPStaked -= amount;
        activeLPCount--;

        // Return LP tokens to user
        IERC20 lpToken = pos.pool == 0 ? lpTokenPoolA : lpTokenPoolB;
        require(lpToken.transfer(msg.sender, amount), "LP return failed");

        emit LPUnstaked(_positionId, msg.sender, amount);
        if (pending > 0) {
            emit RewardsClaimed(_positionId, msg.sender, pending, currentDay() - pos.lastClaimDay);
        }
    }

    /**
     * @notice Claim accumulated rewards for a position.
     */
    function claimRewards(uint256 _positionId) external {
        LPPosition storage pos = positions[_positionId];
        require(pos.provider == msg.sender, "Not owner");
        require(pos.active, "Not active");

        uint256 pending = _calculateRewards(_positionId);
        require(pending > 0, "No rewards");

        uint256 days_ = currentDay() - pos.lastClaimDay;
        pos.lastClaimDay = currentDay();
        pos.totalClaimed += pending;

        _distributeReward(msg.sender, pending);

        emit RewardsClaimed(_positionId, msg.sender, pending, days_);
    }

    /**
     * @notice Calculate pending rewards for a position.
     * reward = (position / totalStaked) × dailyReward × days × bonus
     */
    function _calculateRewards(uint256 _positionId) internal view returns (uint256) {
        LPPosition storage pos = positions[_positionId];
        if (!pos.active) return 0;

        uint256 day = currentDay();
        if (day <= pos.lastClaimDay) return 0;
        if (totalLPStaked == 0) return 0;

        uint256 totalReward = 0;

        for (uint256 d = pos.lastClaimDay + 1; d <= day; d++) {
            uint256 dailyTotal = dailyTotalStaked[d];
            if (dailyTotal == 0) dailyTotal = totalLPStaked; // fallback

            // Share of pool
            uint256 share = pos.amount * 1 ether / dailyTotal;

            // Base daily reward
            uint256 dayReward = BASE_DAILY_REWARD * share / 1 ether;

            // Early bird bonus (first 30 days)
            if (d < 30) {
                dayReward *= EARLY_BIRD_MULTIPLIER;
            }

            totalReward += dayReward;
        }

        // Cap at remaining rewards
        uint256 remaining = TOTAL_REWARDS - totalDistributed;
        if (totalReward > remaining) totalReward = remaining;

        return totalReward;
    }

    /**
     * @notice View pending rewards without claiming.
     */
    function pendingRewards(uint256 _positionId) external view returns (uint256) {
        return _calculateRewards(_positionId);
    }

    function _distributeReward(address _to, uint256 _amount) internal {
        if (_amount == 0) return;
        totalDistributed += _amount;
        jolToken.mint(_to, _amount);
    }

    /**
     * @notice Get all position IDs for a provider.
     */
    function getPositionIds(address _provider) external view returns (uint256[] memory) {
        return providerPositions[_provider];
    }

    /**
     * @notice Program stats.
     */
    function programStats() external view returns (
        uint256 _totalStaked,
        uint256 _totalDistributed,
        uint256 _remainingRewards,
        uint256 _currentDay,
        bool _isActive,
        bool _isEarlyBird
    ) {
        return (
            totalLPStaked,
            totalDistributed,
            TOTAL_REWARDS - totalDistributed,
            currentDay(),
            isActive(),
            isEarlyBird()
        );
    }
}
