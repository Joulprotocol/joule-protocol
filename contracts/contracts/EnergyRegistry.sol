// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title EnergyRegistry
 * @notice Registry for renewable energy production facilities.
 * Facility owners register their installations, oracle nodes verify them,
 * and verified facilities can earn PoE mining rewards.
 */
contract EnergyRegistry is AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    enum FacilityType { Solar, Wind, Hydro, Geothermal }
    // No Biomass — trees don't regrow fast enough
    // No Nuclear — not renewable
    // No Fossil — obviously not
    enum FacilityStatus { Pending, Verified, Suspended, Deregistered }

    struct Facility {
        uint256 id;
        address owner;
        FacilityType facilityType;
        uint256 capacityKW;          // nameplate capacity in kW
        bytes32 meterId;             // hashed smart meter identifier
        int64 latitude;              // scaled by 1e6
        int64 longitude;             // scaled by 1e6
        string country;              // ISO 3166-1 alpha-2
        uint256 registeredAt;
        uint256 verifiedAt;
        FacilityStatus status;
        uint256 totalVerifiedKWh;    // cumulative verified production
        uint256 lastReportTimestamp;
    }

    uint256 public nextFacilityId = 1;
    mapping(uint256 => Facility) public facilities;
    mapping(address => uint256[]) public ownerFacilities;
    mapping(bytes32 => bool) public meterIdUsed;

    // Stats
    uint256 public totalFacilities;
    uint256 public verifiedFacilities;
    uint256 public totalCapacityKW;
    uint256 public totalVerifiedKWh;

    event FacilityRegistered(uint256 indexed id, address indexed owner, FacilityType facilityType, uint256 capacityKW);
    event FacilityVerified(uint256 indexed id, address indexed verifier);
    event FacilitySuspended(uint256 indexed id, string reason);
    event FacilityDeregistered(uint256 indexed id);
    event ProductionRecorded(uint256 indexed id, uint256 kWh, uint256 periodStart, uint256 periodEnd);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Register a new energy production facility
     */
    function registerFacility(
        FacilityType _type,
        uint256 _capacityKW,
        bytes32 _meterId,
        int64 _lat,
        int64 _lon,
        string calldata _country
    ) external returns (uint256) {
        require(_capacityKW > 0, "Capacity must be > 0");
        require(_capacityKW <= 100_000, "Capacity max 100 MW");
        require(!meterIdUsed[_meterId], "Meter ID already registered");

        uint256 id = nextFacilityId++;
        facilities[id] = Facility({
            id: id,
            owner: msg.sender,
            facilityType: _type,
            capacityKW: _capacityKW,
            meterId: _meterId,
            latitude: _lat,
            longitude: _lon,
            country: _country,
            registeredAt: block.timestamp,
            verifiedAt: 0,
            status: FacilityStatus.Pending,
            totalVerifiedKWh: 0,
            lastReportTimestamp: 0
        });

        ownerFacilities[msg.sender].push(id);
        meterIdUsed[_meterId] = true;
        totalFacilities++;

        emit FacilityRegistered(id, msg.sender, _type, _capacityKW);
        return id;
    }

    /**
     * @notice Verify a facility (oracle verifiers only)
     */
    function verifyFacility(uint256 _id) external onlyRole(VERIFIER_ROLE) {
        Facility storage f = facilities[_id];
        require(f.id != 0, "Facility not found");
        require(f.status == FacilityStatus.Pending, "Not in pending state");

        f.status = FacilityStatus.Verified;
        f.verifiedAt = block.timestamp;
        verifiedFacilities++;
        totalCapacityKW += f.capacityKW;

        emit FacilityVerified(_id, msg.sender);
    }

    /**
     * @notice Record verified energy production (called by PoEMining contract)
     */
    function recordProduction(
        uint256 _id,
        uint256 _kWh,
        uint256 _periodStart,
        uint256 _periodEnd
    ) external onlyRole(VERIFIER_ROLE) {
        Facility storage f = facilities[_id];
        require(f.status == FacilityStatus.Verified, "Not verified");
        require(_periodEnd > _periodStart, "Invalid period");
        require(_periodEnd <= block.timestamp, "Future period");

        // Sanity check: production can't exceed capacity × hours
        uint256 periodHours = (_periodEnd - _periodStart) / 3600;
        uint256 maxProduction = f.capacityKW * periodHours;
        require(_kWh <= maxProduction, "Production exceeds capacity");

        f.totalVerifiedKWh += _kWh;
        f.lastReportTimestamp = _periodEnd;
        totalVerifiedKWh += _kWh;

        emit ProductionRecorded(_id, _kWh, _periodStart, _periodEnd);
    }

    /**
     * @notice Suspend a facility (oracle verifiers)
     */
    function suspendFacility(uint256 _id, string calldata _reason) external onlyRole(VERIFIER_ROLE) {
        Facility storage f = facilities[_id];
        require(f.status == FacilityStatus.Verified, "Not verified");
        f.status = FacilityStatus.Suspended;
        emit FacilitySuspended(_id, _reason);
    }

    /**
     * @notice Deregister own facility
     */
    function deregisterFacility(uint256 _id) external {
        Facility storage f = facilities[_id];
        require(f.owner == msg.sender, "Not owner");
        require(f.status != FacilityStatus.Deregistered, "Already deregistered");
        f.status = FacilityStatus.Deregistered;
        emit FacilityDeregistered(_id);
    }

    /**
     * @notice Get all facility IDs for an owner
     */
    function getFacilityIds(address _owner) external view returns (uint256[] memory) {
        return ownerFacilities[_owner];
    }

    /**
     * @notice Check if facility is active and verified
     */
    function isActive(uint256 _id) external view returns (bool) {
        return facilities[_id].status == FacilityStatus.Verified;
    }

    /**
     * @notice Get facility owner
     */
    function facilityOwner(uint256 _id) external view returns (address) {
        return facilities[_id].owner;
    }
}
