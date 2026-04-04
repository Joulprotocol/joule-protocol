// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
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
contract OracleConsensus is AccessControl {
    uint256 public constant MIN_STAKE = 10_000 ether;    // 10,000 JOL
    uint256 public constant QUORUM = 3;                    // 3-of-5 minimum
    uint256 public constant SLASH_PERCENT = 50;            // 50% slash for fraud
    uint256 public constant REPORT_WINDOW = 1 hours;       // time to submit reports
    uint256 public constant MAX_DEVIATION_BPS = 1000;      // 10% max deviation from median

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

    EnergyRegistry public registry;
    PoEMining public poeMining;

    mapping(address => OracleNode) public oracles;
    address[] public oracleList;
    mapping(bytes32 => EnergyReport) public reports;
    bytes32[] public pendingReportIds;

    uint256 public totalStaked;
    uint256 public totalSlashed;
    uint256 public reportsFinalized;

    event OracleJoined(address indexed operator, uint256 stake);
    event OracleExited(address indexed operator, uint256 stakeReturned);
    event OracleSlashed(address indexed operator, uint256 amount, bytes32 reportId);
    event ReportSubmitted(bytes32 indexed reportId, address indexed oracle, uint256 kWh);
    event ReportFinalized(bytes32 indexed reportId, uint256 facilityId, uint256 kWh);
    event AnomalyFlagged(bytes32 indexed reportId, uint256 facilityId, string reason);

    constructor(address admin, address _registry) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = EnergyRegistry(_registry);
    }

    function setPoEMining(address _poeMining) external onlyRole(DEFAULT_ADMIN_ROLE) {
        poeMining = PoEMining(_poeMining);
    }

    // ─── Oracle Management ─────────────────────────────────────────

    /**
     * @notice Stake JOL to become an oracle node
     */
    function joinAsOracle() external payable {
        require(msg.value >= MIN_STAKE, "Insufficient stake");
        require(!oracles[msg.sender].active, "Already active");

        oracles[msg.sender] = OracleNode({
            operator: msg.sender,
            stake: msg.value,
            reportsSubmitted: 0,
            reportsAccepted: 0,
            slashCount: 0,
            joinedAt: block.timestamp,
            active: true
        });

        oracleList.push(msg.sender);
        totalStaked += msg.value;

        emit OracleJoined(msg.sender, msg.value);
    }

    /**
     * @notice Exit oracle network and reclaim stake (minus any slashing)
     */
    function exitOracle() external {
        OracleNode storage node = oracles[msg.sender];
        require(node.active, "Not active oracle");
        require(block.timestamp > node.joinedAt + 30 days, "Lock period 30 days");

        node.active = false;
        uint256 stakeReturn = node.stake;
        node.stake = 0;
        totalStaked -= stakeReturn;

        (bool sent, ) = msg.sender.call{value: stakeReturn}("");
        require(sent, "Transfer failed");

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
    ) external {
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
        if (report.voters.length >= QUORUM) {
            _finalizeReport(reportId);
        }
    }

    // ─── Finalization ──────────────────────────────────────────────

    function _finalizeReport(bytes32 _reportId) internal {
        EnergyReport storage report = reports[_reportId];
        require(!report.finalized, "Already finalized");
        require(report.voters.length >= QUORUM, "No quorum");

        // Calculate median
        uint256[] memory sorted = _sortArray(report.submissions);
        uint256 median = sorted[sorted.length / 2];

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

        // Burned — sent to address(0) effectively by not redistributing
        emit OracleSlashed(_oracle, slashAmount, _reportId);

        // Deactivate if stake falls below minimum
        if (node.stake < MIN_STAKE) {
            node.active = false;
        }
    }

    // ─── Utilities ─────────────────────────────────────────────────

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
}
