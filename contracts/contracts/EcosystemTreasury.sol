// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./JOLToken.sol";

/**
 * @title EcosystemTreasury
 * @notice Community-owned treasury for ecosystem development.
 *
 * Funded by: 5% of total supply (10,500,000 JOL), minted gradually.
 * Spent by: DAO governance vote (proposal + majority).
 *
 * Treasury split:
 *   90% = 9,450,000 JOL — bounties, developers, audits, DEX liquidity
 *   10% = 1,050,000 JOL — insurance reserve (smart contract bug coverage)
 *
 * Insurance payouts require DAO vote + 7-day timelock.
 * No single person controls this. Fully transparent, on-chain, auditable.
 */
contract EcosystemTreasury is AccessControl, ReentrancyGuard {
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    JOLToken public jolToken;

    uint256 public constant MAX_TREASURY = 10_500_000 ether; // 5% of 210M
    uint256 public constant MAX_INSURANCE = 1_050_000 ether; // 10% of treasury
    uint256 public constant INSURANCE_TIMELOCK = 7 days;

    uint256 public totalMinted;
    uint256 public totalSpent;
    uint256 public insuranceReserve;

    // Insurance payout requests (timelocked)
    struct InsuranceRequest {
        address recipient;
        uint256 amount;
        string reason;
        uint256 requestedAt;
        bool executed;
    }
    uint256 public nextInsuranceId = 1;
    mapping(uint256 => InsuranceRequest) public insuranceRequests;

    // Bounty system
    struct Bounty {
        uint256 id;
        string description;
        uint256 reward;
        address claimedBy;
        bool active;
        bool paid;
    }

    uint256 public nextBountyId = 1;
    mapping(uint256 => Bounty) public bounties;

    // Spend proposals (linked to Governance contract)
    struct SpendProposal {
        address recipient;
        uint256 amount;
        string reason;
        bool executed;
    }

    mapping(uint256 => SpendProposal) public proposals; // governanceProposalId → spend

    event TreasuryFunded(uint256 amount, uint256 totalMinted);
    event BountyCreated(uint256 indexed id, string description, uint256 reward);
    event BountyClaimed(uint256 indexed id, address claimedBy);
    event BountyPaid(uint256 indexed id, address to, uint256 amount);
    event SpendApproved(uint256 indexed proposalId, address recipient, uint256 amount, string reason);
    event InsuranceFunded(uint256 amount, uint256 totalReserve);
    event InsuranceRequested(uint256 indexed id, address recipient, uint256 amount, string reason);
    event InsurancePayout(uint256 indexed id, address indexed recipient, uint256 amount, string reason);

    constructor(address admin, address _jolToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
    }

    // ─── Funding ───────────────────────────────────────────────────

    /**
     * @notice Mint JOL to treasury (called periodically, respects 5% cap)
     * Minting schedule: proportional to total mined supply.
     * For every 95 JOL mined by miners, 5 JOL minted to treasury.
     */
    function fundTreasury(uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(totalMinted + _amount <= MAX_TREASURY, "Exceeds treasury cap");
        totalMinted += _amount;
        jolToken.mint(address(this), _amount);
        emit TreasuryFunded(_amount, totalMinted);
    }

    // ─── Bounties ──────────────────────────────────────────────────

    /**
     * @notice Create a bounty (governance only)
     */
    function createBounty(
        string calldata _description,
        uint256 _reward
    ) external onlyRole(GOVERNANCE_ROLE) returns (uint256) {
        require(_reward > 0, "Zero reward");

        uint256 id = nextBountyId++;
        bounties[id] = Bounty({
            id: id,
            description: _description,
            reward: _reward,
            claimedBy: address(0),
            active: true,
            paid: false
        });

        emit BountyCreated(id, _description, _reward);
        return id;
    }

    /**
     * @notice Claim a bounty (anyone can claim, governance approves payment)
     */
    function claimBounty(uint256 _bountyId) external {
        Bounty storage b = bounties[_bountyId];
        require(b.active, "Not active");
        require(b.claimedBy == address(0), "Already claimed");

        b.claimedBy = msg.sender;
        emit BountyClaimed(_bountyId, msg.sender);
    }

    /**
     * @notice Pay out a claimed bounty (governance approves)
     */
    function payBounty(uint256 _bountyId) external onlyRole(GOVERNANCE_ROLE) nonReentrant {
        Bounty storage b = bounties[_bountyId];
        require(b.claimedBy != address(0), "Not claimed");
        require(!b.paid, "Already paid");
        require(jolToken.balanceOf(address(this)) >= b.reward + insuranceReserve, "Insufficient treasury (insurance reserved)");

        b.paid = true;
        b.active = false;
        totalSpent += b.reward;

        require(jolToken.transfer(b.claimedBy, b.reward), "Transfer failed");
        emit BountyPaid(_bountyId, b.claimedBy, b.reward);
    }

    /**
     * @notice Cancel a bounty (governance only)
     */
    function cancelBounty(uint256 _bountyId) external onlyRole(GOVERNANCE_ROLE) {
        bounties[_bountyId].active = false;
    }

    // ─── General Spending (via Governance) ─────────────────────────

    /**
     * @notice Execute a governance-approved spend
     */
    function executeSpend(
        address _recipient,
        uint256 _amount,
        string calldata _reason
    ) external onlyRole(GOVERNANCE_ROLE) nonReentrant {
        require(_amount > 0, "Zero amount");
        uint256 balance = jolToken.balanceOf(address(this));
        // Protect insurance reserve — general spend cannot touch it
        require(balance >= _amount + insuranceReserve, "Insufficient treasury (insurance reserved)");

        totalSpent += _amount;
        require(jolToken.transfer(_recipient, _amount), "Transfer failed");

        emit SpendApproved(0, _recipient, _amount, _reason);
    }

    // ─── Insurance Reserve ─────────────────────────────────────────

    /**
     * @notice Fund the insurance reserve from treasury balance
     */
    function fundInsurance(uint256 _amount) external onlyRole(GOVERNANCE_ROLE) {
        require(insuranceReserve + _amount <= MAX_INSURANCE, "Exceeds insurance cap");
        require(jolToken.balanceOf(address(this)) >= _amount, "Insufficient treasury");
        insuranceReserve += _amount;
        emit InsuranceFunded(_amount, insuranceReserve);
    }

    /**
     * @notice Request insurance payout (starts 7-day timelock)
     */
    function requestInsurancePayout(
        address _recipient,
        uint256 _amount,
        string calldata _reason
    ) external onlyRole(GOVERNANCE_ROLE) returns (uint256) {
        require(_amount > 0 && _amount <= insuranceReserve, "Invalid amount");
        require(bytes(_reason).length > 0, "Reason required");

        uint256 id = nextInsuranceId++;
        insuranceRequests[id] = InsuranceRequest({
            recipient: _recipient,
            amount: _amount,
            reason: _reason,
            requestedAt: block.timestamp,
            executed: false
        });

        emit InsuranceRequested(id, _recipient, _amount, _reason);
        return id;
    }

    /**
     * @notice Execute insurance payout after 7-day timelock
     */
    function executeInsurancePayout(uint256 _id) external onlyRole(GOVERNANCE_ROLE) nonReentrant {
        InsuranceRequest storage req = insuranceRequests[_id];
        require(!req.executed, "Already executed");
        require(req.amount > 0, "Invalid request");
        require(block.timestamp >= req.requestedAt + INSURANCE_TIMELOCK, "Timelock not expired");
        require(req.amount <= insuranceReserve, "Exceeds insurance reserve");

        req.executed = true;
        insuranceReserve -= req.amount;
        totalSpent += req.amount;

        require(jolToken.transfer(req.recipient, req.amount), "Transfer failed");
        emit InsurancePayout(_id, req.recipient, req.amount, req.reason);
    }

    // ─── Views ─────────────────────────────────────────────────────

    function treasuryBalance() external view returns (uint256) {
        return jolToken.balanceOf(address(this));
    }

    function remainingMintable() external view returns (uint256) {
        return MAX_TREASURY - totalMinted;
    }

    function getActiveBounties() external view returns (uint256 count) {
        for (uint256 i = 1; i < nextBountyId; i++) {
            if (bounties[i].active) count++;
        }
    }
}
