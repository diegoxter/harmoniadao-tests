const { expect } = require('chai')
const { BigNumber } = require('ethers')
const { artifacts, contract, ethers, network } = require('hardhat')
require("@nomicfoundation/hardhat-chai-matchers")

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
        // Lets connect both Treasyry and DAO
        await DAO.connect(alice).SetTreasury(Treasury.address)

        const allowanceFactory = await ethers.getContractFactory('HarmoniaDAO_Allowances')
        const AllowanceV1 = await allowanceFactory.deploy(DAO.address, Treasury.address)
        await AllowanceV1.deployed()

        // Lets connect both Allowances and DAO
        await DAO.connect(alice).SetAllowancesAddress(AllowanceV1.address)

        // Let's set a test ether grant
        const TestValue = ethers.utils.parseEther('0.0001')

        await expect(DAO.connect(alice).RegisterNewAllowance(
            bob.address,
            true,
            TestValue,
            '0x0000000000000000000000000000000000000000',
            5,
            7)).to.emit(AllowanceV1, 'NewAllowance')

        // Sending ether for these tests
        await expect(alice.sendTransaction({
            to: AllowanceV1.address,
            value: TestValue,
          })).to.changeEtherBalance(AllowanceV1.address, TestValue);

        await expect(await ethers.provider.getBalance(
            AllowanceV1.address
        )).to.equal(TestValue)

        return { DAO, Treasury, AllowanceV1, TestValue }
    };

    it("dev can reclaim the allowance respecting time, cancels allowance after ForgiveAllowance", async function () {
        const [ alice, bob, david, erin, random ] = await ethers.getSigners()
        const { DAO, Treasury, AllowanceV1, TestValue } = await deployAllowance(erin.address)
        const AllowanceData = await AllowanceV1.GrantList(0)

        // Cant reclaim yet
        await expect(AllowanceV1.connect(bob).ReclaimAllowance(0))
        .to.be.revertedWith('ReclaimAllowance: Not enough time has passed since last withdraw')

        // Not an allowed dev
        await expect(AllowanceV1.connect(alice).ReclaimAllowance(0))
        .to.be.revertedWith('ReclaimAllowance: You are not the owner of this grant')
        await expect(AllowanceV1.connect(erin).ReclaimAllowance(0))
        .to.be.revertedWith('ReclaimAllowance: You are not the owner of this grant')
        
        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(5500)
        await expect(AllowanceV1.connect(bob).ReclaimAllowance(0))
            .to.changeEtherBalance(bob.address, BigInt(TestValue) / BigInt(AllowanceData[7]));
        
        // Some time passing
        await delay(3500)
        
        await expect(AllowanceV1.connect(david).ReclaimAllowance(0))
        .to.be.revertedWith('ReclaimAllowance: You are not the owner of this grant')

        await expect(AllowanceV1.connect(bob).ReclaimAllowance(0))
        .to.be.revertedWith('ReclaimAllowance: Not enough time has passed since last withdraw')
        
        // Some time passing
        await delay(4500)
        await expect(AllowanceV1.connect(bob).ReclaimAllowance(0))
        .to.emit(AllowanceV1, 'AllowanceReclaimed')
        
        // Some time passing
        await delay(1500)
        
        const OGTreasuryBalance = await ethers.provider.getBalance(Treasury.address)
        const OGRemValue = await AllowanceV1.GrantList(0)

        // Draining the grant
        await expect(DAO.connect(alice).ForgiveAllowanceDebt(0))
        .to.emit(AllowanceV1, 'AllowanceForgiven')

        await expect(await ethers.provider.getBalance(Treasury.address))
        .to.equal(BigInt(OGTreasuryBalance) + BigInt(OGRemValue[5]))
        await expect(await ethers.provider.getBalance(AllowanceV1.address))
        .to.equal(0)

        // Should be inactive
        await expect(AllowanceV1.connect(bob).ReclaimAllowance(0))
        .to.be.revertedWith('ReclaimAllowance: This grant is not active')

        // Return the ether
        const TreasuryBalance = await ethers.provider.getBalance(Treasury.address)
        await expect(DAO.connect(alice).TreasuryEtherTransfer(TreasuryBalance, alice.address))
        .to.changeEtherBalance(Treasury.address, "-60000000000000");
    });

    it("pauses and unpauses ether grants effectively", async function () {
        const [ alice, bob, david, random ] = await ethers.getSigners()
        const { DAO, Treasury, AllowanceV1 } = await deployAllowance(random.address)
        
        // Lets pause the allowance
        await expect(DAO.connect(alice).PauseAllowance(0))
        .to.emit(AllowanceV1, 'AllowancePaused')

        // Allowance should not be active
        await expect((await AllowanceV1.GrantList(0))[0]).to.be.false
        await expect(DAO.connect(alice).PauseAllowance(0))
        .to.be.revertedWith('PauseAllowance: Allowance must be unpaused')
        await expect(AllowanceV1.connect(bob).ReclaimAllowance(0))
        .to.be.revertedWith('ReclaimAllowance: This grant is not active')
        // External actors not allowed
        await expect(AllowanceV1.connect(david).ReclaimAllowance(0))
        .to.be.revertedWith('ReclaimAllowance: This grant is not active')

        // Unpausing the allowance
        await expect(DAO.connect(alice).UnpauseAllowance(0))
        .to.emit(AllowanceV1, 'AllowanceUnpaused')
         // Allowance should be active
         await expect((await AllowanceV1.GrantList(0))[0]).to.be.true
        
         // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(5000)
        // External actors not allowed
        await expect(AllowanceV1.connect(alice).ReclaimAllowance(0))
        .to.be.revertedWith('ReclaimAllowance: You are not the owner of this grant')

        await expect(AllowanceV1.connect(bob).ReclaimAllowance(0))
        .to.emit(AllowanceV1, 'AllowanceReclaimed')

        // Draining the grant
        await expect(DAO.connect(alice).ForgiveAllowanceDebt(0))
        .to.emit(AllowanceV1, 'AllowanceForgiven')
        // Return the ether
        const TreasuryBalance = await ethers.provider.getBalance(Treasury.address)
        await expect(DAO.connect(alice).TreasuryEtherTransfer(TreasuryBalance, alice.address))
        .to.changeEtherBalance(Treasury.address, "-80000000000000");
    });

    it("handles ERC20 allowances, cancels allowance after ForgiveAllowance", async function () {
        const [ alice, bob ] = await ethers.getSigners()
        const { Token } = await deployMockToken("Name1", "NM1")
        const { DAO, Treasury, AllowanceV1 } = await deployAllowance(Token.address)

        // Draining the grant 0 as we don't need that
        await expect(DAO.connect(alice).ForgiveAllowanceDebt(0))
        .to.emit(AllowanceV1, 'AllowanceForgiven')
        // Return the ether
        const TreasuryBalance = await ethers.provider.getBalance(Treasury.address)
        await expect(DAO.connect(alice).TreasuryEtherTransfer(TreasuryBalance, alice.address))
        .to.changeEtherBalance(Treasury.address, "-100000000000000");

        // We need a new Allowance, accepting ERC20
        await expect(DAO.connect(alice).RegisterNewAllowance(
            bob.address,
            false,
            BigInt(10000000000000000000),
            Token.address,
            5,
            5)).to.emit(AllowanceV1, 'NewAllowance')

        // The first one is inactive as we drained it, the second is active
        await expect((await AllowanceV1.GrantList(0))[0]).to.be.false
        await expect((await AllowanceV1.GrantList(1))[0]).to.be.true

        // Sending some tokens to Allowance
        await expect(Token.connect(alice).transfer(
            AllowanceV1.address,
            10000000000000000000n
        )).to.changeTokenBalances(
            Token,
            [alice, AllowanceV1],
            [-10000000000000000000n, 10000000000000000000n]
        )
        expect(await Token.balanceOf(AllowanceV1.address)).to.equal(
            10000000000000000000n
        )
        
        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(4500)

        await expect(AllowanceV1.connect(bob).ReclaimAllowance(1)).to.emit(AllowanceV1, 'AllowanceReclaimed')
        expect(await Token.balanceOf(bob.address)).to.equal(
            BigInt((await AllowanceV1.GrantList(1))[4]) / BigInt((await AllowanceV1.GrantList(1))[7])
        )

        // Some time passing
        await delay(1500)

        const OGTreasuryTokenBalance = await Token.balanceOf(Treasury.address)
        const OGRemValue = await AllowanceV1.GrantList(1)

        // Draining the grant 1
        await expect(DAO.connect(alice).ForgiveAllowanceDebt(1))
        .to.emit(AllowanceV1, 'AllowanceForgiven')

        await expect(await Token.balanceOf(Treasury.address))
        .to.equal(BigInt(OGTreasuryTokenBalance) + BigInt(OGRemValue[5]))
        await expect(await Token.balanceOf(AllowanceV1.address))
        .to.equal(0)

        // Should be inactive
        await expect(AllowanceV1.connect(bob).ReclaimAllowance(1))
        .to.be.revertedWith('ReclaimAllowance: This grant is not active')
    });

    it('handles OnlyDAO modifier correctly', async function () {
        const [ alice, bob, random ] = await ethers.getSigners()
        const { DAO, Treasury, AllowanceV1 } = await deployAllowance(random.address)

        // These will fail
        for (let thisUser of [ alice, bob, random ] ) {
            await expect(AllowanceV1.connect(thisUser).ChangeDAO(thisUser.address))
                .to.be.revertedWith("This can only be done by the DAO")

            await expect(AllowanceV1.connect(thisUser).ChangeTreasury(thisUser.address))
                .to.be.revertedWith("This can only be done by the DAO")

            await expect(AllowanceV1.connect(thisUser).RegisterAllowance(
                    bob.address,
                    false,
                    BigInt(10000000000000000000),
                    random.address,
                    5,
                    5)).to.be.revertedWith("This can only be done by the DAO")
                
            await expect(AllowanceV1.connect(thisUser).PauseAllowance(0))
                .to.be.revertedWith("This can only be done by the DAO")

            await expect(AllowanceV1.connect(thisUser).UnpauseAllowance(0))
                .to.be.revertedWith("This can only be done by the DAO")

            await expect(AllowanceV1.connect(thisUser).ForgiveAllowanceDebt(0))
                .to.be.revertedWith("This can only be done by the DAO")
        } 

        // Draining the grant 0 as we don't need that
        await expect(DAO.connect(alice).ForgiveAllowanceDebt(0))
        .to.emit(AllowanceV1, 'AllowanceForgiven')
        // Return the ether
        const TreasuryBalance = await ethers.provider.getBalance(Treasury.address)
        await expect(DAO.connect(alice).TreasuryEtherTransfer(TreasuryBalance, alice.address))
        .to.changeEtherBalance(Treasury.address, "-100000000000000");
    });

    // it("helpful comment, add more tests here", async function () {
    // });
});