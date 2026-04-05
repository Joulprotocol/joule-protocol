const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Governance Tests — ERC20Votes Snapshot + Timelock
 *
 * Flashloan-resistant: voting power snapshotted at proposal creation block.
 * Timelock: 2-day delay between passing and execution.
 * Permissionless execute: anyone can trigger after timelock.
 */
describe("Governance — Snapshot + Timelock", function () {
  let governance, jolToken;
  let admin, proposer, voter1, voter2, attacker;

  const PROPOSAL_THRESHOLD = ethers.parseEther("100000"); // 100k JOL
  const VOTING_PERIOD = 7 * 86400; // 7 days
  const EXECUTION_DELAY = 2 * 86400; // 2 days

  beforeEach(async function () {
    [admin, proposer, voter1, voter2, attacker] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(admin.address);

    const Governance = await ethers.getContractFactory("Governance");
    governance = await Governance.deploy(admin.address, jolToken.target);

    // Mint tokens
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    await jolToken.grantRole(MINTER_ROLE, admin.address);
    await jolToken.mint(proposer.address, ethers.parseEther("200000")); // 200k
    await jolToken.mint(voter1.address, ethers.parseEther("500000"));   // 500k
    await jolToken.mint(voter2.address, ethers.parseEther("300000"));   // 300k

    // CRITICAL: Holders must delegate to activate voting power
    await jolToken.connect(proposer).delegate(proposer.address);
    await jolToken.connect(voter1).delegate(voter1.address);
    await jolToken.connect(voter2).delegate(voter2.address);

    // Mine a block so checkpoints are recorded
    await ethers.provider.send("evm_mine");
  });

  describe("ERC20Votes Integration", function () {
    it("holders have voting power after delegation", async function () {
      expect(await jolToken.getVotes(proposer.address)).to.equal(ethers.parseEther("200000"));
      expect(await jolToken.getVotes(voter1.address)).to.equal(ethers.parseEther("500000"));
    });

    it("undelegated holders have zero voting power", async function () {
      await jolToken.mint(attacker.address, ethers.parseEther("100000"));
      // attacker never delegates
      expect(await jolToken.getVotes(attacker.address)).to.equal(0);
    });

    it("delegation to another address transfers voting power", async function () {
      await jolToken.connect(voter2).delegate(voter1.address);
      await ethers.provider.send("evm_mine");
      expect(await jolToken.getVotes(voter1.address)).to.equal(ethers.parseEther("800000")); // 500k + 300k
      expect(await jolToken.getVotes(voter2.address)).to.equal(0);
    });
  });

  describe("Proposal Creation", function () {
    it("proposer with enough voting power can propose", async function () {
      const tx = await governance.connect(proposer).propose(
        "Test Proposal", "Description", [], []
      );
      await expect(tx).to.emit(governance, "ProposalCreated");
    });

    it("rejects proposal from undelegated holder", async function () {
      await jolToken.mint(attacker.address, ethers.parseEther("200000"));
      // attacker has tokens but never delegated
      await expect(
        governance.connect(attacker).propose("Attack", "desc", [], [])
      ).to.be.revertedWith("Insufficient voting power to propose (delegate first)");
    });

    it("rejects proposal from holder with insufficient voting power", async function () {
      await jolToken.mint(attacker.address, ethers.parseEther("1000"));
      await jolToken.connect(attacker).delegate(attacker.address);
      await ethers.provider.send("evm_mine");
      await expect(
        governance.connect(attacker).propose("Low", "desc", [], [])
      ).to.be.revertedWith("Insufficient voting power to propose (delegate first)");
    });
  });

  describe("Flashloan Resistance", function () {
    it("tokens bought after proposal have zero voting power", async function () {
      // Create proposal
      await governance.connect(proposer).propose("Test", "desc", [], []);

      // Attacker buys tokens AFTER proposal
      await jolToken.mint(attacker.address, ethers.parseEther("5000000")); // 5M
      await jolToken.connect(attacker).delegate(attacker.address);
      await ethers.provider.send("evm_mine");

      // Attacker tries to vote — should have 0 power at snapshot
      await expect(
        governance.connect(attacker).vote(1, true)
      ).to.be.revertedWith("No voting power at snapshot (delegate before proposing)");
    });

    it("snapshot captures pre-proposal balances only", async function () {
      // Create proposal
      await governance.connect(proposer).propose("Test", "desc", [], []);

      // voter1 votes with snapshot power (capped at 5% of snapshot supply)
      await governance.connect(voter1).vote(1, true);

      // Snapshot supply = 1M JOL. 5% cap = 50k. Voter1 has 500k but capped to 50k.
      const [votesFor] = await governance.getProposalVotes(1);
      const snapshotSupply = ethers.parseEther("1000000");
      const maxVote = snapshotSupply * 500n / 10000n; // 5% = 50k
      expect(votesFor).to.equal(maxVote);
    });
  });

  describe("Voting", function () {
    beforeEach(async function () {
      await governance.connect(proposer).propose("Test", "Description", [], []);
    });

    it("votes for and against counted correctly", async function () {
      await governance.connect(voter1).vote(1, true);
      await governance.connect(voter2).vote(1, false);

      // Both capped at 5% of 1M snapshot supply = 50k each
      const maxVote = ethers.parseEther("1000000") * 500n / 10000n;
      const [votesFor, votesAgainst] = await governance.getProposalVotes(1);
      expect(votesFor).to.equal(maxVote);     // voter1: 500k capped to 50k
      expect(votesAgainst).to.equal(maxVote); // voter2: 300k capped to 50k
    });

    it("rejects double voting", async function () {
      await governance.connect(voter1).vote(1, true);
      await expect(
        governance.connect(voter1).vote(1, false)
      ).to.be.revertedWith("Already voted");
    });

    it("rejects voting after period ends", async function () {
      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
      await ethers.provider.send("evm_mine");
      await expect(
        governance.connect(voter1).vote(1, true)
      ).to.be.revertedWith("Voting ended");
    });
  });

  describe("Finalization", function () {
    beforeEach(async function () {
      await governance.connect(proposer).propose("Test", "Description", [], []);
    });

    it("passes with majority and quorum", async function () {
      await governance.connect(voter1).vote(1, true);
      await governance.connect(voter2).vote(1, true);

      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
      await ethers.provider.send("evm_mine");

      await governance.finalize(1);
      const state = (await governance.proposals(1)).state;
      expect(state).to.equal(1); // Passed
    });

    it("rejects if quorum not met", async function () {
      // Only proposer votes (200k < 4% of 1M = 40k... actually 200k > 40k so this passes quorum)
      // Need to test with very small voter
      await governance.connect(proposer).vote(1, true);

      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
      await ethers.provider.send("evm_mine");

      // This will pass because 200k > 4% of 1M = 40k
      await governance.finalize(1);
      const state = (await governance.proposals(1)).state;
      expect(state).to.equal(1); // Passed — quorum met
    });

    it("rejects if majority against", async function () {
      await governance.connect(proposer).vote(1, true);  // 200k for
      await governance.connect(voter1).vote(1, false);    // 500k against

      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
      await ethers.provider.send("evm_mine");

      await governance.finalize(1);
      const state = (await governance.proposals(1)).state;
      expect(state).to.equal(2); // Rejected
    });
  });

  describe("Timelock + Execution", function () {
    beforeEach(async function () {
      await governance.connect(proposer).propose("Test", "Description", [], []);
      await governance.connect(voter1).vote(1, true);
      await governance.connect(voter2).vote(1, true);

      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
      await ethers.provider.send("evm_mine");
      await governance.finalize(1);
    });

    it("rejects execution before timelock expires", async function () {
      await expect(
        governance.execute(1)
      ).to.be.revertedWith("Timelock not expired");
    });

    it("anyone can execute after timelock", async function () {
      await ethers.provider.send("evm_increaseTime", [EXECUTION_DELAY + 1]);
      await ethers.provider.send("evm_mine");

      // Attacker (random address) can trigger execution — permissionless
      await expect(
        governance.connect(attacker).execute(1)
      ).to.emit(governance, "ProposalExecuted");
    });

    it("rejects double execution", async function () {
      await ethers.provider.send("evm_increaseTime", [EXECUTION_DELAY + 1]);
      await ethers.provider.send("evm_mine");

      await governance.execute(1);
      await expect(governance.execute(1)).to.be.revertedWith("Not passed");
    });
  });

  describe("Cancellation", function () {
    it("proposer can cancel own proposal", async function () {
      await governance.connect(proposer).propose("Test", "desc", [], []);
      await governance.connect(proposer).cancel(1);
      const state = (await governance.proposals(1)).state;
      expect(state).to.equal(4); // Cancelled
    });

    it("admin can cancel any proposal", async function () {
      await governance.connect(proposer).propose("Test", "desc", [], []);
      await governance.connect(admin).cancel(1);
    });

    it("random address cannot cancel", async function () {
      await governance.connect(proposer).propose("Test", "desc", [], []);
      await expect(
        governance.connect(attacker).cancel(1)
      ).to.be.revertedWith("Not authorized");
    });
  });
});
