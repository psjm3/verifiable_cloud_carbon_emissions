import os from 'node:os';
import { promisify } from 'util';
import { exec } from 'child_process';
import { BATCH_NUM_OF_CUSTOMERS, TREE_HEIGHT, TREE_NUM_OF_LEAFS } from '../types/merkle_tree.js';
import { log } from '../utils/util.js';

export async function generateCustomerSharesRecProofs() {
    log(`Prover_customer_shares_step, Starting_proof_workers_for_customer_shares_step...\n`)

    let numOfProofs = TREE_NUM_OF_LEAFS / (BATCH_NUM_OF_CUSTOMERS);
    let subtreeRootLevel = Math.ceil(Math.log2(BATCH_NUM_OF_CUSTOMERS));

    const recProofsRunner = promisify(exec);

    const numCPUs = os.availableParallelism();
    let numOfWorkers = (numOfProofs / 2) > numCPUs ? numCPUs : (numOfProofs / 2);
    while (subtreeRootLevel < (TREE_HEIGHT - 1)) {
        for (let i = 0; i < numOfProofs; i += (2 * numOfWorkers)) {
            async function recProofsRunnerExec() {
                const { stdout, stderr } = await recProofsRunner(
                    'tsx ./src/proof_workers/proof_workers_customer_shares_step.ts ' +
                    numOfWorkers + ' ' +
                    i + ' ' +
                    numOfProofs + ' ' +
                    subtreeRootLevel
                );
                if (stdout != "") {
                    log(`${stdout}\n`);
                }
                if (stderr != "") {
                    log(`${stderr}\n`);
                }
            }
            const recProofRunnerTimeStart = performance.now();
            await recProofsRunnerExec();
            log(`Prover_customer_shares_step, step_proof_runner_one_batch, time, ${performance.now() - recProofRunnerTimeStart}, iteration, ${i}, subtreeRootLevel: ${subtreeRootLevel}, num_of_workers, ${numOfWorkers}, num_of_proofs, ${numOfProofs}\n`);
        }
        numOfProofs = numOfProofs / 2;
        subtreeRootLevel = subtreeRootLevel + 1;
        // numOfWorkers = (numOfProofs / 2) > numCPUs ? numCPUs : (numOfProofs / 2);
    }

}
