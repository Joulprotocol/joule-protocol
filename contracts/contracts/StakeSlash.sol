// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./JOLToken.sol";
import "./EnergyRegistry.sol";
import "./ConflictScore.sol";

/**
 * @title StakeSlash
 * @notice Proof of Energy Kiht 3 — economics enforces honesty.
 *
 * Stake = 3 days of expected production value.
 * False data = lose entire stake + temporary ban.
 *
 * The math forbids cheating:
 *   - Stake pays for itself in half a day of honest production
 *   - Cheating profit is ALWAYS less than the loss
 *   - Ban period scales with violation severity
 *
 * Slashed stakes go to the ecosystem treasury (burned or redistributed).
 */
contract StakeSlash is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    JOLToken public jolToken;
    EnergyRegistry public registry;
    ConflictScore public conflictScore;

    // Stake = 3 days × expected daily output × JOL per kWh
    uint256 public constant STAKE_DAYS = 3;
    uint256 public constant JOL_PER_KWH = 1; // base rate for stake calculation

    // Average peak hours estimate for stake calculation (4h — global average)
    uint256 public constant AVG_PEAK_HOURS = 4;

    // Average capacity factor for stake calculation (30% — conservative blend)
    uint256 public constant AVG_CAPACITY_FACTOR = 3000; // 30% in BPS
    uint256 public constant BPS_BASE = 10000;

    // Ban periods
    uint256 public constant BAN_MINOR = 7 days;      // first offense
    uint256 public constant BAN_MAJOR = 30 days;      // repeated offense
    uint256 public constant BAN_PERMANENT = 365 days;  // severe fraud

    // Slash treasury — where slashed stakes go
    address public slashTreasury;

    struct StakeInfo {
        uint256 facilityId;
        address staker;
        uint256 amount;
        uint256 stakedAt;
        bool active;
    }

    struct BanInfo {
        uint256 banCount;
        uint256 bannedUntil;
        uint256 totalSlashed;
    }

    uint256 public nextStakeId = 1;
    mapping(uint256 => StakeInfo) public stakes;           // stakeId → StakeInfo
    mapping(uint256 => uint256) public facilityStake;      // facilityId → stakeId
    mapping(address => BanInfo) public bans;

    uint256 public totalStaked;
    uint256 public totalSlashed;

    event Staked(uint256 indexed stakeId, uint256 indexed facilityId, address indexed staker, uint256 amount);
    event Slashed(uint256 indexed stakeId, uint256 indexed facilityId, address indexed staker, uint256 amount, string reason);
    event StakeWithdrawn(uint256 indexed stakeId, address indexed staker, uint256 amount);
    event Banned(address indexed staker, uint256 until, uint256 banCount);

    constructor(address admin, address _jolToken, address _registry, address _slashTreasury, address _conflictScore) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
        registry = EnergyRegistry(_registry);
        slashTreasury = _slashTreasury;
        conflictScore = ConflictScore(_conflictScore);
    }

    /**
     * @notice Calculate required stake for a facility.
     * Stake = 3 days × capacityKW × avgPeakHours × avgCapacityFactor × JOL_PER_KWH
     */
    function requiredStake(uint256 _facilityId) public view returns (uint256) {
        (, , , uint256 capacityKW, , , , , , , , , ) = registry.facilities(_facilityId);
        require(capacityKW > 0, "Facility not found");

        // 3 days × capacity × 4h peak × 30% CF × 1 JOL/kWh
        uint256 dailyExpected = capacityKW * AVG_PEAK_HOURS * AVG_CAPACITY_FACTOR / BPS_BASE;
        return dailyExpected * STAKE_DAYS * JOL_PER_KWH * 1 ether;
    }

    /**
     * @notice Stake JOL to activate a facility for PoE mining.
     * Must be the facility owner. Facility must be verified.
     */
    function stake(uint256 _facilityId) external returns (uint256 stakeId) {
        require(!isBanned(msg.sender), "Account banned");
        // ConflictScore Level 3+ cannot stake (suspended/expelled)
        if (address(conflictScore) != address(0)) {
            require(conflictScore.canTrade(msg.sender), "Conflict score too high");
        }
        require(facilityStake[_facilityId] == 0, "Already staked");

        address facilityOwner = registry.facilityOwner(_facilityId);
        require(facilityOwner == msg.sender, "Not facility owner");

        (, , , , , , , , , , EnergyRegistry.FacilityStatus status, , ) = registry.facilities(_facilityId);
        require(status == EnergyRegistry.FacilityStatus.Verified, "Facility not verified");

        uint256 amount = requiredStake(_facilityId);
        require(amount > 0, "Zero stake");

        IERC20(address(jolToken)).safeTransferFrom(msg.sender, address(this), amount);

        stakeId = nextStakeId++;
        stakes[stakeId] = StakeInfo({
            facilityId: _facilityId,
            staker: msg.sender,
            amount: amount,
            stakedAt: block.timestamp,
            active: true
        });

        facilityStake[_facilityId] = stakeId;
        totalStaked += amount;

        emit Staked(stakeId, _facilityId, msg.sender, amount);
    }

    /**
     * @notice Slash a facility's stake for false data.
     * Full stake is forfeited. Staker is banned.
     */
    function slash(
        uint256 _facilityId,
        string calldata _reason
    ) external onlyRole(SLASHER_ROLE) {
        uint256 stakeId = facilityStake[_facilityId];
        require(stakeId != 0, "No stake");

        StakeInfo storage s = stakes[stakeId];
        require(s.active, "Stake not active");

        uint256 amount = s.amount;
        address staker = s.staker;

        // Deactivate stake
        s.active = false;
        s.amount = 0;
        facilityStake[_facilityId] = 0;
        totalStaked -= amount;
        totalSlashed += amount;

        // Transfer slashed amount to treasury
        IERC20(address(jolToken)).safeTransfer(slashTreasury, amount);

        // Ban the staker
        BanInfo storage ban = bans[staker];
        ban.banCount++;
        ban.totalSlashed += amount;

        if (ban.banCount == 1) {
            ban.bannedUntil = block.timestamp + BAN_MINOR;
        } else if (ban.banCount == 2) {
            ban.bannedUntil = block.timestamp + BAN_MAJOR;
        } else {
            ban.bannedUntil = block.timestamp + BAN_PERMANENT;
        }

        // Report to ConflictScore — false oracle data = +100 points
        if (address(conflictScore) != address(0)) {
            conflictScore.reportViolation(staker, ConflictScore.ViolationType.FalseOracle);
        }

        emit Slashed(stakeId, _facilityId, staker, amount, _reason);
        emit Banned(staker, ban.bannedUntil, ban.banCount);
    }

    /**
     * @notice Withdraw stake when deregistering facility.
     * Only facility owner, only if not slashed.
     */
    function withdrawStake(uint256 _facilityId) external {
        uint256 stakeId = facilityStake[_facilityId];
        require(stakeId != 0, "No stake");

        StakeInfo storage s = stakes[stakeId];
        require(s.staker == msg.sender, "Not staker");
        require(s.active, "Stake not active");

        uint256 amount = s.amount;

        s.active = false;
        s.amount = 0;
        facilityStake[_facilityId] = 0;
        totalStaked -= amount;

        IERC20(address(jolToken)).safeTransfer(msg.sender, amount);

        emit StakeWithdrawn(stakeId, msg.sender, amount);
    }

    /**
     * @notice Check if an account is currently banned.
     */
    function isBanned(address _account) public view returns (bool) {
        return bans[_account].bannedUntil > block.timestamp;
    }

    /**
     * @notice Check if a facility has an active stake.
     */
    function isStaked(uint256 _facilityId) external view returns (bool) {
        uint256 stakeId = facilityStake[_facilityId];
        if (stakeId == 0) return false;
        return stakes[stakeId].active;
    }
}
