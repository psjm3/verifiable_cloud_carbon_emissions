import os from 'node:os';
import { promisify } from 'util';
import { exec } from 'child_process';
import { BATCH_NUM_OF_CUSTOMERS, TREE_HEIGHT, TREE_NUM_OF_LEAFS } from '../types/o1js_merkle_tree.js';

export async function generateCustomerSharesRecProofs() {
    console.time("OVERALL TIME TAKEN FOR GENERATING REC PROOFS")

    /***** Customer Shares Base (Leaf Nodes) Proofs *****/
    console.log("Generating customer shares recursive proofs in batches...");
    let numOfProofs = TREE_NUM_OF_LEAFS / (BATCH_NUM_OF_CUSTOMERS);
    let subtreeRootLevel = Math.ceil(Math.log2(BATCH_NUM_OF_CUSTOMERS));

    const recProofsRunner = promisify(exec);
    
    const numCPUs = os.availableParallelism();
    let numOfWorkers = (numOfProofs/2) > numCPUs? numCPUs : (numOfProofs/2);
    console.log("Number of rec proof workers:", numOfWorkers);

    while (subtreeRootLevel < (TREE_HEIGHT-1)) {
        console.log('numOfProofs:', numOfProofs);

        for (let i=0; i<numOfProofs; i+=(2*numOfWorkers)) {
            async function recProofsRunnerExec() {
                const { stdout, stderr } = await recProofsRunner(
                    'tsx ./src/proof_workers/proof_workers_customer_shares_rec.ts ' + 
                    numOfWorkers + ' ' +
                    i + ' ' +
                    subtreeRootLevel
                );
                console.log('stdout:', stdout);
                console.log('stderr:', stderr);
            }
            await recProofsRunnerExec();
        }
        numOfProofs = numOfProofs/2;
        subtreeRootLevel = subtreeRootLevel + 1;
        numOfWorkers = (numOfProofs/2) > numCPUs? numCPUs : (numOfProofs/2);
    }
    console.timeEnd("OVERALL TIME TAKEN FOR GENERATING REC PROOFS")
}
