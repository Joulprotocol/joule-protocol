const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EnergyRegistry", function () {
  let registry, owner, verifier, producer1, producer2;

  beforeEach(async function () {
    [owner, verifier, producer1, producer2] = await ethers.getSigners();
    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(owner.address);
    await registry.waitForDeployment();

    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();
    await registry.grantRole(VERIFIER_ROLE, verifier.address);
  });

  describe("Registration", function () {
    it("should register a solar facility", async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("METER-001"));
      const tx = await registry.connect(producer1).registerFacility(
        0, // Solar
        50, // 50 kW
        meterId,
        "0x75636674", // geohash "ucft" (Tallinn)
        2, // subarctic (Tallinn ~59°N)
        "EE"
      );

      const facility = await registry.facilities(1);
      expect(facility.owner).to.equal(producer1.address);
      expect(facility.capacityKW).to.equal(50);
      expect(facility.status).to.equal(0); // Pending
    });

    it("should prevent duplicate meter IDs", async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("METER-001"));
      await registry.connect(producer1).registerFacility(0, 50, meterId, "0x75636674", 2, "EE");

      await expect(
        registry.connect(producer2).registerFacility(0, 30, meterId, "0x75636674", 2, "EE")
      ).to.be.revertedWith("Meter ID already registered");
    });

    it("should reject zero capacity", async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("METER-002"));
      await expect(
        registry.connect(producer1).registerFacility(0, 0, meterId, "0x75636674", 2, "EE")
      ).to.be.revertedWith("Capacity must be > 0");
    });
  });

  describe("Verification", function () {
    let meterId;

    beforeEach(async function () {
      meterId = ethers.keccak256(ethers.toUtf8Bytes("METER-001"));
      await registry.connect(producer1).registerFacility(0, 50, meterId, "0x75636674", 2, "EE");
    });

    it("should allow verifier to verify facility", async function () {
      await registry.connect(verifier).verifyFacility(1);
      const facility = await registry.facilities(1);
      expect(facility.status).to.equal(1); // Verified
      expect(await registry.verifiedFacilities()).to.equal(1);
    });

    it("should reject unauthorized verification", async function () {
      await expect(
        registry.connect(producer1).verifyFacility(1)
      ).to.be.reverted;
    });

    it("should track total capacity after verification", async function () {
      await registry.connect(verifier).verifyFacility(1);
      expect(await registry.totalCapacityKW()).to.equal(50);
    });
  });

  describe("Production Recording", function () {
    beforeEach(async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("METER-001"));
      await registry.connect(producer1).registerFacility(0, 50, meterId, "0x75636674", 2, "EE");
      await registry.connect(verifier).verifyFacility(1);
    });

    it("should record production within capacity", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      await registry.connect(verifier).recordProduction(1, 100, now - 7200, now);

      const facility = await registry.facilities(1);
      expect(facility.totalVerifiedKWh).to.equal(100);
    });

    it("should reject production exceeding capacity", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      // 50 kW × 2 hours = 100 kWh max, trying 200
      await expect(
        registry.connect(verifier).recordProduction(1, 200, now - 7200, now)
      ).to.be.revertedWith("Production exceeds capacity");
    });
  });

  describe("Deregistration", function () {
    beforeEach(async function () {
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("METER-001"));
      await registry.connect(producer1).registerFacility(0, 50, meterId, "0x75636674", 2, "EE");
    });

    it("should allow owner to deregister", async function () {
      await registry.connect(producer1).deregisterFacility(1);
      const facility = await registry.facilities(1);
      expect(facility.status).to.equal(3); // Deregistered
    });

    it("should reject non-owner deregistration", async function () {
      await expect(
        registry.connect(producer2).deregisterFacility(1)
      ).to.be.revertedWith("Not owner");
    });
  });
});
