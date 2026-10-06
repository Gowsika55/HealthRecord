const hre = require("hardhat");

async function main() {
  console.log("Deploying MedicalRecords contract...");

  const MedicalRecords = await hre.ethers.getContractFactory("MedicalRecords");
  const medicalRecords = await MedicalRecords.deploy();

  await medicalRecords.waitForDeployment();

  const address = await medicalRecords.getAddress();
  console.log(`MedicalRecords deployed to: ${address}`);
  
  // We'll write the address and ABI to a json file in the frontend and backend so they can read it easily.
  const fs = require("fs");
  const path = require("path");

  const contractsDir = path.join(__dirname, "..", "frontend", "src", "contracts");
  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
  }

  const backendContractsDir = path.join(__dirname, "..", "backend", "contracts");
  if (!fs.existsSync(backendContractsDir)) {
    fs.mkdirSync(backendContractsDir, { recursive: true });
  }

  const contractArtifact = hre.artifacts.readArtifactSync("MedicalRecords");

  const deploymentTx = medicalRecords.deploymentTransaction();
  let deploymentBlock = null;
  if (deploymentTx) {
    const receipt = await deploymentTx.wait();
    deploymentBlock = receipt ? receipt.blockNumber : null;
  }
  if (!deploymentBlock) {
    try {
      deploymentBlock = await hre.ethers.provider.getBlockNumber();
    } catch {
      deploymentBlock = 0;
    }
  }

  const networkName = hre.network.name;
  console.log(`Network: ${networkName}, Deployed in Block: #${deploymentBlock}`);

  const data = JSON.stringify({
    address: address,
    network: networkName,
    deploymentBlock: deploymentBlock,
    abi: contractArtifact.abi
  }, null, 2);

  fs.writeFileSync(path.join(contractsDir, "MedicalRecords.json"), data);
  fs.writeFileSync(path.join(backendContractsDir, "MedicalRecords.json"), data);
  
  console.log("Contract address and ABI written to frontend/src/contracts/MedicalRecords.json and backend/contracts/MedicalRecords.json");
  if (networkName === "sepolia") {
    console.log(`\n🎉 Success! Contract deployed to Sepolia Testnet!`);
    console.log(`🔗 Sepolia Etherscan Contract Link: https://sepolia.etherscan.io/address/${address}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
