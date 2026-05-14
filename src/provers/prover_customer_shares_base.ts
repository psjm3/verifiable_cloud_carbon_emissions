import os from 'node:os';
import { promisify } from 'util';
import { exec } from 'child_process';
import { BATCH_NUM_OF_CUSTOMERS, TREE_NUM_OF_LEAFS } from '../types/merkle_tree.js';
import { log } from '../utils/util.js';

export async function generateCustomerSharesBaseProofs() {
    log(`Prover_customer_shares_base, Starting_proof_workers_for_customer_shares_base...\n`)
    // By using a separate to run batches of base proofs, and then recursively generate proofs for further up the 
    // tree until the root, it allows many more customer records to be on the same database/merkle tree. This can 
    // scale up subject to file system storage and CPU time/capacity limitations.
    const baseProofsRunner = promisify(exec);

    const numCPUs = os.availableParallelism();
    // let numOfWorkers = (TREE_NUM_OF_LEAFS / BATCH_NUM_OF_CUSTOMERS) > numCPUs ? numCPUs : (TREE_NUM_OF_LEAFS / BATCH_NUM_OF_CUSTOMERS);
    let numOfWorkers = 10;
    for (let i = 0; i < TREE_NUM_OF_LEAFS; i += (BATCH_NUM_OF_CUSTOMERS * numOfWorkers)) {
        async function baseProofsRunnerExec() {
            const { stdout, stderr } = await baseProofsRunner('tsx ./src/proof_workers/proof_workers_customer_shares_base.ts ' + i + ' ' + numOfWorkers);
            if (stdout != "") {
                if (stdout != "") {
                    log(`${stdout}\n`);
                }
                if (stderr != "") {
                    log(`${stderr}\n`);
                }
            }
        }
        const baseProofRunnerTimeStart = performance.now();
        await baseProofsRunnerExec();
        log(`Prover_customer_shares_base, base_proof_runner_one_batch, time, ${performance.now() - baseProofRunnerTimeStart}, iteration, ${i}, num_of_workers, ${numOfWorkers}\n`);
    }
}