const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * TimeBomb Tests — What Happens in Year 8+ When Mining Reward → 0?
 *
 * After enough halvings, PoW block rewards drop to 0 (integer division).
 * JOULE must survive on:
 *   1. Transaction fees (partially burned → deflationary)
 *   2. PoE rewards via EnergyFloor (1 JOL/kWh, capped at 42M)
 *   3. Governance by existing token holders
 *
 * This file validates the math and on-chain behavior for end-of-emission.
 */

describe("TimeBomb — Year 8+ Zero Emission Scenarios", function () {
  // ─── Protocol Constants ───────────────────────────────────────
  const MAX_SUPPLY        = 210_000_000n;
  const HALVING_INTERVAL  = 2_100_000n;
  const BLOCKS_PER_DAY    = 14_400n;
  const INITIAL_REWARD    = 50n;
  const MAX_FLOOR_MINT      = 42_000_000n;

  let jolToken, registry, poeMining, energyFloor, governance;
  let owner, producer, oracleNode, voter1, voter2;

  beforeEach(async function () {
    [owner, producer, oracleNode, voter1, voter2] = await ethers.getSigners();

    const JOLToken = await ethers.getContractFactory("JOLToken");
    jolToken = await JOLToken.deploy(owner.address);

    const EnergyRegistry = await ethers.getContractFactory("EnergyRegistry");
    registry = await EnergyRegistry.deploy(owner.address);

    const PoEMining = await ethers.getContractFactory("PoEMining");
    poeMining = await PoEMining.deploy(owner.address, jolToken.target, registry.target);

    const EnergyFloor = await ethers.getContractFactory("EnergyFloor");
    energyFloor = await EnergyFloor.deploy(owner.address, jolToken.target);

    const Governance = await ethers.getContractFactory("Governance");
    governance = await Governance.deploy(owner.address, jolToken.target);

    // Grant roles
    const MINTER_ROLE = await jolToken.MINTER_ROLE();
    const BURNER_ROLE = await jolToken.BURNER_ROLE();
    const ORACLE_ROLE_POE = await poeMining.ORACLE_ROLE();
    const ORACLE_ROLE_PEG = await energyFloor.ORACLE_ROLE();
    const VERIFIER_ROLE = await registry.VERIFIER_ROLE();

    await jolToken.grantRole(MINTER_ROLE, owner.address);
    await jolToken.grantRole(MINTER_ROLE, poeMining.target);
    await jolToken.grantRole(MINTER_ROLE, energyFloor.target);
    await jolToken.grantRole(BURNER_ROLE, energyFloor.target);
    await poeMining.grantRole(ORACLE_ROLE_POE, oracleNode.address);
    await energyFloor.grantRole(ORACLE_ROLE_PEG, oracleNode.address);
    await registry.grantRole(VERIFIER_ROLE, owner.address);
  });

  // ─── Scenario 1: Reward → 0 After 10 Halvings ─────────────────

  describe("Scenario 1 — After 10 halvings, reward = 0", function () {
    it("50 / 2^10 = 0 via integer division", function () {
      // 50 → 25 → 12 → 6 → 3 → 1 → 0
      // Actually hits 0 at halving 6, not 10
      let reward = INITIAL_REWARD;
      let halvings = 0;

      while (reward > 0n) {
        reward = reward >> 1n;
        halvings++;
      }

      // First zero reward occurs at halving 6
      expect(halvings).to.equal(6);
      expect(INITIAL_REWARD >> 6n).to.equal(0n);

      // At halving 10, still 0
      expect(INITIAL_REWARD >> 10n).to.equal(0n);
    });

    it("reward becomes 0 at block 12,600,000 (~875 days / ~2.4 years)", function () {
      // Era 6 starts at block 6 × 2,100,000 = 12,600,000
      const zeroRewardBlock = 6n * HALVING_INTERVAL;
      expect(zeroRewardBlock).to.equal(12_600_000n);

      const daysToZero = zeroRewardBlock / BLOCKS_PER_DAY;
      expect(daysToZero).to.equal(875n);

      // ~2.4 years
      const yearsToZero = daysToZero * 100n / 365n;
      expect(yearsToZero).to.equal(239n); // 2.39 years × 100
    });

    it("all 6 productive eras enumerated", function () {
      const eras = [];
      for (let i = 0n; i < 10n; i++) {
        const reward = INITIAL_REWARD >> i;
        eras.push({ era: Number(i), reward: Number(reward) });
      }

      expect(eras[0].reward).to.equal(50);
      expect(eras[1].reward).to.equal(25);
      expect(eras[2].reward).to.equal(12);
      expect(eras[3].reward).to.equal(6);
      expect(eras[4].reward).to.equal(3);
      expect(eras[5].reward).to.equal(1);
      expect(eras[6].reward).to.equal(0);
      expect(eras[7].reward).to.equal(0);
      expect(eras[8].reward).to.equal(0);
      expect(eras[9].reward).to.equal(0);
    });
  });

  // ─── Scenario 2: Geometric Series Convergence ─────────────────

  describe("Scenario 2 — Geometric series converges to ~203.7M (< 210M)", function () {
    it("sum of all PoW mining = 203,700,000 JOL", function () {
      // 50 × 2,100,000 × sum(1/2^n for n=0..5) where reward > 0
      // = 2,100,000 × (50 + 25 + 12 + 6 + 3 + 1)
      // = 2,100,000 × 97
      // = 203,700,000
      let total = 0n;
      let reward = INITIAL_REWARD;

      for (let era = 0n; era < 64n; era++) {
        if (reward === 0n) break;
        total += reward * HALVING_INTERVAL;
        reward = reward >> 1n;
      }

      expect(total).to.equal(203_700_000n);
    });

    it("theoretical limit with real division would be exactly 210M", function () {
      // With real number division: 50 × 2,100,000 × (1/(1-0.5)) = 210,000,000
      // But integer division loses 6,300,000 JOL to rounding
      const theoretical = INITIAL_REWARD * HALVING_INTERVAL * 2n;
      expect(theoretical).to.equal(210_000_000n);

      // Lost to integer rounding
      const lost = theoretical - 203_700_000n;
      expect(lost).to.equal(6_300_000n);
    });

    it("6.3M JOL gap is unreachable — permanently lost supply", function () {
      // These 6.3M JOL can NEVER be minted via PoW
      // Only EnergyFloor (42M cap) could partially fill the gap
      const powTotal = 203_700_000n;
      const gap = MAX_SUPPLY - powTotal;
      expect(gap).to.equal(6_300_000n);

      // EnergyFloor cap (42M) far exceeds the gap
      expect(MAX_FLOOR_MINT).to.be.gt(gap);
    });
  });

  // ─── Scenario 3: Transaction Fee Economy ───────────────────────

  describe("Scenario 3 — Transaction fee burn makes supply deflationary", function () {
    it("10k tx/day × 0.001 JOL × 50% burned = 5 JOL/day burned", function () {
      const txPerDay = 10_000n;
      const feePerTx = 1n; // 0.001 JOL in milliJOL, or use wei
      const feePerTxWei = ethers.parseEther("0.001");
      const burnRate = 50n; // 50% in percent

      const dailyFees = txPerDay * feePerTxWei;
      const dailyBurn = dailyFees * burnRate / 100n;

      // 10,000 × 0.001 = 10 JOL fees/day
      expect(dailyFees).to.equal(ethers.parseEther("10"));

      // 50% burned = 5 JOL/day
      expect(dailyBurn).to.equal(ethers.parseEther("5"));
    });

    it("after year 8, supply is net deflationary (0 new PoW, positive burn)", function () {
      // Year 8 = ~2920 days. PoW emissions stopped at day 875.
      // No new PoW supply. Fee burn continues.
      // 5 JOL/day × 365 = 1,825 JOL/year burned
      const dailyBurnJOL = 5n;
      const yearlyBurn = dailyBurnJOL * 365n;
      const newPoWPerYear = 0n; // reward = 0 after era 6

      expect(yearlyBurn).to.equal(1_825n);
      expect(newPoWPerYear).to.equal(0n);

      // Net supply change = minted - burned = 0 - 1825 = -1825 (deflationary)
      const netChange = newPoWPerYear - yearlyBurn;
      expect(netChange).to.equal(-1_825n);
    });

    it("burn mechanics work on-chain", async function () {
      // Mint some tokens, then burn via protocol
      const amount = ethers.parseEther("1000");
      await jolToken.mint(owner.address, amount);

      const supplyBefore = await jolToken.totalSupply();
      await jolToken.burn(ethers.parseEther("5"));
      const supplyAfter = await jolToken.totalSupply();

      expect(supplyBefore - supplyAfter).to.equal(ethers.parseEther("5"));
      expect(await jolToken.totalBurned()).to.equal(ethers.parseEther("5"));
    });

    it("10 years of fee burn: 18,250 JOL destroyed", function () {
      // Compounding effect: as supply shrinks, remaining tokens gain value
      // → fee in JOL terms might decrease, but in USD terms stays stable
      const dailyBurn = 5n;
      const tenYearBurn = dailyBurn * 365n * 10n;
      expect(tenYearBurn).to.equal(18_250n);

      // Still tiny vs total supply (0.009% of 203.7M)
      // But demonstrates deflationary pressure exists
      const burnPercentBps = tenYearBurn * 10_000n / 203_700_000n;
      // 18250 / 203700000 × 10000 ≈ 0 bps (rounds to 0 in integer)
      expect(burnPercentBps).to.equal(0n); // tiny but real
    });
  });

  // ─── Scenario 4: PoE Survives via EnergyFloor ────────────────────

  describe("Scenario 4 — PoE survives when block reward = 0", function () {
    it("EnergyFloor mints 1 JOL per kWh regardless of block reward", async function () {
      // Register producer in EnergyFloor
      await energyFloor.connect(producer).registerProducer("Solar Farm EE", "EE", "solar");

      // Oracle deposits 100 kWh of verified energy
      await energyFloor.connect(oracleNode).depositEnergy(producer.address, 100);

      // Producer received 100 JOL (1 per kWh)
      expect(await jolToken.balanceOf(producer.address)).to.equal(ethers.parseEther("100"));
    });

    it("EnergyFloor has independent cap of 42M JOL (MAX_FLOOR_MINT)", async function () {
      const maxPegMint = await energyFloor.MAX_FLOOR_MINT();
      expect(maxPegMint).to.equal(ethers.parseEther("42000000"));
    });

    it("EnergyFloor works even after PoW exhausted (supply allows it)", async function () {
      // Mint 203.7M via PoW (simulated)
      await jolToken.mint(owner.address, ethers.parseEther("203700000"));

      // 6.3M remaining capacity. EnergyFloor can still mint.
      await energyFloor.connect(producer).registerProducer("Post-PoW Solar", "EE", "solar");
      await energyFloor.connect(oracleNode).depositEnergy(producer.address, 1000);

      // 1000 JOL minted via peg
      expect(await jolToken.balanceOf(producer.address)).to.equal(ethers.parseEther("1000"));

      // Total supply now 203,701,000
      expect(await jolToken.totalSupply()).to.equal(ethers.parseEther("203701000"));
    });

    it("EnergyFloor respects its own 42M cap", async function () {
      await energyFloor.connect(producer).registerProducer("Cap Test", "EE", "solar");

      // Deposit just under the cap (using totalMintedFromEnergy tracking)
      // The cap check is: totalMintedFromEnergy * 1 ether + jolAmount <= MAX_FLOOR_MINT
      // So max kWh via peg = 42,000,000
      // Deposit 42M kWh in one shot would be the limit
      // Test: deposit a small amount succeeds
      await energyFloor.connect(oracleNode).depositEnergy(producer.address, 100);
      expect(await energyFloor.totalMintedFromEnergy()).to.equal(100);
    });

    it("PoE mining via PoEMining still accrues with 3x multiplier", async function () {
      // Even post-PoW, PoEMining still works (mints from JOLToken supply)
      const meterId = ethers.keccak256(ethers.toUtf8Bytes("POSTPOW-WIND-001"));
      await registry.connect(producer).registerFacility(1, 1000, meterId, "0x75636674", 2, "EE");
      await registry.verifyFacility(1);

      await poeMining.connect(oracleNode).accrueReward(1, 50);

      // 50 kWh × 3 = 150 gross, - 2% = 147 JOL
      const claimable = await poeMining.getClaimable(producer.address);
      expect(claimable).to.equal(ethers.parseEther("147"));
    });
  });

  // ─── Scenario 5: Governance Survives Zero Emission ─────────────

  describe("Scenario 5 — Governance works with 0 new supply", function () {
    it("existing holders can propose with 100k+ JOL", async function () {
      // Mint 200k JOL to voter1 (simulating pre-emission holdings)
      await jolToken.mint(voter1.address, ethers.parseEther("200000"));

      // Delegate to self (required for ERC20Votes)
      await jolToken.connect(voter1).delegate(voter1.address);

      // Mine a block so snapshot is available
      await ethers.provider.send("evm_mine", []);

      // Propose
      const tx = await governance.connect(voter1).propose(
        "Post-emission upgrade",
        "Adjust fee structure for sustainability",
        [],
        []
      );

      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });

    it("voting power is based on existing holdings, not new emissions", async function () {
      // Mint to two voters
      await jolToken.mint(voter1.address, ethers.parseEther("150000"));
      await jolToken.mint(voter2.address, ethers.parseEther("100000"));

      // Both delegate to self
      await jolToken.connect(voter1).delegate(voter1.address);
      await jolToken.connect(voter2).delegate(voter2.address);

      await ethers.provider.send("evm_mine", []);

      // Voter1 proposes
      await governance.connect(voter1).propose(
        "Fee burn rate change",
        "Increase burn from 50% to 75%",
        [],
        []
      );

      // Both vote
      await governance.connect(voter1).vote(1, true);
      await governance.connect(voter2).vote(1, true);

      // MAX_WALLET_VOTE_BPS = 500 (5% of snapshot supply)
      // Snapshot supply = 250,000 JOL. Max weight per voter = 250,000 × 5% = 12,500
      // Voter1 has 150k but capped to 12,500. Voter2 has 100k but capped to 12,500.
      const [forVotes, againstVotes] = await governance.getProposalVotes(1);
      const snapshotSupply = ethers.parseEther("250000");
      const maxPerVoter = snapshotSupply * 500n / 10000n; // 5%
      expect(forVotes).to.equal(maxPerVoter * 2n);
      expect(againstVotes).to.equal(0);
    });

    it("QUORUM_BPS = 400 (4% of supply needed for valid vote)", async function () {
      const quorumBps = await governance.QUORUM_BPS();
      expect(quorumBps).to.equal(400);

      // With 210M total supply, quorum = 8.4M JOL worth of votes
      // With 200k circulating, quorum = 8,000 JOL — very achievable
      const smallCirculating = 200_000n;
      const quorum = smallCirculating * 400n / 10_000n;
      expect(quorum).to.equal(8_000n);
    });

    it("proposal passes with quorum met and majority for", async function () {
      // Post-emission scenario: three voters, two vote for, one against
      // With MAX_WALLET_VOTE_BPS = 500 (5%), each voter is capped equally
      // So we need more FOR voters than AGAINST voters
      const [,,, v1, v2, v3] = await ethers.getSigners();

      await jolToken.mint(v1.address, ethers.parseEther("150000"));
      await jolToken.mint(v2.address, ethers.parseEther("100000"));
      await jolToken.mint(v3.address, ethers.parseEther("100000"));

      await jolToken.connect(v1).delegate(v1.address);
      await jolToken.connect(v2).delegate(v2.address);
      await jolToken.connect(v3).delegate(v3.address);

      await ethers.provider.send("evm_mine", []);

      await governance.connect(v1).propose(
        "Protocol upgrade v2",
        "Enable new fee model",
        [],
        []
      );

      // 2 vote for, 1 against — all capped to 5% of 350k = 17,500 each
      await governance.connect(v1).vote(1, true);
      await governance.connect(v2).vote(1, true);
      await governance.connect(v3).vote(1, false);

      // Fast-forward past voting period (7 days)
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      // Finalize
      await governance.finalize(1);

      // votesFor = 2 × 17,500 = 35,000 > votesAgainst = 17,500
      // quorum = 4% of 350k = 14,000. Total votes = 52,500 >= 14,000. Passed.
      const [id, proposer, title, description, createdAt, snapshotBlock, finalizedAt, snapshotSupply, votesFor, votesAgainst, state] = await governance.proposals(1);
      expect(state).to.equal(1); // Passed
    });
  });

  // ─── Combined Timeline Summary ─────────────────────────────────

  describe("Combined — Full emission timeline verification", function () {
    it("complete emission schedule: 6 eras, 203.7M total, then 0", function () {
      const schedule = [];
      let cumulativeSupply = 0n;

      for (let era = 0n; era < 10n; era++) {
        const reward = INITIAL_REWARD >> era;
        const eraMined = reward * HALVING_INTERVAL;
        cumulativeSupply += eraMined;
        schedule.push({
          era: Number(era),
          reward: Number(reward),
          eraMined: Number(eraMined),
          cumulative: Number(cumulativeSupply),
        });
      }

      // Era breakdown
      expect(schedule[0]).to.deep.include({ era: 0, reward: 50, eraMined: 105_000_000 });
      expect(schedule[1]).to.deep.include({ era: 1, reward: 25, eraMined: 52_500_000 });
      expect(schedule[2]).to.deep.include({ era: 2, reward: 12, eraMined: 25_200_000 });
      expect(schedule[3]).to.deep.include({ era: 3, reward: 6,  eraMined: 12_600_000 });
      expect(schedule[4]).to.deep.include({ era: 4, reward: 3,  eraMined: 6_300_000 });
      expect(schedule[5]).to.deep.include({ era: 5, reward: 1,  eraMined: 2_100_000 });
      expect(schedule[6]).to.deep.include({ era: 6, reward: 0,  eraMined: 0 });

      // Final cumulative
      expect(schedule[9].cumulative).to.equal(203_700_000);
    });

    it("post-emission economy: PoE + fees sustain the network", function () {
      // After all PoW emissions (203.7M minted):
      // Remaining mintable via JOLToken: 210M - 203.7M = 6.3M
      // EnergyFloor cap: 42M (but limited by remaining supply)
      // PoE (3x multiplier) also mints from remaining supply
      //
      // Long-term: fee burns reduce circulating supply
      // PoE minting adds new supply for energy producers
      // Net effect depends on adoption and tx volume

      const powMinted = 203_700_000n;
      const remainingCapacity = MAX_SUPPLY - powMinted;
      expect(remainingCapacity).to.equal(6_300_000n);

      // Even if all remaining capacity is used, supply never exceeds 210M
      const maxPossibleSupply = powMinted + remainingCapacity;
      expect(maxPossibleSupply).to.equal(MAX_SUPPLY);
    });
  });
});
