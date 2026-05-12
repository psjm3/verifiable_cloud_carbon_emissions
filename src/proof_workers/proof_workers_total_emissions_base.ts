import cluster from "cluster";
import fs from 'fs';
import fsAsync from 'fs/promises';

import { totalEmissionsCircuit } from "../zkPrograms/zkprogram_total_emissions.js";
import { PublicKey, verify } from "o1js";
import { BATCH_NUM_OF_INTENSITY, SignedIntensityFactor } from "../types/carbon_intensity_factor.js";
import { SignedMeterReading } from "../types/meter_readings.js";
import { debugLog, log, logStreamStart, logStreamStop } from "../utils/util.js";

const path = './generated_logs';
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        console.error(`ERROR: Proof_workers_total_emissions_base, Error creating directory for ${path}: ${err}\n`);
        process.exit(1);
    });
}

let startIdx = parseInt(process.argv[2]);
let numOfWorkers = parseInt(process.argv[3]);

const logFile = path + '/proof_workers_total_emissions_base.out';
logStreamStart(logFile);

let intensitiesRaw = await fsAsync.readFile('./src/data/intensity_factors.json', 'utf8');
let signedIntensityFor30Days = JSON.parse(intensitiesRaw) as SignedIntensityFactor[];
let meterReadingsRaw = await fsAsync.readFile('./generated_meter_readings/meter_readings.json', 'utf8');
let signedMeterReadingsFor30Days = JSON.parse(meterReadingsRaw) as SignedMeterReading[];

let gridOperatorPkRaw = await fsAsync.readFile('./generated_public_keys/grid_operator_pk.json', 'utf8');
let gridOperatorPk = PublicKey.fromJSON(gridOperatorPkRaw);
let meterPkRaw = await fsAsync.readFile('./generated_public_keys/meter_pk.json', 'utf8');
let meterPk = PublicKey.fromJSON(meterPkRaw);

if (cluster.isPrimary) {
    log(`Proof_workers_total_emissions_base, primary_process_${process.pid}_is_running...\n`);

    for (let i = 0; i < numOfWorkers; i++) {
        cluster.fork({ "startIdx": startIdx });
        startIdx = startIdx + BATCH_NUM_OF_INTENSITY;
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal) {
            log(`ERROR: Proof_workers_total_emissions_base, worker ${worker.process.pid} was killed by signal ${signal}\n`);
        } else if (code != 0) {
            log(`ERROR: Proof_workers_total_emissions_base, worker ${worker.process.pid} exited with error code ${code}\n`);
        } else {
            debugLog(`Proof_workers_total_emissions_base, worker ${worker.process.pid} exited\n`);
        }
    });
} else {
    const proofWorkersTimeStart = performance.now();

    let batchIdx = parseInt(process.env.startIdx);

    debugLog(`Proof_workers_total_emissions_base, worker ${process.pid} started with batchIdx ${batchIdx}\n`);

    const compilationTimeStart = performance.now();
    const totalEmissionsVk = (await totalEmissionsCircuit.compile()).verificationKey;
    log(`Proof_workers_total_emissions_base, total_emissions_circuit_compilation, time, ${performance.now() - compilationTimeStart}\n`);

    const baseProofTimeStart = performance.now();
    const { proof: subTotalEmissionsProof } = await totalEmissionsCircuit.baseTotalEmissionsProof(
        signedIntensityFor30Days.slice(batchIdx, batchIdx + BATCH_NUM_OF_INTENSITY),
        gridOperatorPk,
        signedMeterReadingsFor30Days.slice(batchIdx, batchIdx + BATCH_NUM_OF_INTENSITY + 1),
        meterPk
    );
    log(`Proof_workers_total_emissions_base, one_base_proof, time, ${performance.now() - baseProofTimeStart}\n`);

    // Sanity Check to make sure that they can be verified
    // In the complete prototype the verification is done in a separate process
    const validTotalEmissionsProof = await verify(subTotalEmissionsProof, totalEmissionsVk);
    debugLog(`Proof_workers_total_emissions_base, baes total emissions for batch ${batchIdx} checked out? ${validTotalEmissionsProof}\n`);

    fsAsync.writeFile(
        "./generated_proofs/total_emissions_proof_0_" + batchIdx + ".json", JSON.stringify(subTotalEmissionsProof.toJSON())
    ).then(() => {
        log(`Proof_workers_total_emissions_base, Ends, worker_pid, ${process.pid}, start_idx, ${batchIdx}, time, ${performance.now() - proofWorkersTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
        logStreamStop(path);
        process.exit(0);
    }).catch(err => {
        log(`ERROR: Proof_workers_total_emissions_base, error writing to ./generated_proofs/total_emissions_proof_0_${batchIdx}.json: ${err}\n`);
        logStreamStop(path);
        process.exit(1);
    });
}