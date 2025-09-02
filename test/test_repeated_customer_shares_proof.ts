import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import fsAsync from 'fs/promises';
import { createObjectCsvWriter } from 'csv-writer';
import { NUM_OF_CUSTOMERS } from '../src/types/merkle_tree.js';
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
const testTimeStart = performance.now();

const customerSharesProofsExec = promisify(exec);
async function customerSharesProofsRunner() {
    try {
        await customerSharesProofsExec(
            'tsx ./src/provers/prover_customer_shares.ts',
            { maxBuffer: 2048 * 1024 })
    } catch (err) {
        logData.push({ src: 'test_repeated_customer_shares_proof', data: 'ERROR: child process prover_customer_shares.ts', value: err, datatype: 'text' });
    }
}

/******************/
/* PROGRAM STARTS */
/******************/
await createArtifactFolders();

for (let i = 0; i < 5; i++) {
    logData.push({ src: 'test_repeated_customer_shares_proof', data: 'Running customer shares proof for ' + NUM_OF_CUSTOMERS + ' iteration ', value: i, datatype: 'number' });

    const customerSharesTimeStart = performance.now();
    await customerSharesProofsRunner();
    logData.push({ src: 'test_repeated_customer_shares_proof', data: 'Completed one customer shares proof - Time taken', value: (performance.now() - customerSharesTimeStart), datatype: 'ms' });
    logData.push({ src: 'test_repeated_customer_shares_proof', data: 'Completed one customer shares proof - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
    logData.push({ src: 'test_repeated_customer_shares_proof', data: 'Completed one customer shares proof - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
}
logData.push({ src: 'test_repeated_customer_shares_proof', data: 'Customer shares proof 5 times overall - time taken', value: (performance.now() - testTimeStart), datatype: 'ms' })
logData.push({ src: 'test_repeated_customer_shares_proof', data: 'process - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
logData.push({ src: 'test_repeated_customer_shares_proof', data: 'process - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
csvWriter.writeRecords(logData).then(() => console.log('test_repeated_customer_shares_proof logs-writing to file completed'));