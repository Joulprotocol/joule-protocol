// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title JOLToken
 * @notice Native JOULE token with burn mechanics and controlled minting.
 * On the JOULE L1 chain this wraps the native coin for DeFi compatibility.
 * On Ethereum it serves as the wrapped bridge token (wJOL).
 */
contract JOLToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    uint256 public constant MAX_SUPPLY = 210_000_000_000 ether; // 210B JOL
    address public constant BURN_ADDRESS = 0x0000000000000000000000000000000000000369;
    uint256 public totalBurned;

    // Burn tracking
    uint256 public burnFromFees;
    uint256 public burnFromMarketplace;
    uint256 public burnFromSlashing;
    uint256 public burnFromDeployments;

    event TokensBurned(address indexed from, uint256 amount, string reason);
    event SupplyMinted(address indexed to, uint256 amount, string reason);

    constructor(address admin) ERC20("JOULE", "JOL") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        // MINTER_ROLE granted only to contracts (PoEMining, EnergyPeg), never to addresses.
        // Admin sets up roles via grantRole() then renounces ADMIN for immutability.
    }

    /**
     * @notice Admin should call this after all roles are configured.
     * Makes the token contract fully immutable — no new minters/burners can be added.
     */
    function renounceAdmin() external onlyRole(DEFAULT_ADMIN_ROLE) {
        renounceRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Mint new JOL tokens (only by authorized minters — PoW/PoE reward contracts)
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "JOL: exceeds max supply");
        _mint(to, amount);
        emit SupplyMinted(to, amount, "mining");
    }

    /**
     * @notice Mint for specific purposes (ecosystem, dev fund)
     */
    function mintFor(
        address to,
        uint256 amount,
        string calldata reason
    ) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "JOL: exceeds max supply");
        _mint(to, amount);
        emit SupplyMinted(to, amount, reason);
    }

    /**
     * @notice Burn tokens — anyone can burn their own tokens
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        totalBurned += amount;
        emit TokensBurned(msg.sender, amount, "voluntary");
    }

    /**
     * @notice Protocol burn (fees, slashing, etc.)
     */
    function protocolBurn(
        address from,
        uint256 amount,
        string calldata reason
    ) external onlyRole(BURNER_ROLE) {
        _burn(from, amount);
        totalBurned += amount;

        bytes32 reasonHash = keccak256(bytes(reason));
        if (reasonHash == keccak256("fee")) burnFromFees += amount;
        else if (reasonHash == keccak256("marketplace")) burnFromMarketplace += amount;
        else if (reasonHash == keccak256("slashing")) burnFromSlashing += amount;
        else if (reasonHash == keccak256("deployment")) burnFromDeployments += amount;

        emit TokensBurned(from, amount, reason);
    }

    /**
     * @notice Remaining mintable supply
     */
    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }

    /**
     * @notice Circulating supply (total minted minus burned)
     */
    function circulatingSupply() external view returns (uint256) {
        return totalSupply(); // ERC20 totalSupply already accounts for burns
    }
}
