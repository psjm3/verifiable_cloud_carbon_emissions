import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import fsAsync from 'fs/promises';
import { log, logStreamStart, logStreamStop } from '../src/utils/util.js';

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
const logFile = "./test_logs/test_repeated_total_emissions_proof.out"
logStreamStart(logFile);

const testTimeStart = performance.now();
log(`Test_repeated_total_emissions, Starts\n`);

const totalEmissionsProofsExec = promisify(exec);
async function totalEmissionsProofsRunner() {
    try {
        const { stdout, stderr } = await totalEmissionsProofsExec(
            'tsx ./src/provers/prover_total_emissions.ts',
            { maxBuffer: 512 * 1024 }
        );
        if (stdout != "") {
            log(`${stdout}\n`);
        }
        if (stderr != "") {
            log(`${stderr}\n`);
        }
    } catch (err) {
        log(`ERROR: Prover_main, ${err}\n`);
    }
}

/******************/
/* PROGRAM STARTS */
/******************/
await createArtifactFolders();

for (let i=0; i<5; i++) {
    log(`Test_repeated_total_emissions, Running_total_emissions_proof_iteration, ${i}\n`)
    const totalEmissionsTimeStart = performance.now();
    await totalEmissionsProofsRunner();
    log(`Test_repeated_total_emissions, Total_emissions_proof, iteration, ${i}, time, ${performance.now() - totalEmissionsTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
}
log(`Test_repeated_total_emissions, Ends, time, ${performance.now() - testTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
logStreamStop(logFile);