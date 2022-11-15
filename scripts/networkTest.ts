const { ethers } = require('hardhat')

describe('Accounts', function () {
    async function deployContractsFixture() {
        const [alice, bob, carol, david, erin] = await ethers.getSigners()
        
        let count = 1 
        for (let thisUser of [alice, bob, carol, david, erin]) {
            console.log('Account number ' + count + ' address is ' + (await thisUser.address)
                + ' with this amount of ether: ' + (await ethers.provider.getBalance(thisUser.address)))
        
            count++
        }
    }
    it('done', async function () {
        await deployContractsFixture()
    })
})
