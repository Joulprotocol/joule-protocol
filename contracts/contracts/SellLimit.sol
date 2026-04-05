// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SellLimit
 * @notice Square root harmony sell limiter.
 *
 * Energy production is extra income for producers. The sell limit
 * is not a blockade — it's investment discipline.
 *
 * Square root ensures larger producers protect the price longer.
 * Small producers get min 0.5% daily. Max cap 5%.
 *
 * Formula: sqrt(dailyProduction) × marketVolume / 1,000,000
 * Clamped between 0.5% minimum and 5% maximum of daily production.
 */
contract SellLimit {
    // Min 0.5% of daily production
    uint256 public constant MIN_SELL_BPS = 50;    // 0.5% in BPS (base 10000)
    // Max 5% of daily production
    uint256 public constant MAX_SELL_BPS = 500;   // 5% in BPS
    uint256 public constant BPS_BASE = 10000;
    uint256 public constant SQRT_DIVISOR = 1_000_000;

    // Daily sell tracking
    mapping(address => mapping(uint256 => uint256)) public dailySold; // address → day → amount

    event SellLimitChecked(address indexed seller, uint256 amount, uint256 limit, bool allowed);

    /**
     * @notice Calculate daily sell limit for a producer.
     * @param _dailyProduction Producer's daily energy output (in JOL, wei)
     * @param _marketVolume Current daily market volume (in JOL, wei)
     * @return limit Maximum JOL that can be sold today
     */
    function dailySellLimit(
        uint256 _dailyProduction,
        uint256 _marketVolume
    ) public pure returns (uint256 limit) {
        if (_dailyProduction == 0) return 0;

        // sqrt(dailyProduction) × marketVolume / 1,000,000
        uint256 sqrtProd = sqrt(_dailyProduction);
        uint256 sqrtLimit = sqrtProd * _marketVolume / SQRT_DIVISOR;

        // Minimum guarantee: 0.5% of daily production
        uint256 minGuarantee = _dailyProduction * MIN_SELL_BPS / BPS_BASE;

        // Maximum cap: 5% of daily production
        uint256 maxCap = _dailyProduction * MAX_SELL_BPS / BPS_BASE;

        // Clamp
        limit = sqrtLimit;
        if (limit < minGuarantee) limit = minGuarantee;
        if (limit > maxCap) limit = maxCap;
    }

    /**
     * @notice Check and record a sell against the daily limit.
     * @param _seller The seller's address
     * @param _amount Amount being sold (in JOL, wei)
     * @param _dailyProduction Producer's daily output
     * @param _marketVolume Current daily market volume
     * @return allowed Whether the sell is within limits
     */
    function checkSell(
        address _seller,
        uint256 _amount,
        uint256 _dailyProduction,
        uint256 _marketVolume
    ) external returns (bool allowed) {
        uint256 today = block.timestamp / 1 days;
        uint256 limit = dailySellLimit(_dailyProduction, _marketVolume);
        uint256 alreadySold = dailySold[_seller][today];

        allowed = alreadySold + _amount <= limit;

        if (allowed) {
            dailySold[_seller][today] += _amount;
        }

        emit SellLimitChecked(_seller, _amount, limit, allowed);
    }

    /**
     * @notice Get remaining sell allowance for today.
     */
    function remainingAllowance(
        address _seller,
        uint256 _dailyProduction,
        uint256 _marketVolume
    ) external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 limit = dailySellLimit(_dailyProduction, _marketVolume);
        uint256 sold = dailySold[_seller][today];
        if (sold >= limit) return 0;
        return limit - sold;
    }

    /**
     * @notice Integer square root (Babylonian method).
     */
    function sqrt(uint256 x) public pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
