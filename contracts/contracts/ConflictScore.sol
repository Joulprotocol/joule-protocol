// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ConflictScore
 * @notice Automatic, proportional consequence system.
 *
 * The system doesn't punish people — it protects the ecosystem.
 * Consequences are proportional and automatic. No human decides.
 *
 * Score penalties:
 *   +500  Energy infrastructure attack
 *   +200  Attacking another JOULE node
 *   +100  Confirmed false oracle data
 *   +20   Sell limit violation
 *
 * Score decay:
 *   -20/month for Level 1-2
 *   -10/month for Level 3
 *
 * Levels:
 *   0 (0-99)     Clean — full access
 *   1 (100-299)  Warning — reduced rewards (75%)
 *   2 (300-499)  Restricted — reduced rewards (50%), no governance
 *   3 (500-999)  Suspended — no rewards, no trading
 *   4 (1000+)    Expelled — permanent ban (only infrastructure attacks)
 *
 * Level 4 only for infrastructure attacks. Sell limit = max Level 2.
 * Proportionality is fairness.
 */
contract ConflictScore is AccessControl {
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");

    // Violation types and their penalties
    uint256 public constant PENALTY_INFRASTRUCTURE = 500;
    uint256 public constant PENALTY_NODE_ATTACK = 200;
    uint256 public constant PENALTY_FALSE_ORACLE = 100;
    uint256 public constant PENALTY_SELL_LIMIT = 20;

    // Decay rates per 30-day period
    uint256 public constant DECAY_LOW = 20;   // Level 1-2
    uint256 public constant DECAY_HIGH = 10;  // Level 3
    uint256 public constant DECAY_PERIOD = 30 days;

    // Level thresholds
    uint256 public constant LEVEL_1_THRESHOLD = 100;
    uint256 public constant LEVEL_2_THRESHOLD = 300;
    uint256 public constant LEVEL_3_THRESHOLD = 500;
    uint256 public constant LEVEL_4_THRESHOLD = 1000;

    // Reward multipliers by level (in BPS, 10000 = 100%)
    uint256 public constant REWARD_LEVEL_0 = 10000; // 100%
    uint256 public constant REWARD_LEVEL_1 = 7500;  // 75%
    uint256 public constant REWARD_LEVEL_2 = 5000;  // 50%
    // Level 3+: 0%

    enum ViolationType {
        SellLimit,          // 0 — +20, max Level 2
        FalseOracle,        // 1 — +100
        NodeAttack,         // 2 — +200
        Infrastructure      // 3 — +500, can reach Level 4
    }

    struct AccountScore {
        uint256 score;
        uint256 lastDecayApplied;  // timestamp of last decay
        uint256 violationCount;
        uint256 lastViolation;     // timestamp
    }

    mapping(address => AccountScore) public scores;

    event ViolationRecorded(address indexed account, ViolationType violationType, uint256 penalty, uint256 newScore, uint256 level);
    event DecayApplied(address indexed account, uint256 decayed, uint256 newScore);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Report a violation. Score increases, level may change.
     * Sell limit violations are capped at Level 2 (score 499 max from sell limits alone).
     */
    function reportViolation(
        address _account,
        ViolationType _type
    ) external onlyRole(REPORTER_ROLE) {
        // Apply pending decay first
        _applyDecay(_account);

        uint256 penalty = getPenalty(_type);
        AccountScore storage s = scores[_account];

        uint256 newScore = s.score + penalty;

        // Sell limit violations capped at Level 2
        if (_type == ViolationType.SellLimit && newScore >= LEVEL_3_THRESHOLD) {
            newScore = LEVEL_3_THRESHOLD - 1; // 499 max
        }

        s.score = newScore;
        s.violationCount++;
        s.lastViolation = block.timestamp;

        if (s.lastDecayApplied == 0) {
            s.lastDecayApplied = block.timestamp;
        }

        emit ViolationRecorded(_account, _type, penalty, newScore, getLevel(_account));
    }

    /**
     * @notice Apply time-based score decay.
     * Called automatically on violation, or manually by anyone.
     */
    function applyDecay(address _account) external {
        _applyDecay(_account);
    }

    function _applyDecay(address _account) internal {
        AccountScore storage s = scores[_account];
        if (s.score == 0 || s.lastDecayApplied == 0) return;

        // Level 4 (expelled) — no decay
        if (s.score >= LEVEL_4_THRESHOLD) return;

        uint256 elapsed = block.timestamp - s.lastDecayApplied;
        uint256 periods = elapsed / DECAY_PERIOD;
        if (periods == 0) return;

        uint256 level = _getLevel(s.score);
        uint256 decayRate = level >= 3 ? DECAY_HIGH : DECAY_LOW;
        uint256 totalDecay = periods * decayRate;

        if (totalDecay >= s.score) {
            totalDecay = s.score;
            s.score = 0;
        } else {
            s.score -= totalDecay;
        }

        s.lastDecayApplied += periods * DECAY_PERIOD;

        emit DecayApplied(_account, totalDecay, s.score);
    }

    /**
     * @notice Get the penalty for a violation type.
     */
    function getPenalty(ViolationType _type) public pure returns (uint256) {
        if (_type == ViolationType.Infrastructure) return PENALTY_INFRASTRUCTURE;
        if (_type == ViolationType.NodeAttack) return PENALTY_NODE_ATTACK;
        if (_type == ViolationType.FalseOracle) return PENALTY_FALSE_ORACLE;
        if (_type == ViolationType.SellLimit) return PENALTY_SELL_LIMIT;
        return 0;
    }

    /**
     * @notice Get current level for an account (applies pending decay).
     */
    function getLevel(address _account) public view returns (uint256) {
        return _getLevel(scores[_account].score);
    }

    function _getLevel(uint256 _score) internal pure returns (uint256) {
        if (_score >= LEVEL_4_THRESHOLD) return 4;
        if (_score >= LEVEL_3_THRESHOLD) return 3;
        if (_score >= LEVEL_2_THRESHOLD) return 2;
        if (_score >= LEVEL_1_THRESHOLD) return 1;
        return 0;
    }

    /**
     * @notice Get reward multiplier for an account (in BPS).
     * Level 0: 100%, Level 1: 75%, Level 2: 50%, Level 3+: 0%
     */
    function getRewardMultiplier(address _account) external view returns (uint256) {
        uint256 level = getLevel(_account);
        if (level == 0) return REWARD_LEVEL_0;
        if (level == 1) return REWARD_LEVEL_1;
        if (level == 2) return REWARD_LEVEL_2;
        return 0; // Level 3+ gets nothing
    }

    /**
     * @notice Check if account can participate in governance.
     * Level 2+ cannot vote.
     */
    function canGovernance(address _account) external view returns (bool) {
        return getLevel(_account) < 2;
    }

    /**
     * @notice Check if account can trade.
     * Level 3+ cannot trade.
     */
    function canTrade(address _account) external view returns (bool) {
        return getLevel(_account) < 3;
    }
}
