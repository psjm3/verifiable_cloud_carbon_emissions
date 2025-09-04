import cluster from "cluster";
import fs from 'fs';
import fsAsync from 'fs/promises';

import { totalEmissionsCircuit } from "../zkPrograms/zkprogram_total_emissions.js";
import { PublicKey, verify } from "o1js";
import { BATCH_NUM_OF_INTENSITY, SignedIntensityFactor } from "../types/carbon_intensity_factor.js";
import { SignedMeterReading } from "../types/meter_readings.js";
import { DEBUG } from "../utils/util.js";
import { createObjectCsvWriter } from "csv-writer";
import { CsvWriter } from "csv-writer/src/lib/csv-writer.js";
import { ObjectMap } from "csv-writer/src/lib/lang/object.js";

let startIdx = parseInt(process.argv[2]);
let numOfWorkers = parseInt(process.argv[3]);

let intensitiesRaw = await fsAsync.readFile('./generated_intensities/intensity_factors.json', 'utf8');
let signedIntensityFor30Days = JSON.parse(intensitiesRaw) as SignedIntensityFactor[];
let meterReadingsRaw = await fsAsync.readFile('./generated_meter_readings/meter_readings.json', 'utf8');
let signedMeterReadingsFor30Days = JSON.parse(meterReadingsRaw) as SignedMeterReading[];

let gridOperatorPkRaw = await fsAsync.readFile('./generated_public_keys/grid_operator_pk.json', 'utf8');
let gridOperatorPk = PublicKey.fromJSON(gridOperatorPkRaw);
let meterPkRaw = await fsAsync.readFile('./generated_public_keys/meter_pk.json', 'utf8');
let meterPk = PublicKey.fromJSON(meterPkRaw);

if (cluster.isPrimary) {
    for (let i = 0; i < numOfWorkers; i++) {
        cluster.fork({ "startIdx": startIdx });
        startIdx = startIdx + BATCH_NUM_OF_INTENSITY;
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal) {
            console.log({ src: 'proof_workers_total_emissions_base', data: 'ERROR: worker ' + worker.process.pid + ' was killed by signal', value: signal, datatype: 'text' });
        } else if (code != 0) {
            console.log({ src: 'proof_workers_total_emissions_base', data: 'ERROR: worker ' + worker.process.pid + ' exited with error code', value: code, datatype: 'text' });
        } else {
            console.log({ src: 'proof_workers_total_emissions_base', data: 'worker ' + worker.process.pid + ' exited', value: "", datatype: 'text' });
        }
    });
} else {
    const path = './generated_logs';
    if (!fs.existsSync(path)) {
        fsAsync.mkdir(
            path, { recursive: true }
        ).catch(err => {
            console.error(`ERROR: Proof_workers_total_emissions_base, Error creating directory for ${path}: ${err}\n`);
            process.exit(1);
        });
    }
    const logFile = path + '/proof_workers_total_emissions_base.out';
    let csvWriter: CsvWriter<ObjectMap<any>>;
    if (fs.existsSync(logFile)) {
        csvWriter = createObjectCsvWriter({
            append: true,
            path: logFile,
            header: [
                { id: 'src', title: 'src_file' },
                { id: 'data', title: 'data' },
                { id: 'value', title: 'value' },
                { id: 'datatype', title: 'data_type' },
            ]
        });
    } else {
        csvWriter = createObjectCsvWriter({
            path: logFile,
            header: [
                { id: 'src', title: 'src_file' },
                { id: 'data', title: 'data' },
                { id: 'value', title: 'value' },
                { id: 'datatype', title: 'data_type' },
            ]
        });
    }
    let logData = [];
    const proofWorkersTimeStart = performance.now();

    let batchIdx = parseInt(process.env.startIdx);

    logData.push({ src: 'proof_workers_total_emissions_base', data: 'worker ' + process.pid + ' started from index ' + batchIdx, value: "", datatype: 'text' });

    const compilationTimeStart = performance.now();
    const totalEmissionsVk = (await totalEmissionsCircuit.compile()).verificationKey;
    logData.push({ src: 'proof_workers_total_emissions_base', data: 'total emissions circuit compilation - time taken', value: (performance.now() - compilationTimeStart), datatype: 'ms' });

    const baseProofTimeStart = performance.now();
    const { proof: subTotalEmissionsProof } = await totalEmissionsCircuit.baseTotalEmissionsProof(
        signedIntensityFor30Days.slice(batchIdx, batchIdx + BATCH_NUM_OF_INTENSITY),
        gridOperatorPk,
        signedMeterReadingsFor30Days.slice(batchIdx, batchIdx + BATCH_NUM_OF_INTENSITY + 1),
        meterPk
    );
    logData.push({ src: 'proof_workers_total_emissions_base', data: 'total emissions one BASE proof - time taken', value: (performance.now() - baseProofTimeStart), datatype: 'ms' });

    // Sanity Check to make sure that they can be verified
    // In the complete prototype the verification is done in a separate process
    const validTotalEmissionsProof = await verify(subTotalEmissionsProof, totalEmissionsVk);
    if (DEBUG) {
        logData.push({ src: 'proof_workers_total_emissions_base', data: 'total emissions one BASE proof from index ' + batchIdx + ' verified?', value: validTotalEmissionsProof, datatype: 'text' });
    }
    fsAsync.writeFile(
        "./generated_proofs/total_emissions_proof_0_" + batchIdx + ".json", JSON.stringify(subTotalEmissionsProof.toJSON())
    ).then(() => {
        logData.push({ src: 'proof_workers_total_emissions_base', data: 'proof of one total emissions BASE batch from index ' + batchIdx + ' - time taken', value: (performance.now() - proofWorkersTimeStart), datatype: 'ms' })
        logData.push({ src: 'proof_workers_total_emissions_base', data: 'process - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
        logData.push({ src: 'proof_workers_total_emissions_base', data: 'process - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
    }).catch(err => {
        logData.push({ src: 'proof_workers_total_emissions_base', data: 'ERROR: error writing to ./generated_proofs/total_emissions_proof_0_' + batchIdx + '.json', value: err, datatype: 'text' })
        csvWriter.writeRecords(logData).then(() => console.log('proof_workers_customer_shares_base logs-writing to file completed'));
        process.exit(1);
    });
    await csvWriter.writeRecords(logData).then(() => console.log('proof_workers_customer_shares_base logs-writing to file completed'));
    process.exit(0);
}