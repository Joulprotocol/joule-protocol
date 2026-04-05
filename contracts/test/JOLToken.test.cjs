const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("JOLToken", function () {
  let jolToken, owner, minter, user1, user2;

  beforeEach(async function () {
    [owner, minter, user1, user2] = await ethers.getSigners();
    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);
    await jolToken.waitForDeployment();

    // Grant minter role
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER_ROLE, minter.address);
  });

  describe("Deployment", function () {
    it("should have correct name and symbol", async function () {
      expect(await jolToken.name()).to.equal("JOULE");
      expect(await jolToken.symbol()).to.equal("JOL");
    });

    it("should have max supply of 210B", async function () {
      expect(await jolToken.MAX_SUPPLY()).to.equal(ethers.parseEther("210000000"));
    });

    it("should start with zero supply", async function () {
      expect(await jolToken.totalSupply()).to.equal(0);
    });
  });

  describe("Minting", function () {
    it("should allow minter to mint tokens", async function () {
      await jolToken.connect(minter).mint(user1.address, ethers.parseEther("1000"));
      expect(await jolToken.balanceOf(user1.address)).to.equal(ethers.parseEther("1000"));
    });

    it("should reject minting beyond max supply", async function () {
      const maxSupply = await jolToken.MAX_SUPPLY();
      await expect(
        jolToken.connect(minter).mint(user1.address, maxSupply + 1n)
      ).to.be.revertedWith("JOL: exceeds max supply");
    });

    it("should reject unauthorized minting", async function () {
      await expect(
        jolToken.connect(user1).mint(user1.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      await jolToken.connect(minter).mint(user1.address, ethers.parseEther("10000"));
    });

    it("should allow users to burn own tokens", async function () {
      await jolToken.connect(user1).burn(ethers.parseEther("5000"));
      expect(await jolToken.balanceOf(user1.address)).to.equal(ethers.parseEther("5000"));
      expect(await jolToken.totalBurned()).to.equal(ethers.parseEther("5000"));
    });

    it("should track remaining supply correctly", async function () {
      await jolToken.connect(minter).mint(user2.address, ethers.parseEther("5000"));
      const remaining = await jolToken.remainingSupply();
      expect(remaining).to.equal(ethers.parseEther("210000000") - ethers.parseEther("15000"));
    });
  });

  describe("Protocol Burns", function () {
    beforeEach(async function () {
      await jolToken.connect(minter).mint(user1.address, ethers.parseEther("10000"));
      const BURNER_ROLE = await jolToken.BURNER_ROLE();
      await jolToken.grantRole(BURNER_ROLE, owner.address);
    });

    it("should track fee burns", async function () {
      await jolToken.connect(user1).approve(owner.address, ethers.parseEther("100"));
      // Transfer tokens to owner first for protocol burn
      await jolToken.connect(user1).transfer(owner.address, ethers.parseEther("100"));
      await jolToken.protocolBurn(owner.address, ethers.parseEther("100"), "fee");
      expect(await jolToken.burnFromFees()).to.equal(ethers.parseEther("100"));
    });
  });
});
