import cluster from "cluster";
import fs from 'fs';
import fsAsync from 'fs/promises';

import { totalEmissionsCircuit } from "../zkPrograms/zkprogram_total_emissions.js";
import { verify } from "o1js";
import { BATCH_NUM_OF_INTENSITY } from "../types/carbon_intensity_factor.js";
import { DEBUG } from "../utils/util.js";
import { createObjectCsvWriter } from "csv-writer";
import { CsvWriter } from "csv-writer/src/lib/csv-writer.js";
import { ObjectMap } from "csv-writer/src/lib/lang/object.js";

function convertJsonToProof<
    JsonProof,
    SerialisedProof extends { fromJSON(jsonProof: JsonProof): Promise<JsonProof> }
>(SerialisedProof: SerialisedProof, jsonProof: JsonProof) {
    return SerialisedProof.fromJSON(jsonProof);
}

// For 1st rec proof, number of proofs input = number of base proofs, number of proofs output = number of proofs input / BATCH_NUM_OF_CUSTOMERS

// number of worker is divided by BATCH_NUM_OF_CUSTOMERS every time subtree root level increases, 
// e.g. first batch the number or workers are (TREE_NUM_OF_LEAFS/BATCH_NUM_OF_CUSTOMERS),
// at the next level up, the number of workers becomes (TREE_NUM_OF_LEAFS/(BATCH_NUM_OF_CUSTOMERS*BATCH_NUM_OF_CUSTOMERS))
// ***** 
// Therefore, each time before this cluster is executed, numOfInputProofs needs to be updated to 
// half of the number of the previous numOfInputProofs
// *****
const numOfWorkers = parseInt(process.argv[2]);
let startNodeIndex = parseInt(process.argv[3]);
const subtreeRootLevel = parseInt(process.argv[4]);

if (cluster.isPrimary) {
    const nextLevel = subtreeRootLevel + 1;
    const nextStartIndex = 2 ** nextLevel;
    for (let i = 0; i < numOfWorkers; i++) {
        startNodeIndex = BATCH_NUM_OF_INTENSITY * i * nextStartIndex;
        cluster.fork({ "subtreeRootLevel": subtreeRootLevel, "startNodeIndex": startNodeIndex });
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal) {
            console.log({ src: 'proof_workers_total_emissions_step', data: 'ERROR: worker ' + worker.process.pid + ' was killed by signal', value: signal, datatype: 'text' });
        } else if (code != 0) {
            console.log({ src: 'proof_workers_total_emissions_step', data: 'ERROR: worker ' + worker.process.pid + ' exited with error code', value: code, datatype: 'text' });
        } else {
            console.log({ src: 'proof_workers_total_emissions_step', data: 'worker ' + worker.process.pid + ' exited', value: "", datatype: 'text' });
        }
    });
} else {
    const path = './generated_logs';
    if (!fs.existsSync(path)) {
        fsAsync.mkdir(
            path, { recursive: true }
        ).catch(err => {
            console.error(`ERROR: Proof_workers_total_emissions_step, Error creating directory for ${path}: ${err}\n`);
            process.exit(1);
        });
    }
    const logFile = path + '/proof_workers_total_emissions_step.out';
    let csvWriter: CsvWriter<ObjectMap<any>>;
    // if (fs.existsSync(logFile)) {
    //     csvWriter = createObjectCsvWriter({
    //         append: true,
    //         path: logFile,
    //         header: [
    //             { id: 'src', title: 'src_file' },
    //             { id: 'data', title: 'data' },
    //             { id: 'value', title: 'value' },
    //             { id: 'datatype', title: 'data_type' },
    //         ]
    //     });
    // } else {
        csvWriter = createObjectCsvWriter({
            path: logFile,
            header: [
                { id: 'src', title: 'src_file' },
                { id: 'data', title: 'data' },
                { id: 'value', title: 'value' },
                { id: 'datatype', title: 'data_type' },
            ]
        });
    // }
    let logData = [];
    const proofWorkersTimeStart = performance.now();

    let inputNodeIndex = parseInt(process.env.startNodeIndex)
    logData.push({ src: 'proof_workers_total_emissions_step', data: 'worker ' + process.pid + ' started at level ' + parseInt(process.env.subtreeRootLevel) + ' from index ' + inputNodeIndex, value: "", datatype: 'text' });

    const compilationTimeStart = performance.now();
    const totalEmissionsVk = (await totalEmissionsCircuit.compile()).verificationKey;
    logData.push({ src: 'proof_workers_total_emissions_step', data: 'total emissions circuit compilation - time taken', value: (performance.now() - compilationTimeStart), datatype: 'ms' });

    let subtreeRootLevel = parseInt(process.env.subtreeRootLevel)
    let parentOfSubtreeLevel = subtreeRootLevel + 1;
    let rightIdx = inputNodeIndex + BATCH_NUM_OF_INTENSITY * (2 ** subtreeRootLevel);

    let leftSerialisedProofRaw = await fsAsync.readFile("./generated_proofs/total_emissions_proof_" + subtreeRootLevel + "_" + inputNodeIndex + ".json", 'utf8');
    let leftSerialisedProof = await convertJsonToProof(totalEmissionsCircuit.Proof, JSON.parse(leftSerialisedProofRaw));

    let rightSerialisedProofRaw = await fsAsync.readFile("./generated_proofs/total_emissions_proof_" + subtreeRootLevel + "_" + rightIdx + ".json", 'utf8');
    let rightSerialisedProof = await convertJsonToProof(totalEmissionsCircuit.Proof, JSON.parse(rightSerialisedProofRaw));

    const stepProofTimeStart = performance.now();
    const { proof: subTotalEmissionsProof } = await totalEmissionsCircuit.stepTotalEmissionsProof(
        leftSerialisedProof,
        rightSerialisedProof
    );
    logData.push({ src: 'proof_workers_total_emissions_step', data: 'total emissions one STEP proof - time taken', value: (performance.now() - stepProofTimeStart), datatype: 'ms' });

    // Sanity Check to make sure that they can be verified
    // In the complete prototype the verification is done in a separate process
    const validTotalEmissionsProof = await verify(subTotalEmissionsProof, totalEmissionsVk);
    if (DEBUG) {
        logData.push({ src: 'proof_workers_total_emissions_step', data: 'total emissions one STEP proof at level ' + parseInt(process.env.subtreeRootLevel) + ' from index ' + inputNodeIndex + ' verified?', value: validTotalEmissionsProof, datatype: 'text' });
    }
    await fsAsync.writeFile(
        "./generated_proofs/total_emissions_proof_" + parentOfSubtreeLevel + "_" + inputNodeIndex + ".json", JSON.stringify(subTotalEmissionsProof.toJSON())
    ).then(() => {
        logData.push({ src: 'proof_workers_total_emissions_step', data: 'proof of one total emissions STEP batch at level ' + parseInt(process.env.subtreeRootLevel) + ' from index ' + inputNodeIndex + ' - time taken', value: (performance.now() - proofWorkersTimeStart), datatype: 'ms' })
        logData.push({ src: 'proof_workers_total_emissions_step', data: 'process - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
        logData.push({ src: 'proof_workers_total_emissions_step', data: 'process - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
        csvWriter.writeRecords(logData).then(() => console.log('proof_workers_total_emissions_step logs-writing to file completed'));
    }).catch(err => {
        logData.push({ src: 'proof_workers_total_emissions_step', data: 'ERROR: error writing to ./generated_proofs/total_emissions_proof_' + parentOfSubtreeLevel + '_' + inputNodeIndex + '.json', value: err, datatype: 'text' })
        csvWriter.writeRecords(logData).then(() => console.log('proof_workers_total_emissions_step logs-writing to file completed'));
        process.exit(1);
    });
    process.exit(0);
}