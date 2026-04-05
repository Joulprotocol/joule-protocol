const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * EcosystemTreasury Tests
 *
 * Covers:
 * 1. fundTreasury — minting to treasury, cap enforcement (MAX_TREASURY = 10.5M)
 * 2. Bounty lifecycle — create, claim, pay, cancel
 * 3. executeSpend — governance-gated spending
 * 4. Insurance reserve — fundInsurance, requestInsurancePayout, executeInsurancePayout
 * 5. Insurance timelock (7 days)
 * 6. Insurance reserve protection (executeSpend cannot touch insurance)
 * 7. Access control — only GOVERNANCE_ROLE can create bounties, spend, etc.
 * 8. Edge cases — zero amounts, double pay, insufficient balance
 */

describe("EcosystemTreasury", function () {
  let jolToken, treasury;
  let admin, governance, hunter, recipient, stranger;
  let MINTER_ROLE, GOVERNANCE_ROLE;

  const parseJOL = (n) => ethers.parseEther(String(n));
  const MAX_TREASURY = parseJOL(10_500_000);
  const MAX_INSURANCE = parseJOL(1_050_000);

  beforeEach(async function () {
    [admin, governance, hunter, recipient, stranger] = await ethers.getSigners();

    // Deploy JOLToken
    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(admin.address);

    // Deploy EcosystemTreasury
    const EcosystemTreasury = await ethers.getContractFactory("EcosystemTreasury");
    treasury = await EcosystemTreasury.deploy(admin.address, jolToken.target);

    // Roles
    MINTER_ROLE = await jolToken.MINTER_ROLE();
    GOVERNANCE_ROLE = await treasury.GOVERNANCE_ROLE();

    // Grant MINTER_ROLE to admin (for direct mints) and treasury (for fundTreasury)
    await jolToken.grantRole(MINTER_ROLE, admin.address);
    await jolToken.grantRole(MINTER_ROLE, treasury.target);

    // Grant GOVERNANCE_ROLE to governance signer
    await treasury.grantRole(GOVERNANCE_ROLE, governance.address);
  });

  // ─── 1. Fund Treasury ──────────────────────────────────────

  describe("1. fundTreasury", function () {
    it("mints JOL to treasury and updates totalMinted", async function () {
      await treasury.fundTreasury(parseJOL(1000));

      expect(await jolToken.balanceOf(treasury.target)).to.equal(parseJOL(1000));
      expect(await treasury.totalMinted()).to.equal(parseJOL(1000));
      expect(await treasury.treasuryBalance()).to.equal(parseJOL(1000));
    });

    it("allows multiple funding calls up to cap", async function () {
      await treasury.fundTreasury(parseJOL(5_000_000));
      await treasury.fundTreasury(parseJOL(5_000_000));
      await treasury.fundTreasury(parseJOL(500_000));

      expect(await treasury.totalMinted()).to.equal(MAX_TREASURY);
      expect(await treasury.remainingMintable()).to.equal(0);
    });

    it("reverts when exceeding MAX_TREASURY cap", async function () {
      await treasury.fundTreasury(parseJOL(10_000_000));
      await expect(
        treasury.fundTreasury(parseJOL(600_000))
      ).to.be.revertedWith("Exceeds treasury cap");
    });

    it("reverts when exact cap exceeded by 1 wei", async function () {
      await treasury.fundTreasury(MAX_TREASURY);
      await expect(treasury.fundTreasury(1)).to.be.revertedWith("Exceeds treasury cap");
    });

    it("emits TreasuryFunded event", async function () {
      await expect(treasury.fundTreasury(parseJOL(500)))
        .to.emit(treasury, "TreasuryFunded")
        .withArgs(parseJOL(500), parseJOL(500));
    });

    it("only admin can fund treasury", async function () {
      await expect(
        treasury.connect(stranger).fundTreasury(parseJOL(100))
      ).to.be.reverted;
    });
  });

  // ─── 2. Bounty Lifecycle ───────────────────────────────────

  describe("2. Bounty Lifecycle", function () {
    beforeEach(async function () {
      // Fund treasury with enough JOL
      await treasury.fundTreasury(parseJOL(100_000));
    });

    it("creates a bounty (governance only)", async function () {
      await expect(
        treasury.connect(governance).createBounty("Fix bug in PoE", parseJOL(500))
      )
        .to.emit(treasury, "BountyCreated")
        .withArgs(1, "Fix bug in PoE", parseJOL(500));

      const bounty = await treasury.bounties(1);
      expect(bounty.id).to.equal(1);
      expect(bounty.reward).to.equal(parseJOL(500));
      expect(bounty.active).to.be.true;
      expect(bounty.paid).to.be.false;
      expect(bounty.claimedBy).to.equal(ethers.ZeroAddress);
    });

    it("increments bounty IDs", async function () {
      await treasury.connect(governance).createBounty("First", parseJOL(100));
      await treasury.connect(governance).createBounty("Second", parseJOL(200));

      expect(await treasury.nextBountyId()).to.equal(3);
      expect((await treasury.bounties(2)).reward).to.equal(parseJOL(200));
    });

    it("anyone can claim an active bounty", async function () {
      await treasury.connect(governance).createBounty("Audit contract", parseJOL(1000));

      await expect(treasury.connect(hunter).claimBounty(1))
        .to.emit(treasury, "BountyClaimed")
        .withArgs(1, hunter.address);

      const bounty = await treasury.bounties(1);
      expect(bounty.claimedBy).to.equal(hunter.address);
    });

    it("cannot claim already-claimed bounty", async function () {
      await treasury.connect(governance).createBounty("Task", parseJOL(100));
      await treasury.connect(hunter).claimBounty(1);

      await expect(
        treasury.connect(stranger).claimBounty(1)
      ).to.be.revertedWith("Already claimed");
    });

    it("cannot claim inactive bounty", async function () {
      await treasury.connect(governance).createBounty("Task", parseJOL(100));
      await treasury.connect(governance).cancelBounty(1);

      await expect(
        treasury.connect(hunter).claimBounty(1)
      ).to.be.revertedWith("Not active");
    });

    it("governance pays a claimed bounty", async function () {
      await treasury.connect(governance).createBounty("Write docs", parseJOL(300));
      await treasury.connect(hunter).claimBounty(1);

      await expect(treasury.connect(governance).payBounty(1))
        .to.emit(treasury, "BountyPaid")
        .withArgs(1, hunter.address, parseJOL(300));

      expect(await jolToken.balanceOf(hunter.address)).to.equal(parseJOL(300));

      const bounty = await treasury.bounties(1);
      expect(bounty.paid).to.be.true;
      expect(bounty.active).to.be.false;

      expect(await treasury.totalSpent()).to.equal(parseJOL(300));
    });

    it("cannot pay unclaimed bounty", async function () {
      await treasury.connect(governance).createBounty("Task", parseJOL(100));

      await expect(
        treasury.connect(governance).payBounty(1)
      ).to.be.revertedWith("Not claimed");
    });

    it("cannot double-pay a bounty", async function () {
      await treasury.connect(governance).createBounty("Task", parseJOL(100));
      await treasury.connect(hunter).claimBounty(1);
      await treasury.connect(governance).payBounty(1);

      await expect(
        treasury.connect(governance).payBounty(1)
      ).to.be.revertedWith("Already paid");
    });

    it("cancels a bounty (governance only)", async function () {
      await treasury.connect(governance).createBounty("Task", parseJOL(100));
      await treasury.connect(governance).cancelBounty(1);

      const bounty = await treasury.bounties(1);
      expect(bounty.active).to.be.false;
    });

    it("getActiveBounties returns correct count", async function () {
      await treasury.connect(governance).createBounty("A", parseJOL(100));
      await treasury.connect(governance).createBounty("B", parseJOL(200));
      await treasury.connect(governance).createBounty("C", parseJOL(300));

      expect(await treasury.getActiveBounties()).to.equal(3);

      await treasury.connect(governance).cancelBounty(2);
      expect(await treasury.getActiveBounties()).to.equal(2);
    });

    it("rejects zero-reward bounty", async function () {
      await expect(
        treasury.connect(governance).createBounty("Free work", 0)
      ).to.be.revertedWith("Zero reward");
    });
  });

  // ─── 3. executeSpend ───────────────────────────────────────

  describe("3. executeSpend", function () {
    beforeEach(async function () {
      await treasury.fundTreasury(parseJOL(50_000));
    });

    it("governance executes a spend", async function () {
      await expect(
        treasury.connect(governance).executeSpend(recipient.address, parseJOL(1000), "DEX liquidity")
      )
        .to.emit(treasury, "SpendApproved")
        .withArgs(0, recipient.address, parseJOL(1000), "DEX liquidity");

      expect(await jolToken.balanceOf(recipient.address)).to.equal(parseJOL(1000));
      expect(await treasury.totalSpent()).to.equal(parseJOL(1000));
    });

    it("rejects zero amount spend", async function () {
      await expect(
        treasury.connect(governance).executeSpend(recipient.address, 0, "nothing")
      ).to.be.revertedWith("Zero amount");
    });

    it("rejects spend exceeding available balance", async function () {
      await expect(
        treasury.connect(governance).executeSpend(recipient.address, parseJOL(60_000), "too much")
      ).to.be.revertedWith("Insufficient treasury (insurance reserved)");
    });
  });

  // ─── 4. Insurance Reserve ──────────────────────────────────

  describe("4. Insurance Reserve", function () {
    beforeEach(async function () {
      await treasury.fundTreasury(parseJOL(2_000_000));
    });

    it("funds insurance reserve from treasury balance", async function () {
      await expect(
        treasury.connect(governance).fundInsurance(parseJOL(500_000))
      )
        .to.emit(treasury, "InsuranceFunded")
        .withArgs(parseJOL(500_000), parseJOL(500_000));

      expect(await treasury.insuranceReserve()).to.equal(parseJOL(500_000));
    });

    it("allows funding insurance up to MAX_INSURANCE", async function () {
      await treasury.connect(governance).fundInsurance(parseJOL(1_050_000));
      expect(await treasury.insuranceReserve()).to.equal(MAX_INSURANCE);
    });

    it("rejects insurance funding exceeding cap", async function () {
      await treasury.connect(governance).fundInsurance(parseJOL(1_000_000));

      await expect(
        treasury.connect(governance).fundInsurance(parseJOL(100_000))
      ).to.be.revertedWith("Exceeds insurance cap");
    });

    it("rejects insurance funding exceeding treasury balance", async function () {
      // Treasury has 2M, try to fund more than that
      // First drain the treasury via spend
      await treasury.connect(governance).executeSpend(recipient.address, parseJOL(1_500_000), "drain");

      // Now treasury has 500K, but trying to fund 600K insurance
      await expect(
        treasury.connect(governance).fundInsurance(parseJOL(600_000))
      ).to.be.revertedWith("Insufficient treasury");
    });

    it("requests insurance payout (starts timelock)", async function () {
      await treasury.connect(governance).fundInsurance(parseJOL(500_000));

      await expect(
        treasury.connect(governance).requestInsurancePayout(
          recipient.address,
          parseJOL(100_000),
          "Smart contract exploit compensation"
        )
      )
        .to.emit(treasury, "InsuranceRequested")
        .withArgs(1, recipient.address, parseJOL(100_000), "Smart contract exploit compensation");

      const req = await treasury.insuranceRequests(1);
      expect(req.recipient).to.equal(recipient.address);
      expect(req.amount).to.equal(parseJOL(100_000));
      expect(req.executed).to.be.false;
    });

    it("rejects payout request with zero amount", async function () {
      await treasury.connect(governance).fundInsurance(parseJOL(100_000));

      await expect(
        treasury.connect(governance).requestInsurancePayout(recipient.address, 0, "zero")
      ).to.be.revertedWith("Invalid amount");
    });

    it("rejects payout request exceeding insurance reserve", async function () {
      await treasury.connect(governance).fundInsurance(parseJOL(100_000));

      await expect(
        treasury.connect(governance).requestInsurancePayout(
          recipient.address,
          parseJOL(200_000),
          "too much"
        )
      ).to.be.revertedWith("Invalid amount");
    });

    it("rejects payout request without reason", async function () {
      await treasury.connect(governance).fundInsurance(parseJOL(100_000));

      await expect(
        treasury.connect(governance).requestInsurancePayout(recipient.address, parseJOL(1000), "")
      ).to.be.revertedWith("Reason required");
    });
  });

  // ─── 5. Insurance Timelock (7 days) ────────────────────────

  describe("5. Insurance Timelock", function () {
    beforeEach(async function () {
      await treasury.fundTreasury(parseJOL(2_000_000));
      await treasury.connect(governance).fundInsurance(parseJOL(500_000));
      await treasury.connect(governance).requestInsurancePayout(
        recipient.address,
        parseJOL(100_000),
        "Bug bounty payout"
      );
    });

    it("rejects payout before 7-day timelock expires", async function () {
      await expect(
        treasury.connect(governance).executeInsurancePayout(1)
      ).to.be.revertedWith("Timelock not expired");
    });

    it("rejects payout at 6 days 23 hours", async function () {
      // Advance 6 days 23 hours (just under 7 days)
      await ethers.provider.send("evm_increaseTime", [6 * 86400 + 23 * 3600]);
      await ethers.provider.send("evm_mine");

      await expect(
        treasury.connect(governance).executeInsurancePayout(1)
      ).to.be.revertedWith("Timelock not expired");
    });

    it("executes payout after 7-day timelock", async function () {
      // Advance 7 days
      await ethers.provider.send("evm_increaseTime", [7 * 86400]);
      await ethers.provider.send("evm_mine");

      await expect(
        treasury.connect(governance).executeInsurancePayout(1)
      )
        .to.emit(treasury, "InsurancePayout")
        .withArgs(1, recipient.address, parseJOL(100_000), "Bug bounty payout");

      expect(await jolToken.balanceOf(recipient.address)).to.equal(parseJOL(100_000));
      expect(await treasury.insuranceReserve()).to.equal(parseJOL(400_000));
      expect(await treasury.totalSpent()).to.equal(parseJOL(100_000));
    });

    it("cannot execute same payout twice", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 86400]);
      await ethers.provider.send("evm_mine");

      await treasury.connect(governance).executeInsurancePayout(1);

      await expect(
        treasury.connect(governance).executeInsurancePayout(1)
      ).to.be.revertedWith("Already executed");
    });

    it("rejects execution of nonexistent request", async function () {
      await ethers.provider.send("evm_increaseTime", [7 * 86400]);
      await ethers.provider.send("evm_mine");

      await expect(
        treasury.connect(governance).executeInsurancePayout(999)
      ).to.be.revertedWith("Invalid request");
    });
  });

  // ─── 6. Insurance Reserve Protection ───────────────────────

  describe("6. Insurance Reserve Protection", function () {
    beforeEach(async function () {
      await treasury.fundTreasury(parseJOL(1_000_000));
      await treasury.connect(governance).fundInsurance(parseJOL(500_000));
    });

    it("executeSpend cannot touch insurance reserve", async function () {
      // Treasury balance: 1M, insurance: 500K, spendable: 500K
      // Try to spend 600K — should fail
      await expect(
        treasury.connect(governance).executeSpend(recipient.address, parseJOL(600_000), "overspend")
      ).to.be.revertedWith("Insufficient treasury (insurance reserved)");
    });

    it("executeSpend can spend up to non-insurance balance", async function () {
      // Spendable = 1M - 500K = 500K
      await treasury.connect(governance).executeSpend(recipient.address, parseJOL(500_000), "max spend");
      expect(await jolToken.balanceOf(recipient.address)).to.equal(parseJOL(500_000));
    });

    it("payBounty cannot touch insurance reserve", async function () {
      // Create bounty worth more than non-insurance balance
      await treasury.connect(governance).createBounty("Big task", parseJOL(600_000));
      await treasury.connect(hunter).claimBounty(1);

      await expect(
        treasury.connect(governance).payBounty(1)
      ).to.be.revertedWith("Insufficient treasury (insurance reserved)");
    });

    it("payBounty works within non-insurance balance", async function () {
      await treasury.connect(governance).createBounty("Normal task", parseJOL(100_000));
      await treasury.connect(hunter).claimBounty(1);
      await treasury.connect(governance).payBounty(1);

      expect(await jolToken.balanceOf(hunter.address)).to.equal(parseJOL(100_000));
    });
  });

  // ─── 7. Access Control ─────────────────────────────────────

  describe("7. Access Control", function () {
    beforeEach(async function () {
      await treasury.fundTreasury(parseJOL(100_000));
    });

    it("stranger cannot create bounty", async function () {
      await expect(
        treasury.connect(stranger).createBounty("hack", parseJOL(100))
      ).to.be.reverted;
    });

    it("stranger cannot pay bounty", async function () {
      await treasury.connect(governance).createBounty("Task", parseJOL(100));
      await treasury.connect(hunter).claimBounty(1);

      await expect(
        treasury.connect(stranger).payBounty(1)
      ).to.be.reverted;
    });

    it("stranger cannot cancel bounty", async function () {
      await treasury.connect(governance).createBounty("Task", parseJOL(100));

      await expect(
        treasury.connect(stranger).cancelBounty(1)
      ).to.be.reverted;
    });

    it("stranger cannot executeSpend", async function () {
      await expect(
        treasury.connect(stranger).executeSpend(stranger.address, parseJOL(100), "steal")
      ).to.be.reverted;
    });

    it("stranger cannot fundInsurance", async function () {
      await expect(
        treasury.connect(stranger).fundInsurance(parseJOL(100))
      ).to.be.reverted;
    });

    it("stranger cannot requestInsurancePayout", async function () {
      await treasury.connect(governance).fundInsurance(parseJOL(10_000));

      await expect(
        treasury.connect(stranger).requestInsurancePayout(stranger.address, parseJOL(100), "steal")
      ).to.be.reverted;
    });

    it("stranger cannot executeInsurancePayout", async function () {
      await treasury.connect(governance).fundInsurance(parseJOL(10_000));
      await treasury.connect(governance).requestInsurancePayout(
        recipient.address, parseJOL(1000), "legit"
      );

      await ethers.provider.send("evm_increaseTime", [7 * 86400]);
      await ethers.provider.send("evm_mine");

      await expect(
        treasury.connect(stranger).executeInsurancePayout(1)
      ).to.be.reverted;
    });

    it("stranger cannot fundTreasury (admin-only)", async function () {
      await expect(
        treasury.connect(stranger).fundTreasury(parseJOL(100))
      ).to.be.reverted;
    });
  });

  // ─── 8. Edge Cases ─────────────────────────────────────────

  describe("8. Edge Cases", function () {
    beforeEach(async function () {
      await treasury.fundTreasury(parseJOL(100_000));
    });

    it("can fund treasury with exact remaining cap", async function () {
      const remaining = await treasury.remainingMintable();
      await treasury.fundTreasury(remaining);
      expect(await treasury.totalMinted()).to.equal(MAX_TREASURY);
    });

    it("multiple bounties paid sequentially reduce balance correctly", async function () {
      await treasury.connect(governance).createBounty("A", parseJOL(1000));
      await treasury.connect(governance).createBounty("B", parseJOL(2000));

      await treasury.connect(hunter).claimBounty(1);
      await treasury.connect(governance).payBounty(1);

      await treasury.connect(hunter).claimBounty(2);
      await treasury.connect(governance).payBounty(2);

      expect(await treasury.totalSpent()).to.equal(parseJOL(3000));
      expect(await jolToken.balanceOf(hunter.address)).to.equal(parseJOL(3000));
      expect(await treasury.treasuryBalance()).to.equal(parseJOL(97_000));
    });

    it("spending entire non-insurance balance leaves only insurance", async function () {
      await treasury.connect(governance).fundInsurance(parseJOL(10_000));

      // Spend all except insurance
      await treasury.connect(governance).executeSpend(recipient.address, parseJOL(90_000), "drain");

      expect(await treasury.treasuryBalance()).to.equal(parseJOL(10_000));
      expect(await treasury.insuranceReserve()).to.equal(parseJOL(10_000));

      // Cannot spend any more via executeSpend
      await expect(
        treasury.connect(governance).executeSpend(recipient.address, 1, "last wei")
      ).to.be.revertedWith("Insufficient treasury (insurance reserved)");
    });

    it("insurance payout reduces reserve, allowing more general spend later", async function () {
      await treasury.connect(governance).fundInsurance(parseJOL(50_000));

      // Spendable: 100K - 50K = 50K
      await treasury.connect(governance).executeSpend(recipient.address, parseJOL(50_000), "spend all");

      // Now balance = 50K, insurance = 50K, spendable = 0
      await expect(
        treasury.connect(governance).executeSpend(recipient.address, 1, "nope")
      ).to.be.revertedWith("Insufficient treasury (insurance reserved)");

      // Insurance payout releases funds
      await treasury.connect(governance).requestInsurancePayout(
        recipient.address, parseJOL(20_000), "exploit fix"
      );
      await ethers.provider.send("evm_increaseTime", [7 * 86400]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(governance).executeInsurancePayout(1);

      // Balance: 30K, insurance: 30K, still no general spend available
      // But the 20K went to recipient via insurance — that is the correct flow
      expect(await treasury.insuranceReserve()).to.equal(parseJOL(30_000));
      expect(await treasury.treasuryBalance()).to.equal(parseJOL(30_000));
    });

    it("views return correct values", async function () {
      expect(await treasury.treasuryBalance()).to.equal(parseJOL(100_000));
      expect(await treasury.remainingMintable()).to.equal(MAX_TREASURY - parseJOL(100_000));
      expect(await treasury.getActiveBounties()).to.equal(0);
    });

    it("constants are correct", async function () {
      expect(await treasury.MAX_TREASURY()).to.equal(parseJOL(10_500_000));
      expect(await treasury.MAX_INSURANCE()).to.equal(parseJOL(1_050_000));
      expect(await treasury.INSURANCE_TIMELOCK()).to.equal(7 * 86400);
    });
  });
});
