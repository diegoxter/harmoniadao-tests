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
    async function deployAllowance() {
        const [ alice, bob, david, erin, maria ] = await ethers.getSigners()
        const daoFactory = await ethers.getContractFactory('FakeDAO')
        const DAO = await daoFactory.deploy()
        await DAO.deployed()

        const allowanceFactory = await ethers.getContractFactory('HarmoniaDAO_Allowances')
        const AllowanceV1 = await allowanceFactory.deploy(DAO.address)
        await AllowanceV1.deployed()
        // Lets connect both Allowances and DAO
        await DAO.connect(alice).SetAllowancesAddress(AllowanceV1.address)

        // Let's set a test ether grant
        const TestValue = ethers.utils.parseEther('1.0')

        await DAO.connect(alice).RegisterAllowance(
            [erin.address, maria.address],
            true,
            TestValue,
            '0x0000000000000000000000000000000000000000',
            5,
            5)

        return { AllowanceV1 }
    };

    it("gets successfully deployed", async function () {
        const { AllowanceV1 } = await deployAllowance()
    });

    it("allows each dev to reclame the allowance", async function () {
    });

    it("allows each dev to reclame the allowance respecting grant state", async function () {
    });

    it("forgives debt, virtually emptying any grant", async function () {
    });

    // it("helpful comment, add more tests here", async function () {
    // });
});