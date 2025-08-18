import os from 'node:os';
import { promisify } from 'util';
import { exec } from 'child_process';
import { BATCH_NUM_OF_CUSTOMERS, TREE_NUM_OF_LEAFS } from '../types/o1js_merkle_tree.js';

export async function generateCustomerSharesBaseProofs() {
    console.time("OVERALL TIME TAKEN FOR GENERATING CUSTOMER SHARES BASE PROOFS");
    
    // By using a separate to run batches of base proofs, and then recursively generate proofs for further up the 
    // tree until the root, it allows many more customer records to be on the same database/merkle tree. This can 
    // scale up subject to file system storage and CPU time/capacity limitations.
    console.log("Base Proof Prover: generating the base proof for customer records in batches...");
    const baseProofsRunner = promisify(exec);

    const numCPUs = os.availableParallelism();
    let numOfWorkers = (TREE_NUM_OF_LEAFS / BATCH_NUM_OF_CUSTOMERS) > numCPUs? numCPUs : (TREE_NUM_OF_LEAFS / BATCH_NUM_OF_CUSTOMERS);
    console.log("Number of workers:", numOfWorkers);
    for (let i=0; i<TREE_NUM_OF_LEAFS; i+=(BATCH_NUM_OF_CUSTOMERS*numOfWorkers)) {
        async function baseProofsRunnerExec() {
            const { stdout, stderr } = await baseProofsRunner('tsx ./src/proof_workers/proof_workers_customer_shares_base.ts '+i+' '+numOfWorkers);
            console.log('stdout:', stdout);
            console.log('stderr:', stderr);
        }
        console.time("Generate ONE customer shares BASE proofs");
        await baseProofsRunnerExec();
        console.timeEnd("Generate ONE customer shares BASE proofs");
    }
    console.timeEnd("OVERALL TIME TAKEN FOR GENERATING CUSTOMER SHARES BASE PROOFS");
}