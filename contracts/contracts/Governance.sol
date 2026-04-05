// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./JOLToken.sol";

/**
 * @title Governance
 * @notice On-chain governance for JOULE protocol upgrades.
 * 1 JOL = 1 vote. Simple majority with quorum requirement.
 */
contract Governance is AccessControl, ReentrancyGuard {
    JOLToken public jolToken;

    uint256 public constant PROPOSAL_THRESHOLD = 100_000 ether;  // 100k JOL to propose
    uint256 public constant VOTING_PERIOD = 7 days;
    uint256 public constant QUORUM_BPS = 400;                     // 4% of circulating supply
    uint256 public constant MAX_WALLET_VOTE_BPS = 500;            // max 5% of circulating supply per voter

    enum ProposalState { Active, Passed, Rejected, Executed, Cancelled }

    struct Proposal {
        uint256 id;
        address proposer;
        string title;
        string description;
        uint256 createdAt;
        uint256 votesFor;
        uint256 votesAgainst;
        ProposalState state;
        address[] targets;
        bytes[] calldatas;
        mapping(address => bool) hasVoted;
    }

    uint256 public nextProposalId = 1;
    mapping(uint256 => Proposal) public proposals;

    event ProposalCreated(uint256 indexed id, address indexed proposer, string title);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);

    constructor(address admin, address _jolToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
    }

    /**
     * @notice Create a new governance proposal
     */
    function propose(
        string calldata _title,
        string calldata _description,
        address[] memory _targets,
        bytes[] memory _calldatas
    ) external returns (uint256) {
        require(
            jolToken.balanceOf(msg.sender) >= PROPOSAL_THRESHOLD,
            "Insufficient JOL to propose"
        );
        require(_targets.length == _calldatas.length, "Length mismatch");

        uint256 id = nextProposalId++;
        Proposal storage p = proposals[id];
        p.id = id;
        p.proposer = msg.sender;
        p.title = _title;
        p.description = _description;
        p.createdAt = block.timestamp;
        p.state = ProposalState.Active;
        p.targets = _targets;
        p.calldatas = _calldatas;

        emit ProposalCreated(id, msg.sender, _title);
        return id;
    }

    /**
     * @notice Vote on an active proposal
     */
    function vote(uint256 _proposalId, bool _support) external {
        Proposal storage p = proposals[_proposalId];
        require(p.state == ProposalState.Active, "Not active");
        require(block.timestamp <= p.createdAt + VOTING_PERIOD, "Voting ended");
        require(!p.hasVoted[msg.sender], "Already voted");

        uint256 weight = jolToken.balanceOf(msg.sender);
        require(weight > 0, "No voting power");

        // Cap individual voting power at 5% of circulating supply
        uint256 maxWeight = (jolToken.totalSupply() * MAX_WALLET_VOTE_BPS) / 10000;
        if (weight > maxWeight) weight = maxWeight;

        p.hasVoted[msg.sender] = true;

        if (_support) {
            p.votesFor += weight;
        } else {
            p.votesAgainst += weight;
        }

        emit Voted(_proposalId, msg.sender, _support, weight);
    }

    /**
     * @notice Finalize a proposal after voting period
     */
    function finalize(uint256 _proposalId) external {
        Proposal storage p = proposals[_proposalId];
        require(p.state == ProposalState.Active, "Not active");
        require(block.timestamp > p.createdAt + VOTING_PERIOD, "Voting ongoing");

        uint256 quorum = (jolToken.totalSupply() * QUORUM_BPS) / 10000;
        uint256 totalVotes = p.votesFor + p.votesAgainst;

        if (totalVotes >= quorum && p.votesFor > p.votesAgainst) {
            p.state = ProposalState.Passed;
        } else {
            p.state = ProposalState.Rejected;
        }
    }

    /**
     * @notice Execute a passed proposal
     */
    function execute(uint256 _proposalId) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Proposal storage p = proposals[_proposalId];
        require(p.state == ProposalState.Passed, "Not passed");

        p.state = ProposalState.Executed;

        for (uint256 i = 0; i < p.targets.length; i++) {
            (bool success, ) = p.targets[i].call(p.calldatas[i]);
            require(success, "Execution failed");
        }

        emit ProposalExecuted(_proposalId);
    }

    /**
     * @notice Cancel a proposal (proposer or admin)
     */
    function cancel(uint256 _proposalId) external {
        Proposal storage p = proposals[_proposalId];
        require(
            msg.sender == p.proposer || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );
        require(p.state == ProposalState.Active, "Not active");
        p.state = ProposalState.Cancelled;
        emit ProposalCancelled(_proposalId);
    }

    // ─── Views ─────────────────────────────────────────────────────

    function getProposalVotes(uint256 _id) external view returns (uint256 forVotes, uint256 againstVotes) {
        return (proposals[_id].votesFor, proposals[_id].votesAgainst);
    }

    function hasVoted(uint256 _id, address _voter) external view returns (bool) {
        return proposals[_id].hasVoted[_voter];
    }
}
