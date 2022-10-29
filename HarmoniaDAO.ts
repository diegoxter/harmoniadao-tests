const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { artifacts, contract, ethers, network } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const {
  changeTokenBalances,
} = require("@nomicfoundation/hardhat-chai-matchers");

describe("CLDAuction", function () {
  async function deployContractsFixture() {
    const [ alice, bob, maria, joao ] = await ethers.getSigners();
    const RetireeFee = 100;

    const cldFactory = await ethers.getContractFactory("ClassicDAO");
    const CLD = await cldFactory.deploy(
      10000000000000000000n,
      "MockCLD",
      "MCLD"
    );
    await CLD.deployed();
    expect(await CLD.balanceOf(alice.address)).to.equal(10000000000000000000n);

    const cldAuctFFactory = await ethers.getContractFactory(
      "CLDDao_Auction_Factory"
    );
    const CLDAucFactory = await cldAuctFFactory.deploy(alice.address, CLD.address);
    await CLDAucFactory.deployed();

    // Create a test CLDAuction
    await expect(
      CLDAucFactory.newCLDAuction(
        120,
        10000000000000000000n, 
        ethers.utils.parseEther("0.1"), 
        RetireeFee,
        [bob.address, maria.address, joao.address]
      )
    ).to.emit(CLDAucFactory, "NewAuction");
    const AuctInstanceBase = await CLDAucFactory.SeeAuctionData(0);
    const AuctionFactory = await ethers.getContractFactory("CLDDao_Auction");
    const AuctionInstance = await AuctionFactory.attach(
      `${AuctInstanceBase[0]}`
    );

    await expect(
      CLD.connect(alice).transfer(
        AuctionInstance.address,
        10000000000000000000n
      )
    ).to.changeTokenBalances(
      CLD,
      [alice, AuctionInstance.address],
      [-10000000000000000000n, 10000000000000000000n]
    );
    expect(await CLD.balanceOf(AuctionInstance.address)).to.equal(10000000000000000000n);

    return { CLD, CLDAucFactory, AuctionInstance, RetireeFee };
  }

  it("is initialized correctly, with a test auction set", async function () {
    await loadFixture(deployContractsFixture);
  });

  it("supports depositing Ether, denies deposits after auction time expires", async function () {
    const { AuctionInstance } = await loadFixture(deployContractsFixture);
    const [alice, bob, carol, david, erin] = await ethers.getSigners();
    const TestValue = await ethers.utils.parseEther("3.141592")

    for (let thisUser of [alice, bob, carol, david, erin]) {
      // Send some CLD to test users, make them approve it to the VotingSystem contract
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: TestValue,
        })
      ).to.emit(AuctionInstance, "ETCDeposited");
      // We will not see this, value sent is too low
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: ethers.utils.parseEther("0.01"),
        })
      ).to.be.revertedWith(
        "CLDAuction.DepositETC: Deposit amount not high enough"
      );

      // Lets check the getter function is working as it should 
      const PartInfo = await AuctionInstance.CheckParticipant(thisUser.address);
      await expect(PartInfo[0]).to.equal(TestValue)

    }
    const AuctionEtherBalance = await ethers.provider.getBalance(
      AuctionInstance.address
    );
    const AuctionExpectedBalance = BigInt(TestValue * 5);

    expect(AuctionEtherBalance).to.equal(
      AuctionExpectedBalance,
      "This error shall not be seen, the ether balance in the contract is correct"
    );

    await network.provider.send("evm_increaseTime", [120]);

    for (let thisUser of [alice, bob, carol, david, erin]) {
      // We will not see this, the Auction time expired
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: TestValue,
        })
      ).to.be.revertedWith("CLDAuction.DepositETC: The sale is over");
    }
  });

  it("supports withdrawing the Ether once the Auction period is over", async function () {
    const { AuctionInstance } = await loadFixture(deployContractsFixture);
    const [alice] = await ethers.getSigners();
    const TestValue = await ethers.utils.parseEther("3.141592")

    await expect(
      await ethers.provider.getBalance(AuctionInstance.address)
    ).to.equal(0, "Balance should be 0");

    // TO DO check for OnlyDAO modifier compatibility
    // We will not see this, the Auction time expired
    expect(
      await AuctionInstance.connect(alice).DepositETC({
        value: TestValue,
      })
    ).to.emit(AuctionInstance, "ETCDeposited");
    const AuctionEtherBalance = await ethers.provider.getBalance(
      AuctionInstance.address
    );
    const AuctionExpectedBalance = TestValue;

    expect(AuctionEtherBalance).to.equal(
      AuctionExpectedBalance,
      "This error shall not be seen, both ether balance and TestValue are equal"
    );

    // We will not see this, the sale is not over yet
    await expect(
      AuctionInstance.connect(alice).WithdrawETC()
    ).to.be.revertedWith("CLDAuction.WithdrawETC: The sale is not over yet");

    await network.provider.send("evm_increaseTime", [120]);

    // TO DO check for OnlyDAO modifier compatibility
    expect(await AuctionInstance.connect(alice).WithdrawETC()).to.emit(
      AuctionInstance,
      "ETCDWithdrawed"
    );

  });

  it("correctly calculates the share of the pool for each participant", async function () {
    const { AuctionInstance, CLD } = await loadFixture(deployContractsFixture);
    const [alice, bob, carol, david, erin] =await ethers.getSigners();
    const TestValue = await ethers.utils.parseEther("3.141592")

    // Everyone has 1/5 of the pooled ETC here
    for (let thisUser of [alice, bob, carol, david, erin]) {
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: TestValue,
        })
      ).to.emit(AuctionInstance, "ETCDeposited");
    }

    const AuctionEtherBalance = await ethers.provider.getBalance(AuctionInstance.address);
    const AuctionExpectedBalance = BigInt(TestValue * 5);
    // Balance should be 5 ether
    expect(AuctionEtherBalance).to.equal(
      AuctionExpectedBalance,
      "This error shall not be seen, balance should be TestValue*5 ether"
    );
    await expect(
      AuctionInstance.connect(alice).MassUpdatePooledTokenShare()
    ).to.emit(AuctionInstance, "UpdatedPooledTokenShare");
    // Everyone has 1/5 of the pool
    for (let thisUser of [alice, bob, carol, david, erin]) {
      const ParticipantPoolShare = await AuctionInstance.CheckParticipant(thisUser.address);
      expect(ParticipantPoolShare[1]).to.equal(
        2000,
        "This error shall not be seen"
      );
    }

    //Now Alice has 60% of the pool
    for (let i = 0; i < 5; i++) {
      await expect(
        AuctionInstance.connect(alice).DepositETC({
          value: TestValue,
        })
      ).to.emit(AuctionInstance, "ETCDeposited");
    }

    await expect(
      AuctionInstance.connect(alice).MassUpdatePooledTokenShare()
    ).to.emit(AuctionInstance, "UpdatedPooledTokenShare");
    const AlicePoolShare = await AuctionInstance.CheckParticipant(alice.address);
    expect(AlicePoolShare[1]).to.equal(
      6000,
      "This error shall not be seen"
    );
    for (let thisUser of [bob, carol, david, erin]) {
      const ParticipantPoolShare = await AuctionInstance.CheckParticipant(thisUser.address);
      expect(ParticipantPoolShare[1]).to.equal(
        1000,
        "This error shall not be seen"
      );
    }
    await network.provider.send("evm_increaseTime", [120]);

    // We won't see this, but it's related to the withdraw CLD test. 
    for (let thisUser of [alice, bob, carol, david, erin]) {
      await expect(
         AuctionInstance.connect(thisUser).WithdrawCLD(thisUser.address)
       ).to.emit(AuctionInstance, "CLDWithdrawed");
     }

  });

  it("allows participants to retire their ether", async function () {
    const { AuctionInstance, RetireeFee } = await loadFixture(deployContractsFixture);
    const [alice, bob, carol, david, erin] =await ethers.getSigners();
    const TestValue = await ethers.utils.parseEther("3.141592")
    const Operator = 2

    for (let thisUser of [alice, bob, carol, david, erin]) {
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: TestValue,
        })
      ).to.emit(AuctionInstance, "ETCDeposited");
    }

    let iterator = 1;
    // TO DO make this depending on contract value
    for (let thisUser of [bob, carol, erin]) {
      await expect(
        AuctionInstance.connect(thisUser).RetireFromAuction(BigInt(TestValue/Operator), thisUser.address)
      ).to.emit(AuctionInstance, "ParticipantRetired");

      const ParticipantPoolShare = await AuctionInstance.CheckParticipant(thisUser.address);
      expect(ParticipantPoolShare[0]).to.equal(
        BigInt(TestValue/Operator),
        "This error shall not be seen as both participants have TestValue/Operator"
      ); // TO DO
      expect(await AuctionInstance.ETCDeductedFromRetirees()).to.equal(
        BigInt((((TestValue/2)*RetireeFee)/10000)*iterator),
        "This error shall not be seen as both participants have TestValue/Operator"
      );

      iterator += 1;
    }

    const AlicePoolShare = await AuctionInstance.CheckParticipant(alice.address);
    const EstimateGas = await AuctionInstance.estimateGas.RetireFromAuction(ethers.utils.parseEther("2.0"), alice.address);
    const ActualRetiredValue = BigInt((AlicePoolShare[0]-EstimateGas))
    await expect(
      AuctionInstance.connect(alice).RetireFromAuction(ActualRetiredValue, alice.address)
    ).to.emit(AuctionInstance, "ParticipantRetired");
    const NewAlicePoolShare = await AuctionInstance.CheckParticipant(alice.address);
    expect(NewAlicePoolShare[0]).to.below(
      BigInt(53765),  // The previous operations leave just a little bit of ether in the contract
      "This error shall not be seen as Alice has 0 ether in the sale"
      );

    // TO DO check the RetireeFees are being collected
    // TO DO check the CLD withdrawed is still correctly calculated

  });

  it("allows each Participant to withdraw their share of the pooled CLD", async function () {
    const { AuctionInstance, CLD } = await loadFixture(deployContractsFixture);
    const [alice, bob, carol, david, erin] =await ethers.getSigners();
    // You can modify this and nothing will happen 
    const TestValue = await ethers.utils.parseEther("1.0")

    // Everyone has 1/5 of the pooled ETC here
    for (let thisUser of [alice, bob, carol, david, erin]) {
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: TestValue,
        })
      ).to.emit(AuctionInstance, "ETCDeposited");
    }

    // Update the TokenShare, time
    await expect(
      AuctionInstance.connect(alice).MassUpdatePooledTokenShare()
    ).to.emit(AuctionInstance, "UpdatedPooledTokenShare");
    await network.provider.send("evm_increaseTime", [120]);

    // Everyone should have 1/5 of 10e18 CLD here
    for (let thisUser of [alice, bob, carol, david, erin]) {
     await expect(
        AuctionInstance.connect(thisUser).WithdrawCLD(thisUser.address)
      ).to.emit(AuctionInstance, "CLDWithdrawed");
      expect(await CLD.balanceOf(thisUser.address)).to.equal(BigInt(2000000000000000000));
    }
  });

  // it("helpful comment, add more tests here", async function () {
  // });
});
