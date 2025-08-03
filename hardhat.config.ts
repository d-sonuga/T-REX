import '@xyrusworx/hardhat-solidity-json';
import '@nomicfoundation/hardhat-toolbox';
import { HardhatUserConfig } from 'hardhat/config';
import '@openzeppelin/hardhat-upgrades';
import 'solidity-coverage';
import '@nomiclabs/hardhat-solhint';
import '@primitivefi/hardhat-dodoc';

require('dotenv').config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.17',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_URL,
      accounts: [
        process.env.PRIVATE_KEY_1,
        process.env.PRIVATE_KEY_2,
        process.env.PRIVATE_KEY_3,
        process.env.PRIVATE_KEY_4,
        process.env.PRIVATE_KEY_5,
        process.env.PRIVATE_KEY_6,
        process.env.PRIVATE_KEY_7,
        process.env.PRIVATE_KEY_8,
        process.env.PRIVATE_KEY_9,
      ],
      gasLimit: 10_000_000,
    },
    duskevm: {
      url: 'http://l2-rpc.evm-test.dusk.network',
      accounts: [
        process.env.PRIVATE_KEY_1,
        process.env.PRIVATE_KEY_2,
        process.env.PRIVATE_KEY_3,
        process.env.PRIVATE_KEY_4,
        process.env.PRIVATE_KEY_5,
        process.env.PRIVATE_KEY_6,
        process.env.PRIVATE_KEY_7,
        process.env.PRIVATE_KEY_8,
        process.env.PRIVATE_KEY_9,
      ],
      gasPrice: 1_000_000_000,
    },
  },
  gasReporter: {
    enabled: true,
  },
  dodoc: {
    runOnCompile: false,
    debugMode: true,
    outputDir: "./docgen",
    freshOutput: true,
  },
};

export default config;
