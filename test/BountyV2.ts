import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const MAKER_FEE = 250
const TAKER_FEE = 500
const eth = BigInt(10) ** BigInt(18)
const SUBMISSION_STAKE = BigInt(10) * eth
const DURATION = 30 // days
const MAX_ACTIVE_SUBMISSIONS = 20
const MIN_BOUNTY = BigInt(50) * eth

const BIGINT_ONE_IN_BPS = BigInt(10000)

describe("BountyV2", function () {
    async function deployBountyV2Fixture() {
        const [owner, addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();
        const feeReceiver = addr5;

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const mockERC20 = await MockERC20.deploy(BigInt(1000) * eth);
        const BountyV2 = await ethers.getContractFactory("BountyV2");
        const bountyV2 = await BountyV2.deploy(await mockERC20.getAddress(), SUBMISSION_STAKE, MAKER_FEE, TAKER_FEE, DURATION, feeReceiver.address, MAX_ACTIVE_SUBMISSIONS, MIN_BOUNTY);

        // Grant approver role to owner.
        await bountyV2.grantApprover(owner)

        // Send 100 MOCK to eacha address.
        await mockERC20.transfer(addr1.address, BigInt(200) * eth);
        await mockERC20.transfer(addr2.address, BigInt(200) * eth);
        await mockERC20.transfer(addr3.address, BigInt(200) * eth);
        await mockERC20.transfer(addr4.address, BigInt(200) * eth);

        return { bountyV2, mockERC20, owner, addr1, addr2, addr3, addr4, feeReceiver };
    }

    describe("Deployment", function () {
        it("Should deploy", async function () {
            await loadFixture(deployBountyV2Fixture);
        });

        it("Should not deploy with invalid constructor values", async function () {
            const [addr5] = await ethers.getSigners();
            const feeReceiver = addr5;

            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const mockERC20 = await MockERC20.deploy(BigInt(1000) * eth);
            const BountyV2 = await ethers.getContractFactory("BountyV2");
            const bountyV2 = await BountyV2.deploy(await mockERC20.getAddress(), SUBMISSION_STAKE, MAKER_FEE, TAKER_FEE, DURATION, feeReceiver.address, MAX_ACTIVE_SUBMISSIONS, MIN_BOUNTY);

            await expect(BountyV2.deploy(bountyV2, SUBMISSION_STAKE, 10010, TAKER_FEE, DURATION, feeReceiver.address, MAX_ACTIVE_SUBMISSIONS, MIN_BOUNTY)).to.be.revertedWith("BountyV2: maker fee must be <= 10000");
            await expect(BountyV2.deploy(bountyV2, SUBMISSION_STAKE, MAKER_FEE, 10010, DURATION, feeReceiver.address, MAX_ACTIVE_SUBMISSIONS, MIN_BOUNTY)).to.be.revertedWith("BountyV2: taker fee must be <= 10000");
            await expect(BountyV2.deploy(bountyV2, SUBMISSION_STAKE, MAKER_FEE, TAKER_FEE, DURATION, "0x0000000000000000000000000000000000000000", MAX_ACTIVE_SUBMISSIONS, MIN_BOUNTY)).to.be.revertedWith("BountyV2: fee receiver address cannot be 0x0");
            await expect(BountyV2.deploy(bountyV2, SUBMISSION_STAKE, MAKER_FEE, TAKER_FEE, 365001, feeReceiver.address, MAX_ACTIVE_SUBMISSIONS, MIN_BOUNTY)).to.be.revertedWith("BountyV2: bounty duration must be <= 36500 days");
        });


        it("Should set the correct owner", async function () {
            const { bountyV2, owner } = await loadFixture(deployBountyV2Fixture);
            expect(await bountyV2.owner()).to.equal(owner.address);
        });

        it("Should give initial balances", async function () {
            const { mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployBountyV2Fixture);

            expect(await mockERC20.balanceOf(addr1.address)).to.equal(BigInt(200) * eth);
            expect(await mockERC20.balanceOf(addr2.address)).to.equal(BigInt(200) * eth);
            expect(await mockERC20.balanceOf(addr3.address)).to.equal(BigInt(200) * eth);
            expect(await mockERC20.balanceOf(addr4.address)).to.equal(BigInt(200) * eth);
        });

        it("Should set correct consants", async function () {
            const { bountyV2, mockERC20 } = await loadFixture(deployBountyV2Fixture);

            expect(await bountyV2.arkm()).to.equal(await mockERC20.getAddress());
            expect(await bountyV2.submissionStake()).to.equal(SUBMISSION_STAKE);
            expect(await bountyV2.makerFee()).to.equal(MAKER_FEE);
            expect(await bountyV2.takerFee()).to.equal(TAKER_FEE);
            expect(await bountyV2.bountyDurationDays()).to.equal(DURATION);
            expect(await bountyV2.acceptingBounties()).to.equal(true);
            expect(await bountyV2.accruedFees()).to.equal(0);
            expect(await bountyV2.maxActiveSubmissions()).to.equal(MAX_ACTIVE_SUBMISSIONS);
            expect(await bountyV2.minBounty()).to.equal(MIN_BOUNTY);
        });

        it("Should check if ERC20 token has total supply", async function () {
            const [owner, addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();
            const feeReceiver = addr5;

            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const mockERC20 = await MockERC20.deploy(BigInt(1000) * eth);
            const BountyV2 = await ethers.getContractFactory("BountyV2");
            const bountyV2 = await BountyV2.deploy(await mockERC20.getAddress(), SUBMISSION_STAKE, MAKER_FEE, TAKER_FEE, DURATION, feeReceiver.address, MAX_ACTIVE_SUBMISSIONS, MIN_BOUNTY);

            await expect(BountyV2.deploy(bountyV2, SUBMISSION_STAKE, MAKER_FEE, TAKER_FEE, DURATION, feeReceiver.address, MAX_ACTIVE_SUBMISSIONS, MIN_BOUNTY)).to.be.revertedWith("BountyV2: provided token address does not implement ERC20Burnable");

        });
    })

    describe("Fund Bounty", function () {
        it("Should fund a bounty", async function () {
            const { bountyV2, mockERC20, addr1 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            expect(await bountyV2.funder(bountyId)).to.equal(addr1.address);
            expect(await bountyV2.amount(bountyId)).to.equal(amount);
            expect(await bountyV2.initialAmount(bountyId)).to.equal(amount);
            expect(await bountyV2.closed(bountyId)).to.equal(false);
        });

        it("Should enforce min bounty amount", async function () {
            const { bountyV2, mockERC20, addr1 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = SUBMISSION_STAKE / 2n
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await expect(bountyV2.connect(addr1).fundBounty(bountyId, amount)).to.be.revertedWith("BountyV2: below minimum bounty");
        });

        it("Should accrue the maker fee", async function () {
            const { bountyV2, mockERC20, addr1 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            const initialFees = await bountyV2.accruedFees();

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            const finalFees = await bountyV2.accruedFees();

            expect(finalFees - initialFees).to.equal(fee(amount, MAKER_FEE));
        });


        it("Should not fund an already funded bounty", async function () {
            const { bountyV2, mockERC20, addr1 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await expect(bountyV2.connect(addr1).fundBounty(bountyId, amount)).to.be.revertedWith("BountyV2: bounty already funded");
        });
    })

    describe("Make submission", function () {
        it("Should make a submission", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth;
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            expect(await bountyV2.submitterAtPosition(submissionId, bountyId)).to.equal(addr2.address);
            expect(await bountyV2.stakeAtPosition(0, bountyId)).to.equal(SUBMISSION_STAKE);
        });

        it("Should give submission position", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth;
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            expect (await bountyV2.submissionQueuePosition(submissionId, bountyId)).to.equal(0);
            await expect(bountyV2.submissionQueuePosition(2, bountyId)).to.be.revertedWith("BountyV2: submission not found");
        });

        it("Should not make a submission with an insufficient stake", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);


            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE - BigInt(1));
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await expect(bountyV2.connect(addr2).makeSubmission(bountyId, payload)).to.be.revertedWith("ERC20: insufficient allowance");
        });

        it("Should not make a submission on an unfunded bounty", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await expect(bountyV2.connect(addr2).makeSubmission(bountyId, payload)).to.be.revertedWith("BountyV2: bounty not funded");
        });

        it("Should not make a submission on a closed bounty", async function () {
            const { bountyV2, mockERC20, addr1, addr2, addr3 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth;
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Close the bounty.
            await bountyV2.grantApprover(addr3.address);
            bountyV2.connect(addr3).closeBounty(bountyId);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);

            // Try to make a submission on a closed bounty.
            await expect(bountyV2.connect(addr2).makeSubmission(bountyId, payload)).to.be.revertedWith("BountyV2: bounty closed");
        })


        it("Should allow multiple submissions", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId1 = 1;
            const submissionId2 = 2;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId1, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload2 = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId2, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload2);

            expect(await bountyV2.rejectedPayload(payload, bountyId)).to.equal(false);
            expect(await bountyV2.rejectedPayload(payload2, bountyId)).to.equal(false);

            await bountyV2.rejectSubmissions(bountyId, 1);

            // The first should be rejected
            expect(await bountyV2.rejectedPayload(payload, bountyId)).to.equal(true);

            expect(await bountyV2.rejectedPayload(payload2, bountyId)).to.equal(false);
        });

        it("Should not allow more than the max # of submissions", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId1 = 1;
            const submissionId2 = 2;
            const submissionId3 = 3;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId1, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload2 = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId2, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload2);

            await bountyV2.setMaxActiveSubmissions(2);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload3 = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId3, addr2.address]);

            await expect(bountyV2.connect(addr2).makeSubmission(bountyId, payload3)).to.be.revertedWith("BountyV2: max active submissions reached");
        });
    })

    describe("Accept submission", function () {
        it("Should accept a valid submission", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Approve the submission.
            const beforeBalance = await mockERC20.balanceOf(addr2.address);
            // The owner is an approver in the test.
            await bountyV2.approveSubmission(bountyId, submissionId);
            const afterBalance = await mockERC20.balanceOf(addr2.address);

            // Should have transferred amount + stake - fees to submitter.
            expect(afterBalance - beforeBalance).to.equal(amount + SUBMISSION_STAKE - fee(amount, TAKER_FEE));
        });

        it("Should not accept an already rejected payload", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["string"], ["bad payload"]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            expect(await bountyV2.rejectedPayload(payload, bountyId)).to.equal(false);

            // Reject the submission.
            await bountyV2.rejectSubmissions(bountyId, 1);
            await expect(bountyV2.connect(addr2).makeSubmission(bountyId, payload)).to.be.revertedWith("BountyV2: payload rejected");

            expect(await bountyV2.rejectedPayload(payload, bountyId)).to.equal(true);

            // Try to approve the submission but expect it to fail.
            await expect(bountyV2.approveSubmission(bountyId, 1)).to.be.revertedWith("BountyV2: submission not found");
        });

        it("Should accrue the taker fee", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            const feesBeforeApproval = await bountyV2.accruedFees();

            await bountyV2.approveSubmission(bountyId, submissionId);

            const feesAfterApproval = await bountyV2.accruedFees();

            expect(feesAfterApproval - feesBeforeApproval).to.equal(fee(amount, TAKER_FEE));
        });

        it("Should not accept a submission approval from a non approver", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Try to approve the submission but expect it to fail.
            await expect(bountyV2.connect(addr1).approveSubmission(bountyId, submissionId)).to.be.revertedWith("BountyV2: caller is not approver");
        });

        it("Should tell you a submission has been approved", async function () {
            const { bountyV2, mockERC20, addr1, addr2, addr3} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            await bountyV2.approveSubmission(bountyId, submissionId);

            expect(await bountyV2.approvedSubmission(bountyId)).to.equal(payload);
        });

        it("Should not think unapproved submissions are approved", async function () {
            const { bountyV2, mockERC20, addr1, addr2, addr3} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const bountyId2 = 2;
            const submissionId = 1;
            const submissionId2 = 2;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Make sure not-approved submissions are not approved.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId2, amount);

            await mockERC20.connect(addr3).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload2 = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId2, addr3.address]);
            await bountyV2.connect(addr3).makeSubmission(bountyId2, payload2);

            await bountyV2.approveSubmission(bountyId, submissionId);

            expect(await bountyV2.approvedSubmission(bountyId2)).to.not.equal(payload);
        });

        it("Should pay back un-assessed submission stakes", async function () {
            const { bountyV2, mockERC20, addr1, addr2, addr3} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const submissionId2 = 2
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Make a second submission
            await mockERC20.connect(addr3).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload2 = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId2, addr3.address]);
            await bountyV2.connect(addr3).makeSubmission(bountyId, payload2);

            // Get the balance of addr3
            const beforeBalance = await mockERC20.balanceOf(addr3.address);

            // Approve the first submission.
            await bountyV2.approveSubmission(bountyId, submissionId);

            // Get the balance of addr3 after the first submission is approved, paying back addr3's stake.
            const afterBalance = await mockERC20.balanceOf(addr3.address);
            expect(afterBalance - beforeBalance).to.equal(SUBMISSION_STAKE);
        });
    });

    describe("Approve submission", function () {
        it("Should approve valid submission", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            const stake = await bountyV2.stakeAtPosition(0, bountyId);
            const beforeBalance = await mockERC20.balanceOf(addr2.address);
            await bountyV2.approveSubmission(bountyId, submissionId);
            const afterBalance = await mockERC20.balanceOf(addr2.address);
            const takerFee = await bountyV2.fee(amount, false);
            expect(afterBalance - beforeBalance).to.equal(amount+stake-takerFee);
            expect(await bountyV2.rejectedPayload(payload, bountyId)).to.equal(false);
        });

        it("Should not approve submission that does not exist", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            await expect(bountyV2.approveSubmission(bountyId+1, submissionId)).to.be.revertedWith("BountyV2: submission not found");

        });

        it("Should not approve submission with bad payload", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId+1, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            await expect(bountyV2.approveSubmission(bountyId, submissionId)).to.be.revertedWith("BountyV2: submission not found");

        });
    });

    describe("Reject submission", function () {
        it("Should reject a valid submission (once)", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Reject the submission.
            const beforeBalance = await mockERC20.balanceOf(addr2.address);
            // The owner is an approver in the test.
            await bountyV2.rejectSubmissions(bountyId, 1);
            const afterBalance = await mockERC20.balanceOf(addr2.address);

            expect(afterBalance - beforeBalance).to.equal(0)
            expect(await bountyV2.rejectedPayload(payload, bountyId)).to.equal(true);
            await expect(bountyV2.rejectSubmissions(bountyId, 1)).to.be.revertedWith("BountyV2: not enough active submissions");
        });

        it("Should not accept a submission rejection from a non approver", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            await expect(bountyV2.connect(addr1).rejectSubmissions(bountyId, 1)).to.be.revertedWith("BountyV2: caller is not approver");
        });

        it("Should add the rejected submission stake to the bounty amount", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS
            const stake = BigInt(10) * eth

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), amount + stake);
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), stake);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            const initialAmount = await bountyV2.amount(bountyId);
            await bountyV2.rejectSubmissions(bountyId, 1);
            expect(await bountyV2.rejectedPayload(payload, bountyId)).to.equal(true);
            const finalAmount = await bountyV2.amount(bountyId);

            expect(finalAmount - initialAmount).to.equal(stake - fee(stake, MAKER_FEE));
        });

        it("Should not reject a missing submission", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // The owner is an approver in the test.
            await expect(bountyV2.rejectSubmissions(bountyId, 1)).to.be.revertedWith("BountyV2: not enough active submissions")
        });

        it("Should reject multiple submissions", async function () {
            const { bountyV2, mockERC20, addr1, addr2, addr3} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId1 = 1;
            const submissionId2 = 2;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Submit two solutions.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId1, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            await mockERC20.connect(addr3).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload2 = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId2, addr3.address]);
            await bountyV2.connect(addr3).makeSubmission(bountyId, payload2);

            // Try to reject 3 submissions, expect to fail
            // rejectSubmissions
            await expect(bountyV2.rejectSubmissions(bountyId, 3)).to.be.revertedWith("BountyV2: not enough active submissions");

            // Try to reject 2 submissions, expect to work
            await bountyV2.rejectSubmissions(bountyId, 2);

            // Expect both submissions to be rejected
            expect(await bountyV2.rejectedPayload(payload, bountyId)).to.equal(true);
            expect(await bountyV2.rejectedPayload(payload2, bountyId)).to.equal(true);
        });
    });

    describe("Adjust bounty parameters", function () {
        it("Should adjust maker fee", async function () {
            const { bountyV2 } = await loadFixture(deployBountyV2Fixture);

            const newMakerFee = MAKER_FEE + 50
            await bountyV2.setMakerFee(newMakerFee);

            expect(await bountyV2.makerFee()).to.equal(newMakerFee);
        });

        it("Should adjust taker fee", async function () {
            const { bountyV2 } = await loadFixture(deployBountyV2Fixture);

            const newTakerFee = TAKER_FEE + 50
            await bountyV2.setTakerFee(newTakerFee);

            expect(await bountyV2.takerFee()).to.equal(newTakerFee);
        });

        it("Should require fees to be less than or equal to 100%", async function () {
            const { bountyV2 } = await loadFixture(deployBountyV2Fixture);

            const newMakerFee = 10010
            const newTakerFee = 999999

            await expect(bountyV2.setMakerFee(newMakerFee)).to.be.revertedWith("BountyV2: maker fee must be <= 100%");
            await expect(bountyV2.setTakerFee(newTakerFee)).to.be.revertedWith("BountyV2: taker fee must be <= 100%");

            const hundredPercentFee = 10000
            await bountyV2.setMakerFee(hundredPercentFee);
            await bountyV2.setTakerFee(hundredPercentFee);
        });

        it("Should adjust the submission stake", async function () {
            const { bountyV2 } = await loadFixture(deployBountyV2Fixture);

            const newSubmissionStake = SUBMISSION_STAKE + BigInt(10) * eth
            await bountyV2.setSubmissionStake(newSubmissionStake);

            expect(await bountyV2.submissionStake()).to.equal(newSubmissionStake);
        });

        it("Should set new min bounty", async function () {
            const { bountyV2 } = await loadFixture(deployBountyV2Fixture);

            const newMinBounty = MIN_BOUNTY + BigInt(10) * eth
            await bountyV2.setMinBounty(newMinBounty);

            expect(await bountyV2.minBounty()).to.equal(newMinBounty);
        });

        it("Should not allow non owner to adjust params", async function () {
            const { bountyV2, addr1 } = await loadFixture(deployBountyV2Fixture);

            const newMakerFee = MAKER_FEE + 50
            const newTakerFee = TAKER_FEE + 50
            const newSubmissionStake = SUBMISSION_STAKE + BigInt(10) * eth
            const newMinBounty = MIN_BOUNTY + BigInt(10) * eth

            await expect(bountyV2.connect(addr1).setMakerFee(newMakerFee)).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(bountyV2.connect(addr1).setTakerFee(newTakerFee)).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(bountyV2.connect(addr1).setSubmissionStake(newSubmissionStake)).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(bountyV2.connect(addr1).setMaxActiveSubmissions(100)).to.be.revertedWith("Ownable: caller is not the owner");
            await expect(bountyV2.connect(addr1).setMinBounty(newMinBounty)).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should reflect the new maker fee", async function () {
            const { bountyV2, mockERC20, addr1 } = await loadFixture(deployBountyV2Fixture);

            const newMakerFee = MAKER_FEE + 50
            await bountyV2.setMakerFee(newMakerFee);

            const bountyId = 1;
            const amount = BigInt(100) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(newMakerFee)) / BIGINT_ONE_IN_BPS

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            expect(await bountyV2.amount(bountyId)).to.equal(amount);
        });

        it("Should reflect the new taker fee", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            const newTakerFee = TAKER_FEE + 50
            await bountyV2.setTakerFee(newTakerFee);

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            const beforeBalance = await mockERC20.balanceOf(addr2.address);
            await bountyV2.approveSubmission(bountyId, submissionId);
            const afterBalance = await mockERC20.balanceOf(addr2.address);

            expect(afterBalance - beforeBalance).to.equal(amount + SUBMISSION_STAKE - fee(amount, newTakerFee));
        });

        it("Should reflect the new submission stake", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            const newSubmissionStake = SUBMISSION_STAKE + BigInt(10) * eth
            await bountyV2.setSubmissionStake(newSubmissionStake);

            const beforeBalance = await mockERC20.balanceOf(addr2.address);

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), newSubmissionStake);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            const afterBalance = await mockERC20.balanceOf(addr2.address);

            expect(beforeBalance - afterBalance).to.equal(newSubmissionStake);
        });

        it("Should adjust max active submissions", async function () {
            const { bountyV2 } = await loadFixture(deployBountyV2Fixture);

            const newMaxActiveSubmissions = MAX_ACTIVE_SUBMISSIONS + 50
            await bountyV2.setMaxActiveSubmissions(newMaxActiveSubmissions);

            expect(await bountyV2.maxActiveSubmissions()).to.equal(newMaxActiveSubmissions);
        });
    });

    describe("Close bounty", function () {
        it("Should not accept submissions after the expiration", async function () {
            const { bountyV2, mockERC20, addr1 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Wait for the bounty to expire.
            await time.increase(time.duration.days(DURATION + 1));

            // Try to make a submission after the expiration.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [1, addr1.address]);

            await expect(bountyV2.connect(addr1).makeSubmission(bountyId, payload)).to.be.revertedWith("BountyV2: bounty expired");
        });

        it("Should allow closing the bounty once expired (only once)", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            const initialBalance = await mockERC20.balanceOf(addr1.address);

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Wait for the bounty to expire.
            await time.increase(time.duration.days(DURATION + 1));

            // Close the bounty.
            await bountyV2.connect(addr1).closeBounty(bountyId);
            const finalBalance = await mockERC20.balanceOf(addr1.address);

            expect(await bountyV2.approvedSubmission(bountyId)).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");

            expect(await bountyV2.closed(bountyId)).to.equal(true);
            expect(initialBalance - finalBalance).to.equal(fee(amount, MAKER_FEE));

            await expect(bountyV2.connect(addr1).closeBounty(bountyId)).to.be.revertedWith("BountyV2: bounty already closed");
        });

        it("Should not allow closing unfunded bounty", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS
            const initialBalance = await mockERC20.balanceOf(addr1.address);
            // Wait for the bounty to expire.
            await time.increase(time.duration.days(DURATION + 1));
            // Try to close the bounty.
            await expect(bountyV2.connect(addr1).closeBounty(bountyId)).to.be.revertedWith("BountyV2: bounty not funded");
        });

        it("Should not allow non-approver to close early", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Try to close the bounty before it expires.
            await expect(bountyV2.connect(addr2).closeBounty(bountyId)).to.be.revertedWith("BountyV2: only approvers can close before expiration");
        });

        it("Should allow the funder to close the bounty early if they're an approver", async function () {
            const { bountyV2, mockERC20, addr1 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Make addr1 an approver
            await bountyV2.grantApprover(addr1.address);

            bountyV2.connect(addr1).closeBounty(bountyId);
        });


        it("Should allow approver to close the bounty early if they're not the funder", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Make addr2 an approver
            await bountyV2.grantApprover(addr2.address);

            bountyV2.connect(addr2).closeBounty(bountyId);
        });

        it("Should allow approver to close bounty after expiration", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Make addr2 an approver
            await bountyV2.grantApprover(addr2.address);

            //wait
            await time.increase(time.duration.days(DURATION + 1));

            bountyV2.connect(addr1).closeBounty(bountyId);
        });


        it("Should not allow the funder to close the bounty if there is an active submission", async function () {
            const { bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Wait for the bounty to expire.
            await time.increase(time.duration.days(DURATION + 1));

            // Try to close the bounty.
            await expect(bountyV2.connect(addr1).closeBounty(bountyId)).to.be.revertedWith("BountyV2: has active submission");
        });

        it("Should return initial funding amount on closing, rest are fees", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);
            const addr1BalanceBefore = await mockERC20.balanceOf(addr1.address);

            // Approve stake amount to be spent by bountyV2 and then submit a solution.
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Reject the submission.
            const beforeBalance = await mockERC20.balanceOf(addr2.address);
            // The owner is an approver in the test.
            await bountyV2.rejectSubmissions(bountyId, 1);
            const afterBalance = await mockERC20.balanceOf(addr2.address);

            expect(afterBalance - beforeBalance).to.equal(0)
            expect(await bountyV2.rejectedPayload(payload, bountyId)).to.equal(true);

            // Wait for the bounty to expire.
            await time.increase(time.duration.days(DURATION + 1));

            await bountyV2.connect(addr1).closeBounty(bountyId);
            const addr1BalanceAfter = await mockERC20.balanceOf(addr1.address);

            expect(addr1BalanceAfter - addr1BalanceBefore).to.equal(amount);


        });
    });

    describe("Sunset contract: stop accepting bounties", function () {
        it("Should allow the owner to stop the contract from accepting bounties", async function () {
            const { owner, bountyV2 } = await loadFixture(deployBountyV2Fixture);

            await bountyV2.connect(owner).stopAcceptingBounties();

            expect(await bountyV2.acceptingBounties()).to.equal(false);
        });

        it("Should not allow bounty submissions after the contract has stopped accepting bounties", async function () {
            const { owner, bountyV2, mockERC20, addr1 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await bountyV2.connect(owner).stopAcceptingBounties();

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await expect(bountyV2.connect(addr1).fundBounty(bountyId, amount)).to.be.revertedWith("BountyV2: contract no longer accepting bounties");
        });

        it("Should allow solution submissions after the contract has stopped accepting bounties", async function () {
            const { owner, bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            await bountyV2.connect(owner).stopAcceptingBounties();

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [1, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);
        });


        it("Should not allow anyone else to stop the contract from accepting bounties", async function () {
            const { owner, bountyV2, mockERC20, addr1 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await expect(bountyV2.connect(addr1).stopAcceptingBounties()).to.be.revertedWith("Ownable: caller is not the owner");

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);
        });
    });

    describe("Should allow the owner to manage approvers", function () {
        it("Should allow the owner to add an approver", async function () {
            const { owner, bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const newApprover = addr1
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            // Grant a new approver.
            await bountyV2.connect(owner).grantApprover(newApprover.address);
            expect (await bountyV2.approver(newApprover.address)).to.equal(true);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr2).fundBounty(bountyId, amount);
            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [1, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Approve a submission with the new approver.
            await bountyV2.connect(newApprover).approveSubmission(bountyId, 1);

            // Not allow non-owner to grant approver.
            await expect(bountyV2.connect(addr2).grantApprover(addr2.address)).to.be.revertedWith("Ownable: caller is not the owner");

            // Expect failure if trying to approve someone who is already an approver.
            await expect(bountyV2.connect(owner).grantApprover(newApprover.address)).to.be.revertedWith("BountyV2: already approver");
        });

        it("Should allow the owner to revoke an approver", async function () {
            const { owner, bountyV2, mockERC20, addr1, addr2, addr3 } = await loadFixture(deployBountyV2Fixture);
            const revokedApprover = addr1
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await bountyV2.connect(owner).grantApprover(revokedApprover.address);
            await bountyV2.connect(owner).revokeApprover(revokedApprover.address);
            expect (await bountyV2.approver(revokedApprover.address)).to.equal(false);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr2).fundBounty(bountyId, amount);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [1, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Expect to fail to approve the submission with the revoked approver.
            await expect(bountyV2.connect(revokedApprover).approveSubmission(bountyId, 1)).to.be.revertedWith("BountyV2: caller is not approver")

            // Expect to fail if non-owner tries to revoke approver.
            await expect(bountyV2.connect(addr2).revokeApprover(revokedApprover.address)).to.be.revertedWith("Ownable: caller is not the owner")

            // Expect to fail if trying to revoke from someone who is not an approver.
            await expect(bountyV2.connect(owner).revokeApprover(revokedApprover.address)).to.be.revertedWith("BountyV2: not approver")
        });

        it("Should allow the owner to set multiple approvers", async function () {
            const { owner, bountyV2, mockERC20, addr1, addr2, addr3, addr4 } = await loadFixture(deployBountyV2Fixture);
            const newApprover = addr1
            const newApprover2 = addr2
            const notAnApprover = addr3
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await bountyV2.connect(owner).grantApprover(newApprover.address);
            await bountyV2.connect(owner).grantApprover(newApprover2.address);

            expect (await bountyV2.approver(newApprover.address)).to.equal(true);
            expect (await bountyV2.approver(newApprover2.address)).to.equal(true);

            // Fund two bounties.
            await mockERC20.connect(addr3).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr3).fundBounty(bountyId, amount);
            await mockERC20.connect(addr4).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr4).fundBounty(bountyId + 1, amount);

            // Submit two solutions.
            await mockERC20.connect(addr4).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [1, addr4.address]);
            await bountyV2.connect(addr4).makeSubmission(bountyId, payload);

            await mockERC20.connect(addr3).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload2 = ethers.solidityPackedKeccak256(["uint256", "address"], [1, addr3.address]);
            await bountyV2.connect(addr3).makeSubmission(bountyId + 1, payload2);

            // Approve them both with different approvers.
            await expect(bountyV2.connect(notAnApprover).approveSubmission(bountyId, 1)).to.be.revertedWith("BountyV2: caller is not approver")
            await bountyV2.connect(newApprover).approveSubmission(bountyId, 1);
            await bountyV2.connect(newApprover2).approveSubmission(bountyId + 1, 1);
        });

        it("Should not allow an approver to submit a solution", async function () {
            const { owner, bountyV2, mockERC20, addr1, addr2 } = await loadFixture(deployBountyV2Fixture);
            const newApprover = addr1
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await bountyV2.connect(owner).grantApprover(newApprover.address);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), amount + SUBMISSION_STAKE);
            await bountyV2.connect(addr2).fundBounty(bountyId, amount);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [1, addr2.address]);

            await expect(bountyV2.connect(newApprover).makeSubmission(bountyId, payload)).to.be.revertedWith("BountyV2: approvers cannot submit")
        });

        it("Should not allow an approver to approve their own solution if they get granted after posting", async function () {
            const { bountyV2, mockERC20, addr1, addr2} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Grant the submitter as an approver.
            await bountyV2.grantApprover(addr2.address);

            await expect(bountyV2.connect(addr2).approveSubmission(bountyId, submissionId)).to.be.revertedWith("BountyV2: cannot approve own submission")
        });

        it("Should allow another approver A to approve an approver B's solution if B gets granted after posting", async function () {
            const { bountyV2, mockERC20, addr1, addr2, addr3} = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const submissionId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            await mockERC20.connect(addr2).approve(await bountyV2.getAddress(), SUBMISSION_STAKE);
            const payload = ethers.solidityPackedKeccak256(["uint256", "address"], [submissionId, addr2.address]);
            await bountyV2.connect(addr2).makeSubmission(bountyId, payload);

            // Grant the submitter as an approver.
            await bountyV2.grantApprover(addr2.address);
            await bountyV2.grantApprover(addr3.address);

            await bountyV2.connect(addr3).approveSubmission(bountyId, submissionId);
        });
    });

    describe("Withdrawing fees", function () {
        it("Should dispatch all fees", async function () {
            const { bountyV2, mockERC20, addr1 } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            const initialFees = await bountyV2.accruedFees();

            expect(initialFees).to.equal(0);

            // Approve amount to be spent by bountyV2 and then fund the bounty.
            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            const feesAfterFundingBounty = await bountyV2.accruedFees();

            expect(feesAfterFundingBounty).to.equal(fee(amount, MAKER_FEE));

            // Burn fees.
            await bountyV2.withdrawFees();

            const feesAfterWithdrawal = await bountyV2.accruedFees();

            expect(feesAfterWithdrawal).to.equal(0);
        });

        it("Should pay out to the fee receiver", async function () {
            const { bountyV2, mockERC20, addr1, feeReceiver } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            const initialFees = await bountyV2.accruedFees();

            expect(initialFees).to.equal(0);

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);

            const feesAfterFundingBounty = await bountyV2.accruedFees();

            expect(feesAfterFundingBounty).to.equal(fee(amount, MAKER_FEE));

            const initialFeeReceiverBalance = await mockERC20.balanceOf(feeReceiver.address);

            await bountyV2.withdrawFees();

            const finalFeeReceiverBalance = await mockERC20.balanceOf(feeReceiver.address);

            expect(finalFeeReceiverBalance - initialFeeReceiverBalance).to.equal(feesAfterFundingBounty);
        });

        it("Should allow the owner to set the fee receiver address", async function () {
            const { bountyV2, mockERC20, addr1, addr2, feeReceiver } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            const initialFees = await bountyV2.accruedFees();

            expect(initialFees).to.equal(0);

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);
            await bountyV2.withdrawFees();

            await bountyV2.setFeeReceiverAddress(addr2.address);

            await expect(bountyV2.setFeeReceiverAddress("0x0000000000000000000000000000000000000000")).to.be.revertedWith("BountyV2: fee receiver address cannot be 0x0");

            // Assert only owner is allowed to set fee.
            await expect(bountyV2.connect(addr2).setFeeReceiverAddress(addr2.address)).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("Should pay out to the new fee receiver", async function () {
            const { bountyV2, mockERC20, addr1, addr2, feeReceiver } = await loadFixture(deployBountyV2Fixture);
            const bountyId = 1;
            const amount = BigInt(60) * eth
            const amountPlusFee = amount * (BIGINT_ONE_IN_BPS + BigInt(MAKER_FEE)) / BIGINT_ONE_IN_BPS

            const initialFees = await bountyV2.accruedFees();

            expect(initialFees).to.equal(0);

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty(bountyId, amount);
            await bountyV2.withdrawFees();

            const feeReceiverBalancePostBurn1 = await mockERC20.balanceOf(feeReceiver.address);
            const newFeeReceiverBalance0 = await mockERC20.balanceOf(addr2.address);

            await bountyV2.setFeeReceiverAddress(addr2.address);

            await mockERC20.connect(addr1).approve(await bountyV2.getAddress(), (amountPlusFee));
            await bountyV2.connect(addr1).fundBounty((bountyId + 1), amount);
            await bountyV2.withdrawFees();

            const feeReceiverBalancePostBurn2 = await mockERC20.balanceOf(feeReceiver.address);
            const newFeeReceiverBalance1 = await mockERC20.balanceOf(addr2.address);

            expect(feeReceiverBalancePostBurn1).to.equal(feeReceiverBalancePostBurn2);
            expect(newFeeReceiverBalance1 - newFeeReceiverBalance0).to.equal(fee(amount, MAKER_FEE));

            // Assert only the owner can burnAndWithdraw.
            await expect(bountyV2.connect(addr2).withdrawFees()).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });
})

const fee = (amount: bigint, fee: number) => {
    return amount * BigInt(fee) / BigInt(10000)
}
