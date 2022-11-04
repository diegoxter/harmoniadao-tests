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

        await expect(VSystem.connect(alice).CastVote(votes, 0, 3)
        ).to.revertedWith("VotingSystemV1.CastVote: You must either vote 'Yes' or 'No'");
        // Everyone should be able to vote
        for (let thisUser of [ alice, bob, carol, david ]) {
            await expect(VSystem.connect(thisUser).CastVote(votes, 0, 0)
            ).to.emit(VSystem, "CastedVote");

            // These will fail
            await expect(VSystem.connect(thisUser).CastVote(votes, 0, 0)
            ).to.revertedWith('VotingSystemV1.CastVote: You already voted in this proposal');

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
        await expect(VSystemData[8]).to.be.equal(incentiveAmount*VSystemData[4])

        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(8500)

        // These should all fail
        await expect(VSystem.connect(erin).CastVote(votes, 0, 0)
        ).to.be.revertedWith('VotingSystemV1.CastVote: The voting period has ended');

        for (let thisUser of [ alice, bob, carol, david, erin ]) {
            await expect(
                VSystem.connect(thisUser).IncentivizeProposal(0, incentiveAmount)
            ).to.revertedWith(
                'VotingSystemV1.IncentivizeProposal: The voting period has ended, save for the next proposal!');
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
        const OGCLDBalance = await CLD.balanceOf(VSystem.address)
        expect(OGCLDBalance).to.be.equal((votes*4)+(incentiveAmount*4))
        const OGProposalData = await VSystem.SeeProposalInfo(0)
        const OGProposalIncAmount = OGProposalData[8]
        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(8500)
        let proposalInfBfr = await VSystem.SeeProposalInfo(0);
        // The balance in the contract should be the proposal 
        // IncentiveAmount + ApprovingVotes (in this test case)
        expect(OGCLDBalance)
            .to.be.equal(BigInt(proposalInfBfr[8])+BigInt(proposalInfBfr[5]))
        
        let ErinsBalance = await CLD.balanceOf(erin.address)
        await expect(
            VSystem.connect(erin).ExecuteProposal(0)
        ).to.emit(VSystem, "ProposalPassed");
        // This one should fail
        await expect(
            VSystem.connect(erin).ExecuteProposal(0)
        ).to.be.revertedWith('VotingSystemV1.ExecuteProposal: Proposal already executed!');

        // Check it's actually executed
        let proposalInfo = await VSystem.SeeProposalInfo(0);
        // As the proposal passed it should be 1
        expect(proposalInfo[3]).to.equal(1);
        // Individual share should be:
        // The total incentive amount minus taxes
        // divided by the amount of voters
        expect(proposalInfo[9])
        .to.equal((proposalInfBfr[8]-proposalInfBfr[10]-proposalInfBfr[11])
            / proposalInfBfr[4]);
        // Total incentive now should be:
        // The original IncentiveAmount minus both taxes
        expect(proposalInfo[8]).to.equal(BigInt(OGProposalIncAmount) -
            (BigInt(proposalInfBfr[10])+BigInt(proposalInfBfr[11])));
        // The balance on the contract should be:
        // The initial incentive amount (before the execution) 
        // plus the amount of votes casted minus the taxes         
        expect(await CLD.balanceOf(VSystem.address))
        .to.equal(BigInt(OGProposalIncAmount)+BigInt(OGProposalData[5])-
            (BigInt(OGProposalData[10])+BigInt(OGProposalData[11])));

        // The executer received the tokens
        expect(await CLD.balanceOf(erin.address))
        .to.equal(BigInt(ErinsBalance) + BigInt(OGProposalData[11]))
    });

    it("returns the tokens to each voter correctly, only when the voting is over", async function () {
        const [ alice, bob, carol, david, erin ] = await ethers.getSigners();
        const { CLD } = await deployMockToken()
        const { VSystem } = await deployVoting(CLD)
        const votes = 1000
        const incentiveAmount = 235720

        const OGBalance = await CLD.balanceOf(bob.address)
        for (let thisUser of [ alice, bob, carol ]) {
            await expect(VSystem.connect(thisUser).CastVote(votes, 0, 0)
            ).to.emit(VSystem, "CastedVote");

            await expect(
                VSystem.connect(thisUser).IncentivizeProposal(0, incentiveAmount)
            ).to.emit(VSystem, "ProposalIncentivized");
        }
        // Save this for later use
        const ContractAfterVoteBalance = await CLD.balanceOf(VSystem.address)

        const AfterVoteBalance = await CLD.balanceOf(bob.address)
        expect(OGBalance)
        .to.equal(BigInt(AfterVoteBalance) + BigInt(votes) + BigInt(235720))
        // These should fail
        await expect(
            VSystem.connect(david).WithdrawMyTokens(0))
        .to.be.revertedWith('VotingSystemV1.WithdrawMyTokens: Proposal has not been executed!')
        await expect(
            VSystem.connect(erin).WithdrawMyTokens(0))
        .to.be.revertedWith('VotingSystemV1.WithdrawMyTokens: Proposal has not been executed!')

        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(8500)

        await expect(
            VSystem.connect(erin).ExecuteProposal(0)
        ).to.emit(VSystem, "ProposalPassed");

        // These should fail
        await expect(
            VSystem.connect(david).WithdrawMyTokens(0))
        .to.be.revertedWith('VotingSystemV1.WithdrawMyTokens: You have no VotesLocked in this proposal')
        await expect(
            VSystem.connect(erin).WithdrawMyTokens(0))
        .to.be.revertedWith('VotingSystemV1.WithdrawMyTokens: You have no VotesLocked in this proposal')

        for (let thisUser of [ alice, bob, carol ]) {
            await expect(VSystem.connect(thisUser).WithdrawMyTokens(0)
            ).to.emit(VSystem, "IncentiveWithdrawed");

            // This one should fail, no duplicate withdraws allowed
            await expect(VSystem.connect(thisUser).WithdrawMyTokens(0)
            ).to.be.revertedWith('VotingSystemV1.WithdrawMyTokens: You have no VotesLocked in this proposal');

        }
        // Bob's new balance is his balance after votes + incentivizing was deducted
        // plus the IndividualShare the contract held for each user
        let proposalInfo = await VSystem.SeeProposalInfo(0);
        expect(await CLD.balanceOf(bob.address))
        .to.equal(BigInt(AfterVoteBalance) + BigInt(votes) + BigInt(proposalInfo[9]))

        // The current contract balance (0) is:
        // The balance after receiving votes+incentiveAmount minus
        // the individual share each voter received minus
        // the votes it received minus
        // the amount that was burned plus the amount to the executioner
        expect(await CLD.balanceOf(VSystem.address))
        .to.equal(BigInt(ContractAfterVoteBalance) - (BigInt(proposalInfo[9]) * 
        BigInt(3)) - BigInt(votes*3) - 
        (BigInt(proposalInfo[10]) + BigInt(proposalInfo[11])))

    });

    it("returns the incentives correctly if no voter appears", async function () {
        const [ alice, bob, carol, david, erin ] = await ethers.getSigners();
        const { CLD } = await deployMockToken()
        const { VSystem } = await deployVoting(CLD)
        const votes = 1000
        const incentiveAmount = 235720

        const OGBalance = await CLD.balanceOf(bob.address)
        for (let thisUser of [ alice, bob, carol ]) {
             await expect(
                VSystem.connect(thisUser).IncentivizeProposal(0, incentiveAmount)
            ).to.emit(VSystem, "ProposalIncentivized");
        }
        // Save this for later use
        const ContractAfterVoteBalance = await CLD.balanceOf(VSystem.address)

        const AfterVoteBalance = await CLD.balanceOf(bob.address)
        
        // Time related code
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        await delay(12000)

        for (let thisUser of [ alice, bob, carol ]) {
            await expect(
               VSystem.connect(thisUser).WithdrawMyTokens(0)
               ).to.emit(VSystem, "IncentiveWithdrawed");   
        }
        expect(await CLD.balanceOf(bob.address))
        .to.equal(BigInt(AfterVoteBalance) + BigInt(incentiveAmount))
        // The contract's empty
        expect(await CLD.balanceOf(VSystem.address))
        .to.equal(BigInt(ContractAfterVoteBalance) - (BigInt(incentiveAmount)*
        BigInt(3))) // he is a big boy, look at him UwU


    });


    // it("helpful comment, add more tests here", async function () {
    // });
});