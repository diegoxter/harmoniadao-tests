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
    async function deployAllowance(Token) {
        const [ alice, bob ] = await ethers.getSigners()
        const daoFactory = await ethers.getContractFactory('FakeDAO')
        const DAO = await daoFactory.deploy()
        await DAO.deployed()

        const treasuryFactory = await ethers.getContractFactory(
            'HarmoniaDAOTreasury'
        )
        const Treasury = await treasuryFactory.deploy(
            DAO.address,
            Token
        )
        await Treasury.deployed()

        const allowanceFactory = await ethers.getContractFactory('HarmoniaDAO_Allowances')
        const AllowanceV1 = await allowanceFactory.deploy(DAO.address, Treasury.address)
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

        return { DAO, Treasury, AllowanceV1, TestValue }
    };

    it("allows the dev to reclame the allowance respecting time, cancels allowance after ForgiveAllowance", async function () {
        const [ alice, bob, david, erin, random ] = await ethers.getSigners()
        const { DAO, Treasury, AllowanceV1, TestValue } = await deployAllowance(random.address)
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
        await delay(4500)
        await expect(AllowanceV1.connect(bob).ReclameAllowance(0)).to.emit(AllowanceV1, 'AllowanceReclamed')
        
        // Some time passing
        await delay(1500)
        
        const OGTreasuryBalance = await ethers.provider.getBalance(Treasury.address)
        const OGRemValue = await AllowanceV1.GrantList(0)
        // Draining the grant
        await expect(DAO.connect(alice).ForgiveAllowanceDebt(0))
        .to.emit(AllowanceV1, 'AllowanceForgiven')

        await expect(await ethers.provider.getBalance(Treasury.address))
        .to.equal(BigInt(OGTreasuryBalance) + BigInt(OGRemValue[5]))

        // Should be inactive
        await expect(AllowanceV1.connect(bob).ReclameAllowance(0))
        .to.be.revertedWith('ReclameAllowance: This grant is not active')
    });

    it("pauses and unpauses ether grants effectively", async function () {
        const [ alice, bob, david, random ] = await ethers.getSigners()
        const { DAO, AllowanceV1, TestValue } = await deployAllowance(random.address)
        
        // Lets pause the allowance
        await expect(DAO.connect(alice).PauseAllowance(0))
        .to.emit(AllowanceV1, 'AllowancePaused')

        // Allowance should not be active
        await expect((await AllowanceV1.GrantList(0))[0]).to.be.false
        await expect(DAO.connect(alice).PauseAllowance(0))
        .to.be.revertedWith('PauseAllowance: Allowance must be unpaused')
        await expect(AllowanceV1.connect(bob).ReclameAllowance(0))
        .to.be.revertedWith('ReclameAllowance: This grant is not active')
        // External actors not allowed
        await expect(AllowanceV1.connect(david).ReclameAllowance(0))
        .to.be.revertedWith('ReclameAllowance: This grant is not active')

        // Unpausing the allowance
        await expect(DAO.connect(alice).UnpauseAllowance(0))
        .to.emit(AllowanceV1, 'AllowanceUnpaused')
         // Allowance should be active
         await expect((await AllowanceV1.GrantList(0))[0]).to.be.true
        
         // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(5000)
        // External actors not allowed
        await expect(AllowanceV1.connect(alice).ReclameAllowance(0))
        .to.be.revertedWith('ReclameAllowance: You are not the owner of this grant')

        await expect(AllowanceV1.connect(bob).ReclameAllowance(0))
        .to.emit(AllowanceV1, 'AllowanceReclamed')

    });

    it("handles ERC20 allowances, allowance forgive", async function () {
    });

    // it("helpful comment, add more tests here", async function () {
    // });
});