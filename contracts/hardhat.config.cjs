require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    jouleTestnet: {
      url: "http://127.0.0.1:8547",
      chainId: 707070,
      // TEST KEY ONLY — Hardhat default account #0, never use in production
      accounts: ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"],
    },
    hardhat: {
      chainId: 707070,
    },
  },
};
