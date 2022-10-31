const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { artifacts, contract, ethers, network } = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("CLDAuction", function () {
  async function deployMockToken() {
    const [ alice ] = await ethers.getSigners();

    const cldFactory = await ethers.getContractFactory("HTA1");
    const CLD = await cldFactory.deploy(
      10000000000000000000n,
      "MockERC20",
      "MTKN"
    );
    await CLD.deployed();
    expect(await CLD.balanceOf(alice.address)).to.equal(10000000000000000000n);
  
    return { CLD };
  }

  async function deployTreasury(token_address) {
    const [ alice ] = await ethers.getSigners();
    
    const treasuryFactory = await ethers.getContractFactory(
      "HarmoniaDAOTreasury"
    );
    const Treasury = await treasuryFactory.deploy(alice.address, token_address);
    await Treasury.deployed();

    return { Treasury }
  }

  async function transferMockToken(CLD_Address, deployer, to) {
    await expect(
    CLD_Address.connect(deployer).transfer(
      to.address,
      10000000000000000000n
    )
    ).to.changeTokenBalances(
    CLD_Address,
    [deployer, to.address],
    [-10000000000000000000n, 10000000000000000000n]
    );
    expect(await CLD_Address.balanceOf(to.address)).to.equal(10000000000000000000n);
  }

  async function deployAuctionFixture(treasury_address, token_address) {
    const [ alice, bob, carol, david ] = await ethers.getSigners();
    const RetireeFee = 100;

    const cldAuctFFactory = await ethers.getContractFactory(
      "CLDDao_Auction_Factory"
    );
    const CLDAucFactory = await cldAuctFFactory.deploy(alice.address, treasury_address, token_address);
    await CLDAucFactory.deployed();

    // Create a test CLDAuction
    await expect(
      CLDAucFactory.newCLDAuction(
        15,
        10000000000000000000n, 
        ethers.utils.parseEther("0.001"),
        RetireeFee,
        [bob.address, carol.address, david.address]
      )
    ).to.emit(CLDAucFactory, "NewAuction");
    const AuctInstanceBase = await CLDAucFactory.SeeAuctionData(0);
    const AuctionFactory = await ethers.getContractFactory("CLDDao_Auction");
    const AuctionInstance = await AuctionFactory.attach(
      `${AuctInstanceBase[0]}`
    );

    return { CLDAucFactory, AuctionInstance };
  }

  it("handles Ether deposits, denies them when not high enough and after auction expires", async function () {
    const [ alice, bob, carol, david, erin, random ] = await ethers.getSigners();
    const { AuctionInstance } = await deployAuctionFixture(random.address, random.address);
    const TestValue = await ethers.utils.parseEther("0.004")

    for (let thisUser of [ alice, bob, carol, david, erin ]) {
      // Depositing some Ether
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: TestValue,
        })
      ).to.emit(AuctionInstance, "ETCDeposited");
      // We will not see this, value sent is too low
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: (TestValue/4),
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
      "This error shall not be seen, the ether balance in the contract is TestValue * 5"
    );

    // Time related code
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await delay(8500);

    for (let thisUser of [alice, bob, carol, david, erin]) {
      // We will not see this, the Auction time expired
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: TestValue,
        })
      ).to.be.revertedWith("CLDAuction.DepositETC: The sale is over");
    }
  });

  it("handles withdrawing of Ether once the auction period is over", async function () {
    const [ alice, random ] = await ethers.getSigners();
    const { AuctionInstance } = await deployAuctionFixture(random.address, random.address);
    const TestValue = await ethers.utils.parseEther("0.004")

    await expect(
      await ethers.provider.getBalance(AuctionInstance.address)
    ).to.equal(0, "Balance should be 0");

    // TO DO check for OnlyDAO modifier compatibility
    expect(
      await AuctionInstance.connect(alice).DepositETC({
        value: TestValue,
      })
    ).to.emit(AuctionInstance, "ETCDeposited");
    
    const AuctionEtherBalance = await ethers.provider.getBalance(
      AuctionInstance.address
    );
    expect(AuctionEtherBalance).to.equal(
      TestValue,
      "This error shall not be seen, both contract's ether balance and TestValue are equal"
    );

    // We will not see this, the sale is not over yet
    await expect(
      AuctionInstance.connect(alice).WithdrawETC()
    ).to.be.revertedWith("CLDAuction.WithdrawETC: The sale is not over yet");
    
    // Time related code
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await delay(15900);

    expect(await AuctionInstance.connect(alice).WithdrawETC()).to.emit(
      AuctionInstance,
      "ETCDWithdrawed"
    );

    const AuctionNewEtherBalance = await ethers.provider.getBalance(
      AuctionInstance.address
    );
    expect(AuctionNewEtherBalance).to.equal(
      0,
      "This error shall not be seen, the contract has 0 ether"
    );
  });

  it("calculates the TokenShare for each participant, splits the prize accordingly", async function () {
    const { CLD } = await deployMockToken();
    const { AuctionInstance } = await deployAuctionFixture(CLD.address, CLD.address);
    const [ alice, bob, carol, david, erin ] =await ethers.getSigners();
    const TestValue = await ethers.utils.parseEther("0.004")
    // Let's get some tokens into the contract
    await transferMockToken(CLD, alice, AuctionInstance)

    // Everyone has 1/5 of the pooled ETC here
    for (let thisUser of [ alice, bob, carol, david, erin ]) {
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
      "This error shall not be seen, balance should be (TestValue * 5) ether"
    );

    // Everyone has 1/5 of the pool
    for (let thisUser of [alice, bob, carol, david, erin]) {
      const ParticipantPoolShare = await AuctionInstance.CheckParticipant(thisUser.address);
      expect(ParticipantPoolShare[2]).to.equal(
        2000,
        "This error shall not be seen"
      );
    }

    //Now Alice has 60% of the pool
    await expect(
      AuctionInstance.connect(alice).DepositETC({
        value: (BigInt(TestValue*5)),
      })
    ).to.emit(AuctionInstance, "ETCDeposited");

    const AlicePoolShare = await AuctionInstance.CheckParticipant(alice.address);
    expect(AlicePoolShare[2]).to.equal(
      6000,
      "This error shall not be seen, as Alice has 60% of the TokenShare"
    );
    for (let thisUser of [bob, carol, david, erin]) {
      const ParticipantPoolShare = await AuctionInstance.CheckParticipant(thisUser.address);
      expect(ParticipantPoolShare[2]).to.equal(
        1000,
        "This error shall not be seen, as everyone else holds only 10% each"
      );
    }

    // Time related code
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await delay(10000);

    // Testing the MTKN gets correctly split between participants
    const TotalMTKN = await CLD.totalSupply();
    const QuarterOfTotalMTKN = ((TotalMTKN*40) / 100)/4;
    await expect(
      AuctionInstance.connect(alice).WithdrawCLD(alice.address)
    ).to.emit(AuctionInstance, "CLDWithdrawed");
    const AliceTokenBalance = await CLD.balanceOf(alice.address);
    await expect(AliceTokenBalance).to.equal(BigInt((TotalMTKN*60)/100));

    for (let thisUser of [ bob, carol, david, erin]) {
      await expect(
         AuctionInstance.connect(thisUser).WithdrawCLD(thisUser.address)
       ).to.emit(AuctionInstance, "CLDWithdrawed");
       // These addresses hold 1/4 of 10 MTKN each
       const UserTokenBalance = await CLD.balanceOf(thisUser.address);
       await expect(UserTokenBalance).to.equal(BigInt(QuarterOfTotalMTKN));
     }

     // No MTKN left in the auction contract after all that
     const AuctionokenBalance = await CLD.balanceOf(AuctionInstance.address);
     await expect(AuctionokenBalance).to.equal(0);

  });

  it("allows people to retire from auctions, updates the TokenShare and splits the prize accorndingly", async function () {
    const { CLD } = await deployMockToken();
    const [ alice, bob, carol, david, erin ] = await ethers.getSigners();
    const { Treasury } = await deployTreasury(CLD.address)
    const { AuctionInstance } = await deployAuctionFixture(CLD.address, Treasury.address);
    const TestValue = await ethers.utils.parseEther("0.004");
    const Operator = 2;
    // Let's get some tokens into the contract
    await transferMockToken(CLD, alice, AuctionInstance);
    // aqui
    const OneDevOGEtherBalance = await ethers.provider.getBalance(bob.address)
    for (let thisUser of [ alice, bob, carol, david, erin ]) {
      await expect(
        AuctionInstance.connect(thisUser).DepositETC({
          value: TestValue,
        })
      ).to.emit(AuctionInstance, "ETCDeposited");
    }
    const OneOGContractEtherBalance = await ethers.provider.getBalance(AuctionInstance.address)
    
    const AuctionRetireeFee = await AuctionInstance.RetireeFee();
    let iteration = 1;
    for (let thisUser of [ bob, carol ]) {
      await expect(
        AuctionInstance.connect(thisUser).RetireFromAuction(BigInt(TestValue/2))
      ).to.emit(AuctionInstance, "ParticipantRetired");

      const ParticipantPoolShare = await AuctionInstance.CheckParticipant(thisUser.address);
      expect(ParticipantPoolShare[0]).to.be.at.least(
        BigInt(TestValue/Operator),
        "This error shall not be seen as both participants have TestValue/Operator"
      );

      //Here we verify the ETCDeductedFromRetirees gets higher
      const AuctionDeductedEher = await AuctionInstance.ETCDeductedFromRetirees();
      const ShouldBeTheDeductedEther = (((TestValue/Operator)*AuctionRetireeFee)/10000)*iteration
      await expect(AuctionDeductedEher).to.be.equal(BigInt(ShouldBeTheDeductedEther))
      //The balance of ether in the contract should be deducted correctly
      expect(await ethers.provider.getBalance(AuctionInstance.address))
      .to.be.equal(BigInt(((OneOGContractEtherBalance) - ((TestValue/Operator)*iteration-(ShouldBeTheDeductedEther)))))
      iteration += 1;
    }

    // TO DO fix this // Here we empty Alice deposits
    const AlicePoolShare = await AuctionInstance.CheckParticipant(alice.address);
    const AliceBalance = BigInt(AlicePoolShare[0])
    // Balance after two participants withdrawed
    const SecondContractBalance = BigInt(await ethers.provider.getBalance(AuctionInstance.address));
    await expect(
      AuctionInstance.connect(alice).RetireFromAuction(AlicePoolShare[0])
    ).to.emit(AuctionInstance, "ParticipantRetired");
    const NewAlicePoolShare = await AuctionInstance.CheckParticipant(alice.address);
    expect(NewAlicePoolShare[0]).to.be.equal(
      0,  // The previous operations leave just a little bit of ether in the contract
      "This error shall not be seen as Alice has retired almos all her ether in the sale"
    );
    // Testing the balance holds the correct amount of ether
    const WhatAliceReceivedAfterRetiring = (AliceBalance*BigInt(AuctionRetireeFee))/BigInt(10000)
    expect(await ethers.provider.getBalance(AuctionInstance.address))
    .to.be.equal(BigInt(SecondContractBalance  - (AliceBalance-WhatAliceReceivedAfterRetiring)))

    // Time related code
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await delay(15000);

    // Here we verify the MTKN is split correctly after retirees hit the sack
    const TotalMTKN = await CLD.totalSupply();
    // Alice doesnt have a share, so no piece of pie for her
    await expect(
      AuctionInstance.connect(alice).WithdrawCLD(alice.address)
    ).to.be.revertedWith("CLDAuction.WithdrawCLD: You didn't buy any CLD");

    for (let thisUser of [ bob, carol, david, erin ]) {
      await expect(
         AuctionInstance.connect(thisUser).WithdrawCLD(thisUser.address)
       ).to.emit(AuctionInstance, "CLDWithdrawed");

      const UserTokenBalance = await CLD.balanceOf(thisUser.address);
      const UserPoolShare = await AuctionInstance.CheckParticipant(thisUser.address);

      await expect(UserTokenBalance).to.be.equal(BigInt(((TotalMTKN*UserPoolShare[1])/10000)));
    }

    // TO DO verify the ETCDeductedFromRetirees gets sent to the devs
    const OneDevEtherBalance = await ethers.provider.getBalance(bob.address);

    await expect(OneDevEtherBalance).to.be.at.most(BigInt((OneDevOGEtherBalance-TestValue)+TestValue/Operator));
    
    expect(await AuctionInstance.connect(alice).WithdrawETC()).to.emit(
      AuctionInstance,
      "ETCDWithdrawed"
    );

  });

  // it("helpful comment, add more tests here", async function () {
  // });
});
