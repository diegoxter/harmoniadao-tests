/** @type import('hardhat/config').HardhatUserConfig */
require('dotenv').config()
require('@nomiclabs/hardhat-ethers')

const MNEMONIC = process.env.MNEMONIC

module.exports = {
    solidity: '0.8.17',
    mocha: {
        timeout: 100000000,
    },
    networks: {
        fantom_testnet: {
            url: `https://rpc.testnet.fantom.network/`,
            /*accounts: {
                mnemonic: MNEMONIC,
            },*/
            chainId: 4002,
        },
        matic_testnet: {
            url: `https://matic-mumbai.chainstacklabs.com`,
            /*accounts: {
                mnemonic: MNEMONIC,
            },*/
            chainId: 80001,
        },
    },
    settings: {
        optimizer: {
            enabled: true,
            runs: 200,
        },
    },
    paths: {
        sources: 'Harmonia_DAO_Protocol/',
    },
}
