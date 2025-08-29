import cluster from "cluster";
import fs from 'fs';
import fsAsync from 'fs/promises';

import { totalEmissionsCircuit } from "../zkPrograms/zkprogram_total_emissions.js";
import { verify } from "o1js";
import { BATCH_NUM_OF_INTENSITY } from "../types/carbon_intensity_factor.js";
import { debugLog, log, logStreamStart, logStreamStop } from "../utils/util.js";

function convertJsonToProof<
    JsonProof,
    SerialisedProof extends { fromJSON(jsonProof: JsonProof): Promise<JsonProof> }
>(SerialisedProof: SerialisedProof, jsonProof: JsonProof) {
    return SerialisedProof.fromJSON(jsonProof);
}

const path = './generated_logs';
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        console.error(`ERROR: Proof_workers_total_emissions_step, Error creating directory for ${path}: ${err}\n`);
        process.exit(1);
    });
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
const logFile = path + '/proof_workers_total_emissions_step.out';
logStreamStart(logFile);

if (cluster.isPrimary) {
    log(`Proof_workers_total_emissions_step, primary_process_${process.pid}_is_running...\n`);

    const nextLevel = subtreeRootLevel + 1;
    const nextStartIndex = 2**nextLevel;
    for (let i = 0; i < numOfWorkers; i++) {
        startNodeIndex =  BATCH_NUM_OF_INTENSITY*i*nextStartIndex;
        cluster.fork({ "subtreeRootLevel": subtreeRootLevel, "startNodeIndex": startNodeIndex });
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal) {
            log(`ERROR: Proof_workers_total_emissions_step, worker ${worker.process.pid} was killed by signal ${signal}\n`);
        } else if (code != 0) {
            log(`ERROR: Proof_workers_total_emissions_step, worker ${worker.process.pid} exited with error code ${code}\n`);
        } else {
            debugLog(`Proof_workers_total_emissions_step, worker ${worker.process.pid} exited\n`);
        }
    });
} else {
    const proofWorkersTimeStart = performance.now();

    let inputNodeIndex = parseInt(process.env.startNodeIndex)
    debugLog(`Proof_workers_total_emissions_step, worker ${process.pid} started with level ${parseInt(process.env.subtreeRootLevel)} and inputNodeIndex ${inputNodeIndex}\n`);

    const compilationTimeStart = performance.now();
    const totalEmissionsVk = (await totalEmissionsCircuit.compile()).verificationKey;
    log(`Proof_workers_total_emissions_step, total_emissions_circuit_compilation, time, ${performance.now() - compilationTimeStart}\n`);

    let subtreeRootLevel = parseInt(process.env.subtreeRootLevel)
    let parentOfSubtreeLevel = subtreeRootLevel + 1;
    let rightIdx = inputNodeIndex + BATCH_NUM_OF_INTENSITY*(2**subtreeRootLevel);

    let leftSerialisedProofRaw = await fsAsync.readFile("./generated_proofs/total_emissions_proof_" + subtreeRootLevel + "_" + inputNodeIndex + ".json", 'utf8');
    let leftSerialisedProof = await convertJsonToProof(totalEmissionsCircuit.Proof, JSON.parse(leftSerialisedProofRaw));

    let rightSerialisedProofRaw = await fsAsync.readFile("./generated_proofs/total_emissions_proof_" + subtreeRootLevel + "_" + rightIdx + ".json", 'utf8');
    let rightSerialisedProof = await convertJsonToProof(totalEmissionsCircuit.Proof, JSON.parse(rightSerialisedProofRaw));

    const stepProofTimeStart = performance.now();
    const { proof: subTotalEmissionsProof } = await totalEmissionsCircuit.stepTotalEmissionsProof(
        leftSerialisedProof,
        rightSerialisedProof
    );
    log(`Proof_workers_total_emissions_step, one_step_proof, time, ${performance.now() - stepProofTimeStart}\n`);

    // Sanity Check to make sure that they can be verified
    // In the complete prototype the verification is done in a separate process
    const validTotalEmissionsProof = await verify(subTotalEmissionsProof, totalEmissionsVk);
    debugLog(`Proof_workers_total_emissions_step, step node at level ${parseInt(process.env.subtreeRootLevel)} and index ${inputNodeIndex} checked out? ${validTotalEmissionsProof}\n`);

    await fsAsync.writeFile(
        "./generated_proofs/total_emissions_proof_" + parentOfSubtreeLevel + "_" + inputNodeIndex + ".json", JSON.stringify(subTotalEmissionsProof.toJSON())
    ).then(() => {
        log(`Proof_workers_total_emissions_step, Ends, worker_pid, ${process.pid}, level, ${parseInt(process.env.subtreeRootLevel)}, inputNodeIndex, ${inputNodeIndex}, time, ${performance.now() - proofWorkersTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
        logStreamStop(path);
    }).catch(err => {
        log(`ERROR: Proof_workers_total_emissions_step, error writing to ./generated_proofs/total_emissions_proof_${parentOfSubtreeLevel}_${inputNodeIndex}.json: ${err}\n`);
        logStreamStop(path);
        process.exit(1);
    });
    process.exit(0);
}