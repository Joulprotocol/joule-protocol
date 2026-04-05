// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./JOLToken.sol";
import "./EnergyRegistry.sol";
import "./PhysicalCap.sol";
import "./WeatherOracle.sol";
import "./OracleConsensus.sol";
import "./StakeSlash.sol";
import "./ConflictScore.sol";
import "./PoEMining.sol";
import "./EnergyFloor.sol";

/**
 * @title EnergyProofEngine
 * @notice THE single gateway for all energy-based minting in JOULE.
 *
 * NO JOL is minted from energy without passing ALL 5 layers simultaneously:
 *
 *   Layer 1 — Physics:    PhysicalCap verifies kWh is physically possible
 *   Layer 2 — Weather:    WeatherOracle cross-checks with real weather data
 *   Layer 3 — Consensus:  OracleConsensus confirms 3/5 oracles agree
 *   Layer 4 — Economic:   StakeSlash confirms producer has skin in the game
 *   Layer 5 — Reputation: ConflictScore confirms no fraud history
 *
 * This contract replaces the old flow where OracleConsensus directly called
 * PoEMining.accrueReward(). Now: Oracle finalizes → Engine validates → mint.
 *
 * "Trust, but verify. Then verify again. Then verify the verifiers."
 */
contract EnergyProofEngine is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant ENGINE_OPERATOR = keccak256("ENGINE_OPERATOR");

    // ─── Dependencies ─────────────────────────────────────────────
    JOLToken public jolToken;
    EnergyRegistry public registry;
    PhysicalCap public physicalCap;
    WeatherOracle public weatherOracle;
    OracleConsensus public oracleConsensus;
    StakeSlash public stakeSlash;
    ConflictScore public conflictScore;
    PoEMining public poeMining;
    EnergyFloor public energyFloor;

    // ─── State ────────────────────────────────────────────────────
    uint256 public totalVerifiedKWh;
    uint256 public totalMintedJOL;
    uint256 public totalRejected;

    // Track processed reports to prevent double-minting
    mapping(bytes32 => bool) public processedReports;

    // Daily facility cap tracking
    mapping(uint256 => mapping(uint256 => uint256)) public dailyMinted; // facilityId → day → kWh

    // ─── Events ───────────────────────────────────────────────────
    event EnergyVerified(
        uint256 indexed facilityId,
        uint256 kWh,
        uint256 jolMinted,
        bytes32 reportId,
        uint8 rewardMultiplier
    );
    event EnergyRejected(
        uint256 indexed facilityId,
        uint256 kWh,
        bytes32 reportId,
        string reason
    );
    event LayerFailed(
        uint256 indexed facilityId,
        bytes32 reportId,
        uint8 layer,
        string reason
    );

    constructor(
        address admin,
        address _jolToken,
        address _registry,
        address _physicalCap,
        address _weatherOracle,
        address _oracleConsensus,
        address _stakeSlash,
        address _conflictScore,
        address _poeMining,
        address _energyFloor
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
        registry = EnergyRegistry(_registry);
        physicalCap = PhysicalCap(_physicalCap);
        weatherOracle = WeatherOracle(_weatherOracle);
        oracleConsensus = OracleConsensus(_oracleConsensus);
        stakeSlash = StakeSlash(_stakeSlash);
        conflictScore = ConflictScore(_conflictScore);
        poeMining = PoEMining(_poeMining);
        energyFloor = EnergyFloor(_energyFloor);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Core: Verify and Mint ────────────────────────────────────

    /**
     * @notice Process a finalized oracle report through all 5 verification layers.
     * Called after OracleConsensus finalizes a report.
     *
     * @param _facilityId The energy facility
     * @param _periodStart Start of production period (unix timestamp)
     * @param _periodEnd End of production period (unix timestamp)
     */
    function processReport(
        uint256 _facilityId,
        uint256 _periodStart,
        uint256 _periodEnd
    ) external nonReentrant whenNotPaused onlyRole(ENGINE_OPERATOR) {
        // Compute report ID (same formula as OracleConsensus)
        bytes32 reportId = keccak256(
            abi.encodePacked(_facilityId, _periodStart, _periodEnd)
        );

        // ─── Pre-checks ──────────────────────────────────────────
        require(!processedReports[reportId], "Report already processed");

        // Get finalized kWh from oracle consensus
        (
            uint256 facilityId,
            , // periodStart
            , // periodEnd
            , // createdAt
            bool finalized,
            uint256 finalKWh,
              // anomalyFlagged
        ) = _getReport(reportId);

        require(finalized, "Report not finalized by oracle consensus");
        require(facilityId == _facilityId, "Facility ID mismatch");
        require(finalKWh > 0, "Zero kWh report");

        // Get facility owner
        address producer = registry.facilityOwner(_facilityId);
        require(producer != address(0), "Unknown facility");

        // ═══════════════════════════════════════════════════════════
        // LAYER 1 — PHYSICS: Is this production physically possible?
        // ═══════════════════════════════════════════════════════════
        bool physicsOk = physicalCap.verifyProduction(_facilityId, finalKWh);
        if (!physicsOk) {
            _reject(_facilityId, finalKWh, reportId, 1, "Physics cap exceeded");
            return;
        }

        // ═══════════════════════════════════════════════════════════
        // LAYER 2 — WEATHER: Does weather data support this production?
        // ═══════════════════════════════════════════════════════════
        uint256 day = _periodStart / 1 days;
        bool weatherOk = weatherOracle.verifyWithWeather(_facilityId, finalKWh, day);
        if (!weatherOk) {
            _reject(_facilityId, finalKWh, reportId, 2, "Weather verification failed");
            return;
        }

        // ═══════════════════════════════════════════════════════════
        // LAYER 3 — CONSENSUS: Did 3/5 oracles agree?
        // ═══════════════════════════════════════════════════════════
        // Already verified by checking finalized == true above.
        // OracleConsensus requires QUORUM (3) before setting finalized.

        // ═══════════════════════════════════════════════════════════
        // LAYER 4 — ECONOMIC: Does producer have stake (skin in the game)?
        // ═══════════════════════════════════════════════════════════
        if (!stakeSlash.isStaked(_facilityId)) {
            _reject(_facilityId, finalKWh, reportId, 4, "Facility not staked");
            return;
        }
        if (stakeSlash.isBanned(producer)) {
            _reject(_facilityId, finalKWh, reportId, 4, "Producer is banned");
            return;
        }

        // ═══════════════════════════════════════════════════════════
        // LAYER 5 — REPUTATION: Is producer's conflict score clean?
        // ═══════════════════════════════════════════════════════════
        uint256 conflictLevel = conflictScore.getLevel(producer);
        if (conflictLevel >= 3) {
            _reject(_facilityId, finalKWh, reportId, 5, "Conflict score too high (level 3+)");
            return;
        }

        // ═══════════════════════════════════════════════════════════
        // ALL 5 LAYERS PASSED — MINT
        // ═══════════════════════════════════════════════════════════

        // Check daily cap
        uint256 maxDaily = physicalCap.maxDailyOutput(_facilityId);
        uint256 today = block.timestamp / 1 days;
        require(
            dailyMinted[_facilityId][today] + finalKWh <= maxDaily,
            "Daily production cap exceeded"
        );
        dailyMinted[_facilityId][today] += finalKWh;

        // Mark as processed
        processedReports[reportId] = true;

        // Get reward multiplier based on reputation
        uint256 rewardMultiplier = conflictScore.getRewardMultiplier(producer);

        // Accrue PoE reward (3× base, adjusted by reputation)
        uint256 jolPerKWh = poeMining.getJolPerKWh(); // 3 JOL per kWh
        uint256 baseReward = finalKWh * jolPerKWh;
        uint256 adjustedReward = (baseReward * rewardMultiplier) / 10000;

        // Accrue in PoEMining (it handles minting)
        poeMining.accrueReward(_facilityId, finalKWh);

        // Deposit energy in floor (1 JOL per kWh backing)
        energyFloor.depositEnergy(producer, finalKWh);

        // Update stats
        totalVerifiedKWh += finalKWh;
        totalMintedJOL += adjustedReward;

        emit EnergyVerified(
            _facilityId,
            finalKWh,
            adjustedReward,
            reportId,
            uint8(rewardMultiplier / 1000)
        );
    }

    // ─── Internal ─────────────────────────────────────────────────

    function _reject(
        uint256 _facilityId,
        uint256 _kWh,
        bytes32 _reportId,
        uint8 _layer,
        string memory _reason
    ) internal {
        processedReports[_reportId] = true; // prevent retry
        totalRejected++;
        emit EnergyRejected(_facilityId, _kWh, _reportId, _reason);
        emit LayerFailed(_facilityId, _reportId, _layer, _reason);
    }

    function _getReport(bytes32 _reportId) internal view returns (
        uint256 facilityId,
        uint256 periodStart,
        uint256 periodEnd,
        uint256 createdAt,
        bool finalized,
        uint256 finalKWh,
        bool anomalyFlagged
    ) {
        // Auto-getter skips array fields (voters, submissions, weatherHashes)
        // Returns: facilityId, periodStart, periodEnd, createdAt, finalized, finalKWh, anomalyFlagged
        (facilityId, periodStart, periodEnd, createdAt, finalized, finalKWh, anomalyFlagged) =
            oracleConsensus.reports(_reportId);
    }

    // ─── Views ────────────────────────────────────────────────────

    /**
     * @notice Check if a report has been processed
     */
    function isProcessed(
        uint256 _facilityId,
        uint256 _periodStart,
        uint256 _periodEnd
    ) external view returns (bool) {
        bytes32 reportId = keccak256(
            abi.encodePacked(_facilityId, _periodStart, _periodEnd)
        );
        return processedReports[reportId];
    }

    /**
     * @notice Pre-flight check: would this facility pass all layers?
     * Does NOT process or mint — just checks readiness.
     */
    function preflightCheck(uint256 _facilityId) external view returns (
        bool active,
        bool staked,
        bool notBanned,
        bool reputationClean,
        uint256 conflictLevel,
        uint256 rewardMultiplierBps,
        uint256 maxDailyKWh
    ) {
        address producer = registry.facilityOwner(_facilityId);
        active = registry.isActive(_facilityId);
        staked = stakeSlash.isStaked(_facilityId);
        notBanned = !stakeSlash.isBanned(producer);
        conflictLevel = conflictScore.getLevel(producer);
        reputationClean = conflictLevel < 3;
        rewardMultiplierBps = conflictScore.getRewardMultiplier(producer);
        maxDailyKWh = physicalCap.maxDailyOutput(_facilityId);
    }

    /**
     * @notice Engine stats
     */
    function engineStats() external view returns (
        uint256 _totalVerifiedKWh,
        uint256 _totalMintedJOL,
        uint256 _totalRejected
    ) {
        return (totalVerifiedKWh, totalMintedJOL, totalRejected);
    }
}
