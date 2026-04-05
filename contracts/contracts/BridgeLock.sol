// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title BridgeLock
 * @notice JOULE chain side of the Ethereum bridge.
 * Users lock native JOL here → bridge mints wJOL on Ethereum.
 * Users burn wJOL on Ethereum → bridge unlocks JOL here.
 *
 * Security: 3/5 multisig validators, timelock on large amounts.
 */
contract BridgeLock is AccessControl, ReentrancyGuard {
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");

    uint256 public constant LARGE_AMOUNT = 100_000 ether; // 100k JOL
    uint256 public constant TIMELOCK_DURATION = 24 hours;

    struct LockRequest {
        address user;
        uint256 amount;
        uint256 timestamp;
        bool processed;
    }

    struct UnlockRequest {
        address user;
        uint256 amount;
        bytes32 ethTxHash;
        uint256 confirmations;
        uint256 createdAt;
        bool executed;
        mapping(address => bool) hasConfirmed;
    }

    uint256 public nextLockId = 1;
    uint256 public nextUnlockId = 1;
    mapping(uint256 => LockRequest) public lockRequests;
    mapping(uint256 => UnlockRequest) public unlockRequests;
    mapping(bytes32 => bool) public processedEthTxHashes;

    uint256 public totalLocked;
    uint256 public totalUnlocked;
    uint256 public requiredConfirmations = 3;

    event JOLLocked(uint256 indexed lockId, address user, uint256 amount);
    event JOLUnlocked(uint256 indexed unlockId, address user, uint256 amount);
    event UnlockConfirmed(uint256 indexed unlockId, address validator);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Lock JOL for bridging to Ethereum
     */
    function lockJOL() external payable nonReentrant {
        require(msg.value > 0, "Zero amount");

        uint256 lockId = nextLockId++;
        lockRequests[lockId] = LockRequest({
            user: msg.sender,
            amount: msg.value,
            timestamp: block.timestamp,
            processed: false
        });

        totalLocked += msg.value;

        emit JOLLocked(lockId, msg.sender, msg.value);
    }

    /**
     * @notice Validator confirms unlock (from Ethereum burn)
     */
    function confirmUnlock(
        uint256 _unlockId,
        address _user,
        uint256 _amount,
        bytes32 _ethTxHash
    ) external onlyRole(VALIDATOR_ROLE) {
        require(!processedEthTxHashes[_ethTxHash], "Already processed");

        UnlockRequest storage req = unlockRequests[_unlockId];

        // Initialize if first confirmation
        if (req.user == address(0)) {
            req.user = _user;
            req.amount = _amount;
            req.ethTxHash = _ethTxHash;
            req.createdAt = block.timestamp;
        } else {
            // Subsequent confirmations must match the first — prevents parameter manipulation
            bytes32 expected = keccak256(abi.encodePacked(_unlockId, req.user, req.amount, req.ethTxHash));
            bytes32 submitted = keccak256(abi.encodePacked(_unlockId, _user, _amount, _ethTxHash));
            require(expected == submitted, "Parameters mismatch with first confirmation");
        }

        require(!req.hasConfirmed[msg.sender], "Already confirmed");
        require(!req.executed, "Already executed");

        req.hasConfirmed[msg.sender] = true;
        req.confirmations++;

        emit UnlockConfirmed(_unlockId, msg.sender);

        // Execute if enough confirmations
        if (req.confirmations >= requiredConfirmations) {
            _executeUnlock(_unlockId);
        }
    }

    function _executeUnlock(uint256 _unlockId) internal {
        UnlockRequest storage req = unlockRequests[_unlockId];
        require(!req.executed, "Already executed");
        require(address(this).balance >= req.amount, "Insufficient bridge balance");

        // Timelock for large amounts
        if (req.amount >= LARGE_AMOUNT) {
            require(
                block.timestamp >= req.createdAt + TIMELOCK_DURATION,
                "Timelock not expired for large amount"
            );
        }

        req.executed = true;
        processedEthTxHashes[req.ethTxHash] = true;
        totalUnlocked += req.amount;

        (bool sent, ) = req.user.call{value: req.amount}("");
        require(sent, "Transfer failed");

        emit JOLUnlocked(_unlockId, req.user, req.amount);
    }

    /**
     * @notice Current bridge TVL
     */
    function bridgeTVL() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {}
}
