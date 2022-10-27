const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { artifacts, contract, ethers, network } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const {
  changeTokenBalances,
} = require("@nomicfoundation/hardhat-chai-matchers");

describe("CLDAuction", function () {
  async function deployContractsFixture() {
    const [alice] = await ethers.getSigners();

    const cldFactory = await ethers.getContractFactory("ClassicDAO");
    const CLD = await cldFactory.deploy(
      20000000000000000000n,
      "MockCLD",
      "MCLD"
    );
    await CLD.deployed();
    expect(await CLD.balanceOf(alice.address)).to.equal(20000000000000000000n);

    const cldAuctFFactory = await ethers.getContractFactory(
      "CLDDao_Auction_Factory"
    );
    const CLDAucFactory = await cldAuctFFactory.deploy();
    await CLDAucFactory.deployed();

    // Create a test CLDAuction
    await expect(
      CLDAucFactory.newCLDAuction(120, 20000000000000000000n)
    ).to.emit(CLDAucFactory, "NewAuction");
    const AuctInstanceBase = await CLDAucFactory.SeeAuctionData(0);
    const AuctionFactory = await ethers.getContractFactory("CLDDao_Auction");
    const AuctionInstance = await AuctionFactory.attach(
      `${AuctInstanceBase[0]}`
    );

    await expect(
      CLD.connect(alice).transfer(
        AuctionInstance.address,
        20000000000000000000n
      )
    ).to.changeTokenBalances(
      CLD,
      [alice, AuctionInstance.address],
      [-20000000000000000000n, 20000000000000000000n]
    );

    return { CLD, CLDAucFactory, AuctionInstance };
  }

  it("is initialized correctly, with a test auction set", async function () {
    await loadFixture(deployContractsFixture);
  });

  it("supports depositing Ether, denies deposits after auction time expires", async function () {
    const { AuctionInstance } = await loadFixture(deployContractsFixture);
    const [alice, bob, carol, david, erin] = await ethers.getSigners();

    for (let thisUser of [alice, bob, carol, david, erin]) {
      // Send some CLD to test users, make them approve it to the VotingSystem contract
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: ethers.utils.parseEther("1.0"),
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
    }
    const AuctionEtherBalance = await ethers.provider.getBalance(
      AuctionInstance.address
    );
    const AuctionExpectedBalance = ethers.utils.parseEther("5.0");

    expect(AuctionEtherBalance).to.equal(
      AuctionExpectedBalance,
      "This error shall not be seen"
    );

    await network.provider.send("evm_increaseTime", [120]);

    for (let thisUser of [alice, bob, carol, david, erin]) {
      // We will not see this, the Auction time expired
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: ethers.utils.parseEther("1.0"),
        })
      ).to.be.revertedWith("CLDAuction.DepositETC: The sale is over");
    }
  });

  it("supports withdrawing the Ether once the Auction period is over", async function () {
    const { AuctionInstance } = await loadFixture(deployContractsFixture);
    const [alice, bob] = await ethers.getSigners();

    await expect(
      await ethers.provider.getBalance(AuctionInstance.address)
    ).to.equal(0, "Balance should be 0");

    // TO DO check for OnlyDAO modifier compatibility
    // We will not see this, the Auction time expired
    expect(
      await AuctionInstance.connect(alice).DepositETC({
        value: ethers.utils.parseEther("1.0"),
      })
    ).to.emit(AuctionInstance, "ETCDeposited");
    const AuctionEtherBalance = await ethers.provider.getBalance(
      AuctionInstance.address
    );
    const AuctionExpectedBalance = await ethers.utils.parseEther("1.0");

    expect(AuctionEtherBalance).to.equal(
      AuctionExpectedBalance,
      "This error shall not be seen"
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

  it("Allows each Participant to withdraw their share of the pooled CLD", async function () {
    const { AuctionInstance } = await loadFixture(deployContractsFixture);
    const [alice, bob, carol, david, erin] =await ethers.getSigners();

    for (let thisUser of [alice, bob, carol, david, erin]) {
      // Send some CLD to test users, make them approve it to the VotingSystem contract
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: ethers.utils.parseEther("1.0"),
        })
      ).to.emit(AuctionInstance, "ETCDeposited");
    }

    const AuctionEtherBalance = await ethers.provider.getBalance(
      AuctionInstance.address
    );
    const AuctionExpectedBalance = await ethers.utils.parseEther("5.0");

    expect(AuctionEtherBalance).to.equal(
      AuctionExpectedBalance,
      "This error shall not be seen"
    );

    

  });


  // it("helpful comment, add more tests here", async function () {
  // });
});
