import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import fsAsync from 'fs/promises';
import { customerSharesCircuit } from '../zkPrograms/zkprogram_customer_shares.js';
import { totalEmissionsCircuit } from '../zkPrograms/zkprogram_total_emissions.js';
import { perCustomerEmissionsCircuit } from '../zkPrograms/zkprogram_per_customer_proof.js';
import { log, logStreamStart, logStreamStop } from '../utils/util.js';
import { NUM_OF_CUSTOMERS } from '../types/merkle_tree.js';
import { NUM_OF_VERIFIER } from '../types/customer.js';

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
        './generated_logs'
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
const logFile = "./generated_logs/prover_main.out"
logStreamStart(logFile);

const proverMainTimeStart = performance.now();
log(`Prover_main, Starts\n`);

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

const perCustomerProofsExec = promisify(exec);
async function perCustomerProofsRunner() {
    const { stdout, stderr } = await perCustomerProofsExec(
        'tsx ./src/provers/prover_per_customer_emissions.ts',
        { maxBuffer: 512 * 1024 }
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

const totalEmissionsAnalysis = await totalEmissionsCircuit.analyzeMethods();
log(`Prover_main, Constraints_of_total_emissions_base, how_many, ${totalEmissionsAnalysis.baseTotalEmissionsProof.rows}
Prover_main, Constraints_of_total_emissions_step, how_many, ${totalEmissionsAnalysis.stepTotalEmissionsProof.rows}\n`);

const customerSharesAnalysis = await customerSharesCircuit.analyzeMethods();
log(`Prover_main, Constraints_of_customer_shares_base, how_many, ${customerSharesAnalysis.baseSumOfSharesProof.rows};
Prover_main, Constraints_of_customer_shares_step, how_many, ${customerSharesAnalysis.stepSumOfSharesProof.rows}\n`);

const perCustomerEmissionssAnalysis = await perCustomerEmissionsCircuit.analyzeMethods();
log(`Prover_main, Constraints_of_per_customer_emissions, how_many, ${perCustomerEmissionssAnalysis.emissionsProof.rows}\n`);

const threeProofsTimeStart = performance.now();
log(`Prover_main, Running_total_emissions_proof...\n`)
const totalEmissionsTimeStart = performance.now();
await totalEmissionsProofsRunner();
log(`Prover_main, Total_emissions_proof, time, ${performance.now() - totalEmissionsTimeStart}\n`);

log(`Prover_main, Running_customer_shares_proof...\n`)
const customerSharesTimeStart = performance.now();
await customerSharesProofsRunner();
log(`Prover_main, Customer_shares_proof, time, ${performance.now() - customerSharesTimeStart},  numOfCustomers, ${NUM_OF_CUSTOMERS}\n`);

log(`Prover_main, Running_per_customer_emissions_proof...\n`);
const overallPerCustomerTimeStart = performance.now();
await perCustomerProofsRunner();
log(`Prover_main, Per_customer_emissions_proof, time, ${performance.now() - overallPerCustomerTimeStart}, numOfVerifiers, ${NUM_OF_VERIFIER}\n`);

log(`Prover_main, all_three_proofs, time, ${performance.now() - threeProofsTimeStart}\n`);
log(`Prover_main, Ends, time, ${performance.now() - proverMainTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
logStreamStop(logFile);
