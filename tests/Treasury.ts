const { expect } = require("chai");
const { BigNumber } = require("ethers");
const { artifacts, contract, ethers, network } = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("Treasury", function () {
    async function deployContracts() {
        const cldFactory = await ethers.getContractFactory("HTA1");
        const CLD = await cldFactory.deploy(
          1000,
          "MockERC20",
          "MTKN"
        );

        const daoFactory = await ethers.getContractFactory('FakeDAO')
        const DAO = await daoFactory.deploy()
        await DAO.deployed()

        const treasuryFactory = await ethers.getContractFactory("HarmoniaDAOTreasury");
        const Treasury = await treasuryFactory.deploy(DAO.address, CLD.address);
        await Treasury.deployed();

        return { Treasury, CLD, DAO }
    }

    it("sends and receives ether, given caller has elevated rights", async function () {
        const [ alice, bob ] = await ethers.getSigners();
        const { Treasury, CLD } = await deployContracts()
        const sentValue = await ethers.utils.parseEther("10.0")
        const bobOGEtherBalance = await ethers.provider.getBalance(bob.address)

        const sendEther =  alice.sendTransaction({
            to: Treasury.address,
            value: sentValue, // Sends exactly 10.5 ether
        });

        await expect(await ethers.provider.getBalance(Treasury.address))
        .to.be.equal(0);
        await expect(sendEther)
        .to.emit(Treasury, "EtherReceived");
        await expect(await ethers.provider.getBalance(Treasury.address))
        .to.be.equal(sentValue);
        
        // Should give an error, not allowed
        await expect(Treasury.connect(alice).TransferETH(BigInt(sentValue/2), bob.address))
        .to.be.reverted;
    });

    /* Stuff to test:
    *
    * RegisterAsset
    * ChangeRegisteredAssetLimit
    * IsRegistered
    * ReceiveRegisteredAsset
    * TransferERC20
    // it('interacts correctly with ERC20 assets', async function () {
    // });
    * UserAssetClaim
    * AssetClaim
    // it("helpful comment, add more tests here", async function () {
    // });
    * GetBackingValueEther
    * GetBackingValueAsset
    // it("helpful comment, add more tests here", async function () {
    // });
    */

    
    // it("helpful comment, add more tests here", async function () {
    // });
});