// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./EnergyRegistry.sol";

/**
 * @title PhysicalCap
 * @notice Physics-based maximum energy output calculator.
 *
 * Kiht 1 of Proof of Energy — physics is the judge.
 * Calculates the theoretical maximum daily output based on:
 *   - Installed capacity (kW)
 *   - GPS coordinates (latitude → solar peak hours)
 *   - Technology type (solar, wind, hydro, geothermal)
 *   - Technology-specific efficiency factors
 *
 * 10% buffer for measurement tolerances.
 * GPS is locked at registration. 90-day freeze before change.
 */
contract PhysicalCap {
    EnergyRegistry public registry;

    // Technology efficiency factors (basis points, 10000 = 100%)
    // Conservative real-world capacity factors
    uint256 public constant SOLAR_EFFICIENCY = 2000;       // 20% — global average CF
    uint256 public constant WIND_EFFICIENCY = 3000;        // 30%
    uint256 public constant HYDRO_EFFICIENCY = 5000;       // 50%
    uint256 public constant GEOTHERMAL_EFFICIENCY = 9000;  // 90%

    // 10% measurement tolerance buffer (11000 = 110%)
    uint256 public constant TOLERANCE_BPS = 11000;
    uint256 public constant BPS_BASE = 10000;

    // Solar peak hours by latitude band (hours × 100 for precision)
    // Based on annual average Global Horizontal Irradiance data
    uint256 public constant PEAK_HOURS_EQUATOR = 550;      // 5.5h — 0-15°
    uint256 public constant PEAK_HOURS_TROPICAL = 500;     // 5.0h — 15-30°
    uint256 public constant PEAK_HOURS_TEMPERATE = 400;    // 4.0h — 30-45°
    uint256 public constant PEAK_HOURS_SUBARCTIC = 300;    // 3.0h — 45-60°
    uint256 public constant PEAK_HOURS_ARCTIC = 200;       // 2.0h — 60°+

    // GPS change freeze period
    uint256 public constant GPS_FREEZE_PERIOD = 90 days;

    // GPS change tracking
    mapping(uint256 => uint256) public lastGpsChange;  // facilityId → timestamp

    event PhysicsCheckPassed(uint256 indexed facilityId, uint256 claimedKWh, uint256 maxAllowed);
    event PhysicsCheckFailed(uint256 indexed facilityId, uint256 claimedKWh, uint256 maxAllowed);

    constructor(address _registry) {
        registry = EnergyRegistry(_registry);
    }

    /**
     * @notice Calculate maximum daily output for a facility.
     * @param _facilityId The registered facility ID
     * @return maxKWh Maximum allowed daily kWh (including 10% tolerance)
     */
    function maxDailyOutput(uint256 _facilityId) public view returns (uint256 maxKWh) {
        (
            ,                              // id
            ,                              // owner
            EnergyRegistry.FacilityType facilityType,
            uint256 capacityKW,
            ,                              // meterId
            int64 latitude,
            ,                              // longitude
            ,                              // country
            ,                              // registeredAt
            ,                              // verifiedAt
            ,                              // status
            ,                              // totalVerifiedKWh
                                           // lastReportTimestamp
        ) = registry.facilities(_facilityId);

        require(capacityKW > 0, "Facility not found");

        uint256 peakHours = getSolarPeak(latitude);
        uint256 efficiency = getTechEfficiency(facilityType);

        // Base max = capacity × peakHours × efficiency
        // peakHours is ×100, efficiency is in BPS (×10000)
        // So: capacityKW × peakHours × efficiency / (100 × 10000)
        uint256 theoreticalMax = capacityKW * peakHours * efficiency / (100 * BPS_BASE);

        // Add 10% tolerance buffer
        maxKWh = theoreticalMax * TOLERANCE_BPS / BPS_BASE;
    }

    /**
     * @notice Verify that claimed production doesn't violate physics.
     * @param _facilityId The facility claiming production
     * @param _claimedKWh The energy claimed for the day
     * @return allowed Whether the claim passes physics check
     */
    function verifyProduction(
        uint256 _facilityId,
        uint256 _claimedKWh
    ) external returns (bool allowed) {
        uint256 maxAllowed = maxDailyOutput(_facilityId);

        if (_claimedKWh <= maxAllowed) {
            emit PhysicsCheckPassed(_facilityId, _claimedKWh, maxAllowed);
            return true;
        } else {
            emit PhysicsCheckFailed(_facilityId, _claimedKWh, maxAllowed);
            return false;
        }
    }

    /**
     * @notice Get solar peak hours based on latitude.
     * Wind/hydro/geo use this as a proxy for daylight hours affecting all renewables.
     * @param _lat Latitude scaled by 1e6 (e.g., 58381000 = 58.381°N)
     * @return peakHours Peak sun hours × 100
     */
    function getSolarPeak(int64 _lat) public pure returns (uint256 peakHours) {
        // Get absolute latitude in degrees
        uint256 absLat;
        if (_lat >= 0) {
            absLat = uint256(uint64(_lat)) / 1e6;
        } else {
            absLat = uint256(uint64(-_lat)) / 1e6;
        }

        if (absLat < 15) {
            return PEAK_HOURS_EQUATOR;       // 5.5h
        } else if (absLat < 30) {
            return PEAK_HOURS_TROPICAL;      // 5.0h
        } else if (absLat < 45) {
            return PEAK_HOURS_TEMPERATE;     // 4.0h
        } else if (absLat < 60) {
            return PEAK_HOURS_SUBARCTIC;     // 3.0h
        } else {
            return PEAK_HOURS_ARCTIC;        // 2.0h
        }
    }

    /**
     * @notice Get efficiency factor for technology type.
     * @param _type The facility technology type
     * @return efficiency Efficiency in basis points (10000 = 100%)
     */
    function getTechEfficiency(
        EnergyRegistry.FacilityType _type
    ) public pure returns (uint256 efficiency) {
        if (_type == EnergyRegistry.FacilityType.Solar) {
            return SOLAR_EFFICIENCY;         // 20%
        } else if (_type == EnergyRegistry.FacilityType.Wind) {
            return WIND_EFFICIENCY;          // 30%
        } else if (_type == EnergyRegistry.FacilityType.Hydro) {
            return HYDRO_EFFICIENCY;         // 50%
        } else if (_type == EnergyRegistry.FacilityType.Geothermal) {
            return GEOTHERMAL_EFFICIENCY;    // 90%
        } else {
            revert("Unknown technology type");
        }
    }
}
