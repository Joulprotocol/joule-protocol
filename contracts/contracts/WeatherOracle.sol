// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./EnergyRegistry.sol";
import "./PhysicalCap.sol";

/**
 * @title WeatherOracle
 * @notice Proof of Energy Kiht 2 — weather is an honest witness.
 *
 * Oracle nodes submit weather data from Open-Meteo API (open, free, global).
 * The contract calculates maximum possible output given actual weather
 * and cross-verifies with PhysicalCap (Kiht 1).
 *
 * Both layers must agree before energy claims are accepted.
 * Cloudy day in Tallinn → solar park cannot claim full output.
 *
 * Weather factors by technology:
 *   Solar  → irradiance (W/m²) relative to clear-sky (1000 W/m²)
 *   Wind   → wind speed cubed relationship (cut-in, rated, cut-out)
 *   Hydro  → precipitation factor (rainfall mm relative to baseline)
 *   Geo    → constant (95% — weather-independent, minor seasonal variance)
 */
contract WeatherOracle is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    EnergyRegistry public registry;
    PhysicalCap public physicalCap;

    // 10% measurement tolerance (11000 = 110%)
    uint256 public constant TOLERANCE_BPS = 11000;
    uint256 public constant BPS_BASE = 10000;

    // Solar: clear sky reference irradiance
    uint256 public constant CLEAR_SKY_IRRADIANCE = 1000; // W/m² reference

    // Wind: power curve thresholds (m/s × 10 for precision)
    uint256 public constant WIND_CUT_IN = 30;    // 3.0 m/s
    uint256 public constant WIND_RATED = 120;     // 12.0 m/s
    uint256 public constant WIND_CUT_OUT = 250;   // 25.0 m/s

    // Hydro: baseline daily precipitation (mm × 10)
    uint256 public constant HYDRO_BASELINE_PRECIP = 50; // 5.0 mm/day

    // Geothermal: constant factor (weather-independent)
    uint256 public constant GEO_WEATHER_FACTOR = 9500; // 95% in BPS

    // Submitted weather data
    struct WeatherData {
        uint256 facilityId;
        uint256 timestamp;           // observation time
        uint256 irradiance;          // W/m² (solar)
        uint256 windSpeed;           // m/s × 10
        uint256 precipitation;       // mm × 10
        uint256 temperature;         // °C × 10 (for future use)
        address submittedBy;
        bool verified;
    }

    uint256 public nextWeatherId = 1;
    mapping(uint256 => WeatherData) public weatherData;

    // Latest weather per facility per day
    mapping(uint256 => mapping(uint256 => uint256)) public dailyWeatherId; // facilityId → day → weatherId

    event WeatherSubmitted(uint256 indexed weatherId, uint256 indexed facilityId, address indexed oracle);
    event WeatherVerified(uint256 indexed facilityId, uint256 claimedKWh, uint256 weatherMaxKWh, bool passed);

    constructor(address admin, address _registry, address _physicalCap) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = EnergyRegistry(_registry);
        physicalCap = PhysicalCap(_physicalCap);
    }

    /**
     * @notice Oracle submits weather observation for a facility's location.
     * Data sourced from Open-Meteo API off-chain, submitted on-chain.
     */
    function submitWeather(
        uint256 _facilityId,
        uint256 _timestamp,
        uint256 _irradiance,
        uint256 _windSpeed,
        uint256 _precipitation,
        uint256 _temperature
    ) external onlyRole(ORACLE_ROLE) returns (uint256) {
        require(_timestamp <= block.timestamp, "Future timestamp");
        require(_timestamp > block.timestamp - 2 days, "Data too old");

        (, , , uint256 capacityKW, , , , , , , , , ) = registry.facilities(_facilityId);
        require(capacityKW > 0, "Facility not found");

        uint256 id = nextWeatherId++;
        weatherData[id] = WeatherData({
            facilityId: _facilityId,
            timestamp: _timestamp,
            irradiance: _irradiance,
            windSpeed: _windSpeed,
            precipitation: _precipitation,
            temperature: _temperature,
            submittedBy: msg.sender,
            verified: false
        });

        uint256 day = _timestamp / 1 days;
        dailyWeatherId[_facilityId][day] = id;

        emit WeatherSubmitted(id, _facilityId, msg.sender);
        return id;
    }

    /**
     * @notice Verify energy claim against weather data AND PhysicalCap.
     * Both Kiht 1 (physics) and Kiht 2 (weather) must pass.
     *
     * @param _facilityId The facility claiming production
     * @param _claimedKWh Energy claimed for the day
     * @param _day The day (unix timestamp / 86400)
     * @return passed Whether both physics AND weather checks pass
     */
    function verifyWithWeather(
        uint256 _facilityId,
        uint256 _claimedKWh,
        uint256 _day
    ) external returns (bool passed) {
        // Kiht 1: PhysicalCap must pass first
        bool physicsPassed = physicalCap.verifyProduction(_facilityId, _claimedKWh);
        if (!physicsPassed) {
            emit WeatherVerified(_facilityId, _claimedKWh, 0, false);
            return false;
        }

        // Kiht 2: Weather check
        uint256 weatherId = dailyWeatherId[_facilityId][_day];
        if (weatherId == 0) {
            // No weather data → conservative: allow only 50% of physics cap
            uint256 conservativeMax = physicalCap.maxDailyOutput(_facilityId) / 2;
            bool conservativePassed = _claimedKWh <= conservativeMax;
            emit WeatherVerified(_facilityId, _claimedKWh, conservativeMax, conservativePassed);
            return conservativePassed;
        }

        uint256 weatherMax = calcWeatherMax(_facilityId, weatherId);

        // Apply 10% tolerance
        uint256 allowedMax = weatherMax * TOLERANCE_BPS / BPS_BASE;

        weatherData[weatherId].verified = true;
        passed = _claimedKWh <= allowedMax;

        emit WeatherVerified(_facilityId, _claimedKWh, allowedMax, passed);
    }

    /**
     * @notice Calculate maximum output given weather conditions.
     * Technology-specific formulas.
     */
    function calcWeatherMax(
        uint256 _facilityId,
        uint256 _weatherId
    ) public view returns (uint256 maxKWh) {
        WeatherData memory w = weatherData[_weatherId];

        (
            , ,
            EnergyRegistry.FacilityType facilityType,
            uint256 capacityKW,
            , , , , , , , ,
        ) = registry.facilities(_facilityId);

        uint256 peakHours = physicalCap.getSolarPeak(getLatitude(_facilityId));

        if (facilityType == EnergyRegistry.FacilityType.Solar) {
            maxKWh = calcSolarMax(capacityKW, peakHours, w.irradiance);
        } else if (facilityType == EnergyRegistry.FacilityType.Wind) {
            maxKWh = calcWindMax(capacityKW, w.windSpeed);
        } else if (facilityType == EnergyRegistry.FacilityType.Hydro) {
            maxKWh = calcHydroMax(capacityKW, peakHours, w.precipitation);
        } else {
            // Geothermal — weather-independent
            maxKWh = capacityKW * peakHours * GEO_WEATHER_FACTOR / (100 * BPS_BASE);
        }
    }

    /**
     * @notice Solar: output scales linearly with irradiance.
     * Cloudy day (200 W/m²) = 20% of clear sky output.
     */
    function calcSolarMax(
        uint256 _capacityKW,
        uint256 _peakHours,
        uint256 _irradiance
    ) public pure returns (uint256) {
        // irradiance as fraction of clear sky
        // capacity × peakHours/100 × irradiance/1000 × efficiency(20%)
        return _capacityKW * _peakHours * _irradiance * 2000 / (100 * CLEAR_SKY_IRRADIANCE * BPS_BASE);
    }

    /**
     * @notice Wind: simplified power curve.
     * Below cut-in (3 m/s) → 0
     * Cut-in to rated (3-12 m/s) → cubic ramp
     * Rated to cut-out (12-25 m/s) → 100%
     * Above cut-out (25+ m/s) → 0 (safety shutdown)
     */
    function calcWindMax(
        uint256 _capacityKW,
        uint256 _windSpeed
    ) public pure returns (uint256) {
        if (_windSpeed < WIND_CUT_IN) return 0;
        if (_windSpeed > WIND_CUT_OUT) return 0;

        uint256 factor;
        if (_windSpeed >= WIND_RATED) {
            // At or above rated: full capacity factor (30%)
            factor = 3000;
        } else {
            // Cubic interpolation between cut-in and rated
            // Simplified: linear ramp for gas efficiency
            uint256 range = WIND_RATED - WIND_CUT_IN; // 90
            uint256 position = _windSpeed - WIND_CUT_IN;
            factor = position * 3000 / range;
        }

        // 24 hours of wind × capacity factor
        return _capacityKW * 24 * factor / BPS_BASE;
    }

    /**
     * @notice Hydro: output scales with precipitation relative to baseline.
     * No rain → 30% base flow. Heavy rain → up to 100% capacity factor.
     */
    function calcHydroMax(
        uint256 _capacityKW,
        uint256 _peakHours,
        uint256 _precipitation
    ) public pure returns (uint256) {
        uint256 factor;
        if (_precipitation == 0) {
            factor = 3000; // 30% base flow
        } else if (_precipitation >= HYDRO_BASELINE_PRECIP * 2) {
            factor = 5000; // 50% max (hydro CF from PhysicalCap)
        } else {
            // Linear between 30% and 50%
            factor = 3000 + (_precipitation * 2000 / (HYDRO_BASELINE_PRECIP * 2));
        }

        return _capacityKW * _peakHours * factor / (100 * BPS_BASE);
    }

    /**
     * @notice Helper: get facility latitude from registry.
     */
    function getLatitude(uint256 _facilityId) public view returns (int64) {
        (, , , , , int64 lat, , , , , , , ) = registry.facilities(_facilityId);
        return lat;
    }
}
