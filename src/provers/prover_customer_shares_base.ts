import os from 'node:os';

import { promisify } from 'util';
import { exec } from 'child_process';
import { BATCH_NUM_OF_CUSTOMERS, TREE_NUM_OF_LEAFS } from '../types/merkle_tree.js';

export async function generateCustomerSharesBaseProofs(logData: any[]) {
    // By using a separate to run batches of base proofs, and then recursively generate proofs for further up the 
    // tree until the root, it allows many more customer records to be on the same database/merkle tree. This can 
    // scale up subject to file system storage and CPU time/capacity limitations.
    const baseProofsRunner = promisify(exec);

    const numCPUs = os.availableParallelism();
    let numOfWorkers = (TREE_NUM_OF_LEAFS / BATCH_NUM_OF_CUSTOMERS) > numCPUs ? numCPUs : (TREE_NUM_OF_LEAFS / BATCH_NUM_OF_CUSTOMERS);
    for (let i = 0; i < TREE_NUM_OF_LEAFS; i += (BATCH_NUM_OF_CUSTOMERS * numOfWorkers)) {
        async function baseProofsRunnerExec() {
            try {
                await baseProofsRunner('tsx ./src/proof_workers/proof_workers_customer_shares_base.ts ' + i + ' ' + numOfWorkers);
            } catch (err) {
                logData.push({ src: 'prover_customer_shares_base', data: 'ERROR: child process proof_workers_customer_shares_base.ts', value: err, datatype: 'text' })
            }
        }
        const baseProofRunnerTimeStart = performance.now();
        await baseProofsRunnerExec();
        logData.push({ 
            src: 'prover_customer_shares_base', 
            data: 'customer shares BASE one batch at iteration ' + i + ' with number of workers ' + numOfWorkers + ' - time taken', 
            value: (performance.now() - baseProofRunnerTimeStart), 
            datatype: 'ms' });
    }
}
