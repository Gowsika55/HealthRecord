require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: process.env.PRIVATE_KEY && process.env.PRIVATE_KEY.trim().length >= 64
        ? [process.env.PRIVATE_KEY.trim().startsWith("0x") ? process.env.PRIVATE_KEY.trim() : `0x${process.env.PRIVATE_KEY.trim()}`]
        : []
    }
  }
};
