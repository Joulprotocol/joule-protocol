// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./JOLToken.sol";

/**
 * @title PaymentChannel
 * @notice Bidirectional payment channels for machine-to-machine micropayments.
 *
 * Why this matters:
 * - EV pays charger 0.001 JOL per second of charging
 * - AI agent pays compute node 0.0001 JOL per inference
 * - Smart home pays grid 0.01 JOL per kWh consumed
 *
 * On-chain transactions cost gas. Micropayments need to be INSTANT and FREE.
 * Payment channels move transactions off-chain, settle on-chain only at close.
 *
 * Flow:
 * 1. Open channel (deposit JOL)
 * 2. Exchange signed payment messages off-chain (instant, free)
 * 3. Close channel (settle final balance on-chain)
 */
contract PaymentChannel is ReentrancyGuard, Pausable, AccessControl {
    using ECDSA for bytes32;
    

    JOLToken public jolToken;

    struct Channel {
        uint256 id;
        address sender;      // e.g., EV
        address receiver;    // e.g., charger
        uint256 deposit;     // JOL locked by sender
        uint256 expiration;  // auto-close time
        uint256 paid;        // total paid (updated on close)
        bool open;
        bool closed;
    }

    uint256 public nextChannelId = 1;
    mapping(uint256 => Channel) public channels;
    mapping(address => uint256[]) public senderChannels;
    mapping(address => uint256[]) public receiverChannels;

    // Stats
    uint256 public totalChannelsOpened;
    uint256 public totalChannelsClosed;
    uint256 public totalVolume;

    event ChannelOpened(uint256 indexed id, address sender, address receiver, uint256 deposit, uint256 expiration);
    event ChannelClosed(uint256 indexed id, uint256 senderAmount, uint256 receiverAmount);
    event ChannelExpired(uint256 indexed id, uint256 refunded);

    constructor(address admin, address _jolToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    /**
     * @notice Open a payment channel by depositing JOL
     * @param _receiver The counterparty (machine receiving payments)
     * @param _deposit Amount of JOL to lock
     * @param _duration How long the channel stays open (seconds)
     */
    function openChannel(
        address _receiver,
        uint256 _deposit,
        uint256 _duration
    ) external nonReentrant whenNotPaused returns (uint256) {
        require(_receiver != address(0) && _receiver != msg.sender, "Invalid receiver");
        require(_deposit > 0, "Zero deposit");
        require(_duration >= 60 && _duration <= 365 days, "Invalid duration");

        // Effects (state changes BEFORE external calls)
        uint256 id = nextChannelId++;
        channels[id] = Channel({
            id: id,
            sender: msg.sender,
            receiver: _receiver,
            deposit: _deposit,
            expiration: block.timestamp + _duration,
            paid: 0,
            open: true,
            closed: false
        });

        senderChannels[msg.sender].push(id);
        receiverChannels[_receiver].push(id);
        totalChannelsOpened++;

        // Interaction (external call AFTER state changes)
        require(jolToken.transferFrom(msg.sender, address(this), _deposit), "Transfer failed");

        emit ChannelOpened(id, msg.sender, _receiver, _deposit, block.timestamp + _duration);
        return id;
    }

    /**
     * @notice Close channel with signed payment proof.
     * Receiver submits the latest signed message from sender.
     *
     * Off-chain, sender signs messages like:
     *   "I authorize payment of X JOL on channel Y"
     * Each new message has a higher amount (cumulative).
     * Only the FINAL message matters for settlement.
     */
    function closeChannel(
        uint256 _channelId,
        uint256 _amount,
        bytes memory _signature
    ) external nonReentrant {
        Channel storage ch = channels[_channelId];
        require(ch.open && !ch.closed, "Channel not open");
        require(msg.sender == ch.receiver, "Only receiver can close");
        require(_amount <= ch.deposit, "Amount exceeds deposit");

        // Verify sender's signature
        bytes32 message = keccak256(abi.encodePacked(
            address(this),
            _channelId,
            _amount
        ));
        bytes32 ethSignedMessage = ECDSA.toEthSignedMessageHash(message);
        address signer = ethSignedMessage.recover(_signature);
        require(signer == ch.sender, "Invalid signature");

        // Close and settle
        ch.open = false;
        ch.closed = true;
        ch.paid = _amount;

        // Pay receiver
        if (_amount > 0) {
            require(jolToken.transfer(ch.receiver, _amount), "Receiver payment failed");
        }

        // Refund remainder to sender
        uint256 remainder = ch.deposit - _amount;
        if (remainder > 0) {
            require(jolToken.transfer(ch.sender, remainder), "Sender refund failed");
        }

        totalChannelsClosed++;
        totalVolume += _amount;

        emit ChannelClosed(_channelId, remainder, _amount);
    }

    /**
     * @notice Expire channel (sender can reclaim after expiration)
     */
    // Grace period: receiver has 1 hour after expiration to submit closeChannel
    uint256 public constant EXPIRE_GRACE_PERIOD = 1 hours;

    function expireChannel(uint256 _channelId) external nonReentrant {
        Channel storage ch = channels[_channelId];
        require(ch.open && !ch.closed, "Channel not open");
        require(block.timestamp >= ch.expiration + EXPIRE_GRACE_PERIOD, "Grace period active");
        require(msg.sender == ch.sender, "Only sender can expire");

        ch.open = false;
        ch.closed = true;

        // Refund full deposit to sender
        require(jolToken.transfer(ch.sender, ch.deposit), "Refund failed");

        totalChannelsClosed++;
        emit ChannelExpired(_channelId, ch.deposit);
    }

    /**
     * @notice Extend channel expiration (sender only)
     */
    function extendChannel(uint256 _channelId, uint256 _additionalTime) external {
        Channel storage ch = channels[_channelId];
        require(ch.open, "Not open");
        require(msg.sender == ch.sender, "Only sender");
        ch.expiration += _additionalTime;
    }

    /**
     * @notice Top up channel deposit (sender only)
     */
    function topUpChannel(uint256 _channelId, uint256 _amount) external nonReentrant {
        Channel storage ch = channels[_channelId];
        require(ch.open, "Not open");
        require(msg.sender == ch.sender, "Only sender");
        ch.deposit += _amount;
        require(jolToken.transferFrom(msg.sender, address(this), _amount), "Transfer failed");
    }

    // ─── Views ─────────────────────────────────────────────────────

    function getChannelsByPair(address _sender, address _receiver) external view returns (uint256[] memory) {
        uint256[] memory senderCh = senderChannels[_sender];
        uint256 count;
        for (uint256 i = 0; i < senderCh.length; i++) {
            if (channels[senderCh[i]].receiver == _receiver && channels[senderCh[i]].open) count++;
        }
        uint256[] memory result = new uint256[](count);
        uint256 idx;
        for (uint256 i = 0; i < senderCh.length; i++) {
            if (channels[senderCh[i]].receiver == _receiver && channels[senderCh[i]].open) {
                result[idx++] = senderCh[i];
            }
        }
        return result;
    }

    /**
     * @notice Helper to create the message hash for off-chain signing
     */
    function getMessageHash(uint256 _channelId, uint256 _amount) external view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), _channelId, _amount));
    }
}
