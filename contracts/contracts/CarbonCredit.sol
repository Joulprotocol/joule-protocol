// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./EnergyRegistry.sol";

/**
 * @title CarbonCredit
 * @notice Tokenized carbon credits as NFTs, backed by verified renewable energy.
 *
 * EU ETS market: 114 BILLION EUR/year. Companies MUST buy carbon credits.
 * This is not optional — it's LAW.
 *
 * Each CarbonCredit NFT represents:
 * - Verified production of X kWh renewable energy
 * - Avoided CO2 emissions (using EU grid emission factor)
 * - Auditable on-chain proof of origin (producer, location, time, type)
 *
 * EU average grid emission factor: ~0.23 kg CO2/kWh
 * So 1,000 kWh of solar = ~230 kg CO2 avoided = 0.23 tonnes
 * EU ETS carbon price: ~70-100 EUR/tonne
 *
 * These credits can be:
 * - Traded on JOULE marketplace
 * - Retired (burned) for compliance
 * - Bundled for institutional buyers
 * - Verified by third-party auditors
 */
contract CarbonCredit is ERC721, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    // EU average grid emission factor: 230g CO2/kWh = 230000 mg/kWh
    uint256 public constant EU_EMISSION_FACTOR_MG_PER_KWH = 230_000;
    uint256 public constant MAX_CREDITS = 1_000_000; // max 1M carbon credits

    struct Credit {
        uint256 id;
        address producer;
        uint256 energyKWh;        // verified kWh
        uint256 co2AvoidedGrams;  // calculated CO2 avoided
        string energyType;        // "solar", "wind", "hydro"
        string country;           // ISO 3166-1
        uint256 productionStart;  // period start
        uint256 productionEnd;    // period end
        uint256 mintedAt;
        bool retired;             // burned for compliance
        bool audited;             // verified by third-party
        string auditorNote;
    }

    uint256 public nextCreditId = 1;
    mapping(uint256 => Credit) public credits;

    // Stats
    uint256 public totalCreditsIssued;
    uint256 public totalCreditsRetired;
    uint256 public totalKWhCertified;
    uint256 public totalCO2AvoidedKg;

    event CreditIssued(uint256 indexed id, address producer, uint256 kWh, uint256 co2Grams);
    event CreditRetired(uint256 indexed id, address retiredBy, string reason);
    event CreditAudited(uint256 indexed id, address auditor, string note);

    constructor(address admin) ERC721("JOULE Carbon Credit", "JCC") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    /**
     * @notice Issue a carbon credit NFT for verified energy production.
     * Called after oracle verification of real energy output.
     */
    function issueCredit(
        address _producer,
        uint256 _energyKWh,
        string calldata _energyType,
        string calldata _country,
        uint256 _periodStart,
        uint256 _periodEnd
    ) external onlyRole(MINTER_ROLE) whenNotPaused returns (uint256) {
        require(_producer != address(0), "Zero address");
        require(_energyKWh > 0, "Zero energy");
        require(_periodEnd > _periodStart, "Invalid period");
        require(totalCreditsIssued < MAX_CREDITS, "Max credits reached");

        // Calculate CO2 avoided
        uint256 co2Grams = (_energyKWh * EU_EMISSION_FACTOR_MG_PER_KWH) / 1000;

        uint256 id = nextCreditId++;
        credits[id] = Credit({
            id: id,
            producer: _producer,
            energyKWh: _energyKWh,
            co2AvoidedGrams: co2Grams,
            energyType: _energyType,
            country: _country,
            productionStart: _periodStart,
            productionEnd: _periodEnd,
            mintedAt: block.timestamp,
            retired: false,
            audited: false,
            auditorNote: ""
        });

        _mint(_producer, id);

        totalCreditsIssued++;
        totalKWhCertified += _energyKWh;
        totalCO2AvoidedKg += co2Grams / 1000;

        emit CreditIssued(id, _producer, _energyKWh, co2Grams);
        return id;
    }

    /**
     * @notice Retire (burn) a carbon credit for compliance.
     * Once retired, it can NEVER be traded again.
     * This is how companies offset their emissions.
     */
    function retireCredit(uint256 _id, string calldata _reason) external {
        require(ownerOf(_id) == msg.sender, "Not owner");
        require(!credits[_id].retired, "Already retired");

        credits[_id].retired = true;
        totalCreditsRetired++;

        // Don't actually burn the NFT — keep it as proof of retirement
        // but mark it as retired so it can't be transferred

        emit CreditRetired(_id, msg.sender, _reason);
    }

    /**
     * @notice Third-party auditor verifies a credit
     */
    function auditCredit(uint256 _id, string calldata _note) external onlyRole(AUDITOR_ROLE) {
        require(!credits[_id].audited, "Already audited");
        credits[_id].audited = true;
        credits[_id].auditorNote = _note;
        emit CreditAudited(_id, msg.sender, _note);
    }

    /**
     * @notice Override transfer to prevent trading of retired credits
     */
    function _beforeTokenTransfer(address from, address to, uint256 tokenId, uint256 batchSize) internal override {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        if (from != address(0) && to != address(0)) { // skip mint/burn
            require(!credits[tokenId].retired, "Retired credit cannot be transferred");
        }
    }

    // ─── Views ─────────────────────────────────────────────────────

    /**
     * @notice Get total CO2 offset in tonnes
     */
    function totalCO2OffsetTonnes() external view returns (uint256) {
        return totalCO2AvoidedKg / 1000;
    }

    /**
     * @notice Get credit details
     */
    function getCreditDetails(uint256 _id) external view returns (
        address producer,
        uint256 energyKWh,
        uint256 co2AvoidedGrams,
        string memory energyType,
        string memory country,
        bool retired,
        bool audited
    ) {
        Credit storage c = credits[_id];
        return (c.producer, c.energyKWh, c.co2AvoidedGrams, c.energyType, c.country, c.retired, c.audited);
    }

    /**
     * @notice Check interface support (ERC721 + AccessControl)
     */
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
