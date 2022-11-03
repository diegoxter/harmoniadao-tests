const { expect } = require('chai')
const { BigNumber } = require('ethers')
const { artifacts, contract, ethers, network } = require('hardhat')
require('@nomicfoundation/hardhat-chai-matchers')

describe('VotingSystem', function () {
    async function deployMockToken() {
        const [ alice ] = await ethers.getSigners()

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
    async function deployVoting(CLD) {
        const [ alice, bob, carol, david, erin ] = await ethers.getSigners()

        const daoFactory = await ethers.getContractFactory('FakeDAO')
        const DAO = await daoFactory.deploy()
        await DAO.deployed()

        const VFactory = await ethers.getContractFactory('VotingSystemV1')
        const VSystem = await VFactory.deploy(CLD.address, DAO.address, 100, 100)
        await VSystem.deployed()

        // Lets connect both VSystem and DAO
        await DAO.connect(alice).SetVotingAddress(VSystem.address)

        // Give some tokens to the other test users, approve the VotingSystem
        await expect(
            CLD.connect(alice).approve(VSystem.address, 1000000000000000000n)
        );
        for (let thisUser of [ bob, carol, david, erin ]) {
            // Send some CLD to test users, make them approve it to the VotingSystem contract
            await expect(
                CLD.connect(alice).transfer(thisUser.address, 1000000000000000000n)
                ).to.changeTokenBalances(CLD, [alice, thisUser], [-1000000000000000000n, 1000000000000000000n]);
            
            await expect(
                CLD.connect(thisUser).approve(VSystem.address, 1000000000000000000n)
            );
        }

        // New test proposal, anyone can propose
        await DAO.connect(bob).NewProposal('Test proposal #0', 15)

        return { DAO, VSystem }
    };

    it('allows voting and incentivizing, rejects duplicate votes both when voting period ends', async function () {
        const [ alice, bob, carol, david, erin ] = await ethers.getSigners();
        const { CLD } = await deployMockToken()
        const { VSystem } = await deployVoting(CLD)
        const votes = 1000
        const incentiveAmount = 235720

        // Everyone should be able to vote
        for (let thisUser of [ alice, bob, carol, david ]) {
            await expect(VSystem.connect(thisUser).CastVote(votes, 0, 0)
            ).to.emit(VSystem, "CastedVote");

            // This one will fail
            await expect(VSystem.connect(thisUser).CastVote(votes, 0, 0)
            ).to.revertedWith('You already voted in this proposal');

            await expect(
                VSystem.connect(thisUser).IncentivizeProposal(0, incentiveAmount)
            ).to.emit(VSystem, "ProposalIncentivized");
            
            let userVotes = await VSystem.viewVoterInfo(thisUser.address, 0);
            expect(userVotes[2]).to.be.true;
            expect(userVotes[0]).to.be.equal(votes, "This message shall not be seen, users have $(votes)")
        }

        // Check the proposal received the votes and the incentives
        const VSystemData = await VSystem.SeeProposalInfo(0)
        await expect(VSystemData[4]).to.be.equal(4)
        await expect(VSystemData[5]).to.be.equal(votes*VSystemData[4])
        await expect(VSystemData[7]).to.be.equal(incentiveAmount*VSystemData[4])

        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(8500)

        // These should all fail
        await expect(VSystem.connect(erin).CastVote(votes, 0, 0)
        ).to.emit(VSystem, "CastedVote");
        for (let thisUser of [ alice, bob, carol, david, erin ]) {
            await expect(
                VSystem.connect(thisUser).IncentivizeProposal(0, incentiveAmount)
            ).to.revertedWith(
                'The voting period has ended, save for the next proposal!');
        }

    });

    it("rejects unauthorized transactions", async function () {
        const [ alice, bob, carol, david, erin ] = await ethers.getSigners();
        const { CLD } = await deployMockToken()
        const { DAO, VSystem } = await deployVoting(CLD)

        // These should all fail because:
        for (let thisWord of ["execusCut", "burnCut", "memberHolding"]) {
            // Alice is not the DAO
            await expect(
                VSystem.connect(alice).SetTaxAmount(0, `${thisWord}`), 
            ).to.be.revertedWith('This can only be done by the DAO');
        }
        for (let thisUser of [ alice, bob, carol, david, erin ]) {
            // None of this users is the DAO
            await expect(
                VSystem.connect(thisUser).ChangeDAO(CLD.address)
            ).to.revertedWith('This can only be done by the DAO');
        }

        // This one will go through
        await DAO.connect(alice).NewDAOInVoting(CLD.address)
        expect(await VSystem.DAO()).to.be.equal(CLD.address)
    });

    it("executes the proposals correctly, burning and paying the executioner's cut", async function () {
        const [ alice, bob, carol, david, erin ] = await ethers.getSigners();
        const { CLD } = await deployMockToken()
        const { VSystem } = await deployVoting(CLD)
        const votes = 1000
        const incentiveAmount = 235720

        // Everyone should be able to vote
        for (let thisUser of [ alice, bob, carol, david ]) {
            await expect(VSystem.connect(thisUser).CastVote(votes, 0, 0)
            ).to.emit(VSystem, "CastedVote");

            await expect(
                VSystem.connect(thisUser).IncentivizeProposal(0, incentiveAmount)
            ).to.emit(VSystem, "ProposalIncentivized");
        }

        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(8500)
        
        await expect(
            VSystem.connect(erin).ExecuteProposal(0)
        ).to.emit(VSystem, "ProposalPassed");

    });

    // it("helpful comment, add more tests here", async function () {
    // });
});