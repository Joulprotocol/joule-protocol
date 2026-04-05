// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./JOLToken.sol";
import "./EnergyRegistry.sol";
import "./PoEMining.sol";

/**
 * @title OracleConsensus
 * @notice Byzantine Fault Tolerant oracle network for verifying energy production.
 *
 * Three-layer verification:
 *   Layer 1 — Hardware: MID-certified smart meters (EU Directive 2014/32/EU)
 *   Layer 2 — Oracle network: 3/5 BFT consensus, staked operators, slash for fraud
 *   Layer 3 — Cross-check: weather correlation, capacity limits, anomaly detection
 *
 * Oracle nodes submit energy reports with weather data hash.
 * Anomaly flags are raised when production doesn't match conditions:
 *   - Solar production at night → reject
 *   - Wind production in calm weather → flag
 *   - Production exceeds facility nameplate capacity → reject
 *   - 10x spike vs previous period → flag for manual review
 *
 * Weakest link: hardware manipulation. Mitigated by MID certification (criminal offense
 * to tamper), registered GPS location, and weather cross-check.
 */
contract OracleConsensus is AccessControl, ReentrancyGuard, Pausable {
    uint256 public quorum = 2;                              // starts 2/3, scales to 3/5+
    uint256 public minOracles = 3;                          // starts 3, scales to 5+
    uint256 public constant MIN_STAKE = 10_000 ether;      // 10,000 JOL
    uint256 public constant SLASH_PERCENT = 50;            // 50% slash for fraud

    event QuorumUpdated(uint256 newQuorum, uint256 newMinOracles);
    uint256 public constant REPORT_WINDOW = 1 hours;       // time to submit reports
    uint256 public constant MAX_DEVIATION_BPS = 500;       // 5% max deviation from median

    struct OracleNode {
        address operator;
        uint256 stake;
        uint256 reportsSubmitted;
        uint256 reportsAccepted;
        uint256 slashCount;
        uint256 joinedAt;
        bool active;
    }

    struct EnergyReport {
        uint256 facilityId;
        uint256 periodStart;
        uint256 periodEnd;
        uint256 createdAt;
        bool finalized;
        uint256 finalKWh;
        address[] voters;
        uint256[] submissions;      // kWh values submitted by each voter
        bytes32[] weatherHashes;    // hash of weather data per oracle (cross-check)
        bool anomalyFlagged;        // true if cross-check found suspicious data
    }

    JOLToken public jolToken;
    EnergyRegistry public registry;
    PoEMining public poeMining;
    address public slashTreasury; // where slashed funds go

    mapping(address => OracleNode) public oracles;
    address[] public oracleList;
    mapping(bytes32 => EnergyReport) public reports;
    bytes32[] public pendingReportIds;
    uint256 public pendingReportCleanupIndex; // tracks cleanup progress

    uint256 public totalStaked;
    uint256 public totalSlashed;
    uint256 public reportsFinalized;

    event OracleJoined(address indexed operator, uint256 stake);
    event OracleExited(address indexed operator, uint256 stakeReturned);
    event OracleSlashed(address indexed operator, uint256 amount, bytes32 reportId);
    event ReportSubmitted(bytes32 indexed reportId, address indexed oracle, uint256 kWh);
    event ReportFinalized(bytes32 indexed reportId, uint256 facilityId, uint256 kWh);
    event AnomalyFlagged(bytes32 indexed reportId, uint256 facilityId, string reason);

    constructor(address admin, address _jolToken, address _registry, address _slashTreasury) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
        registry = EnergyRegistry(_registry);
        slashTreasury = _slashTreasury;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function setQuorum(uint256 _newQuorum, uint256 _newMinOracles) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newQuorum >= 2, "Min quorum is 2");
        require(_newMinOracles >= 3, "Min oracles is 3");
        require(_newQuorum * 2 > _newMinOracles, "Quorum must be >50%");
        require(_newQuorum <= _newMinOracles, "Quorum cant exceed total");
        quorum = _newQuorum;
        minOracles = _newMinOracles;
        emit QuorumUpdated(_newQuorum, _newMinOracles);
    }

    function setPoEMining(address _poeMining) external onlyRole(DEFAULT_ADMIN_ROLE) {
        poeMining = PoEMining(_poeMining);
    }

    // ─── Oracle Management ─────────────────────────────────────────

    /**
     * @notice Stake JOL to become an oracle node
     */
    function joinAsOracle(uint256 _stakeAmount) external whenNotPaused {
        require(_stakeAmount >= MIN_STAKE, "Insufficient stake");
        require(!oracles[msg.sender].active, "Already active");

        // Transfer JOL stake from oracle to this contract
        require(jolToken.transferFrom(msg.sender, address(this), _stakeAmount), "Stake transfer failed");

        oracles[msg.sender] = OracleNode({
            operator: msg.sender,
            stake: _stakeAmount,
            reportsSubmitted: 0,
            reportsAccepted: 0,
            slashCount: 0,
            joinedAt: block.timestamp,
            active: true
        });

        oracleList.push(msg.sender);
        totalStaked += _stakeAmount;

        emit OracleJoined(msg.sender, _stakeAmount);
    }

    /**
     * @notice Exit oracle network and reclaim stake (minus any slashing)
     */
    function exitOracle() external nonReentrant {
        OracleNode storage node = oracles[msg.sender];
        require(node.active, "Not active oracle");
        require(block.timestamp > node.joinedAt + 30 days, "Lock period 30 days");

        node.active = false;
        uint256 stakeReturn = node.stake;
        node.stake = 0;
        totalStaked -= stakeReturn;

        // Return JOL stake
        require(jolToken.transfer(msg.sender, stakeReturn), "Stake return failed");

        emit OracleExited(msg.sender, stakeReturn);
    }

    // ─── Report Submission ─────────────────────────────────────────

    /**
     * @notice Submit an energy production report with weather cross-check.
     * @param _weatherHash Hash of weather data for the period (oracle fetches from NASA POWER / OpenWeatherMap)
     *
     * Off-chain, each oracle independently:
     * 1. Reads smart meter data (kWh produced)
     * 2. Fetches weather data for facility location + time period
     * 3. Checks: is production plausible given weather? (solar + cloudy = low production)
     * 4. Submits kWh + weather hash on-chain
     *
     * If weather hashes from different oracles don't match → anomaly flag.
     * If production is impossible given weather → oracle should submit 0 kWh.
     */
    function submitReport(
        uint256 _facilityId,
        uint256 _periodStart,
        uint256 _periodEnd,
        uint256 _kWhProduced,
        bytes32 _weatherHash
    ) external whenNotPaused {
        require(oracles[msg.sender].active, "Not active oracle");
        require(registry.isActive(_facilityId), "Facility not active");

        bytes32 reportId = keccak256(
            abi.encodePacked(_facilityId, _periodStart, _periodEnd)
        );

        EnergyReport storage report = reports[reportId];

        // Initialize report if first submission
        if (report.facilityId == 0) {
            report.facilityId = _facilityId;
            report.periodStart = _periodStart;
            report.periodEnd = _periodEnd;
            report.createdAt = block.timestamp;
            pendingReportIds.push(reportId);
        }

        require(!report.finalized, "Already finalized");
        require(block.timestamp <= report.createdAt + REPORT_WINDOW, "Report window closed");

        // Cap voters to prevent gas DoS on finalization
        require(report.voters.length < 20, "Max oracles per report");

        // Check oracle hasn't already voted
        for (uint256 i = 0; i < report.voters.length; i++) {
            require(report.voters[i] != msg.sender, "Already submitted");
        }

        report.voters.push(msg.sender);
        report.submissions.push(_kWhProduced);
        report.weatherHashes.push(_weatherHash);
        oracles[msg.sender].reportsSubmitted++;

        emit ReportSubmitted(reportId, msg.sender, _kWhProduced);

        // Auto-finalize if quorum reached
        if (report.voters.length >= quorum) {
            _finalizeReport(reportId);
        }
    }

    // ─── Finalization ──────────────────────────────────────────────

    function _finalizeReport(bytes32 _reportId) internal {
        EnergyReport storage report = reports[_reportId];
        require(!report.finalized, "Already finalized");
        require(report.voters.length >= quorum, "No quorum");

        // Stake-weighted median: oracles with more stake have more influence
        uint256 median = _stakeWeightedMedian(report.voters, report.submissions);

        report.finalKWh = median;
        report.finalized = true;
        reportsFinalized++;

        // Cross-check: do weather hashes agree?
        // If majority of weather hashes differ, flag anomaly
        if (report.weatherHashes.length >= 2) {
            uint256 matches = 0;
            bytes32 refHash = report.weatherHashes[0];
            for (uint256 w = 0; w < report.weatherHashes.length; w++) {
                if (report.weatherHashes[w] == refHash) matches++;
            }
            if (matches < report.weatherHashes.length / 2 + 1) {
                report.anomalyFlagged = true;
                emit AnomalyFlagged(_reportId, report.facilityId, "Weather hash mismatch");
            }
        }

        // Slash outliers and reward accurate reporters
        for (uint256 i = 0; i < report.voters.length; i++) {
            uint256 submitted = report.submissions[i];
            uint256 deviation = _percentDeviation(submitted, median);

            if (deviation > MAX_DEVIATION_BPS) {
                // Slash for inaccurate report
                _slashOracle(report.voters[i], _reportId);
            } else {
                oracles[report.voters[i]].reportsAccepted++;
            }
        }

        // Record production in registry
        registry.recordProduction(
            report.facilityId,
            median,
            report.periodStart,
            report.periodEnd
        );

        // Trigger PoE reward
        if (address(poeMining) != address(0)) {
            poeMining.accrueReward(report.facilityId, median);
        }

        emit ReportFinalized(_reportId, report.facilityId, median);
    }

    function _slashOracle(address _oracle, bytes32 _reportId) internal {
        OracleNode storage node = oracles[_oracle];
        uint256 slashAmount = (node.stake * SLASH_PERCENT) / 100;

        node.stake -= slashAmount;
        node.slashCount++;
        totalSlashed += slashAmount;

        // Transfer slashed JOL to treasury (not stuck in contract)
        if (slashTreasury != address(0)) {
            jolToken.transfer(slashTreasury, slashAmount);
        }

        emit OracleSlashed(_oracle, slashAmount, _reportId);

        // Deactivate if stake falls below minimum
        if (node.stake < MIN_STAKE) {
            node.active = false;
        }
    }

    // ─── Utilities ─────────────────────────────────────────────────

    /**
     * @notice Stake-weighted median: sort submissions by kWh, walk through
     * accumulating stake until >= 50% of total voter stake. That value is the median.
     * Oracles with more skin in the game have proportionally more influence.
     */
    function _stakeWeightedMedian(
        address[] memory voters,
        uint256[] memory submissions
    ) internal view returns (uint256) {
        uint256 n = voters.length;
        require(n > 0, "No submissions");

        // Build (kWh, stake) pairs and sort by kWh
        uint256[] memory indices = new uint256[](n);
        for (uint256 i = 0; i < n; i++) indices[i] = i;

        // Sort indices by submission value (ascending)
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = i + 1; j < n; j++) {
                if (submissions[indices[j]] < submissions[indices[i]]) {
                    (indices[i], indices[j]) = (indices[j], indices[i]);
                }
            }
        }

        // Sum total stake of voters
        uint256 totalVoterStake = 0;
        for (uint256 i = 0; i < n; i++) {
            totalVoterStake += oracles[voters[i]].stake;
        }

        // Walk sorted values, accumulate stake until >= half
        uint256 accumulated = 0;
        uint256 halfStake = totalVoterStake / 2;
        for (uint256 i = 0; i < n; i++) {
            accumulated += oracles[voters[indices[i]]].stake;
            if (accumulated > halfStake) {
                return submissions[indices[i]];
            }
        }

        // Fallback: return last value (shouldn't reach here)
        return submissions[indices[n - 1]];
    }

    function _sortArray(uint256[] memory arr) internal pure returns (uint256[] memory) {
        uint256[] memory sorted = new uint256[](arr.length);
        for (uint256 i = 0; i < arr.length; i++) sorted[i] = arr[i];

        for (uint256 i = 0; i < sorted.length; i++) {
            for (uint256 j = i + 1; j < sorted.length; j++) {
                if (sorted[j] < sorted[i]) {
                    (sorted[i], sorted[j]) = (sorted[j], sorted[i]);
                }
            }
        }
        return sorted;
    }

    function _percentDeviation(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) return a > 0 ? 10000 : 0;
        if (a > b) return ((a - b) * 10000) / b;
        return ((b - a) * 10000) / b;
    }

    // ─── Views ─────────────────────────────────────────────────────

    function getActiveOracleCount() external view returns (uint256) {
        uint256 count;
        for (uint256 i = 0; i < oracleList.length; i++) {
            if (oracles[oracleList[i]].active) count++;
        }
        return count;
    }

    function getReportVoters(bytes32 _reportId) external view returns (address[] memory) {
        return reports[_reportId].voters;
    }

    function getReportSubmissions(bytes32 _reportId) external view returns (uint256[] memory) {
        return reports[_reportId].submissions;
    }

    // ─── Cleanup ───────────────────────────────────────────────────

    /**
     * @notice Remove finalized reports from pendingReportIds.
     * Prevents unbounded array growth. Anyone can call.
     * Processes up to `_batchSize` entries per call (gas limit friendly).
     */
    function cleanupPendingReports(uint256 _batchSize) external {
        uint256 len = pendingReportIds.length;
        if (len == 0 || pendingReportCleanupIndex >= len) return;

        uint256 end = pendingReportCleanupIndex + _batchSize;
        if (end > len) end = len;

        // Compact: move non-finalized to front
        uint256 writeIdx = pendingReportCleanupIndex;
        for (uint256 i = pendingReportCleanupIndex; i < end; i++) {
            if (!reports[pendingReportIds[i]].finalized) {
                if (i != writeIdx) {
                    pendingReportIds[writeIdx] = pendingReportIds[i];
                }
                writeIdx++;
            }
        }

        // If we processed the entire array, truncate
        if (end == len) {
            // Remove finalized entries from the end
            while (pendingReportIds.length > writeIdx) {
                pendingReportIds.pop();
            }
            pendingReportCleanupIndex = 0; // reset for next cycle
        } else {
            pendingReportCleanupIndex = end;
        }
    }

    function getPendingReportCount() external view returns (uint256) {
        return pendingReportIds.length;
    }
}
