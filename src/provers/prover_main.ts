import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import fsAsync from 'fs/promises';
import { customerSharesCircuit } from '../zkPrograms/zkprogram_customer_shares.js';
import { totalEmissionsCircuit } from '../zkPrograms/zkprogram_total_emissions.js';
import { perCustomerEmissionsCircuit } from '../zkPrograms/zkprogram_per_customer_proof.js';
import { NUM_OF_CUSTOMERS } from '../types/merkle_tree.js';
import { NUM_OF_VERIFIER } from '../types/customer.js';
import { createObjectCsvWriter } from 'csv-writer';
import { CsvWriter } from 'csv-writer/src/lib/csv-writer.js';
import { ObjectMap } from 'csv-writer/src/lib/lang/object.js';

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
let csvWriter : CsvWriter<ObjectMap<any>>;
if (fs.existsSync(logFile)) {
    csvWriter = createObjectCsvWriter({
        append: true,
        path: logFile,
        header: [
            {id: 'src', title: 'src_file'},
            {id: 'data', title: 'data'},
            {id: 'value', title: 'value'},
            {id: 'datatype', title: 'data_type'},
        ]
    });
} else {
    csvWriter = createObjectCsvWriter({
        path: logFile,
        header: [
            {id: 'src', title: 'src_file'},
            {id: 'data', title: 'data'},
            {id: 'value', title: 'value'},
            {id: 'datatype', title: 'data_type'},
        ]
    }); 
}
let logData = [];

const proverMainTimeStart = performance.now();

const totalEmissionsProofsExec = promisify(exec);
async function totalEmissionsProofsRunner() {
    try {
        await totalEmissionsProofsExec(
            'tsx ./src/provers/prover_total_emissions.ts',
            { maxBuffer: 512 * 1024 }
        );
    } catch (err) {
        logData.push({ src: 'prover_main', data: 'ERROR: child process prover_total_emissions.ts', value: err, datatype: 'text' })
    }
}

const customerSharesProofsExec = promisify(exec);
async function customerSharesProofsRunner() {
    try {
        await customerSharesProofsExec(
            'tsx ./src/provers/prover_customer_shares.ts',
            { maxBuffer: 2048 * 1024 }
        );
    } catch (err) {
        logData.push({ src: 'prover_main', data: 'ERROR: child process prover_customer_shares.ts', value: err, datatype: 'text' })
    }
}

const perCustomerProofsExec = promisify(exec);
async function perCustomerProofsRunner() {
    try {
        await perCustomerProofsExec(
            'tsx ./src/provers/prover_per_customer_emissions.ts',
            { maxBuffer: 512 * 1024 }
        );
    } catch (err) {
        logData.push({ src: 'prover_main', data: 'ERROR: child process prover_per_customer_emissions.ts', value: err, datatype: 'text' })
    }
}

/******************/
/* PROGRAM STARTS */
/******************/
await createArtifactFolders();

const totalEmissionsAnalysis = await totalEmissionsCircuit.analyzeMethods();
logData.push({ src: 'prover_main', data: 'constraints of total emissions BASE', value: totalEmissionsAnalysis.baseTotalEmissionsProof.rows, datatype: 'number' })
logData.push({ src: 'prover_main', data: 'constraints of total emissions STEP', value: totalEmissionsAnalysis.stepTotalEmissionsProof.rows, datatype: 'number' })
const customerSharesAnalysis = await customerSharesCircuit.analyzeMethods();
logData.push({ src: 'prover_main', data: 'constraints of customer shares BASE', value: customerSharesAnalysis.baseSumOfSharesProof.rows, datatype: 'number' })
logData.push({ src: 'prover_main', data: 'constraints of customer shares STEP', value: customerSharesAnalysis.stepSumOfSharesProof.rows, datatype: 'number' })
const perCustomerEmissionssAnalysis = await perCustomerEmissionsCircuit.analyzeMethods();
logData.push({ src: 'prover_main', data: 'constraints of per customer emissions', value: perCustomerEmissionssAnalysis.emissionsProof.rows, datatype: 'number' })

const threeProofsTimeStart = performance.now();
const totalEmissionsTimeStart = performance.now();
await totalEmissionsProofsRunner();
logData.push({ src: 'prover_main', data: 'total emissions proof - time taken', value: (performance.now() - totalEmissionsTimeStart), datatype: 'ms' })

const customerSharesTimeStart = performance.now();
await customerSharesProofsRunner();
logData.push({ src: 'prover_main', data: 'customer shares proof - time taken', value: (performance.now() - customerSharesTimeStart), datatype: 'ms' })
logData.push({ src: 'prover_main', data: 'customer shares proof - number of customers', value: NUM_OF_CUSTOMERS, datatype: 'number' })

const overallPerCustomerTimeStart = performance.now();
await perCustomerProofsRunner();
logData.push({ src: 'prover_main', data: 'per customer emissions proof - time taken', value: (performance.now() - overallPerCustomerTimeStart), datatype: 'ms' })
logData.push({ src: 'prover_main', data: 'per customer emissions proof - number of verifier', value: NUM_OF_VERIFIER, datatype: 'number' })

logData.push({ src: 'prover_main', data: 'generated three proofs overall - time taken', value: (performance.now() - threeProofsTimeStart), datatype: 'ms' })
logData.push({ src: 'prover_main', data: 'prover overall - time taken', value: (performance.now() - proverMainTimeStart), datatype: 'ms' })
logData.push({ src: 'prover_main', data: 'process - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
logData.push({ src: 'prover_main', data: 'process - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
csvWriter.writeRecords(logData).then(() => console.log('prover_main logs-writing to file completed'));