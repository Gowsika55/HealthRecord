// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MedicalRecords {
    address public owner;
    mapping(address => bool) public admins;
    mapping(address => bool) public operators;

    struct Record {
        string diagnosis;
        string treatment;
        string notes;
        string doctorName;
        address doctorAddress;
        uint256 timestamp;
        string ipfsHash;
        string reportUrl;
    }

    // Mapping to track approved doctors
    mapping(address => bool) public approvedDoctors;

    // Mapping to track patient access permissions: patientAddress => doctorAddress => hasAccess
    mapping(address => mapping(address => bool)) public hasAccess;

    // Mapping to store patient records: patientAddress => Record[]
    mapping(address => Record[]) private patientRecords;

    // Events for auditing
    event DoctorApproved(address indexed doctor, address indexed approvedBy);
    event DoctorRevoked(address indexed doctor, address indexed revokedBy);
    event AccessGranted(address indexed patient, address indexed doctor);
    event AccessRevoked(address indexed patient, address indexed doctor);
    event RecordAdded(
        address indexed patient,
        address indexed doctor,
        uint256 timestamp,
        string diagnosis,
        string treatment,
        string notes,
        string doctorName,
        string ipfsHash,
        string reportUrl
    );
    event AdminAuthorized(address indexed adminAddress);
    event AdminRemoved(address indexed adminAddress);
    event OperatorAuthorized(address indexed operatorAddress);
    event OperatorRemoved(address indexed operatorAddress);

    modifier onlyAdmin() {
        require(msg.sender == owner || admins[msg.sender], "Only admin can perform this action");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == owner || operators[msg.sender], "Only operator can perform this action");
        _;
    }

    modifier onlyAdminOrOperator() {
        require(
            msg.sender == owner || admins[msg.sender] || operators[msg.sender],
            "Caller is not authorized admin or operator"
        );
        _;
    }

    constructor() {
        owner = msg.sender;
        admins[msg.sender] = true;
        operators[msg.sender] = true;
    }

    // Role Management
    function authorizeAdmin(address _admin) external onlyAdminOrOperator {
        require(_admin != address(0), "Invalid address");
        admins[_admin] = true;
        emit AdminAuthorized(_admin);
    }

    function removeAdmin(address _admin) external onlyAdmin {
        require(_admin != owner, "Cannot remove contract owner");
        admins[_admin] = false;
        emit AdminRemoved(_admin);
    }

    function authorizeOperator(address _operator) external onlyAdmin {
        require(_operator != address(0), "Invalid address");
        operators[_operator] = true;
        emit OperatorAuthorized(_operator);
    }

    function removeOperator(address _operator) external onlyAdmin {
        operators[_operator] = false;
        emit OperatorRemoved(_operator);
    }

    // Doctor Verification: Admin MetaMask OR Operator
    function approveDoctor(address _doctor) external onlyAdminOrOperator {
        require(_doctor != address(0), "Invalid doctor address");
        approvedDoctors[_doctor] = true;
        emit DoctorApproved(_doctor, msg.sender);
    }

    function revokeDoctor(address _doctor) external onlyAdminOrOperator {
        require(_doctor != address(0), "Invalid doctor address");
        approvedDoctors[_doctor] = false;
        emit DoctorRevoked(_doctor, msg.sender);
    }

    // Patient Access Delegation: Admin MetaMask OR Operator
    function grantAccess(address _patient, address _doctor) external onlyAdminOrOperator {
        require(_patient != address(0) && _doctor != address(0), "Invalid address");
        hasAccess[_patient][_doctor] = true;
        emit AccessGranted(_patient, _doctor);
    }

    function revokeAccess(address _patient, address _doctor) external onlyAdminOrOperator {
        require(_patient != address(0) && _doctor != address(0), "Invalid address");
        hasAccess[_patient][_doctor] = false;
        emit AccessRevoked(_patient, _doctor);
    }

    // Medical Record Entry: Admin MetaMask OR Operator
    function addRecord(
        address _doctor,
        address _patient,
        string calldata _diagnosis,
        string calldata _treatment,
        string calldata _notes,
        string calldata _doctorName,
        string calldata _ipfsHash,
        string calldata _reportUrl
    ) external onlyAdminOrOperator {
        require(approvedDoctors[_doctor], "Doctor is not approved on-chain");
        require(hasAccess[_patient][_doctor], "Doctor does not have consent access to this patient");
        
        patientRecords[_patient].push(Record({
            diagnosis: _diagnosis,
            treatment: _treatment,
            notes: _notes,
            doctorName: _doctorName,
            doctorAddress: _doctor,
            timestamp: block.timestamp,
            ipfsHash: _ipfsHash,
            reportUrl: _reportUrl
        }));

        emit RecordAdded(
            _patient,
            _doctor,
            block.timestamp,
            _diagnosis,
            _treatment,
            _notes,
            _doctorName,
            _ipfsHash,
            _reportUrl
        );
    }

    // View function to retrieve records
    function getRecords(address _patient) external view returns (Record[] memory) {
        return patientRecords[_patient];
    }

    // Helper functions to check roles
    function isAuthorizedAdmin(address _account) external view returns (bool) {
        return _account == owner || admins[_account];
    }

    function isAuthorizedOperator(address _account) external view returns (bool) {
        return _account == owner || operators[_account];
    }
}
