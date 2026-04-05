const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * WeatherOracle Tests — Proof of Energy Kiht 2
 *
 * Weather is an honest witness.
 * Cloudy day in Tallinn → solar park cannot claim full output.
 */
describe("WeatherOracle — Weather Layer", function () {
  let weatherOracle, physicalCap, registry;
  let owner, oracleNode, producer;

  const TALLINN_GEOHASH = "0x75636674"; // "ucft"
  const TALLINN_BAND = 2; // subarctic
  const NAIROBI_GEOHASH = "0x73373268"; // "s72h"
  const NAIROBI_BAND = 4; // equator

  let now;

  async function registerFacility(type, capacityKW, geohash, band) {
    const meterId = ethers.keccak256(
      ethers.toUtf8Bytes(`METER-${Date.now()}-${Math.random()}`)
    );
    await registry.connect(producer).registerFacility(type, capacityKW, meterId, geohash, band, "XX");
    const id = (await registry.nextFacilityId()) - 1n;
    await registry.connect(owner).verifyFacility(id);
    return id;
  }

  function dayOf(timestamp) {
    return BigInt(timestamp) / 86400n;
  }

  beforeEach(async function () {
    [owner, oracleNode, producer] = await ethers.getSigners();

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(owner.address);

    const PhysicalCap = await ethers.getContractFactory("PhysicalCap");
    physicalCap = await PhysicalCap.deploy(registry.target);

    const WeatherOracle = await ethers.getContractFactory("WeatherOracle");
    weatherOracle = await WeatherOracle.deploy(owner.address, registry.target, physicalCap.target);

    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();
    const ORACLE_ROLE = await weatherOracle.ORACLE_ROLE();
    await registry.grantRole(VERIFIER_ROLE, owner.address);
    await weatherOracle.grantRole(ORACLE_ROLE, oracleNode.address);
    await weatherOracle.grantRole(ORACLE_ROLE, owner.address); // for verifyWithWeather tests

    now = (await ethers.provider.getBlock("latest")).timestamp;
  });

  // ─── Weather Submission ──────────────────────────────────────

  describe("Weather Submission", function () {
    it("oracle submits weather data", async function () {
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);

      const tx = await weatherOracle.connect(oracleNode).submitWeather(
        id, now, 800, 50, 0, 150 // 800 W/m², 5.0 m/s wind, 0 rain, 15°C
      );
      await expect(tx).to.emit(weatherOracle, "WeatherSubmitted");

      const w = await weatherOracle.weatherData(1);
      expect(w.facilityId).to.equal(id);
      expect(w.irradiance).to.equal(800);
      expect(w.windSpeed).to.equal(50);
    });

    it("rejects future timestamp", async function () {
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      await expect(
        weatherOracle.connect(oracleNode).submitWeather(id, now + 3600, 800, 50, 0, 150)
      ).to.be.revertedWith("Future timestamp");
    });

    it("rejects data older than 2 days", async function () {
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      await expect(
        weatherOracle.connect(oracleNode).submitWeather(id, now - 200000, 800, 50, 0, 150)
      ).to.be.revertedWith("Data too old");
    });

    it("rejects non-oracle submission", async function () {
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      await expect(
        weatherOracle.connect(producer).submitWeather(id, now, 800, 50, 0, 150)
      ).to.be.reverted;
    });

    it("rejects non-existent facility", async function () {
      await expect(
        weatherOracle.connect(oracleNode).submitWeather(999, now, 800, 50, 0, 150)
      ).to.be.revertedWith("Facility not found");
    });
  });

  // ─── Solar Weather Calculations ──────────────────────────────

  describe("Solar — Weather Impact", function () {
    it("clear sky (1000 W/m²) in Tallinn → full physics output", async function () {
      // 50kW solar, Tallinn: PhysicalCap max = 33 kWh
      // Weather: 1000 W/m² (clear sky)
      // calcSolarMax = 50 × 300 × 1000 × 2000 / (100 × 1000 × 10000) = 30
      // + 10% tolerance = 33
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      const day = dayOf(now);

      await weatherOracle.connect(oracleNode).submitWeather(id, now, 1000, 0, 0, 200);

      const tx = await weatherOracle.verifyWithWeather(id, 30, day);
      await expect(tx).to.emit(weatherOracle, "WeatherVerified").withArgs(id, 30, 33, true);
    });

    it("PILVINE PÄEV TALLINNAS — päikesepark ei saa väita täistoodangut", async function () {
      // 50kW solar, Tallinn
      // Weather: 200 W/m² (heavy clouds — only 20% of clear sky)
      // calcSolarMax = 50 × 300 × 200 × 2000 / (100 × 1000 × 10000) = 6
      // + 10% tolerance = 6 (6.6 rounds down)
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      const day = dayOf(now);

      await weatherOracle.connect(oracleNode).submitWeather(id, now, 200, 0, 0, 80);

      // Try to claim 25 kWh (which would pass PhysicalCap alone)
      const tx = await weatherOracle.verifyWithWeather(id, 25, day);
      await expect(tx).to.emit(weatherOracle, "WeatherVerified");

      // Static call to check result
      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 25, day);
      expect(passed).to.be.false;

      // 6 kWh should pass
      const passed2 = await weatherOracle.verifyWithWeather.staticCall(id, 6, day);
      expect(passed2).to.be.true;
    });

    it("partly cloudy (500 W/m²) → half the clear-sky output", async function () {
      // 100kW solar, Tallinn
      // calcSolarMax = 100 × 300 × 500 × 2000 / (100 × 1000 × 10000) = 30
      // + 10% = 33
      const id = await registerFacility(0, 100, TALLINN_GEOHASH, TALLINN_BAND);
      const day = dayOf(now);

      await weatherOracle.connect(oracleNode).submitWeather(id, now, 500, 0, 0, 150);

      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 33, day);
      expect(passed).to.be.true;

      const failed = await weatherOracle.verifyWithWeather.staticCall(id, 40, day);
      expect(failed).to.be.false;
    });
  });

  // ─── Wind Weather Calculations ──────────────────────────────

  describe("Wind — Weather Impact", function () {
    it("good wind (12+ m/s) → full capacity factor", async function () {
      // 100kW wind, rated speed 12 m/s
      // calcWindMax: windSpeed >= WIND_RATED → factor 3000
      // 100 × 24 × 3000 / 10000 = 720 kWh (weather)
      // PhysicalCap: 100 × 300 × 3000 / (100 × 10000) × 110% = 99 kWh
      // Cross-verified: min(weather, physics) → physics caps at 99
      const id = await registerFacility(1, 100, TALLINN_GEOHASH, TALLINN_BAND);
      const day = dayOf(now);

      await weatherOracle.connect(oracleNode).submitWeather(id, now, 0, 150, 0, 100);

      // 90 kWh within both caps
      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 90, day);
      expect(passed).to.be.true;
    });

    it("calm day (2 m/s) → below cut-in, zero output", async function () {
      const id = await registerFacility(1, 100, TALLINN_GEOHASH, TALLINN_BAND);
      const day = dayOf(now);

      await weatherOracle.connect(oracleNode).submitWeather(id, now, 0, 20, 0, 100);

      // Even 1 kWh should fail (weather says 0 + 10% = 0)
      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 1, day);
      expect(passed).to.be.false;

      // 0 kWh passes
      const passed0 = await weatherOracle.verifyWithWeather.staticCall(id, 0, day);
      expect(passed0).to.be.true;
    });

    it("storm (30 m/s) → above cut-out, safety shutdown", async function () {
      const id = await registerFacility(1, 100, TALLINN_GEOHASH, TALLINN_BAND);
      const day = dayOf(now);

      await weatherOracle.connect(oracleNode).submitWeather(id, now, 0, 300, 0, 50);

      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 1, day);
      expect(passed).to.be.false;
    });

    it("moderate wind (7.5 m/s) → partial output, capped by physics", async function () {
      // 100kW wind, 7.5 m/s = 75 in contract units
      // Weather: factor = 1500, 100 × 24 × 1500 / 10000 = 360 kWh
      // PhysicalCap: 100kW wind Tallinn = 99 kWh max
      // Cross-verified: physics caps at 99
      const id = await registerFacility(1, 100, TALLINN_GEOHASH, TALLINN_BAND);
      const day = dayOf(now);

      await weatherOracle.connect(oracleNode).submitWeather(id, now, 0, 75, 0, 100);

      // 90 kWh within physics cap
      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 90, day);
      expect(passed).to.be.true;

      // 100 kWh exceeds physics cap (99)
      const failed = await weatherOracle.verifyWithWeather.staticCall(id, 100, day);
      expect(failed).to.be.false;
    });
  });

  // ─── Hydro Weather Calculations ─────────────────────────────

  describe("Hydro — Weather Impact", function () {
    it("no rain → 30% base flow", async function () {
      // 200kW hydro, equator (5.5h peak), no rain
      // factor = 3000
      // 200 × 550 × 3000 / (100 × 10000) = 330
      // + 10% = 363
      const id = await registerFacility(2, 200, NAIROBI_GEOHASH, NAIROBI_BAND);
      const day = dayOf(now);

      await weatherOracle.connect(oracleNode).submitWeather(id, now, 0, 0, 0, 250);

      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 360, day);
      expect(passed).to.be.true;

      const failed = await weatherOracle.verifyWithWeather.staticCall(id, 370, day);
      expect(failed).to.be.false;
    });

    it("heavy rain → up to 50% capacity factor", async function () {
      // 200kW hydro, equator, heavy rain (100 mm = 1000 in units, above 2× baseline)
      // factor = 5000
      // 200 × 550 × 5000 / (100 × 10000) = 550
      // + 10% = 605
      const id = await registerFacility(2, 200, NAIROBI_GEOHASH, NAIROBI_BAND);
      const day = dayOf(now);

      await weatherOracle.connect(oracleNode).submitWeather(id, now, 0, 0, 1000, 250);

      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 600, day);
      expect(passed).to.be.true;
    });
  });

  // ─── Cross-Verification (Kiht 1 + Kiht 2) ──────────────────

  describe("Cross-Verification — Physics + Weather", function () {
    it("physics fail blocks even if weather would pass", async function () {
      // 50kW solar, Tallinn: PhysicalCap max = 33 kWh
      // Clear sky weather would allow ~33 kWh
      // But claiming 50 kWh → physics says no first
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      const day = dayOf(now);

      await weatherOracle.connect(oracleNode).submitWeather(id, now, 1000, 0, 0, 200);

      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 50, day);
      expect(passed).to.be.false;
    });

    it("no weather data → conservative 50% of physics cap", async function () {
      // 50kW solar, Tallinn: PhysicalCap max = 33
      // No weather → 33/2 = 16 kWh max
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      const day = dayOf(now);
      // No weather submitted

      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 16, day);
      expect(passed).to.be.true;

      const failed = await weatherOracle.verifyWithWeather.staticCall(id, 17, day);
      expect(failed).to.be.false;
    });

    it("full cycle: submit weather → verify → passes", async function () {
      const id = await registerFacility(0, 100, TALLINN_GEOHASH, TALLINN_BAND);
      const day = dayOf(now);

      // Sunny day in Tallinn (rare but it happens)
      await weatherOracle.connect(oracleNode).submitWeather(id, now, 900, 30, 0, 220);

      // calcSolarMax = 100 × 300 × 900 × 2000 / (100 × 1000 × 10000) = 54
      // + 10% = 59
      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 54, day);
      expect(passed).to.be.true;
    });
  });

  // ─── Geothermal (weather-independent) ────────────────────────

  describe("Geothermal — Weather Independent", function () {
    it("any weather → ~95% constant output", async function () {
      // 500kW geo, equator
      // 500 × 550 × 9500 / (100 × 10000) = 2612
      // + 10% = 2873
      const id = await registerFacility(3, 500, NAIROBI_GEOHASH, NAIROBI_BAND);
      const day = dayOf(now);

      // Terrible weather — doesn't matter for geo
      await weatherOracle.connect(oracleNode).submitWeather(id, now, 0, 300, 500, 0);

      const passed = await weatherOracle.verifyWithWeather.staticCall(id, 2600, day);
      expect(passed).to.be.true;
    });
  });
});
