// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MachineRegistry
 * @notice On-chain identity for machines: IoT devices, AI agents, EVs,
 * smart meters, solar inverters, wind turbines.
 *
 * Every machine that transacts on JOULE has a decentralized identity (DID).
 * This enables:
 * - Machine-to-machine payments (EV pays charger, AI pays compute)
 * - Reputation system (reliable machines get better rates)
 * - Access control (only verified machines can access services)
 * - Audit trail (every machine action is traceable)
 *
 * DID format: did:joule:<chainId>:<address>
 */
contract MachineRegistry is AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");

    enum MachineType {
        IoTSensor,          // 0: temperature, humidity, etc.
        SmartMeter,         // 1: energy meter
        SolarInverter,      // 2: solar panel controller
        WindTurbine,        // 3: wind turbine controller
        EVCharger,          // 4: EV charging station
        ElectricVehicle,    // 5: EV itself
        AIAgent,            // 6: autonomous AI agent
        ComputeNode,        // 7: GPU/CPU compute provider
        StorageBattery,     // 8: energy storage
        SmartHome,          // 9: home automation hub
        IndustrialDevice    // 10: factory equipment
    }

    enum MachineStatus { Registered, Verified, Suspended, Retired }

    struct Machine {
        uint256 id;
        address owner;         // human or organization that owns the machine
        address wallet;        // machine's own wallet for autonomous payments
        MachineType machineType;
        MachineStatus status;
        string manufacturer;
        string model;
        bytes32 firmwareHash;  // hash of current firmware (integrity check)
        bytes4 geohash;        // 4-char geohash (~20 km precision, privacy-safe)
        uint256 registeredAt;
        uint256 verifiedAt;
        // Reputation
        uint256 totalTransactions;
        uint256 successfulTransactions;
        uint256 totalEnergyKWh;    // energy produced or consumed
        uint256 reputationScore;   // 0-10000 (basis points, 10000 = perfect)
    }

    uint256 public nextMachineId = 1;
    mapping(uint256 => Machine) public machines;
    mapping(address => uint256) public walletToMachine; // machine wallet → machine ID
    mapping(address => uint256[]) public ownerMachines;

    // Stats
    uint256 public totalMachines;
    uint256 public verifiedMachines;
    uint256 public totalMachineTransactions;

    event MachineRegistered(uint256 indexed id, address owner, address wallet, MachineType machineType);
    event MachineVerified(uint256 indexed id);
    event MachineSuspended(uint256 indexed id, string reason);
    event MachineTransactionRecorded(uint256 indexed id, uint256 amount, bool success);
    event ReputationUpdated(uint256 indexed id, uint256 newScore);
    event FirmwareUpdated(uint256 indexed id, bytes32 newHash);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Register a machine with its own wallet
     */
    function registerMachine(
        address _wallet,
        MachineType _type,
        string calldata _manufacturer,
        string calldata _model,
        bytes32 _firmwareHash,
        bytes4 _geohash
    ) external returns (uint256) {
        require(_wallet != address(0), "Invalid wallet");
        require(walletToMachine[_wallet] == 0, "Wallet already registered");

        uint256 id = nextMachineId++;
        machines[id] = Machine({
            id: id,
            owner: msg.sender,
            wallet: _wallet,
            machineType: _type,
            status: MachineStatus.Registered,
            manufacturer: _manufacturer,
            model: _model,
            firmwareHash: _firmwareHash,
            geohash: _geohash,
            registeredAt: block.timestamp,
            verifiedAt: 0,
            totalTransactions: 0,
            successfulTransactions: 0,
            totalEnergyKWh: 0,
            reputationScore: 5000 // start at 50%
        });

        walletToMachine[_wallet] = id;
        ownerMachines[msg.sender].push(id);
        totalMachines++;

        emit MachineRegistered(id, msg.sender, _wallet, _type);
        return id;
    }

    /**
     * @notice Verify a machine (verifier only — confirms physical existence)
     */
    function verifyMachine(uint256 _id) external onlyRole(VERIFIER_ROLE) {
        Machine storage m = machines[_id];
        require(m.id != 0, "Not found");
        require(m.status == MachineStatus.Registered, "Not in registered state");

        m.status = MachineStatus.Verified;
        m.verifiedAt = block.timestamp;
        verifiedMachines++;

        emit MachineVerified(_id);
    }

    /**
     * @notice Record a transaction by a machine (called by payment contracts)
     */
    function recordTransaction(
        address _machineWallet,
        uint256 _amount,
        bool _success
    ) external onlyRole(RECORDER_ROLE) {
        uint256 id = walletToMachine[_machineWallet];
        if (id == 0) return; // unregistered machine, skip

        Machine storage m = machines[id];
        m.totalTransactions++;
        if (_success) {
            m.successfulTransactions++;
        }
        totalMachineTransactions++;

        // Update reputation: success rate as basis points
        if (m.totalTransactions > 0) {
            m.reputationScore = (m.successfulTransactions * 10000) / m.totalTransactions;
        }

        emit MachineTransactionRecorded(id, _amount, _success);
        emit ReputationUpdated(id, m.reputationScore);
    }

    /**
     * @notice Record energy production/consumption by a machine
     */
    function recordEnergy(address _machineWallet, uint256 _kWh) external onlyRole(RECORDER_ROLE) {
        uint256 id = walletToMachine[_machineWallet];
        if (id == 0) return;
        machines[id].totalEnergyKWh += _kWh;
    }

    /**
     * @notice Update firmware hash (owner only)
     */
    function updateFirmware(uint256 _id, bytes32 _newHash) external {
        Machine storage m = machines[_id];
        require(m.owner == msg.sender, "Not owner");
        m.firmwareHash = _newHash;
        emit FirmwareUpdated(_id, _newHash);
    }

    /**
     * @notice Suspend a machine (verifier)
     */
    function suspendMachine(uint256 _id, string calldata _reason) external onlyRole(VERIFIER_ROLE) {
        machines[_id].status = MachineStatus.Suspended;
        emit MachineSuspended(_id, _reason);
    }

    // ─── Views ─────────────────────────────────────────────────────

    function isVerified(address _wallet) external view returns (bool) {
        uint256 id = walletToMachine[_wallet];
        return id != 0 && machines[id].status == MachineStatus.Verified;
    }

    function getReputation(address _wallet) external view returns (uint256) {
        uint256 id = walletToMachine[_wallet];
        if (id == 0) return 0;
        return machines[id].reputationScore;
    }

    function getMachinesByOwner(address _owner) external view returns (uint256[] memory) {
        return ownerMachines[_owner];
    }

    /**
     * @notice Get machine DID string
     */
    function getDID(uint256 _id) external view returns (string memory) {
        require(machines[_id].id != 0, "Not found");
        // Returns format: did:joule:707070:<wallet_address>
        return string(abi.encodePacked(
            "did:joule:707070:",
            _toHexString(machines[_id].wallet)
        ));
    }

    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory data = abi.encodePacked(addr);
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2] = alphabet[uint8(data[i] >> 4)];
            str[3 + i * 2] = alphabet[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }
}
