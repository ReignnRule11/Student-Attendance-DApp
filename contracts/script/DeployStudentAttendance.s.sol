// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StudentAttendance } from "../src/StudentAttendance.sol";

interface VmDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Explicit, Sepolia-only deployment entry point.
/// @dev Uses Foundry cheatcodes directly; no forge-std dependency is required.
contract DeployStudentAttendance {
    VmDeploy private constant vm =
        VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;

    event ContractDeployed(address indexed contractAddress, address indexed admin, uint256 chainId);

    function run() external returns (StudentAttendance deployed) {
        require(block.chainid == SEPOLIA_CHAIN_ID, "deployment restricted to Sepolia");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address expectedDeployer = vm.envOr("EXPECTED_DEPLOYER_ADDRESS", address(0));

        require(deployer != address(0), "invalid deployer");
        require(
            expectedDeployer == address(0) || deployer == expectedDeployer,
            "unexpected deployer address"
        );

        vm.startBroadcast(deployerKey);
        deployed = new StudentAttendance();
        vm.stopBroadcast();

        require(deployed.admin() == deployer, "deployer is not contract admin");
        require(deployed.instructors(deployer), "deployer is not initial instructor");

        emit ContractDeployed(address(deployed), deployer, block.chainid);
    }
}
