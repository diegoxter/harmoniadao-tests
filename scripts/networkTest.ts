const { ethers } = require('hardhat')

describe('Accounts', function () {
    async function deployContractsFixture() {
        const [alice, bob, carol, david, erin] = await ethers.getSigners()
        console.log('are the following: ')

        for (let thisUser of [alice, bob, carol, david, erin]) {
            console.log(await thisUser.address)
        }
    }
    it('done', async function () {
        await deployContractsFixture()
    })
})
