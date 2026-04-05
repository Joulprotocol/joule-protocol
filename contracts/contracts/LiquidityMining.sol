// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./JOLToken.sol";

/**
 * @title LiquidityMining
 * @notice 180-day liquidity mining program — MasterChef pattern (O(1) claims).
 *
 * Total rewards: 4,200,000 JOL (2% of 210M supply)
 * Duration: 180 days (6 months)
 * Early bird bonus: 2× rewards for first 30 days
 *
 * Uses accRewardPerShare / rewardDebt model (SushiSwap MasterChef V1).
 * No loops in claim/deposit/withdraw — constant gas regardless of time elapsed.
 */
contract LiquidityMining is AccessControl {
    JOLToken public jolToken;

    uint256 public constant TOTAL_REWARDS = 4_200_000 ether;
    uint256 public constant PROGRAM_DURATION = 180 days;
    uint256 public constant EARLY_BIRD_PERIOD = 30 days;
    uint256 public constant EARLY_BIRD_MULTIPLIER = 2;

    // 4.2M JOL / (30d×2 + 150d×1) = 4.2M / 210 weighted days = 20,000 JOL/day base
    uint256 public constant BASE_DAILY_REWARD = 20_000 ether;

    // Per-second base rate: 20,000 ether / 86,400
    uint256 public constant REWARD_PER_SECOND = 231481481481481481; // ~0.2315 JOL/sec

    uint256 public programStart;
    uint256 public lastRewardTime;
    uint256 public accRewardPerShare; // ×1e12 precision
    uint256 public totalDistributed;
    uint256 public totalLPStaked;
    uint256 public activeLPCount;

    struct LPPosition {
        address provider;
        uint256 amount;
        uint256 pool;          // 0 = JOL/USDC, 1 = JOL/ETH
        uint256 rewardDebt;    // MasterChef reward debt
        uint256 totalClaimed;
        bool active;
    }

    uint256 public nextPositionId = 1;
    mapping(uint256 => LPPosition) public positions;
    mapping(address => uint256[]) public providerPositions;

    IERC20 public lpTokenPoolA;
    IERC20 public lpTokenPoolB;

    event LPStaked(uint256 indexed positionId, address indexed provider, uint256 amount, uint256 pool);
    event LPUnstaked(uint256 indexed positionId, address indexed provider, uint256 amount);
    event RewardsClaimed(uint256 indexed positionId, address indexed provider, uint256 amount);

    constructor(address admin, address _jolToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
        programStart = block.timestamp;
        lastRewardTime = block.timestamp;
    }

    function setLPTokens(address _poolA, address _poolB) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(address(lpTokenPoolA) == address(0), "Already set");
        require(_poolA != address(0) && _poolB != address(0), "Zero address");
        lpTokenPoolA = IERC20(_poolA);
        lpTokenPoolB = IERC20(_poolB);
    }

    // ─── Time Helpers ─────────────────────────────────────────────

    function isActive() public view returns (bool) {
        return block.timestamp < programStart + PROGRAM_DURATION;
    }

    function isEarlyBird() public view returns (bool) {
        return block.timestamp < programStart + EARLY_BIRD_PERIOD;
    }

    function currentDay() public view returns (uint256) {
        if (block.timestamp < programStart) return 0;
        uint256 day = (block.timestamp - programStart) / 1 days;
        return day >= 180 ? 179 : day;
    }

    /**
     * @notice Weighted time multiplier — early bird seconds count 2×.
     */
    function getMultiplier(uint256 _from, uint256 _to) public view returns (uint256) {
        uint256 earlyEnd = programStart + EARLY_BIRD_PERIOD;
        uint256 progEnd = programStart + PROGRAM_DURATION;

        if (_from < programStart) _from = programStart;
        if (_to > progEnd) _to = progEnd;
        if (_to <= _from) return 0;

        if (_to <= earlyEnd) {
            return (_to - _from) * 2;
        } else if (_from >= earlyEnd) {
            return _to - _from;
        } else {
            return (earlyEnd - _from) * 2 + (_to - earlyEnd);
        }
    }

    // ─── Pool Update (MasterChef core) ────────────────────────────

    function updatePool() public {
        if (block.timestamp <= lastRewardTime) return;

        if (totalLPStaked == 0) {
            lastRewardTime = block.timestamp;
            return;
        }

        uint256 multiplier = getMultiplier(lastRewardTime, block.timestamp);
        uint256 reward = multiplier * REWARD_PER_SECOND;

        // Cap at remaining rewards
        uint256 remaining = TOTAL_REWARDS - totalDistributed;
        if (reward > remaining) reward = remaining;

        accRewardPerShare += reward * 1e12 / totalLPStaked;
        totalDistributed += reward;
        lastRewardTime = block.timestamp;
    }

    // ─── Staking ──────────────────────────────────────────────────

    function stakeLiquidity(uint256 _amount, uint256 _pool) external returns (uint256 positionId) {
        require(isActive(), "Program ended");
        require(_amount > 0, "Zero amount");
        require(_pool <= 1, "Invalid pool");

        IERC20 lpToken = _pool == 0 ? lpTokenPoolA : lpTokenPoolB;
        require(address(lpToken) != address(0), "LP token not set");
        require(lpToken.transferFrom(msg.sender, address(this), _amount), "LP transfer failed");

        updatePool();

        positionId = nextPositionId++;
        positions[positionId] = LPPosition({
            provider: msg.sender,
            amount: _amount,
            pool: _pool,
            rewardDebt: _amount * accRewardPerShare / 1e12,
            totalClaimed: 0,
            active: true
        });

        providerPositions[msg.sender].push(positionId);
        totalLPStaked += _amount;
        activeLPCount++;

        emit LPStaked(positionId, msg.sender, _amount, _pool);
    }

    // ─── Unstaking ────────────────────────────────────────────────

    function unstakeLiquidity(uint256 _positionId) external {
        LPPosition storage pos = positions[_positionId];
        require(pos.provider == msg.sender, "Not owner");
        require(pos.active, "Not active");

        updatePool();

        uint256 pending = pos.amount * accRewardPerShare / 1e12 - pos.rewardDebt;
        if (pending > 0) {
            _distributeReward(msg.sender, pending);
            pos.totalClaimed += pending;
        }

        pos.active = false;
        uint256 amount = pos.amount;
        pos.amount = 0;
        pos.rewardDebt = 0;
        totalLPStaked -= amount;
        activeLPCount--;

        IERC20 lpToken = pos.pool == 0 ? lpTokenPoolA : lpTokenPoolB;
        require(lpToken.transfer(msg.sender, amount), "LP return failed");

        emit LPUnstaked(_positionId, msg.sender, amount);
        if (pending > 0) {
            emit RewardsClaimed(_positionId, msg.sender, pending);
        }
    }

    // ─── Claiming ─────────────────────────────────────────────────

    function claimRewards(uint256 _positionId) external {
        LPPosition storage pos = positions[_positionId];
        require(pos.provider == msg.sender, "Not owner");
        require(pos.active, "Not active");

        updatePool();

        uint256 pending = pos.amount * accRewardPerShare / 1e12 - pos.rewardDebt;
        require(pending > 0, "No rewards");

        pos.rewardDebt = pos.amount * accRewardPerShare / 1e12;
        pos.totalClaimed += pending;

        _distributeReward(msg.sender, pending);

        emit RewardsClaimed(_positionId, msg.sender, pending);
    }

    // ─── Views ────────────────────────────────────────────────────

    function pendingRewards(uint256 _positionId) external view returns (uint256) {
        LPPosition storage pos = positions[_positionId];
        if (!pos.active || pos.amount == 0) return 0;

        uint256 _accRewardPerShare = accRewardPerShare;
        if (block.timestamp > lastRewardTime && totalLPStaked > 0) {
            uint256 multiplier = getMultiplier(lastRewardTime, block.timestamp);
            uint256 reward = multiplier * REWARD_PER_SECOND;
            uint256 remaining = TOTAL_REWARDS - totalDistributed;
            if (reward > remaining) reward = remaining;
            _accRewardPerShare += reward * 1e12 / totalLPStaked;
        }

        return pos.amount * _accRewardPerShare / 1e12 - pos.rewardDebt;
    }

    function getPositionIds(address _provider) external view returns (uint256[] memory) {
        return providerPositions[_provider];
    }

    function programStats() external view returns (
        uint256 _totalStaked,
        uint256 _totalDistributed,
        uint256 _remainingRewards,
        uint256 _currentDay,
        bool _isActive,
        bool _isEarlyBird
    ) {
        return (totalLPStaked, totalDistributed, TOTAL_REWARDS - totalDistributed, currentDay(), isActive(), isEarlyBird());
    }

    function _distributeReward(address _to, uint256 _amount) internal {
        if (_amount == 0) return;
        jolToken.mint(_to, _amount);
    }
}
