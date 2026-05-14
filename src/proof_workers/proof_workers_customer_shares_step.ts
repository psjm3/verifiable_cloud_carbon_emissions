import cluster from "cluster";
import fs from 'fs';
import fsAsync from 'fs/promises';

import { NodeContent, TREE_NUM_OF_LEAFS } from "../types/merkle_tree.js";
import { verify } from "o1js";
import { customerSharesCircuit } from "../zkPrograms/zkprogram_customer_shares.js";
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
        console.error(`ERROR: Proof_workers_customer_shares_step, Error creating directory for ${path}: ${err}\n`);
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
let numOfProofs = parseInt(process.argv[4]);
const subtreeRootLevel = parseInt(process.argv[5]);

const logFile = path + '/proof_workers_customer_shares_step.out';
logStreamStart(logFile);

if (cluster.isPrimary) {
    log(`Proof_workers_customer_shares_step, primary_process_${process.pid}_is_running...\n`);

    for (let i = 0; i < numOfWorkers; i++) {
        if (startNodeIndex >= numOfProofs) {
            break;
        }
        cluster.fork({ "subtreeRootLevel": subtreeRootLevel, "startNodeIndex": startNodeIndex });
        startNodeIndex = startNodeIndex + 2;
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal) {
            log(`ERROR: Proof_workers_customer_shares_step, worker ${worker.process.pid} was killed by signal ${signal}\n`);
        } else if (code != 0) {
            log(`ERROR: Proof_workers_customer_shares_step, worker ${worker.process.pid} exited with error code ${code}\n`);
        } else {
            debugLog(`Proof_workers_customer_shares_step, worker ${worker.process.pid} exited\n`);
        }
    });
} else {
    const proofWorkersTimeStart = performance.now();
    let inputNodeIndex = parseInt(process.env.startNodeIndex)
    
    debugLog(`Proof_workers_customer_shares_step, worker ${process.pid} started with level ${parseInt(process.env.subtreeRootLevel)} and inputNodeIndex ${inputNodeIndex}\n`);

    /***** Customer Shares Base (Leaf Nodes) Proofs *****/
    const compilationTimeStart = performance.now();
    const customerTreeCircuitVk = (await customerSharesCircuit.compile()).verificationKey;
    log(`Proof_workers_customer_shares_step, customer_shares_circuit_compilation, time, ${performance.now() - compilationTimeStart}\n`);

    let subtreeRootLevel = parseInt(process.env.subtreeRootLevel)
    let parentOfSubtreeLevel = subtreeRootLevel + 1;

    let leftSerialisedProofRaw = await fsAsync.readFile("./generated_proofs/subtree_proof_" + subtreeRootLevel + "_" + inputNodeIndex + ".json", 'utf8');
    let leftSerialisedProof = await convertJsonToProof(customerSharesCircuit.Proof, JSON.parse(leftSerialisedProofRaw));

    let rightSerialisedProofRaw = await fsAsync.readFile("./generated_proofs/subtree_proof_" + subtreeRootLevel + "_" + (inputNodeIndex + 1) + ".json", 'utf8');
    let rightSerialisedProof = await convertJsonToProof(customerSharesCircuit.Proof, JSON.parse(rightSerialisedProofRaw));

    let parentOfSubtreeIdx = BigInt(Math.floor(inputNodeIndex / 2));
    let subtreeRoot = await fsAsync.readFile("./generated_proofs/subtree_root_" + parentOfSubtreeLevel + "_" + parentOfSubtreeIdx + ".json", 'utf8');
    let subtreeRootAsNode = JSON.parse(subtreeRoot) as NodeContent

    const stepProofTimeStart = performance.now();
    const { proof: stepOneProof } = await customerSharesCircuit.stepSumOfSharesProof(
        new NodeContent({ 
            hash: subtreeRootAsNode.hash, 
            totalCustomerShares: subtreeRootAsNode.totalCustomerShares,
            totalResourceCharges: subtreeRootAsNode.totalResourceCharges,
            totalOtherCharges: subtreeRootAsNode.totalOtherCharges,
            ratioLowerBound: subtreeRootAsNode.ratioLowerBound,
            ratioUpperBound: subtreeRootAsNode.ratioUpperBound
         }),
        leftSerialisedProof,
        rightSerialisedProof
    );
    log(`Proof_workers_customer_shares_step, one_step_proof, time, ${performance.now() - stepProofTimeStart}\n`);

    // sanity check that the generated proof can be verified before writing to disc.
    const validStepProof = await verify(stepOneProof, customerTreeCircuitVk);
    debugLog(`Proof_workers_customer_shares_step, step node at level ${parseInt(process.env.subtreeRootLevel)} and index ${inputNodeIndex} checked out? ${validStepProof}\n`);
    
    await fsAsync.writeFile(
        "./generated_proofs/subtree_proof_" + parentOfSubtreeLevel + "_" + parentOfSubtreeIdx + ".json", JSON.stringify(stepOneProof.toJSON())
    ).then(() => {
        log(`Proof_workers_customer_shares_step, Ends, worker_pid, ${process.pid}, level, ${parseInt(process.env.subtreeRootLevel)}, inputNodeIndex ${inputNodeIndex}, time, ${performance.now() - proofWorkersTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
        logStreamStop(path);
    }).catch(err => {
        log(`ERROR: Proof_workers_customer_shares_step, error writing to ./generated_proofs/subtree_proof_${parentOfSubtreeLevel}_${parentOfSubtreeIdx}.json: ${err}\n`);
        logStreamStop(path);
        process.exit(1);
    });
    process.exit(0);
}
