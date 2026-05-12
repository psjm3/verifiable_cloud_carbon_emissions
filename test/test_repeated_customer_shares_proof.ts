import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import fsAsync from 'fs/promises';
import { log, logStreamStart, logStreamStop } from '../src/utils/util.js';
import { NUM_OF_CUSTOMERS } from '../src/types/merkle_tree.js';

/***************/
/* PREPARATION */
/***************/
async function createArtifactFolders() {
    const paths = [
        './generated_proofs/',
        './generated_public_keys/',
        './generated_smart_meters/',
        './generated_witnesses/',
        './generated_intensities/',
        './generated_meter_readings/',
        './test_logs'
    ]

    paths.forEach((path) => {
        if (!fs.existsSync(path)) {
            fsAsync.mkdir(
                path, { recursive: true }
            ).catch(err => {
                console.error(`ERROR: Prover_main, Error creating directory for ${path}: ${err}`);
                process.exit(1);
            });
        }
    })
}
const logFile = "./test_logs/test_repeated_customer_shares_proof.out"
logStreamStart(logFile);

const testTimeStart = performance.now();
log(`Test_repeated_customer_shares, Starts\n`);

const customerSharesProofsExec = promisify(exec);
async function customerSharesProofsRunner() {
    const { stdout, stderr } = await customerSharesProofsExec(
        'tsx ./src/provers/prover_customer_shares.ts',
        { maxBuffer: 2048 * 1024 }
    );
    if (stdout != "") {
        log(`${stdout}\n`);
    }
    if (stderr != "") {
        log(`${stderr}\n`);
    }
}

/******************/
/* PROGRAM STARTS */
/******************/
await createArtifactFolders();

for (let i = 0; i < 5; i++) {
    log(`Test_repeated_total_emissions, Running_total_emissions_proof_iteration, ${i}\n`)
    const customerSharesTimeStart = performance.now();
    await customerSharesProofsRunner();
    log(`Test_repeated_customer_shares, Customer_shares_proof, iteration, ${i}, time, ${performance.now() - customerSharesTimeStart},  numOfCustomers, ${NUM_OF_CUSTOMERS}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
}
log(`Test_repeated_customer_shares, Ends, time, ${performance.now() - testTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
logStreamStop(logFile);