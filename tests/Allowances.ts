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
        const [ alice, bob ] = await ethers.getSigners()
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

        await expect(DAO.connect(alice).RegisterNewAllowance(
            bob.address,
            true,
            TestValue,
            '0x0000000000000000000000000000000000000000',
            5,
            7)).to.emit(AllowanceV1, 'NewAllowance')

        // Sending ether for these tests
        await alice.sendTransaction({
            to: AllowanceV1.address,
            value: TestValue,
          });

        await expect(await ethers.provider.getBalance(
            AllowanceV1.address
        )).to.equal(TestValue)

        return { DAO, AllowanceV1, TestValue }
    };
/*
    it("gets successfully deployed", async function () {
        const { AllowanceV1 } = await deployAllowance()
        const AllowanceData = await AllowanceV1.GrantList(0)

        //console.log(AllowanceData)
    });

    it("allows the dev to reclame the allowance, respecting the time between installments", async function () {
        const [ alice, bob, david, erin ] = await ethers.getSigners()
        const { AllowanceV1, TestValue } = await deployAllowance()
        const AllowanceData = await AllowanceV1.GrantList(0)

        const BobOGEtherBalance = await ethers.provider.getBalance(bob.address)
        // Cant reclaim yet
        await expect(AllowanceV1.connect(bob).ReclameAllowance(0))
        .to.be.revertedWith('ReclameAllowance: Not enough time has passed since last withdraw')
        // Not an allowed dev
        await expect(AllowanceV1.connect(alice).ReclameAllowance(0))
        .to.be.revertedWith('ReclameAllowance: You are not the owner of this grant')
        await expect(AllowanceV1.connect(erin).ReclameAllowance(0))
        .to.be.revertedWith('ReclameAllowance: You are not the owner of this grant')
        
        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(3500)
        
        await expect(AllowanceV1.connect(bob).ReclameAllowance(0)).to.emit(AllowanceV1, 'AllowanceReclamed')
        await expect(await ethers.provider.getBalance(bob.address)).to.at.within(
            BigInt(BobOGEtherBalance) + ((BigInt(TestValue) / BigInt(2)) / BigInt(AllowanceData[7])),
            BigInt(BobOGEtherBalance) + (BigInt(TestValue) / BigInt(AllowanceData[7])))
        // Some time passing
        await delay(3500)
        
        await expect(AllowanceV1.connect(david).ReclameAllowance(0))
        .to.be.revertedWith('ReclameAllowance: You are not the owner of this grant')

        await expect(AllowanceV1.connect(bob).ReclameAllowance(0))
        .to.be.revertedWith('ReclameAllowance: Not enough time has passed since last withdraw')
        
        // Some time passing
        await delay(1500)
        await expect(AllowanceV1.connect(bob).ReclameAllowance(0)).to.emit(AllowanceV1, 'AllowanceReclamed')
    });
*/
    it("allows the dev to reclame the allowance respecting grant state", async function () {
        const [ alice, bob, david ] = await ethers.getSigners()
        const { DAO, AllowanceV1, TestValue } = await deployAllowance()
        const AllowanceData = await AllowanceV1.grantList(0)
console.log(AllowanceData[0])
        // Lets pause the allowance
        await expect(DAO.connect(alice).PauseAllowance(0))
        .to.emit(AllowanceV1, 'AllowancePaused')
console.log(AllowanceData[0])

        // Allowance should not be active
        await expect(AllowanceData[0]).to.be.false
        await expect(DAO.connect(alice).PauseAllowance(0))
        .to.be.revertedWith('ReclameAllowance: This grant is not active 1')
        await expect(DAO.connect(alice).UnpauseAllowance(0))
        .to.be.revertedWith('ReclameAllowance: This grant is not active 1')
        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(5000)

        await expect(AllowanceV1.connect(bob).ReclameAllowance(0))
        .to.be.revertedWith('ReclameAllowance: This grant is not active')

        // Lets pause the allowance


    });

    it("forgives debt, virtually emptying any grant", async function () {
    });

    // it("helpful comment, add more tests here", async function () {
    // });
});