import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { days } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time/duration";
import { expect } from "chai";
import { access } from "fs";
import { ethers } from "hardhat";

const MAKER_FEE = 250
const TAKER_FEE = 500
const WITHDRAW_EARLY_FEE = 1000
const MINIMUM_STEP = 500
const eth = BigInt(10) ** BigInt(18)
const LISTING_STAKE = BigInt(10) * eth
const MINIMUM_BUYOUT = BigInt(10) * eth
const DURATION = 30 * 86400 // 30 days in seconds
const COOLDOWN = 15 * 86400 // 15 days in seconds

// function that calculates fees
function fee(amount: bigint, early: boolean): bigint {
    const takerFee = amount * BigInt(TAKER_FEE) / (BigInt(10000) + BigInt(TAKER_FEE));
    const makerFee = (amount - takerFee) * BigInt(MAKER_FEE) / BigInt(10000);
    const earlyFee = (amount - takerFee - makerFee) * BigInt(WITHDRAW_EARLY_FEE) / BigInt(10000);
    if (early) {
        return takerFee + makerFee + earlyFee;
    } else {
        return takerFee + makerFee;
    }
}

function addTakerFee(bid: bigint): bigint {
    return bid * (BigInt(10000) + BigInt(TAKER_FEE)) / BigInt(10000);
}

describe("AuctionV1", function () {
    async function deployAuctionV1Fixture() {
        const [owner, addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();
        const feeReceiver = addr5;

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const mockERC20 = await MockERC20.deploy(BigInt(1000) * eth);
        const AuctionV1 = await ethers.getContractFactory("AuctionV1");
        const auctionV1 = await AuctionV1.deploy(await mockERC20.getAddress(), LISTING_STAKE, MAKER_FEE, TAKER_FEE, WITHDRAW_EARLY_FEE, MINIMUM_STEP, MINIMUM_BUYOUT, DURATION, feeReceiver.address, COOLDOWN);

        // Grant approver role to owner.
        await auctionV1.grantApprover(owner)

        // Send 100 MOCK to eacha address.
        await mockERC20.transfer(addr1.address, BigInt(100) * eth);
        await mockERC20.transfer(addr2.address, BigInt(100) * eth);
        await mockERC20.transfer(addr3.address, BigInt(100) * eth);
        await mockERC20.transfer(addr4.address, BigInt(100) * eth);

        return { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4, feeReceiver };
    }

    describe("Deployment", function () {
        it("Should deploy", async function () {
            await loadFixture(deployAuctionV1Fixture);
        });

        it("Should not deploy with invalid constructor values", async function () {
            const [addr5] = await ethers.getSigners();
            const feeReceiver = addr5;

            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const mockERC20 = await MockERC20.deploy(BigInt(1000) * eth);
            const AuctionV1 = await ethers.getContractFactory("AuctionV1");

            await expect(AuctionV1.deploy(await mockERC20.getAddress(), LISTING_STAKE, 10100, TAKER_FEE, WITHDRAW_EARLY_FEE, MINIMUM_STEP, MINIMUM_BUYOUT, DURATION, feeReceiver.address, COOLDOWN)).to.be.revertedWith("AuctionV1: maker fee must be <= 10000");
            await expect(AuctionV1.deploy(await mockERC20.getAddress(), LISTING_STAKE, MAKER_FEE, 10100, WITHDRAW_EARLY_FEE, MINIMUM_STEP, MINIMUM_BUYOUT, DURATION, feeReceiver.address, COOLDOWN)).to.be.revertedWith("AuctionV1: taker fee must be <= 10000");
            await expect(AuctionV1.deploy(await mockERC20.getAddress(), LISTING_STAKE, MAKER_FEE, TAKER_FEE, WITHDRAW_EARLY_FEE, MINIMUM_STEP, MINIMUM_BUYOUT, DURATION, "0x0000000000000000000000000000000000000000", COOLDOWN)).to.be.revertedWith("AuctionV1: fee receiver address cannot be 0x0");
            await expect(AuctionV1.deploy(await mockERC20.getAddress(), LISTING_STAKE, MAKER_FEE, TAKER_FEE, WITHDRAW_EARLY_FEE, MINIMUM_STEP, MINIMUM_BUYOUT, 36600*86400, feeReceiver.address, COOLDOWN)).to.be.revertedWith("AuctionV1: listing duration must be <= 36500 days in seconds");
        });

        it("Should set the correct owner", async function () {
            const { auctionV1, owner } = await loadFixture(deployAuctionV1Fixture);
            expect(await auctionV1.owner()).to.equal(owner.address);
        });

        it("Should give initial balances", async function () {
            const { mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);

            expect(await mockERC20.balanceOf(addr1.address)).to.equal(BigInt(100) * eth);
            expect(await mockERC20.balanceOf(addr2.address)).to.equal(BigInt(100) * eth);
            expect(await mockERC20.balanceOf(addr3.address)).to.equal(BigInt(100) * eth);
            expect(await mockERC20.balanceOf(addr4.address)).to.equal(BigInt(100) * eth);
        });

        it("Should set correct consants", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4, feeReceiver } = await loadFixture(deployAuctionV1Fixture);

            expect(await auctionV1.arkm()).to.equal(await mockERC20.getAddress());
            expect(await auctionV1.listingStake()).to.equal(LISTING_STAKE);
            expect(await auctionV1.makerFee()).to.equal(MAKER_FEE);
            expect(await auctionV1.takerFee()).to.equal(TAKER_FEE);
            expect(await auctionV1.withdrawEarlyFee()).to.equal(WITHDRAW_EARLY_FEE);
            expect(await auctionV1.minimumStepBasis()).to.equal(MINIMUM_STEP);
            expect(await auctionV1.feeReceiverAddress()).to.equal(feeReceiver.address);
            expect(await auctionV1.takerFee()).to.equal(TAKER_FEE);
            expect(await auctionV1.listingDurationDays()).to.equal(DURATION);
            expect(await auctionV1.acceptingListings()).to.equal(true);
            expect(await auctionV1.accruedFees()).to.equal(0);
            expect(await auctionV1.listingStake()).to.equal(LISTING_STAKE);
            expect(await auctionV1.minimumBuyoutPrice()).to.equal(MINIMUM_BUYOUT);
            expect(await auctionV1.cooldown()).to.equal(COOLDOWN);

        });

        it("Should check if ERC20 token has total supply", async function () {
            const [owner, addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();
            const feeReceiver = addr5;

            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const mockERC20 = await MockERC20.deploy(BigInt(1000) * eth);
            const AuctionV1 = await ethers.getContractFactory("AuctionV1");
            const auctionV1 = await AuctionV1.deploy(await mockERC20.getAddress(), LISTING_STAKE, MAKER_FEE, TAKER_FEE, WITHDRAW_EARLY_FEE, MINIMUM_STEP, MINIMUM_BUYOUT, DURATION, feeReceiver.address, COOLDOWN);
            await expect(AuctionV1.deploy(auctionV1, LISTING_STAKE, MAKER_FEE, TAKER_FEE, WITHDRAW_EARLY_FEE, MINIMUM_STEP, MINIMUM_BUYOUT, DURATION, feeReceiver.address, COOLDOWN)).to.be.revertedWith("AuctionV1: provided token address does not implement ERC20Burnable");

        });
    })

    describe("Change settings", function () {
        it("Should change the listing stake", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.setListingStake(1776);
            expect(await auctionV1.listingStake()).to.equal(1776);
            await expect(auctionV1.connect(addr1).setListingStake(1776)).to.be.rejectedWith("Ownable: caller is not the owner");
        });
        it("Should change the maker fee", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.setMakerFee(100);
            expect(await auctionV1.makerFee()).to.equal(100);
            await expect(auctionV1.connect(addr1).setMakerFee(100)).to.be.rejectedWith("Ownable: caller is not the owner");
            await expect(auctionV1.connect(owner).setMakerFee(100000)).to.be.rejectedWith("BountyV1: maker fee must be <= 100%");

        });
        it("Should change the taker fee", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.setTakerFee(100);
            expect(await auctionV1.takerFee()).to.equal(100);
            await expect(auctionV1.connect(addr1).setTakerFee(100)).to.be.rejectedWith("Ownable: caller is not the owner");
            await expect(auctionV1.connect(owner).setTakerFee(100000)).to.be.rejectedWith("BountyV1: taker fee must be <= 100%");
        });
        it("Should change the withdraw early fee", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.setWithdrawEarlyFee(100);
            expect(await auctionV1.withdrawEarlyFee()).to.equal(100);
            await expect(auctionV1.connect(addr1).setWithdrawEarlyFee(100)).to.be.rejectedWith("Ownable: caller is not the owner");
            await expect(auctionV1.connect(owner).setWithdrawEarlyFee(100000)).to.be.rejectedWith("BountyV1: withdraw early fee must be <= 100%");

        });
        it("Should change the cooldown", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.setCooldown(7 * 24* 60 * 60);
            expect(await auctionV1.cooldown()).to.equal(7 * 24* 60 * 60);
            await expect(auctionV1.connect(addr1).setCooldown(100)).to.be.rejectedWith("Ownable: caller is not the owner");
        });
        it("Should change the minimum step basis", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.setMinimumStep(1);
            expect(await auctionV1.minimumStepBasis()).to.equal(1);
            await expect(auctionV1.connect(addr1).setMinimumStep(100)).to.be.rejectedWith("Ownable: caller is not the owner");
        });
        it("Should change the minimum buyout price", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.setMinimumBuyoutPrice(1);
            expect(await auctionV1.minimumBuyoutPrice()).to.equal(1);
            await expect(auctionV1.connect(addr1).setMinimumBuyoutPrice(100)).to.be.rejectedWith("Ownable: caller is not the owner");
        });
        it("Should change the fee receiver address", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.setFeeReceiverAddress(addr1.address);
            expect(await auctionV1.feeReceiverAddress()).to.equal(addr1.address);
            await expect(auctionV1.connect(addr1).setFeeReceiverAddress(addr1.address)).to.be.rejectedWith("Ownable: caller is not the owner");
            await expect(auctionV1.connect(owner).setFeeReceiverAddress("0x0000000000000000000000000000000000000000")).to.be.rejectedWith("BountyV1: fee receiver address cannot be 0x0");

        });
        it("Should change the listing duration days", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.connect(owner).setDefaultListingDuration(1);
            expect(await auctionV1.listingDurationDays()).to.equal(1);
            await expect(auctionV1.connect(addr1).setDefaultListingDuration(100)).to.be.rejectedWith("Ownable: caller is not the owner");
        });
        it("Should grand and revoke the approver", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.grantApprover(addr1);
            expect(await auctionV1.isApprover(addr1.address)).to.equal(true);
            await auctionV1.connect(owner).revokeApprover(addr1.address);
            expect(await auctionV1.isApprover(addr1.address)).to.equal(false);
            await expect(auctionV1.connect(addr1).grantApprover(addr1.address)).to.be.rejectedWith("Ownable: caller is not the owner");
            await expect(auctionV1.connect(addr1).revokeApprover(addr1.address)).to.be.rejectedWith("Ownable: caller is not the owner");
        });

        it("Should stop accepting new listings", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4,  } = await loadFixture(deployAuctionV1Fixture);
            await auctionV1.connect(owner).stopAcceptingListings();
            await expect(auctionV1.connect(owner).stakeListing(1, 100, 0, DURATION, true)).to.be.rejectedWith("AuctionV1: not accepting listings");
            await expect(auctionV1.connect(addr2).stopAcceptingListings()).to.be.rejectedWith("Ownable: caller is not the owner");
        });

    });

    describe("Collect fee", function () {
        it("Should collect fee", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner, feeReceiver } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);
            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);
            await time.increase(time.duration.seconds(DURATION));
            await time.increase(time.duration.days(16))
            await auctionV1.connect(addr1).claim(listingID, false);

            const oldBalance = await mockERC20.balanceOf(feeReceiver);
            await auctionV1.connect(owner).withdrawFees();
            expect(await mockERC20.balanceOf(feeReceiver)).to.equal(oldBalance + fee(addTakerFee(bid), false));

            await expect(auctionV1.connect(addr2).withdrawFees()).to.revertedWith("Ownable: caller is not the owner");

        });
    });

    describe("Create listings", function () {
        it("Should create a non-auction listing", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const TimeInSeconds = 0 // default time resolves to 30 days.

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, TimeInSeconds, false);
        });

        it("Should have functional getters", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const TimeInSeconds = 0 // default time resolves to 30 days.

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, TimeInSeconds, false);

            expect(await auctionV1.closesAt(listingID)).to.greaterThan(0);
            expect(await auctionV1.currentBidID(listingID)).to.equal(0);
            expect(await auctionV1.currentBidAmount(listingID)).to.equal(0);
            expect(await auctionV1.withdrawn(listingID)).to.equal(false);
            expect(await auctionV1.buyoutPrice(listingID)).to.equal(100000000000000000000n);
            expect(await auctionV1.listingIsAuction(listingID)).to.equal(false);
            expect(await auctionV1.listingStartingPrice(listingID)).to.equal(0);
            await expect(auctionV1.isClosed(123)).to.be.revertedWith("AuctionV1: listing does not exist");
        });

        it("Should create a pure auction listing", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const TimeInSeconds = 0 // default time resolves to 30 days.


            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, 0, 0, DURATION, true);
        });

        it("Should create an auction with buyout listing", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 10, DURATION, true);
            expect(await auctionV1.getListingStake(listingID)).to.equal(LISTING_STAKE);
        });

        it("Should not create an auction with buyout less than start price", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await expect(auctionV1.connect(addr1).stakeListing(listingID, buyout, buyout+BigInt(1), DURATION, true)).to.be.revertedWith("AuctionV1: starting price must be lower than or equal to the buyout price");
        });

        it("Should create an auction with buyout less than start price if buyout is zero", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, 0, 100, DURATION, true);
        });

        it("Should not accept listings after contract stops accepting them", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;

            await auctionV1.connect(owner).stopAcceptingListings();

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await expect(auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true)).to.be.revertedWith("AuctionV1: not accepting listings");
        });

        it("Should not accept a listing with the same ID twice", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);
            await expect(auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION,  true)).to.be.revertedWith("AuctionV1: listing already exists");
        });

        it("Should not accept a non-auction listing without a buyout", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await expect(auctionV1.connect(addr1).stakeListing(listingID, 0, 0, DURATION, false)).to.be.revertedWith("AuctionV1: must have a buyout price or be an auction");
        });

        it("Should not accept a buyout between 0 and the minimum buyout", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await expect(auctionV1.connect(addr1).stakeListing(listingID, 1, 0, DURATION, false)).to.be.revertedWith("AuctionV1: must have a buyout price larger than the minimum buyout price");
        });
    })

    describe("Bid on listings", function () {
        it("Should accept a bid", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);
        });

        it("Should accept a bid but extend end time if within 30 min of expiry", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);
            time.increase(DURATION - 15 * 60);
            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);
            const t1 = await time.latest();
            expect(await auctionV1.closesAt(listingID)).to.equal(BigInt(t1 + 30*60));

            // Extend a second time.
            await mockERC20.connect(addr3).approve(auctionV1.getAddress(), addTakerFee(BigInt(24)*eth));
            await auctionV1.connect(addr3).placeBid(listingID, BigInt(24)*eth, bidID+1);
            const t2 = await time.latest();
            // Confirm this has changed the end time.
            expect(await auctionV1.closesAt(listingID)).to.equal(t2+30*60) // off by two seconds

        });

        it("Should accept a second bid and pay back fist bid", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid1 = BigInt(20) * eth;
            const bid1ID = 1001;
            const bid2 = BigInt(30) * eth;
            const bid2ID = 1002;
            const balanceBefore = await mockERC20.balanceOf(addr2);

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);
            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid1));
            await auctionV1.connect(addr2).placeBid(listingID, bid1, bid1ID);
            await mockERC20.connect(addr3).approve(auctionV1.getAddress(), addTakerFee(bid2));
            await auctionV1.connect(addr3).placeBid(listingID, bid2, bid2ID);

            expect(await mockERC20.balanceOf(addr2)).to.be.equal(balanceBefore);
        });

        it("Should accept buyout a bid even if step not big enough", async function () {
            const { auctionV1, mockERC20, owner, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(10) * eth;
            const bid = BigInt(13) * eth;
            const bidID = 1001;

            await auctionV1.connect(owner).setMinimumStep(BigInt(500000));

            await mockERC20.connect(owner).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(owner).stakeListing(listingID, buyout, 0, DURATION, true);
            expect(await auctionV1.isClosed(listingID)).to.be.false;
            await expect (auctionV1.winningBidID(listingID)).to.be.revertedWith("AuctionV1: listing is not closed");
            await expect (auctionV1.winningBidder(listingID)).to.be.revertedWith("AuctionV1: listing is not closed");
            await expect (auctionV1.winningBidder(10)).to.be.revertedWith("AuctionV1: listing does not exist");


            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(BigInt(9)* eth));
            await auctionV1.connect(addr2).placeBid(listingID, BigInt(9)* eth, bidID);

            await mockERC20.connect(addr3).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr3).placeBid(listingID, bid, bidID);

            expect(await auctionV1.isClosed(listingID)).to.be.true;
            expect(await auctionV1.winningBidID(listingID)).to.be.equal(bidID);
            await expect (auctionV1.winningBidID(10)).to.be.revertedWith("AuctionV1: listing does not exist");

            expect(await auctionV1.winningBidder(listingID)).to.be.equal(addr3.address);
        });

        it("Should accept buyout a bid", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(10) * eth;
            const bid = BigInt(13) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr3).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr3).placeBid(listingID, bid, bidID);
            expect(await auctionV1.isClosed(listingID)).to.be.true;

        });


        it("Should not accept a bid if the listing does not exist", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await expect(auctionV1.connect(addr2).placeBid(listingID, bid, bidID)).to.be.revertedWith("AuctionV1: listing does not exist");
        });

        it("Should not accept a bid if it's below the starting price", async function () {

            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(10) * eth;
            const bid = BigInt(9) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, BigInt(10)*eth, DURATION, true);
            await mockERC20.connect(addr3).approve(auctionV1.getAddress(), addTakerFee(bid));
            await expect(auctionV1.connect(addr3).placeBid(listingID, bid, bidID)).to.be.revertedWith("AuctionV1: bid must be at least starting price");
        });

        it("Should not accept a bid if it's below the previous bid and there's no buyout", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, 0, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            await mockERC20.connect(addr3).approve(auctionV1.getAddress(), addTakerFee(bid-1n));
            await expect(auctionV1.connect(addr3).placeBid(listingID, bid, bidID)).to.be.revertedWith("AuctionV1: bid must be higher by the minimum step increase");
        });

        it("Should not accept a bid if the listing is closed", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await auctionV1.grantApprover(addr2);
            await auctionV1.connect(addr2).rejectListing(listingID);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await expect(auctionV1.connect(addr2).placeBid(listingID, bid, bidID)).to.be.revertedWith("AuctionV1: listing is closed");
            expect(await auctionV1.isClosed(listingID)).to.equal(true);
        });

        it("Should not accept a bid if the bid is lower than minimum step required", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(1) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);


            await auctionV1.grantApprover(addr2);
            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await expect(auctionV1.connect(addr2).placeBid(listingID, bid+BigInt(1), bidID)).to.be.revertedWith("AuctionV1: bid must be higher by the minimum step increase");
        });

        it("Should pay out existing bid if listing is rejected", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(1) * eth;
            const bidID = 1001;

            const balanceBefore = await mockERC20.connect(addr2).balanceOf(addr2);

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await auctionV1.grantApprover(addr2);
            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);
            await auctionV1.connect(addr2).rejectListing(listingID);
            expect(await mockERC20.balanceOf(addr2)).to.be.equal(balanceBefore);

            // The current bid for the listing should be 0.
            expect(await auctionV1.currentBidAmount(listingID)).to.be.equal(0);
            expect(await auctionV1.currentBidID(listingID)).to.be.equal(0);
        });

        it("Should not accept a bid if the listing has expired", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));

            await time.increase(time.duration.days(DURATION + 1));

            await expect(auctionV1.connect(addr2).placeBid(listingID, bid, bidID)).to.be.revertedWith("AuctionV1: listing has expired");
        });

        it("Should not accepd a non-buyout bid to a non-auction listing", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, false);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));

            await expect(auctionV1.connect(addr2).placeBid(listingID, bid, bidID)).to.be.revertedWith("AuctionV1: not accepting non-buyout bids");
        });

        it("Should not accept a non-buyout bid on non-auction bid", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployAuctionV1Fixture);
            const listingID = 1;
            const buyout = BigInt(25) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, false);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(BigInt(30) * eth));
            await expect(auctionV1.connect(addr2).placeBid(listingID, bid, bidID)).to.be.revertedWith("AuctionV1: not accepting non-buyout bids");
            await auctionV1.connect(addr2).placeBid(listingID, BigInt(30) * eth, bidID);
            expect(await auctionV1.currentBidAmount(listingID)).to.be.equal(BigInt(30) * eth);

        });

    });

    describe("Claim listings", function () {

        it("Should claim a listing", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);
            const oldBalance = await mockERC20.balanceOf(addr1);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            expect(await auctionV1.isClosed(listingID)).to.equal(false);
            await time.increase(time.duration.seconds(DURATION));
            await time.increase(time.duration.days(16))
            await auctionV1.connect(addr1).claim(listingID, false);
            expect(await auctionV1.isClosed(listingID)).to.equal(true);
            expect(await mockERC20.balanceOf(addr1)).to.equal(oldBalance + addTakerFee(bid) - fee(addTakerFee(bid), false));

        });


        it("Should claim a listing and return stake when there is no bid", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;

            await auctionV1.grantApprover(owner);
            const oldBalance = await mockERC20.balanceOf(addr1);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);
            await time.increase(time.duration.seconds(DURATION));
            await time.increase(time.duration.days(16))
            await auctionV1.connect(addr1).claim(listingID, false);
            expect(await auctionV1.isClosed(listingID)).to.equal(true);
            expect(await mockERC20.balanceOf(addr1)).to.equal(oldBalance);

        });


        it("Should fail to claim unless paying fee", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            await expect(auctionV1.connect(addr1).claim(listingID, false)).to.be.revertedWith("AuctionV1: listing does not exist");


        });

        it("Should fail to claim unless paying fee", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            expect(await auctionV1.isClosed(listingID)).to.equal(false);
            await time.increase(time.duration.seconds(DURATION + 1));
            await expect(auctionV1.connect(addr1).claim(listingID, false)).to.be.revertedWith("AuctionV1: can not withdraw before cooldown period expires");
        });

        it("Should fail to claim unless paying fee with changed cooldown", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);
            await auctionV1.connect(owner).setCooldown(10 * 24 * 60 * 60);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            expect(await auctionV1.isClosed(listingID)).to.equal(false);
            await time.increase(time.duration.seconds(DURATION + 1));
            await expect(auctionV1.connect(addr1).claim(listingID, false)).to.be.revertedWith("AuctionV1: can not withdraw before cooldown period expires");
            await time.increase(time.duration.seconds(9 * 24 * 60 * 60));
            await expect(auctionV1.connect(addr1).claim(listingID, false)).to.be.revertedWith("AuctionV1: can not withdraw before cooldown period expires");
            await time.increase(time.duration.seconds(1 * 24 * 60 * 60));
            await auctionV1.connect(addr1).claim(listingID, false);
            expect(await auctionV1.withdrawn(listingID)).to.equal(true);
        });


        it("Should claim a listing early for a fee", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);
            const oldBalance = await mockERC20.balanceOf(addr1);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            expect(await auctionV1.isClosed(listingID)).to.equal(false);
            expect(await auctionV1.withdrawn(listingID)).to.equal(false);
            await time.increase(time.duration.seconds(DURATION+1));
            await auctionV1.connect(addr1).claim(listingID, true);
            expect(await auctionV1.isClosed(listingID)).to.equal(true);
            expect(await mockERC20.balanceOf(addr1)).to.equal(oldBalance + addTakerFee(bid) - fee(addTakerFee(bid), true));
            expect(await auctionV1.withdrawn(listingID)).to.equal(true);


        });


        it("Should claim a listing early for a fee only if is poster", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);
            const oldBalance = await mockERC20.balanceOf(addr1);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            expect(await auctionV1.isClosed(listingID)).to.equal(false);
            await time.increase(time.duration.seconds(DURATION+1));
            await expect(auctionV1.connect(addr2).claim(listingID, true)).to.be.revertedWith("AuctionV1: can not withdraw before cooldown period expires");
            expect(await auctionV1.withdrawn(listingID)).to.equal(false);

        });


        it("Should claim a listing early without a fee if approver", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);
            const oldBalance = await mockERC20.balanceOf(addr1);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            expect(await auctionV1.isClosed(listingID)).to.equal(false);
            await time.increase(time.duration.seconds(DURATION+1));
            await auctionV1.connect(owner).claim(listingID, false);
            expect(await auctionV1.isClosed(listingID)).to.equal(true);
            expect(await mockERC20.balanceOf(addr1)).to.equal(oldBalance + addTakerFee(bid) - fee(addTakerFee(bid), false));

        });

        it("Should let anyone claim on behalf of the lister", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);
            const oldBalance = await mockERC20.balanceOf(addr1);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            await time.increase(time.duration.seconds(DURATION));
            await time.increase(time.duration.days(16));
            await auctionV1.connect(addr3).claim(listingID, false);
            expect(await mockERC20.balanceOf(addr1)).to.equal(oldBalance + addTakerFee(bid) - fee(addTakerFee(bid), false));
        });

        it("Should not be allowed to claim an open", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            expect(await auctionV1.isClosed(listingID)).to.equal(false);

            await expect(auctionV1.connect(addr1).claim(listingID, false)).to.be.revertedWith("AuctionV1: listing is not closed");

        });

        it("Should not claim a listing twice", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidWithFee = addTakerFee(bid);
            const bidID = 1001;

            await auctionV1.grantApprover(owner);
            const oldBalance = await mockERC20.balanceOf(addr1);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), bidWithFee);
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            expect(await auctionV1.isClosed(listingID)).to.equal(false);
            await time.increase(time.duration.seconds(DURATION));
            await time.increase(time.duration.days(16))
            await auctionV1.connect(addr1).claim(listingID, false);
            expect(await auctionV1.isClosed(listingID)).to.equal(true);
            expect(await mockERC20.balanceOf(addr1)).to.equal(oldBalance + bidWithFee - fee(bidWithFee, false));
            await expect(auctionV1.connect(addr1).claim(listingID, false)).to.be.revertedWith("AuctionV1: has already been withdrawn");
            expect(await auctionV1.isClosed(listingID)).to.equal(true);
            expect(await mockERC20.balanceOf(addr1)).to.equal(oldBalance + bidWithFee - fee(bidWithFee, false));
        });
    });
    describe("Closing listings", function () {
        it("Should close a listing", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            expect(await auctionV1.withdrawn(listingID)).to.equal((false));
            await auctionV1.connect(owner).rejectListing(listingID);
            expect(await auctionV1.isClosed(listingID)).to.equal(true);
            expect(await auctionV1.withdrawn(listingID)).to.equal((true));
        });

        it("Should close listing when there is no bid on it", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            await auctionV1.grantApprover(owner);
            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);
            await auctionV1.connect(owner).rejectListing(listingID);
            await expect (auctionV1.winningBidder(listingID)).to.be.revertedWith("AuctionV1: listing has not been bid on");
            await expect (auctionV1.winningBidID(listingID)).to.be.revertedWith("AuctionV1: listing has not been bid on");

        });

        it("Should close a listing and not allow claim afterwards", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(200) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);
            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);
            await time.increase(time.duration.days(DURATION + 16));
            await auctionV1.connect(owner).rejectListing(listingID);
            await expect(auctionV1.connect(addr1).claim(listingID, false)).to.be.revertedWith("AuctionV1: has already been withdrawn");

        });

        it("Should not allow a non-approver non-poster to close a listing", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            await expect(auctionV1.connect(addr2).rejectListing(listingID)).to.be.revertedWith("AuctionV1: closing requires approver");
        });

        it("Should not allow a listing to be closed if it is already closed", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await mockERC20.connect(addr2).approve(auctionV1.getAddress(), addTakerFee(bid));
            await auctionV1.connect(addr2).placeBid(listingID, bid, bidID);

            await auctionV1.connect(owner).rejectListing(listingID);

            await expect(auctionV1.connect(owner).rejectListing(listingID)).to.be.revertedWith("AuctionV1: listing is closed");
        });

        it("Should not allow non-approvers to close early", async function () {
            const { auctionV1, mockERC20, addr1, addr2, addr3, addr4, owner } = await loadFixture(deployAuctionV1Fixture);

            const listingID = 1;
            const buyout = BigInt(100) * eth;
            const bid = BigInt(20) * eth;
            const bidID = 1001;

            await auctionV1.grantApprover(owner);

            await mockERC20.connect(addr1).approve(auctionV1.getAddress(), LISTING_STAKE);
            await auctionV1.connect(addr1).stakeListing(listingID, buyout, 0, DURATION, true);

            await expect(auctionV1.connect(addr1).rejectListing(listingID)).to.be.revertedWith("AuctionV1: closing requires approver");
        });
    });
})
