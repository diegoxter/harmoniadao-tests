const { expect } = require('chai')
const { BigNumber } = require('ethers')
const { artifacts, contract, ethers, network } = require('hardhat')
require('@nomicfoundation/hardhat-chai-matchers')

describe('AllowancesV1', function () {
    async function deployMockToken(name, ticker) {
        const [ alice ] = await ethers.getSigners()

        const tokenFactory = await ethers.getContractFactory('HTA1')
        const Token = await tokenFactory.deploy(
            10000000000000000000n,
            name,
            ticker
        )
        await Token.deployed()
        expect(await Token.balanceOf(alice.address)).to.equal(
            10000000000000000000n
        )

        return { Token }
    }
    async function deployAllowance(CLD) {
        const daoFactory = await ethers.getContractFactory('FakeDAO')
        const DAO = await daoFactory.deploy()
        await DAO.deployed()

        const allowanceFactory = await ethers.getContractFactory('HarmoniaDAO_Allowances')
        const AllowanceV1 = await allowanceFactory.deploy(DAO.address, CLD.address)
        await AllowanceV1.deployed()

        return { AllowanceV1 }
    };

    it("gets successfully deployed", async function () {
        const { Token } = await deployMockToken('MockCLD', 'MCLD')
        const { AllowanceV1 } = await deployAllowance(Token)
    });

    // it("helpful comment, add more tests here", async function () {
    // });
});