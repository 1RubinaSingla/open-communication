/**
 * Verifies the reward-per-share staking math against a real in-memory DB:
 * proportional distribution across stakers, accumulation across multiple jobs,
 * claim, and unstake.
 */
import { createDb } from "@0c/db";

let pass = true;
const check = (name: string, ok: boolean) => {
  console.log(`   ${ok ? "✓" : "✗"} ${name}`);
  if (!ok) pass = false;
};

const db = createDb(":memory:", { signupGrant: 1000 });
db.ensureUser("alice");
db.ensureUser("bob");
db.ensureUser("payer");

// alice stakes 100, bob stakes 300 → alice owns 25% of the pool, bob 75%.
db.stake("alice", 100);
db.stake("bob", 300);
check("staked amounts recorded", db.stakeInfo("alice").staked === 100 && db.stakeInfo("bob").staked === 300);
check("network total staked = 400", db.stakeInfo("alice").totalStaked === 400);

// A settled job with charge=100 routes stakingFee = floor(100*0.1) = 10 to the pool.
function settleCharge100(jobId: string) {
  db.reserve("payer", jobId, 500, "llama3.2");
  db.settle("payer", jobId, 500, "llama3.2", { promptTokens: 0, completionTokens: 20000 }, "worker");
}
settleCharge100("job1");
// pool 10 → alice 25% = 2.5→2, bob 75% = 7.5→7
check("round 1: alice pending = 2 (25% of 10)", db.stakeInfo("alice").pending === 2);
check("round 1: bob pending = 7 (75% of 10)", db.stakeInfo("bob").pending === 7);

settleCharge100("job2");
// cumulative floor recovers rounding dust: alice floor(5.0)=5, bob floor(15.0)=15
check("round 2 (cumulative): alice pending = 5", db.stakeInfo("alice").pending === 5);
check("round 2 (cumulative): bob pending = 15", db.stakeInfo("bob").pending === 15);
check("no dust lost: alice+bob = full 20 pool", db.stakeInfo("alice").pending + db.stakeInfo("bob").pending === 20);

// alice claims → credited to balance, pending resets
const balBefore = db.balanceOf("alice");
const claim = db.claimStake("alice");
check("alice claim pays 5 credits", claim.claimed === 5 && db.balanceOf("alice") === balBefore + 5);
check("alice pending resets to 0 after claim", db.stakeInfo("alice").pending === 0);
check("bob unaffected by alice's claim (still 15)", db.stakeInfo("bob").pending === 15);

// alice unstakes 100 → credits returned to balance, stake = 0
const before = db.balanceOf("alice");
db.unstake("alice", 100);
check("unstake returns 100 credits", db.balanceOf("alice") === before + 100);
check("alice stake now 0", db.stakeInfo("alice").staked === 0);
check("network total staked back to 300", db.stakeInfo("bob").totalStaked === 300);

// new reward now goes entirely to bob (only staker): 15 + 10 = 25
settleCharge100("job3");
check("post-unstake reward all to bob (15+10=25)", db.stakeInfo("bob").pending === 25);

console.log("\n" + (pass ? "OK — staking math verified." : "FAIL — see above."));
process.exit(pass ? 0 : 1);
