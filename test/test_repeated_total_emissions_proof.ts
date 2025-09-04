import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import fsAsync from 'fs/promises';
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

const totalEmissionsProofsExec = promisify(exec);
async function totalEmissionsProofsRunner() {
    try {
        await totalEmissionsProofsExec(
            'tsx ./src/provers/prover_total_emissions.ts',
            { maxBuffer: 512 * 1024 }
        );
    } catch (err) {
        logData.push({ src: 'test_repeated_total_emissions_proof', data: 'ERROR: child process prover_total_emissions.ts', value: err, datatype: 'text' });
    }
}

/******************/
/* PROGRAM STARTS */
/******************/
await createArtifactFolders();

for (let i=0; i<5; i++) {
    logData.push({ src: 'test_repeated_total_emissions_proof', data: 'Running total emissions proof iteration ', value: i, datatype: 'number' });

    const totalEmissionsTimeStart = performance.now();
    await totalEmissionsProofsRunner();
    logData.push({ src: 'test_repeated_total_emissions_proof', data: 'Completed one total emissions proof - Time taken', value: (performance.now() - totalEmissionsTimeStart), datatype: 'ms' });
    logData.push({ src: 'test_repeated_total_emissions_proof', data: 'Completed one total emissions proof - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
    logData.push({ src: 'test_repeated_total_emissions_proof', data: 'Completed one total emissions proof - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
}
logData.push({ src: 'test_repeated_total_emissions_proof', data: 'Total emissions proof 5 times overall - time taken', value: (performance.now() - testTimeStart), datatype: 'ms' })
logData.push({ src: 'test_repeated_total_emissions_proof', data: 'process - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
logData.push({ src: 'test_repeated_total_emissions_proof', data: 'process - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
csvWriter.writeRecords(logData).then(() => console.log('test_repeated_total_emissions_proof logs-writing to file completed'));