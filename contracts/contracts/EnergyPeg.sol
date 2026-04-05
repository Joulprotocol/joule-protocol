// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./JOLToken.sol";

/**
 * @title EnergyPeg
 * @notice THE core value mechanism of JOULE.
 *
 * 1 JOL = 1 kWh of verified renewable energy.
 *
 * This is NOT a stablecoin peg. It's a FLOOR PRICE mechanism:
 * - Energy producers deposit verified kWh → receive 1 JOL per kWh
 * - Anyone holding JOL can redeem it for energy credits (1 JOL = 1 kWh)
 * - Energy credits are redeemable at participating producers
 * - Floor price = market price of 1 kWh (~0.20-0.30 EUR in EU)
 * - JOL can trade ABOVE the floor (speculation, scarcity, utility)
 * - JOL cannot sustainably trade BELOW the floor (arbitrage closes gap)
 *
 * As global energy prices rise → JOL floor rises.
 * As AI compute demand grows → energy demand grows → JOL floor rises.
 */
contract EnergyPeg is AccessControl, ReentrancyGuard {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant PRODUCER_ROLE = keccak256("PRODUCER_ROLE");

    JOLToken public jolToken;

    // Energy Reserve cap — shared with PoEMining (total 42B for energy)
    // EnergyPeg uses the Energy Reserve allocation (20% of supply)
    // This cap prevents unlimited minting via depositEnergy
    uint256 public constant MAX_PEG_MINT = 42_000_000_000 ether; // 20% of 210B

    // Energy Reserve: total kWh backing in the system
    uint256 public totalEnergyReserveKWh;
    uint256 public totalMintedFromEnergy;
    uint256 public totalRedeemedKWh;

    // Producer registry
    struct EnergyProducer {
        address producer;
        string name;
        string country;           // ISO 3166-1
        string energyType;        // "solar", "wind", "hydro"
        uint256 totalDeposited;   // kWh deposited lifetime
        uint256 totalRedeemed;    // kWh redeemed against this producer
        uint256 availableKWh;     // current redeemable balance
        bool active;
    }

    mapping(address => EnergyProducer) public producers;
    address[] public producerList;

    // Redemption tickets
    struct RedemptionTicket {
        uint256 id;
        address redeemer;
        address producer;
        uint256 kWh;
        uint256 createdAt;
        bool fulfilled;
    }

    uint256 public nextTicketId = 1;
    mapping(uint256 => RedemptionTicket) public tickets;
    mapping(address => uint256[]) public userTickets;

    // Price oracle (kWh price in USD cents, updated by oracle)
    uint256 public kWhPriceUSDCents = 25; // default 0.25 USD
    uint256 public lastPriceUpdate;

    event EnergyDeposited(address indexed producer, uint256 kWh, uint256 jolMinted);
    event EnergyRedeemed(address indexed redeemer, address indexed producer, uint256 kWh, uint256 jolBurned);
    event RedemptionTicketCreated(uint256 indexed ticketId, address redeemer, uint256 kWh);
    event RedemptionFulfilled(uint256 indexed ticketId, address producer);
    event PriceUpdated(uint256 newPriceUSDCents);
    event ProducerRegistered(address indexed producer, string name);

    constructor(address admin, address _jolToken) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        jolToken = JOLToken(_jolToken);
    }

    // ─── Producer Management ───────────────────────────────────────

    /**
     * @notice Register as an energy producer
     */
    function registerProducer(
        string calldata _name,
        string calldata _country,
        string calldata _energyType
    ) external {
        require(!producers[msg.sender].active, "Already registered");

        producers[msg.sender] = EnergyProducer({
            producer: msg.sender,
            name: _name,
            country: _country,
            energyType: _energyType,
            totalDeposited: 0,
            totalRedeemed: 0,
            availableKWh: 0,
            active: true
        });
        producerList.push(msg.sender);

        emit ProducerRegistered(msg.sender, _name);
    }

    // ─── THE PEG: Deposit Energy → Get JOL ─────────────────────────

    /**
     * @notice Deposit verified energy production, receive 1 JOL per kWh.
     * Called by oracle after verifying real-world energy production.
     *
     * This is the MINTING mechanism. New JOL only enters circulation
     * when REAL energy is produced and verified.
     */
    function depositEnergy(
        address _producer,
        uint256 _kWh
    ) external onlyRole(ORACLE_ROLE) {
        require(producers[_producer].active, "Not registered producer");
        require(_kWh > 0, "Zero kWh");

        // Check peg mint cap
        uint256 jolAmount = _kWh * 1 ether;
        require(totalMintedFromEnergy * 1 ether + jolAmount <= MAX_PEG_MINT, "Peg mint cap reached");

        // Update producer state
        producers[_producer].totalDeposited += _kWh;
        producers[_producer].availableKWh += _kWh;

        // Update global reserve
        totalEnergyReserveKWh += _kWh;
        totalMintedFromEnergy += _kWh;

        // Mint 1 JOL per kWh to producer — capped
        jolToken.mint(_producer, jolAmount);

        emit EnergyDeposited(_producer, _kWh, jolAmount);
    }

    // ─── THE PEG: Burn JOL → Get Energy Credit ─────────────────────

    /**
     * @notice Redeem JOL for energy credits.
     * Burns JOL and creates a redemption ticket against a producer.
     *
     * 1 JOL burned = 1 kWh credit at chosen producer.
     * This creates the FLOOR PRICE: if JOL trades below energy price,
     * arbitrageurs buy JOL and redeem for energy (profit).
     */
    function redeemForEnergy(
        address _producer,
        uint256 _kWh
    ) external nonReentrant {
        require(producers[_producer].active, "Producer not active");
        require(producers[_producer].availableKWh >= _kWh, "Insufficient producer capacity");
        require(_kWh > 0, "Zero kWh");

        uint256 jolAmount = _kWh * 1 ether;

        // Effects (state changes BEFORE external calls)
        producers[_producer].availableKWh -= _kWh;
        producers[_producer].totalRedeemed += _kWh;
        totalEnergyReserveKWh -= _kWh;
        totalRedeemedKWh += _kWh;

        // Create redemption ticket
        uint256 ticketId = nextTicketId++;

        // Burn JOL from redeemer (interaction AFTER state changes)
        jolToken.protocolBurn(msg.sender, jolAmount, "energy_redemption");
        tickets[ticketId] = RedemptionTicket({
            id: ticketId,
            redeemer: msg.sender,
            producer: _producer,
            kWh: _kWh,
            createdAt: block.timestamp,
            fulfilled: false
        });
        userTickets[msg.sender].push(ticketId);

        emit RedemptionTicketCreated(ticketId, msg.sender, _kWh);
        emit EnergyRedeemed(msg.sender, _producer, _kWh, jolAmount);
    }

    /**
     * @notice Producer marks redemption ticket as fulfilled
     */
    function fulfillRedemption(uint256 _ticketId) external {
        RedemptionTicket storage ticket = tickets[_ticketId];
        require(ticket.producer == msg.sender, "Not your ticket");
        require(!ticket.fulfilled, "Already fulfilled");

        ticket.fulfilled = true;
        emit RedemptionFulfilled(_ticketId, msg.sender);
    }

    // ─── Price Oracle ──────────────────────────────────────────────

    /**
     * @notice Update the reference kWh price (oracle only)
     */
    function updatePrice(uint256 _priceUSDCents) external onlyRole(ORACLE_ROLE) {
        require(_priceUSDCents > 0 && _priceUSDCents < 10000, "Invalid price");
        kWhPriceUSDCents = _priceUSDCents;
        lastPriceUpdate = block.timestamp;
        emit PriceUpdated(_priceUSDCents);
    }

    // ─── Views ─────────────────────────────────────────────────────

    /**
     * @notice Implied floor price of 1 JOL in USD cents
     */
    function floorPriceUSDCents() external view returns (uint256) {
        return kWhPriceUSDCents; // 1 JOL = 1 kWh = kWh price
    }

    /**
     * @notice Backing ratio: how much energy backs the circulating JOL
     */
    function backingRatio() external view returns (uint256) {
        uint256 circulating = jolToken.totalSupply();
        if (circulating == 0) return 0;
        return (totalEnergyReserveKWh * 1 ether * 10000) / circulating; // basis points
    }

    function getProducerCount() external view returns (uint256) {
        return producerList.length;
    }

    function getUserTickets(address _user) external view returns (uint256[] memory) {
        return userTickets[_user];
    }
}
