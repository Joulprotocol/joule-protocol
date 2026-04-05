const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * PhysicalCap Tests — Proof of Energy Kiht 1
 *
 * Physics is the judge. This contract ensures no facility
 * can claim more energy than physics allows.
 */
describe("PhysicalCap — Physics Layer", function () {
  let physicalCap, registry;
  let owner, verifier, producer;

  // Geohash + latitude bands (replacing raw GPS for privacy)
  // Latitude bands: 0=tropical(15-30°), 1=temperate(30-45°), 2=subarctic(45-60°), 3=arctic(60°+), 4=equator(0-15°)
  const TALLINN_GEOHASH = "0x75636674";   // "ucft" — subarctic band (2)
  const TALLINN_BAND = 2;
  const MALAGA_GEOHASH = "0x65797063";    // "eypc" — temperate band (1)
  const MALAGA_BAND = 1;
  const NAIROBI_GEOHASH = "0x73373268";   // "s72h" — equator band (4)
  const NAIROBI_BAND = 4;
  const CAIRO_GEOHASH = "0x73746e68";     // "stnh" — tropical band (0)
  const CAIRO_BAND = 0;
  const REYKJAVIK_GEOHASH = "0x67636a32"; // "gcj2" — arctic band (3)
  const REYKJAVIK_BAND = 3;

  async function registerFacility(type, capacityKW, geohash, band) {
    const meterId = ethers.keccak256(
      ethers.toUtf8Bytes(`METER-${Date.now()}-${Math.random()}`)
    );
    await registry.connect(producer).registerFacility(type, capacityKW, meterId, geohash, band, "XX");
    const id = (await registry.nextFacilityId()) - 1n;
    await registry.connect(verifier).verifyFacility(id);
    return id;
  }

  beforeEach(async function () {
    [owner, verifier, producer] = await ethers.getSigners();

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(owner.address);

    const PhysicalCap = await ethers.getContractFactory("PhysicalCap");
    physicalCap = await PhysicalCap.deploy(registry.target);

    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();
    await registry.grantRole(VERIFIER_ROLE, verifier.address);
  });

  // ─── Solar Peak Hours by Latitude ────────────────────────────

  describe("Solar Peak Hours by Latitude Band", function () {
    it("equator (band 4) = 5.5h", async function () {
      expect(await physicalCap.getSolarPeakByBand(4)).to.equal(550);
    });

    it("tropical (band 0) = 5.0h", async function () {
      expect(await physicalCap.getSolarPeakByBand(0)).to.equal(500);
    });

    it("temperate (band 1) = 4.0h", async function () {
      expect(await physicalCap.getSolarPeakByBand(1)).to.equal(400);
    });

    it("subarctic (band 2) = 3.0h — Tallinn", async function () {
      expect(await physicalCap.getSolarPeakByBand(2)).to.equal(300);
    });

    it("arctic (band 3) = 2.0h — Reykjavik", async function () {
      expect(await physicalCap.getSolarPeakByBand(3)).to.equal(200);
    });

    it("all bands covered", async function () {
      // Verify all 5 bands return valid values
      expect(await physicalCap.getSolarPeakByBand(0)).to.equal(500);
      expect(await physicalCap.getSolarPeakByBand(1)).to.equal(400);
      expect(await physicalCap.getSolarPeakByBand(2)).to.equal(300);
      expect(await physicalCap.getSolarPeakByBand(3)).to.equal(200);
      expect(await physicalCap.getSolarPeakByBand(4)).to.equal(550);
    });
  });

  // ─── Technology Efficiency ──────────��────────────────────────

  describe("Technology Efficiency", function () {
    it("Solar = 20%", async function () {
      expect(await physicalCap.getTechEfficiency(0)).to.equal(2000);
    });

    it("Wind = 30%", async function () {
      expect(await physicalCap.getTechEfficiency(1)).to.equal(3000);
    });

    it("Hydro = 50%", async function () {
      expect(await physicalCap.getTechEfficiency(2)).to.equal(5000);
    });

    it("Geothermal = 90%", async function () {
      expect(await physicalCap.getTechEfficiency(3)).to.equal(9000);
    });
  });

  // ─── Max Daily Output Calculations ──────────────────────────

  describe("Max Daily Output", function () {
    it("50kW solar in Tallinn (58°N) → max ~33 kWh/day", async function () {
      // 50 kW × 3.0h peak × 20% efficiency = 30 kWh theoretical
      // + 10% tolerance = 33 kWh
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      const max = await physicalCap.maxDailyOutput(id);
      expect(max).to.equal(33); // 50 × 300 × 2000 / (100 × 10000) × 11000/10000 = 33
    });

    it("50kW solar in Malaga (37°N) → max ~44 kWh/day", async function () {
      // 50 × 4.0h × 20% = 40 theoretical + 10% = 44
      const id = await registerFacility(0, 50, MALAGA_GEOHASH, MALAGA_BAND);
      const max = await physicalCap.maxDailyOutput(id);
      expect(max).to.equal(44);
    });

    it("100kW wind in Tallinn → max ~99 kWh/day", async function () {
      // 100 × 3.0h × 30% = 90 + 10% = 99
      const id = await registerFacility(1, 100, TALLINN_GEOHASH, TALLINN_BAND);
      const max = await physicalCap.maxDailyOutput(id);
      expect(max).to.equal(99);
    });

    it("200kW hydro at equator → max ~605 kWh/day", async function () {
      // 200 × 5.5h × 50% = 550 + 10% = 605
      const id = await registerFacility(2, 200, NAIROBI_GEOHASH, NAIROBI_BAND);
      const max = await physicalCap.maxDailyOutput(id);
      expect(max).to.equal(605);
    });

    it("500kW geothermal at equator → max ~2722 kWh/day", async function () {
      // 500 × 5.5h × 90% = 2475 + 10% = 2722.5 → 2722 (integer)
      const id = await registerFacility(3, 500, NAIROBI_GEOHASH, NAIROBI_BAND);
      const max = await physicalCap.maxDailyOutput(id);
      expect(max).to.equal(2722);
    });

    it("1MW solar in arctic (65°N) → very limited", async function () {
      // 1000 × 2.0h × 20% = 400 + 10% = 440
      const id = await registerFacility(0, 1000, REYKJAVIK_GEOHASH, REYKJAVIK_BAND);
      const max = await physicalCap.maxDailyOutput(id);
      expect(max).to.equal(440);
    });
  });

  // ─── Production Verification ────────���───────────────────────

  describe("Production Verification", function () {
    it("passes when claimed ≤ max", async function () {
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      // Max = 33 kWh, claim 30
      const tx = await physicalCap.verifyProduction(id, 30);
      await expect(tx).to.emit(physicalCap, "PhysicsCheckPassed");
    });

    it("passes at exactly max", async function () {
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      const tx = await physicalCap.verifyProduction(id, 33);
      await expect(tx).to.emit(physicalCap, "PhysicsCheckPassed");
    });

    it("fails when claimed > max (physics says no)", async function () {
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      // Max = 33, claim 50
      const tx = await physicalCap.verifyProduction(id, 50);
      await expect(tx).to.emit(physicalCap, "PhysicsCheckFailed");
    });

    it("cloudy day in Tallinn — can't claim full capacity", async function () {
      // 100kW solar, Tallinn: max = 66 kWh/day
      // Trying to claim 100 kWh (as if it ran 100% for hours) → fail
      const id = await registerFacility(0, 100, TALLINN_GEOHASH, TALLINN_BAND);
      const max = await physicalCap.maxDailyOutput(id);
      expect(max).to.equal(66);

      const tx = await physicalCap.verifyProduction(id, 100);
      await expect(tx).to.emit(physicalCap, "PhysicsCheckFailed");
    });

    it("returns false for overclaim, true for valid", async function () {
      const id = await registerFacility(1, 100, TALLINN_GEOHASH, TALLINN_BAND);
      // Wind 100kW Tallinn: max = 99

      // Valid claim
      const result1 = await physicalCap.verifyProduction.staticCall(id, 90);
      expect(result1).to.be.true;

      // Overclaim
      const result2 = await physicalCap.verifyProduction.staticCall(id, 150);
      expect(result2).to.be.false;
    });
  });

  // ─── Edge Cases ──────���──────────────────────────────────────

  describe("Edge Cases", function () {
    it("reverts for non-existent facility", async function () {
      await expect(physicalCap.maxDailyOutput(999)).to.be.revertedWith("Facility not found");
    });

    it("zero claimed kWh always passes", async function () {
      const id = await registerFacility(0, 50, TALLINN_GEOHASH, TALLINN_BAND);
      const result = await physicalCap.verifyProduction.staticCall(id, 0);
      expect(result).to.be.true;
    });
  });
});
