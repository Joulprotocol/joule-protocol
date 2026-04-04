// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title wJOL (Wrapped JOULE)
 * @notice ERC-20 on Ethereum mainnet representing locked JOL on JOULE chain.
 *
 * Bridge flow:
 *   JOULE chain:    User sends JOL → Bridge contract (locked)
 *   Ethereum:       Bridge mints wJOL 1:1
 *   Uniswap:        wJOL/ETH pool — anyone can trade
 *   Reverse:        Burn wJOL on Ethereum → unlock JOL on JOULE chain
 *
 * This is deployed on ETHEREUM (not JOULE chain).
 * Bridge validators (3/5 multisig) authorize mint/burn.
 */
contract WrappedJOULE is ERC20, AccessControl {
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");

    // Track bridge operations for audit
    struct BridgeOp {
        address user;
        uint256 amount;
        bytes32 jouleChainTxHash; // tx hash on JOULE chain
        uint256 timestamp;
        bool isMint; // true = JOL→wJOL, false = wJOL→JOL
    }

    BridgeOp[] public bridgeHistory;
    mapping(bytes32 => bool) public processedTxHashes; // prevent double-mint

    uint256 public totalBridgedIn;  // total JOL locked on JOULE chain
    uint256 public totalBridgedOut; // total JOL unlocked back

    event BridgedIn(address indexed user, uint256 amount, bytes32 jouleChainTxHash);
    event BridgedOut(address indexed user, uint256 amount);

    constructor(address admin) ERC20("Wrapped JOULE", "wJOL") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Mint wJOL when JOL is locked on JOULE chain.
     * Called by bridge validators after confirming lock tx.
     */
    function bridgeIn(
        address _user,
        uint256 _amount,
        bytes32 _jouleChainTxHash
    ) external onlyRole(BRIDGE_ROLE) {
        require(!processedTxHashes[_jouleChainTxHash], "Already processed");
        require(_amount > 0, "Zero amount");

        processedTxHashes[_jouleChainTxHash] = true;
        totalBridgedIn += _amount;

        _mint(_user, _amount);

        bridgeHistory.push(BridgeOp({
            user: _user,
            amount: _amount,
            jouleChainTxHash: _jouleChainTxHash,
            timestamp: block.timestamp,
            isMint: true
        }));

        emit BridgedIn(_user, _amount, _jouleChainTxHash);
    }

    /**
     * @notice Burn wJOL to unlock JOL on JOULE chain.
     * User calls this, then bridge validators unlock on JOULE chain.
     */
    function bridgeOut(uint256 _amount) external {
        require(_amount > 0, "Zero amount");
        require(balanceOf(msg.sender) >= _amount, "Insufficient balance");

        _burn(msg.sender, _amount);
        totalBridgedOut += _amount;

        bridgeHistory.push(BridgeOp({
            user: msg.sender,
            amount: _amount,
            jouleChainTxHash: bytes32(0), // filled by bridge validators
            timestamp: block.timestamp,
            isMint: false
        }));

        emit BridgedOut(msg.sender, _amount);
    }

    /**
     * @notice Amount of JOL currently locked in bridge
     */
    function totalLocked() external view returns (uint256) {
        return totalBridgedIn - totalBridgedOut;
    }

    function getBridgeHistoryLength() external view returns (uint256) {
        return bridgeHistory.length;
    }
}
