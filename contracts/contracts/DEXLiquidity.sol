// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./JOLToken.sol";

/**
 * @title DEXLiquidity
 * @notice Launch-day DEX liquidity provisioning for Uniswap v3.
 *
 * Energy producers must be able to sell from day one.
 * Without liquidity, joining is pointless. This ensures the ring is complete.
 *
 * Allocation: 3% of total supply = 6,300,000 JOL
 *   Pool A: JOL/USDC — 60% (3,780,000 JOL)
 *   Pool B: JOL/ETH  — 40% (2,520,000 JOL)
 *
 * Uniswap v3 concentrated liquidity:
 *   Fee tier: 0.3% (3000) — standard tier, deepest liquidity
 *   Price range: 0.10 – 2.00 USDC per JOL
 *
 * This contract holds the DEX allocation and provisions it
 * to Uniswap v3 pools via admin-controlled deployment.
 * Multisig (3/5 Gnosis Safe) controls the release.
 */
contract DEXLiquidity is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant PROVISIONER_ROLE = keccak256("PROVISIONER_ROLE");

    JOLToken public jolToken;

    // 3% of 210M = 6.3M JOL total DEX allocation
    uint256 public constant TOTAL_DEX_ALLOCATION = 6_300_000 ether;

    // Pool split
    uint256 public constant POOL_A_BPS = 6000;  // 60% → JOL/USDC
    uint256 public constant POOL_B_BPS = 4000;  // 40% → JOL/ETH
    uint256 public constant BPS_BASE = 10000;

    // Uniswap v3 fee tier
    uint24 public constant FEE_TIER = 3000;     // 0.3%

    // Price range in USDC (scaled by 1e6 for USDC decimals)
    uint256 public constant PRICE_LOWER = 100000;   // 0.10 USDC
    uint256 public constant PRICE_UPPER = 2000000;   // 2.00 USDC

    // Pool addresses (set after Uniswap pool creation)
    address public poolJOLUSDC;
    address public poolJOLETH;

    // Provisioning state
    uint256 public provisionedPoolA;
    uint256 public provisionedPoolB;
    bool public poolAProvisioned;
    bool public poolBProvisioned;

    event PoolAddressSet(string pool, address poolAddress);
    event LiquidityProvisioned(string pool, uint256 jolAmount);
    event EmergencyWithdraw(address indexed to, uint256 amount);

    constructor(address admin, address _jolToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PROVISIONER_ROLE, admin);
        jolToken = JOLToken(_jolToken);
    }

    /**
     * @notice Get JOL allocation for Pool A (JOL/USDC).
     * 60% of 6.3B = 3,780,000,000 JOL
     */
    function poolAAllocation() public pure returns (uint256) {
        return TOTAL_DEX_ALLOCATION * POOL_A_BPS / BPS_BASE;
    }

    /**
     * @notice Get JOL allocation for Pool B (JOL/ETH).
     * 40% of 6.3B = 2,520,000,000 JOL
     */
    function poolBAllocation() public pure returns (uint256) {
        return TOTAL_DEX_ALLOCATION * POOL_B_BPS / BPS_BASE;
    }

    /**
     * @notice Set Uniswap v3 pool addresses after creation.
     * Called by multisig after pools are deployed on Uniswap.
     */
    function setPoolAddresses(
        address _poolJOLUSDC,
        address _poolJOLETH
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_poolJOLUSDC != address(0) && _poolJOLETH != address(0), "Zero address");
        poolJOLUSDC = _poolJOLUSDC;
        poolJOLETH = _poolJOLETH;
        emit PoolAddressSet("JOL/USDC", _poolJOLUSDC);
        emit PoolAddressSet("JOL/ETH", _poolJOLETH);
    }

    /**
     * @notice Provision JOL to Pool A (JOL/USDC).
     * Transfers 60% of DEX allocation to the pool router/position manager.
     * @param _recipient Address to receive JOL (Uniswap position manager or router)
     */
    function provisionPoolA(address _recipient) external onlyRole(PROVISIONER_ROLE) {
        require(!poolAProvisioned, "Pool A already provisioned");
        require(_recipient != address(0), "Zero recipient");

        uint256 amount = poolAAllocation();
        require(jolToken.balanceOf(address(this)) >= amount, "Insufficient balance");

        poolAProvisioned = true;
        provisionedPoolA = amount;

        IERC20(address(jolToken)).safeTransfer(_recipient, amount);

        emit LiquidityProvisioned("JOL/USDC", amount);
    }

    /**
     * @notice Provision JOL to Pool B (JOL/ETH).
     * Transfers 40% of DEX allocation to the pool router/position manager.
     * @param _recipient Address to receive JOL (Uniswap position manager or router)
     */
    function provisionPoolB(address _recipient) external onlyRole(PROVISIONER_ROLE) {
        require(!poolBProvisioned, "Pool B already provisioned");
        require(_recipient != address(0), "Zero recipient");

        uint256 amount = poolBAllocation();
        require(jolToken.balanceOf(address(this)) >= amount, "Insufficient balance");

        poolBProvisioned = true;
        provisionedPoolB = amount;

        IERC20(address(jolToken)).safeTransfer(_recipient, amount);

        emit LiquidityProvisioned("JOL/ETH", amount);
    }

    /**
     * @notice Emergency withdraw — multisig only.
     * Only usable if pools haven't been provisioned yet.
     */
    function emergencyWithdraw(address _to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!poolAProvisioned && !poolBProvisioned, "Already provisioned");
        uint256 balance = jolToken.balanceOf(address(this));
        require(balance > 0, "No balance");

        IERC20(address(jolToken)).safeTransfer(_to, balance);
        emit EmergencyWithdraw(_to, balance);
    }

    /**
     * @notice Check if both pools are fully provisioned.
     */
    function fullyProvisioned() external view returns (bool) {
        return poolAProvisioned && poolBProvisioned;
    }

    /**
     * @notice Remaining JOL in this contract.
     */
    function remainingBalance() external view returns (uint256) {
        return jolToken.balanceOf(address(this));
    }
}
