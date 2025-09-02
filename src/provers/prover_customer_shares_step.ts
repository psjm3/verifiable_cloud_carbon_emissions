import os from 'node:os';

import { promisify } from 'util';
import { exec } from 'child_process';
import { BATCH_NUM_OF_CUSTOMERS, TREE_HEIGHT, TREE_NUM_OF_LEAFS } from '../types/merkle_tree.js';

export async function generateCustomerSharesStepProofs(logData: any[]) {
    let numOfProofs = TREE_NUM_OF_LEAFS / (BATCH_NUM_OF_CUSTOMERS);
    let subtreeRootLevel = Math.ceil(Math.log2(BATCH_NUM_OF_CUSTOMERS));

    const stepProofsRunner = promisify(exec);

    const numCPUs = os.availableParallelism();
    let numOfWorkers = (numOfProofs / 2) > numCPUs ? numCPUs : (numOfProofs / 2);

    while (subtreeRootLevel < (TREE_HEIGHT - 1)) {
        for (let i = 0; i < numOfProofs; i += (2 * numOfWorkers)) {
            async function stepProofsRunnerExec() {
                try {
                    await stepProofsRunner(
                        'tsx ./src/proof_workers/proof_workers_customer_shares_step.ts ' +
                        numOfWorkers + ' ' +
                        i + ' ' +
                        subtreeRootLevel
                    ); 
                } catch (err) {
                    logData.push({ src: 'prover_total_emissions', data: 'ERROR: child process proof_workers_total_emissions_base.ts', value: err, datatype: 'text' })
                }
            }
            const stepProofRunnerTimeStart = performance.now();
            await stepProofsRunnerExec();
            logData.push({ 
                src: 'prover_customer_shares_step', 
                data: 'customer shares STEP one batch at iteration ' + i + ' at subtree root level ' + subtreeRootLevel + ' with number of workers ' + numOfWorkers + ' - time taken', 
                value: (performance.now() - stepProofRunnerTimeStart), 
                datatype: 'ms' });
        }
        numOfProofs = numOfProofs / 2;
        subtreeRootLevel = subtreeRootLevel + 1;
        numOfWorkers = (numOfProofs / 2) > numCPUs ? numCPUs : (numOfProofs / 2);
    }

}
