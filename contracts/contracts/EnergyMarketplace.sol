// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./JOLToken.sol";
import "./EnergyPeg.sol";

/**
 * @title EnergyMarketplace
 * @notice P2P marketplace for trading energy credits.
 * Producers list energy credits, buyers purchase with JOL.
 * 1% of trades is burned (deflationary), 0.5% commission.
 */
contract EnergyMarketplace is AccessControl, ReentrancyGuard, Pausable {
    JOLToken public jolToken;
    EnergyPeg public energyPeg;

    uint256 public constant BURN_BPS = 150;          // 1.5% burn (all fees burned — no founder cut)

    struct Listing {
        uint256 id;
        address seller;
        uint256 kWh;                // energy credits offered
        uint256 pricePerKWh;        // JOL per kWh (in wei)
        string energyType;          // "solar", "wind", "hydro"
        string country;
        uint256 createdAt;
        bool active;
    }

    uint256 public nextListingId = 1;
    mapping(uint256 => Listing) public listings;

    // Stats
    uint256 public totalTradeVolume;
    uint256 public totalBurned;
    uint256 public totalTrades;

    event ListingCreated(uint256 indexed id, address indexed seller, uint256 kWh, uint256 pricePerKWh);
    event ListingCancelled(uint256 indexed id);
    event TradExecuted(uint256 indexed listingId, address indexed buyer, uint256 kWh, uint256 totalPrice);
    event FeeBurned(uint256 amount);

    constructor(address admin, address _jolToken, address _energyPeg) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
        energyPeg = EnergyPeg(_energyPeg);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    /**
     * @notice List energy credits for sale
     */
    function createListing(
        uint256 _kWh,
        uint256 _pricePerKWh,
        string calldata _energyType,
        string calldata _country
    ) external whenNotPaused returns (uint256) {
        require(_kWh > 0, "Zero kWh");
        require(_pricePerKWh > 0, "Zero price");

        // Verify seller has energy credits in the peg registry
        if (address(energyPeg) != address(0)) {
            (, , , , , , uint256 availableKWh, ) = energyPeg.producers(msg.sender);
            require(availableKWh >= _kWh, "Insufficient energy credits in registry");
        }

        uint256 id = nextListingId++;
        listings[id] = Listing({
            id: id,
            seller: msg.sender,
            kWh: _kWh,
            pricePerKWh: _pricePerKWh,
            energyType: _energyType,
            country: _country,
            createdAt: block.timestamp,
            active: true
        });

        emit ListingCreated(id, msg.sender, _kWh, _pricePerKWh);
        return id;
    }

    /**
     * @notice Buy energy credits from a listing
     */
    function buy(uint256 _listingId, uint256 _kWh) external nonReentrant whenNotPaused {
        Listing storage listing = listings[_listingId];
        require(listing.active, "Listing not active");
        require(_kWh > 0 && _kWh <= listing.kWh, "Invalid kWh amount");

        uint256 totalPrice = _kWh * listing.pricePerKWh;

        // Calculate fees — all fees burned, no founder cut
        uint256 burnAmount = (totalPrice * BURN_BPS) / 10000;
        uint256 sellerReceives = totalPrice - burnAmount;

        // Effects (state changes BEFORE external calls)
        listing.kWh -= _kWh;
        if (listing.kWh == 0) listing.active = false;
        totalTradeVolume += totalPrice;
        totalBurned += burnAmount;
        totalTrades++;

        // Interactions (external calls AFTER state changes)
        require(
            jolToken.transferFrom(msg.sender, listing.seller, sellerReceives),
            "Seller transfer failed"
        );
        require(
            jolToken.transferFrom(msg.sender, address(this), burnAmount),
            "Fee transfer failed"
        );
        jolToken.burn(burnAmount);

        emit TradExecuted(_listingId, msg.sender, _kWh, totalPrice);
        emit FeeBurned(burnAmount);
    }

    /**
     * @notice Cancel own listing
     */
    function cancelListing(uint256 _listingId) external {
        Listing storage listing = listings[_listingId];
        require(listing.seller == msg.sender, "Not seller");
        require(listing.active, "Not active");
        listing.active = false;
        emit ListingCancelled(_listingId);
    }

    // ─── Views ─────────────────────────────────────────────────────

    function getActiveListing(uint256 _id) external view returns (
        address seller,
        uint256 kWh,
        uint256 pricePerKWh,
        string memory energyType,
        string memory country
    ) {
        Listing storage l = listings[_id];
        require(l.active, "Not active");
        return (l.seller, l.kWh, l.pricePerKWh, l.energyType, l.country);
    }
}
