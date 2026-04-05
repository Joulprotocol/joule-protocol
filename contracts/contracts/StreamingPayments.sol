// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./JOLToken.sol";

/**
 * @title StreamingPayments
 * @notice Real-time, per-second money streaming for machine economy.
 *
 * Use cases:
 * - EV charges at station: 0.05 JOL/second while plugged in
 * - AI agent rents GPU: 0.001 JOL/second of compute
 * - Smart home pays solar neighbor: 0.02 JOL/second of power
 * - Factory pays grid: streaming payment for industrial power
 *
 * Money flows continuously. No invoices, no billing cycles, no disputes.
 * Machines pay EXACTLY for what they use, per-second.
 */
contract StreamingPayments is ReentrancyGuard {
    JOLToken public jolToken;

    uint256 public constant FEE_BPS = 10; // 0.1% protocol fee — 100% burned

    struct Stream {
        uint256 id;
        address sender;         // who pays
        address receiver;       // who gets paid
        uint256 ratePerSecond;  // JOL per second (in wei)
        uint256 deposit;        // total JOL locked
        uint256 startTime;
        uint256 stopTime;       // 0 = still running
        uint256 lastWithdrawTime;
        uint256 withdrawn;      // total withdrawn by receiver
        bool active;
    }

    uint256 public nextStreamId = 1;
    mapping(uint256 => Stream) public streams;
    mapping(address => uint256[]) public outgoingStreams;
    mapping(address => uint256[]) public incomingStreams;

    // Stats
    uint256 public totalStreams;
    uint256 public activeStreams;
    uint256 public totalStreamedVolume;

    event StreamCreated(uint256 indexed id, address sender, address receiver, uint256 ratePerSecond, uint256 deposit);
    event StreamWithdrawn(uint256 indexed id, address receiver, uint256 amount);
    event StreamStopped(uint256 indexed id, uint256 senderRefund, uint256 receiverPaid);
    event StreamToppedUp(uint256 indexed id, uint256 amount);

    constructor(address _jolToken) {
        jolToken = JOLToken(_jolToken);
    }

    /**
     * @notice Start a payment stream
     * @param _receiver Who gets paid
     * @param _ratePerSecond JOL per second (in wei, e.g., 1e15 = 0.001 JOL/sec)
     * @param _deposit Total JOL to lock (determines max stream duration)
     */
    function createStream(
        address _receiver,
        uint256 _ratePerSecond,
        uint256 _deposit
    ) external returns (uint256) {
        require(_receiver != address(0) && _receiver != msg.sender, "Invalid receiver");
        require(_ratePerSecond > 0, "Zero rate");
        require(_deposit >= _ratePerSecond, "Deposit too small");

        uint256 id = nextStreamId++;
        streams[id] = Stream({
            id: id,
            sender: msg.sender,
            receiver: _receiver,
            ratePerSecond: _ratePerSecond,
            deposit: _deposit,
            startTime: block.timestamp,
            stopTime: 0,
            lastWithdrawTime: block.timestamp,
            withdrawn: 0,
            active: true
        });

        outgoingStreams[msg.sender].push(id);
        incomingStreams[_receiver].push(id);
        totalStreams++;
        activeStreams++;

        require(jolToken.transferFrom(msg.sender, address(this), _deposit), "Transfer failed");

        emit StreamCreated(id, msg.sender, _receiver, _ratePerSecond, _deposit);
        return id;
    }

    /**
     * @notice Withdraw earned JOL from a stream (receiver calls this)
     */
    function withdrawFromStream(uint256 _streamId) external nonReentrant {
        Stream storage s = streams[_streamId];
        require(msg.sender == s.receiver, "Not receiver");

        uint256 available = _availableBalance(s);
        require(available > 0, "Nothing to withdraw");

        // Calculate fee — 100% of protocol fee is burned (deflationary)
        uint256 fee = (available * FEE_BPS) / 10000;
        uint256 netAmount = available - fee;

        s.withdrawn += available;
        s.lastWithdrawTime = block.timestamp;

        // Transfer to receiver
        require(jolToken.transfer(s.receiver, netAmount), "Transfer failed");
        // Burn fee (deflationary)
        if (fee > 0) {
            jolToken.burn(fee);
        }

        totalStreamedVolume += available;
        emit StreamWithdrawn(_streamId, s.receiver, netAmount);

        // Auto-stop if deposit depleted
        if (s.withdrawn >= s.deposit) {
            s.active = false;
            s.stopTime = block.timestamp;
            activeStreams--;
        }
    }

    /**
     * @notice Stop a stream (sender or receiver can stop)
     */
    function stopStream(uint256 _streamId) external nonReentrant {
        Stream storage s = streams[_streamId];
        require(s.active, "Not active");
        require(msg.sender == s.sender || msg.sender == s.receiver, "Not authorized");

        s.active = false;
        s.stopTime = block.timestamp;
        activeStreams--;

        // Calculate final amounts
        uint256 receiverOwed = _availableBalance(s);
        uint256 senderRefund = s.deposit - s.withdrawn - receiverOwed;

        // Pay receiver (effects before interactions)
        if (receiverOwed > 0) {
            uint256 fee = (receiverOwed * FEE_BPS) / 10000;
            uint256 netAmount = receiverOwed - fee;
            s.withdrawn += receiverOwed;
            totalStreamedVolume += receiverOwed;
            require(jolToken.transfer(s.receiver, netAmount), "Receiver payment failed");
            // Burn protocol fee (deflationary)
            if (fee > 0) {
                jolToken.burn(fee);
            }
        }

        // Refund sender
        if (senderRefund > 0) {
            require(jolToken.transfer(s.sender, senderRefund), "Sender refund failed");
        }

        emit StreamStopped(_streamId, senderRefund, receiverOwed);
    }

    /**
     * @notice Top up a stream with more JOL (extends duration)
     */
    function topUpStream(uint256 _streamId, uint256 _amount) external nonReentrant {
        Stream storage s = streams[_streamId];
        require(s.active, "Not active");
        require(msg.sender == s.sender, "Not sender");

        s.deposit += _amount;
        require(jolToken.transferFrom(msg.sender, address(this), _amount), "Transfer failed");

        emit StreamToppedUp(_streamId, _amount);
    }

    // ─── Internal ──────────────────────────────────────────────────

    function _availableBalance(Stream storage s) internal view returns (uint256) {
        uint256 endTime = s.active ? block.timestamp : s.stopTime;
        uint256 elapsed = endTime - s.startTime;
        uint256 totalEarned = elapsed * s.ratePerSecond;

        // Cap at deposit
        if (totalEarned > s.deposit) totalEarned = s.deposit;

        // Subtract already withdrawn
        if (totalEarned <= s.withdrawn) return 0;
        return totalEarned - s.withdrawn;
    }

    // ─── Views ─────────────────────────────────────────────────────

    /**
     * @notice How much the receiver can withdraw right now
     */
    function getAvailableBalance(uint256 _streamId) external view returns (uint256) {
        return _availableBalance(streams[_streamId]);
    }

    /**
     * @notice Remaining time until stream deposit runs out
     */
    function getRemainingTime(uint256 _streamId) external view returns (uint256) {
        Stream storage s = streams[_streamId];
        if (!s.active) return 0;
        uint256 elapsed = block.timestamp - s.startTime;
        uint256 earned = elapsed * s.ratePerSecond;
        if (earned >= s.deposit) return 0;
        return (s.deposit - earned) / s.ratePerSecond;
    }

    /**
     * @notice Current flow rate between two addresses
     */
    function getFlowRate(address _sender, address _receiver) external view returns (uint256) {
        uint256[] storage streamIds = outgoingStreams[_sender];
        uint256 totalRate;
        for (uint256 i = 0; i < streamIds.length; i++) {
            Stream storage s = streams[streamIds[i]];
            if (s.receiver == _receiver && s.active) {
                totalRate += s.ratePerSecond;
            }
        }
        return totalRate;
    }
}
