const { expect } = require('chai')
const { BigNumber } = require('ethers')
const { artifacts, contract, ethers, network } = require('hardhat')
require('@nomicfoundation/hardhat-chai-matchers')

describe('CLDAuction', function () {
    async function deployMockToken() {
        const [alice] = await ethers.getSigners()

        const cldFactory = await ethers.getContractFactory('HTA1')
        const CLD = await cldFactory.deploy(
            10000000000000000000n,
            'MockERC20',
            'MTKN'
        )
        await CLD.deployed()
        expect(await CLD.balanceOf(alice.address)).to.equal(
            10000000000000000000n
        )

        return { CLD }
    }

    // Deploy the FakeDAO, soon real DAO
    async function deployDAO() {
        const daoFactory = await ethers.getContractFactory('FakeDAO')
        const DAO = await daoFactory.deploy()
        await DAO.deployed()

        return { DAO }
    }

    async function deployTreasury(dao_address, token_address) {
        const treasuryFactory = await ethers.getContractFactory(
            'HarmoniaDAOTreasury'
        )
        const Treasury = await treasuryFactory.deploy(
            dao_address,
            token_address
        )
        await Treasury.deployed()

        return { Treasury }
    }

    async function transferMockToken(CLD_Address, DAO, deployer, Treasury, to) {
        //Should be sent to the treasury
        await CLD_Address.connect(deployer).transfer(
            Treasury.address,
            10000000000000000000n
        )
        expect(await CLD_Address.balanceOf(Treasury.address)).to.equal(
            10000000000000000000n
        )

        //Send the tokens from the treasury to the Auction
        await DAO.connect(deployer).TreasuryERC20Transfer(
            0,
            10000000000000000000n,
            to.address
        )
        expect(await CLD_Address.balanceOf(to.address)).to.equal(
            10000000000000000000n
        )
    }

    async function deployAuctionFixture(
        dao_address,
        treasury_address,
        token_address
    ) {
        const [alice, bob, carol, david] = await ethers.getSigners()
        const RetireeFee = 100
        const TestValue = ethers.utils.parseEther('0.001')

        const DAOFactory = await ethers.getContractFactory('FakeDAO')
        const DAOInstance = await DAOFactory.attach(dao_address)

        const cldAuctFFactory = await ethers.getContractFactory(
            'CLDAuctionFactory'
        )
        const CLDAucFactory = await cldAuctFFactory.deploy(
            dao_address,
            treasury_address,
            token_address
        )
        await CLDAucFactory.deployed()

        // Lets connect both CLDAuction and DAO
        await DAOInstance.SetAuctionFactory(CLDAucFactory.address)

        // Create a test CLDAuction

        await expect(
            await DAOInstance.NewTokenAuction(
                15,
                10000000000000000000n,
                TestValue,
                RetireeFee,
                [bob.address, carol.address, david.address]
            )
        ).to.emit(CLDAucFactory, 'NewAuction')
        const AuctInstanceBase = await CLDAucFactory.SeeAuctionData(0)
        const AuctionFactory = await ethers.getContractFactory('CLDAuction')
        const AuctionInstance = await AuctionFactory.attach(
            `${AuctInstanceBase[0]}`
        )

        return { CLDAucFactory, AuctionInstance, TestValue }
    }
    
    it('handles Ether deposits, denies them when not high enough and after auction expires', async function () {
        const [alice, bob, carol, david, erin, random] =
            await ethers.getSigners()
        const { DAO } = await deployDAO()
        // We don't care about that random.address here, no need for Treasury or token
        const { AuctionInstance, TestValue } = await deployAuctionFixture(
            DAO.address,
            random.address, // Treasury
            random.address  // Token
        )
        // This can be used to test the TestValue
        const Operator = 4

        for (let thisUser of [alice, bob, carol, david, erin]) {
            // Depositing some Ether
            await expect(
                AuctionInstance.connect(thisUser).DepositETC({
                    value: TestValue*Operator,
                })
            ).to.emit(AuctionInstance, 'ETCDeposited')
            // We will not see this, value sent is too low
            await expect(
                AuctionInstance.connect(thisUser).DepositETC({
                    value: TestValue / Operator,
                })
            ).to.be.revertedWith(
                'CLDAuction.DepositETC: Deposit amount not high enough'
            )
            // Lets check the getter function is working as it should
            const PartInfo = await AuctionInstance.CheckParticipant(
                thisUser.address
            )
            await expect(PartInfo[0]).to.equal(TestValue*Operator)
        }

        const AuctionEtherBalance = await ethers.provider.getBalance(
            AuctionInstance.address
        )
        const AuctionExpectedBalance = BigInt((TestValue*Operator) * 5)

        expect(AuctionEtherBalance).to.equal(
            AuctionExpectedBalance,
            'This error shall not be seen, the ether balance in the contract is TestValue * 5'
        )

        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(8500)

        for (let thisUser of [alice, bob, carol, david, erin]) {
            // We will not see this, the Auction time expired
            await expect(
                AuctionInstance.connect(thisUser).DepositETC({
                    value: TestValue,
                })
            ).to.be.revertedWith('CLDAuction.DepositETC: The sale is over')
            await expect(
                AuctionInstance.connect(thisUser).RetireFromAuction(
                    TestValue
                )
            ).to.be.revertedWith('CLDAuction.RetireFromAuction: The sale is over, you can only withdraw your CLD')
        }
    })

    it('handles withdrawing of Ether once the auction period is over', async function () {
        const [alice, random] = await ethers.getSigners()
        const { DAO } = await deployDAO()
        // We don't care about that random.address here, no need for Treasury or token
        const { AuctionInstance, TestValue } = await deployAuctionFixture(
            DAO.address,
            random.address, // Treasury
            random.address  // Token
        )
        const Operator = 4

        await expect(
            await ethers.provider.getBalance(AuctionInstance.address)
        ).to.equal(0, 'Balance should be 0')

        await expect(
            AuctionInstance.connect(alice).DepositETC({
                value: TestValue * Operator,
            })
        ).to.emit(AuctionInstance, 'ETCDeposited')

        // We will not see this, the sale is not over yet
        await expect(
            AuctionInstance.connect(alice).WithdrawETC()
        ).to.be.revertedWith('CLDAuction.WithdrawETC: The sale is not over yet')

        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(15900)

        const DummyTreasuryBalance = await ethers.provider.getBalance(random.address)

        // Now we can withdraw
        expect(await AuctionInstance.connect(alice).WithdrawETC()).to.emit(
            AuctionInstance,
            'ETCDWithdrawed'
        )
        await expect(
            AuctionInstance.connect(alice).WithdrawETC()
        ).to.be.revertedWith('CLDAuction.WithdrawETC: No ether on this contract')

        const AuctionNewEtherBalance = await ethers.provider.getBalance(
            AuctionInstance.address
        )
        expect(AuctionNewEtherBalance).to.equal(
            0,
            'This error shall not be seen, the contract has 0 ether'
        )
        expect(await ethers.provider.getBalance(random.address)).to.equal(
            BigInt(DummyTreasuryBalance) + BigInt(TestValue * Operator),
            'This error shall not be seen, the Treasury received the ether'
        )

    })

    it('calculates the TokenShare for each participant, splits the prize accordingly', async function () {
        const { CLD } = await deployMockToken()
        const { DAO } = await deployDAO()
        const { Treasury } = await deployTreasury(DAO.address, CLD.address)
        const { AuctionInstance, TestValue } = await deployAuctionFixture(
            DAO.address,
            CLD.address,
            CLD.address
        )
        const [alice, bob, carol, david, erin] = await ethers.getSigners()
        const Operator = 4
        // Set the Treasury in the DAO
        await DAO.connect(alice).SetTreasury(Treasury.address)
        // Let's get some tokens into the contract (they go deployer->Treasury->DAO sends them to AuctionInstance)
        await transferMockToken(CLD, DAO, alice, Treasury, AuctionInstance)

        // Everyone has 1/5 of the pooled ETC here
        for (let thisUser of [alice, bob, carol, david, erin]) {
            await expect(
                AuctionInstance.connect(thisUser).DepositETC({
                    value: TestValue * Operator,
                })
            ).to.emit(AuctionInstance, 'ETCDeposited')
        }

        const AuctionEtherBalance = await ethers.provider.getBalance(
            AuctionInstance.address
        )
        const AuctionExpectedBalance = BigInt((TestValue * Operator) * 5)
        expect(AuctionEtherBalance).to.equal(
            AuctionExpectedBalance,
            'This error shall not be seen, balance should be (TestValue * 5) ether'
        )

        // Everyone has 1/5 of the pool
        for (let thisUser of [alice, bob, carol, david, erin]) {
            const ParticipantPoolShare = await AuctionInstance.CheckParticipant(
                thisUser.address
            )
            expect(ParticipantPoolShare[2]).to.equal(
                2000,
                'This error shall not be seen, everyone has 1/5 of the PoolShare'
            )
        }

        //Now Alice has 60% of the pool
        await expect(
            AuctionInstance.connect(alice).DepositETC({
                value: BigInt((TestValue * Operator) * 5),
            })
        ).to.emit(AuctionInstance, 'ETCDeposited')

        const AliceData = await AuctionInstance.CheckParticipant(
            alice.address
        )
        expect(AliceData[2]).to.equal(
            6000,
            'This error shall not be seen, Alice has 60% of the TokenShare'
        )
        for (let thisUser of [bob, carol, david, erin]) {
            const ParticipantData = await AuctionInstance.CheckParticipant(
                thisUser.address
            )
            expect(ParticipantData[2]).to.equal(
                1000,
                'This error shall not be seen, as everyone else holds only 10% each'
            )
        }

        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(10000)

        // Testing the MTKN gets correctly split between participants with different shares
        const TotalMTKN = await CLD.totalSupply()
        const QuarterOfTotalMTKN = ((TotalMTKN * 40) / 100) / 4
        await expect(AuctionInstance.connect(alice).WithdrawCLD()).to.emit(
            AuctionInstance,
            'CLDWithdrawed'
        )
        // Alice has 60% of the token's totalAmount
        await expect(await CLD.balanceOf(alice.address)).to.equal(BigInt((TotalMTKN * 60) / 100))
        
        // These addresses hold 1/4 of total MTKN each
        for (let thisUser of [bob, carol, david, erin]) {
            await expect(
                AuctionInstance.connect(thisUser).WithdrawCLD()
            ).to.emit(AuctionInstance, 'CLDWithdrawed')
            await expect(await CLD.balanceOf(thisUser.address)).to.equal(BigInt(QuarterOfTotalMTKN))
        }

        // No MTKN left in the auction contract after all that
        await expect(await CLD.balanceOf(AuctionInstance.address)).to.equal(0)
    })

    it('allows users to retire from auctions, updating the prize (users) and ether (devs) amount accordingly', 
        async function () {
        const { CLD } = await deployMockToken()
        const [alice, bob, carol, david, erin] = await ethers.getSigners()
        const { DAO } = await deployDAO()
        const { Treasury } = await deployTreasury(DAO.address, CLD.address)
        const { AuctionInstance, TestValue } = await deployAuctionFixture(
            DAO.address,
            CLD.address,
            Treasury.address
        )
        const I = 4
        const Operator = 2
        // Set the Treasury in the DAO, Alice is the deployer
        await DAO.connect(alice).SetTreasury(Treasury.address)
        // Let's get some tokens into the contract
        await transferMockToken(CLD, DAO, alice, Treasury, AuctionInstance)
        const OneDevOGEtherBalance = await ethers.provider.getBalance(
            bob.address
        )
        for (let thisUser of [alice, bob, carol, david, erin]) {
            await expect(
                AuctionInstance.connect(thisUser).DepositETC({
                    value: TestValue*I, // 0.001 * 4 ether
                })
            ).to.emit(AuctionInstance, 'ETCDeposited')
        }

        const OneOGContractEtherBalance = await ethers.provider.getBalance(
            AuctionInstance.address
        )

        const AuctionRetireeFee = await AuctionInstance.RetireeFee()
        let iteration = 1
        for (let thisUser of [bob, carol]) {
            await expect(
                AuctionInstance.connect(thisUser).RetireFromAuction(
                    BigInt((TestValue * I) / Operator)
                )
            ).to.emit(AuctionInstance, 'ParticipantRetired')
            await expect(
                AuctionInstance.connect(thisUser).RetireFromAuction(
                    BigInt((TestValue * (I*I)))
                )
            ).to.be.revertedWith("CLDAuction.RetireFromAuction: You can't withdraw this many ETC")

            const ParticipantPoolShare = await AuctionInstance.CheckParticipant(
                thisUser.address
            )
            expect(ParticipantPoolShare[0]).to.be.at.least(
                BigInt((TestValue * I) / Operator), // in this case, half their respective amounts
                'This error shall not be seen as both participants have TestValue/Operator'
            )

            // Here we verify the ETCDeductedFromRetirees gets higher
            const AuctionDeductedEher =
                await AuctionInstance.ETCDeductedFromRetirees()
            const ShouldBeTheDeductedEther =
                ((((TestValue * I) / Operator) * AuctionRetireeFee) / 10000) *
                iteration
            await expect(AuctionDeductedEher).to.be.equal(
                BigInt(ShouldBeTheDeductedEther)
            )
            //The balance of ether in the contract should be deducted correctly
            expect(
                await ethers.provider.getBalance(AuctionInstance.address)
            ).to.be.equal(
                BigInt(
                    OneOGContractEtherBalance -
                        (((TestValue * I) / Operator) * iteration -
                            ShouldBeTheDeductedEther)
                )
            )
            iteration += 1
        }

        // Balance/snapshot after two participants withdrawed
        const SecondContractBalance = BigInt(
            await ethers.provider.getBalance(AuctionInstance.address)
        )
        // Checking this require works
        await expect(
            AuctionInstance.connect(alice).WithdrawCLD()
        ).to.be.revertedWith("CLDAuction.WithdrawCLD: The sale is not over yet")
        // Here we empty Alice deposits
        const AliceData = await AuctionInstance.CheckParticipant(
            alice.address
        )
        const AliceBalance = BigInt(AliceData[0])
        await expect(
            AuctionInstance.connect(alice).RetireFromAuction(AliceData[0])
        ).to.emit(AuctionInstance, 'ParticipantRetired')
        
        const NewAlicePoolShare = await AuctionInstance.CheckParticipant(
            alice.address
        )
        expect(NewAlicePoolShare[0]).to.be.equal(
            0, // The previous operations leave no ether
            'This error shall not be seen as Alice has retired all her ether in the sale'
        )
        // Testing the contract holds the correct amount of ether
        const WhatAliceReceivedAfterRetiring =
            (AliceBalance * BigInt(AuctionRetireeFee)) / BigInt(10000)
        expect(
            await ethers.provider.getBalance(AuctionInstance.address)
        ).to.be.equal(
            BigInt(
                SecondContractBalance -
                    (AliceBalance - WhatAliceReceivedAfterRetiring)
            )
        )

        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(15000)

        // Here we verify the MTKN is split correctly after retirees hit the sack
        const TotalMTKN = await CLD.totalSupply()
        // Alice doesnt have a share, so no piece of pie for her
        await expect(
            AuctionInstance.connect(alice).WithdrawCLD()
        ).to.be.revertedWith("CLDAuction.WithdrawCLD: You didn't buy any CLD")

        for (let thisUser of [bob, carol, david, erin]) {
            await expect(
                AuctionInstance.connect(thisUser).WithdrawCLD()
            ).to.emit(AuctionInstance, 'CLDWithdrawed')

            const UserTokenBalance = await CLD.balanceOf(thisUser.address)
            const UserPoolShare = await AuctionInstance.CheckParticipant(
                thisUser.address
            )
            // Basic math, everyone holds their respective share
            await expect(UserTokenBalance).to.be.equal(
                BigInt((TotalMTKN * UserPoolShare[1]) / 10000) // 100000 BP = 100,00%
            )
        }

        // Verify the ETCDeductedFromRetirees gets sent to the devs
        const OneDevEtherBalance = await ethers.provider.getBalance(bob.address)
        const OtherDevEtherBalance = await ethers.provider.getBalance(carol.address)
        const DavidEtherBalance = await ethers.provider.getBalance(david.address)

        await expect(OneDevEtherBalance).to.be.at.most(
            BigInt(OneDevOGEtherBalance) - BigInt(TestValue * I) + (BigInt((TestValue * I) / Operator))
        )
        await expect(await ethers.provider.getBalance(carol.address)).to.be.at.most(
            BigInt(OneDevOGEtherBalance) - BigInt(TestValue * I) + (BigInt((TestValue * I) / Operator))
        )
        await expect(await ethers.provider.getBalance(david.address)).to.be.at.most(
            BigInt(OneDevOGEtherBalance) - BigInt(TestValue * I) + (BigInt((TestValue * I) / Operator))
        )

        await expect(AuctionInstance.connect(alice).WithdrawETC()).to.emit(
            AuctionInstance,
            'ETCDWithdrawed'
        )
        // Correctly increases each dev ether's balance
        let feeForEachDev = BigInt(await AuctionInstance.ETCDeductedFromRetirees()) / BigInt(await AuctionInstance.ActiveDevs())

        await expect(await ethers.provider.getBalance(bob.address))
        .to.at.least(BigInt(OneDevEtherBalance) + BigInt(feeForEachDev))
        await expect(await ethers.provider.getBalance(carol.address))
        .to.at.least(BigInt(OtherDevEtherBalance) + BigInt(feeForEachDev))

        let shouldBeBalance = BigInt(DavidEtherBalance) + BigInt(BigInt(await AuctionInstance.ETCDeductedFromRetirees()) / BigInt(3))
        await expect(await ethers.provider.getBalance(david.address))
        .to.equal(shouldBeBalance)
        
        // The contract should be almost empty
        expect(await ethers.provider.getBalance(AuctionInstance.address)).to.be.at.most(5, "The contract should hold close to 0 ether")
    })

    it('handles OnlyDAO modifier correctly, also adds and removes devs as needed', async function () {
        // We will connect to the DAO via the deployer, Alice. In normal circunstances, the voting module will take the decisions
        const [alice, bob, carol, david, erin, random, random2, random3] =
            await ethers.getSigners()
        const { DAO } = await deployDAO()
        const { Treasury } = await deployTreasury(DAO.address, random.address)
        // This first random address is a dummy address, we don't need to deploy anything here
        const { AuctionInstance } = await deployAuctionFixture(
            DAO.address,
            random.address, // in normal circunstances this should be the token's address, but we are testing
            Treasury.address
        )

        // Set the Treasury in the DAO, alice is the deployer
        await DAO.connect(alice).SetTreasury(Treasury.address)
        // All these tests should be reverted because:
        for (let thisUser of [alice, bob, carol, david, erin]) {
            // They don't have permission
            await expect(
                AuctionInstance.connect(thisUser).AddDev(thisUser.address)
            ).to.be.revertedWith('This can only be done by the DAO')
            await expect(
                AuctionInstance.connect(thisUser).AddDevs([
                    david.address,
                    carol.address,
                    bob.address,
                ])
            ).to.be.revertedWith('This can only be done by the DAO')
            await expect(
                AuctionInstance.connect(thisUser).RemDev(thisUser.address)
            ).to.be.revertedWith('This can only be done by the DAO')
            await expect(
                AuctionInstance.connect(thisUser).RemDevs([
                    david.address,
                    carol.address,
                    bob.address,
                ])
            ).to.be.revertedWith('This can only be done by the DAO')
        }
        for (let thisUser of [bob, carol, david]) {
            // They are already devs
            await expect(
                DAO.connect(alice).AddAucInstanceDevAddress(
                    AuctionInstance.address,
                    thisUser.address
                )
            ).to.be.revertedWith(
                'CLDAuction.AddDev: This user is already a dev'
            )
            await expect(
                DAO.connect(alice).AddAucInstanceDevAddresses(
                    AuctionInstance.address,
                    [david.address, carol.address, bob.address]
                )
            ).to.be.revertedWith(
                'CLDAuction.AddDev: This user is already a dev'
            )

            // They are not devs
            await expect(
                DAO.connect(alice).RemAucInstanceDevAddress(
                    AuctionInstance.address,
                    erin.address
                )
            ).to.be.revertedWith(
                'CLDAuction.RemDev: This user is not a dev'
            )
            await expect(
                DAO.connect(alice).RemAucInstanceDevAddresses(
                    AuctionInstance.address,
                    [alice.address, erin.address, random.address]
                )
            ).to.be.revertedWith(
                'CLDAuction.RemDev: This user is not a dev'
            )
        }

        // This shouldn't fail, both transactions are run by the "DAO"
        await expect(
            DAO.connect(alice).AddAucInstanceDevAddress(
                AuctionInstance.address,
                erin.address
            )
        ).to.emit(AuctionInstance, 'NewDevAdded')
        // If this works everything below will too
        expect(await AuctionInstance.isDev(erin.address)).to.be.true
        await expect(
            DAO.connect(alice).AddAucInstanceDevAddresses(
                AuctionInstance.address,
                [random.address, random2.address, random3.address]
            )
        ).to.emit(AuctionInstance, 'NewDevAdded')
    })

    it("correctly pays to active devs if one of them is removed", async function () {
        const [alice, bob, carol, david, erin, random, random2, random3] =
        await ethers.getSigners()
        const { DAO } = await deployDAO()
        const { Treasury } = await deployTreasury(DAO.address, random.address)
        // This first random address is a dummy address, we don't need to deploy anything here
        const { AuctionInstance, TestValue } = await deployAuctionFixture(
            DAO.address,
            random.address, // in normal circunstances this should be the token's address, but we are testing
            Treasury.address
        )

        //Can be changed without a problem
        const Operator = 4

        for (let thisUser of [alice, bob, carol, david, erin]) {
            // Depositing some Ether
            await expect(
                AuctionInstance.connect(thisUser).DepositETC({
                    value: TestValue * Operator,
                })
            ).to.emit(AuctionInstance, 'ETCDeposited')
        }

        // Verify the ETCDeductedFromRetirees gets sent to the devs
        const OneDevEtherBalance = await ethers.provider.getBalance(bob.address)
        const OtherDevEtherBalance = await ethers.provider.getBalance(carol.address)
        const DavidEtherBalance = await ethers.provider.getBalance(david.address)

        await expect(
            DAO.connect(alice).RemAucInstanceDevAddress(
                AuctionInstance.address,
                bob.address
            )
        ).to.emit(AuctionInstance, 'DevRemoved')

        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(12500)
        
        await expect(AuctionInstance.connect(alice).WithdrawETC()).to.emit(
            AuctionInstance,
            'ETCDWithdrawed'
        )

        // Correctly increases each dev ether's balance
        let feeForEachDev = BigInt(await AuctionInstance.ETCDeductedFromRetirees()) / BigInt(await AuctionInstance.ActiveDevs())

        await expect(await ethers.provider.getBalance(bob.address))
        .to.at.least(BigInt(OneDevEtherBalance) + BigInt(feeForEachDev))
        await expect(await ethers.provider.getBalance(carol.address))
        .to.at.least(BigInt(OtherDevEtherBalance) + BigInt(feeForEachDev))

        let shouldBeBalance = BigInt(DavidEtherBalance) + BigInt(BigInt(await AuctionInstance.ETCDeductedFromRetirees()) / BigInt(3))
        
        await expect(await ethers.provider.getBalance(david.address))
        .to.at.least(shouldBeBalance)
    });

    // it("helpful comment, add more tests here", async function () {
    // });
})
