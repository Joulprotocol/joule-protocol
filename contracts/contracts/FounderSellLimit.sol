// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./JOLToken.sol";

/**
 * @title FounderSellLimit
 * @notice Founder sell limit — in code, not in promises.
 *
 * Maximum 1% of daily market volume per day.
 * Community sees every sell in real-time on-chain.
 *
 * This is not about restricting the founder.
 * This is about proving commitment through code.
 */
contract FounderSellLimit {
    JOLToken public jolToken;

    // 1% of daily volume
    uint256 public constant MAX_DAILY_PCT = 100; // 1% in BPS (base 10000)
    uint256 public constant BPS_BASE = 10000;

    address public founder;

    // Daily tracking
    mapping(uint256 => uint256) public dailySold;       // day → amount sold
    mapping(uint256 => uint256) public dailyVolume;      // day → reported volume

    // Volume oracle — reports daily trading volume
    address public volumeOracle;

    event FounderSell(uint256 indexed day, uint256 amount, uint256 totalToday, uint256 limit);
    event FounderSellBlocked(uint256 indexed day, uint256 attempted, uint256 totalToday, uint256 limit);
    event DailyVolumeUpdated(uint256 indexed day, uint256 volume);

    constructor(address _jolToken, address _founder, address _volumeOracle) {
        jolToken = JOLToken(_jolToken);
        founder = _founder;
        volumeOracle = _volumeOracle;
    }

    /**
     * @notice Oracle updates daily market volume.
     */
    function updateDailyVolume(uint256 _volume) external {
        require(msg.sender == volumeOracle, "Not volume oracle");
        uint256 today = block.timestamp / 1 days;
        dailyVolume[today] = _volume;
        emit DailyVolumeUpdated(today, _volume);
    }

    /**
     * @notice Founder sells through this contract.
     * Enforces 1% daily volume limit.
     * @param _to Buyer address
     * @param _amount JOL amount to sell
     */
    function sell(address _to, uint256 _amount) external {
        require(msg.sender == founder, "Not founder");

        uint256 today = block.timestamp / 1 days;
        uint256 limit = getDailyLimit(today);

        uint256 totalAfter = dailySold[today] + _amount;
        if (totalAfter > limit) {
            emit FounderSellBlocked(today, _amount, dailySold[today], limit);
            revert("Exceeds daily founder sell limit");
        }

        dailySold[today] = totalAfter;

        // Transfer from founder to buyer
        jolToken.transferFrom(founder, _to, _amount);

        emit FounderSell(today, _amount, totalAfter, limit);
    }

    /**
     * @notice Get founder's daily sell limit.
     * 1% of daily market volume.
     */
    function getDailyLimit(uint256 _day) public view returns (uint256) {
        uint256 volume = dailyVolume[_day];
        if (volume == 0) {
            // If no volume reported today, check yesterday
            if (_day > 0) {
                volume = dailyVolume[_day - 1];
            }
        }
        return volume * MAX_DAILY_PCT / BPS_BASE;
    }

    /**
     * @notice Get remaining sell allowance for founder today.
     */
    function remainingToday() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 limit = getDailyLimit(today);
        uint256 sold = dailySold[today];
        if (sold >= limit) return 0;
        return limit - sold;
    }

    /**
     * @notice Get how much founder has sold today.
     */
    function soldToday() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        return dailySold[today];
    }
}
