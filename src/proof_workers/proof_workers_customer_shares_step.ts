import cluster from "cluster";
import fs from 'fs';
import fsAsync from 'fs/promises';

import { NodeContent } from "../types/merkle_tree.js";
import { verify } from "o1js";
import { customerSharesCircuit } from "../zkPrograms/zkprogram_customer_shares.js";
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
    for (let i = 0; i < numOfWorkers; i++) {
        cluster.fork({ "subtreeRootLevel": subtreeRootLevel, "startNodeIndex": startNodeIndex });
        startNodeIndex = startNodeIndex + 2;
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal) {
            console.log({ src: 'proof_workers_customer_shares_step', data: 'ERROR: worker ' + worker.process.pid + ' was killed by signal', value: signal, datatype: 'text' });
        } else if (code != 0) {
            console.log({ src: 'proof_workers_customer_shares_step', data: 'ERROR: worker ' + worker.process.pid + ' exited with error code', value: code, datatype: 'text' });
        } else {
            console.log({ src: 'proof_workers_customer_shares_step', data: 'worker ' + worker.process.pid + ' exited', value: "", datatype: 'text' });
        }
    });
} else {
    const path = './generated_logs';
    if (!fs.existsSync(path)) {
        fsAsync.mkdir(
            path, { recursive: true }
        ).catch(err => {
            console.error(`ERROR: Proof_workers_customer_shares_step, Error creating directory for ${path}: ${err}\n`);
            process.exit(1);
        });
    }
    const logFile = path + '/proof_workers_customer_shares_step.out';
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
    let inputNodeIndex = parseInt(process.env.startNodeIndex)

    logData.push({ src: 'proof_workers_customer_shares_step', data: 'worker ' + process.pid + ' started at level ' + parseInt(process.env.subtreeRootLevel) + ' from index ' + inputNodeIndex, value: "", datatype: 'text' })

    /***** Customer Shares Base (Leaf Nodes) Proofs *****/
    const compilationTimeStart = performance.now();
    const customerTreeCircuitVk = (await customerSharesCircuit.compile()).verificationKey;
    logData.push({ src: 'proof_workers_customer_shares_step', data: 'customer shares circuit compilation - time taken', value: (performance.now() - compilationTimeStart), datatype: 'ms' });

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
    logData.push({ src: 'proof_workers_customer_shares_step', data: 'customer shares one STEP proof - time taken', value: (performance.now() - stepProofTimeStart), datatype: 'ms' });

    // sanity check that the generated proof can be verified before writing to disc.
    const validStepProof = await verify(stepOneProof, customerTreeCircuitVk);
    if (DEBUG) {
        logData.push({ src: 'proof_workers_customer_shares_step', data: 'customer shares one STEP proof at level ' + parseInt(process.env.subtreeRootLevel) + ' from index ' + inputNodeIndex + ' verified?', value: validStepProof, datatype: 'text' });
    }
    await fsAsync.writeFile(
        "./generated_proofs/subtree_proof_" + parentOfSubtreeLevel + "_" + parentOfSubtreeIdx + ".json", JSON.stringify(stepOneProof.toJSON())
    ).then(() => {
        logData.push({ src: 'proof_workers_customer_shares_step', data: 'proof of one customer shares STEP batch at level ' + parseInt(process.env.subtreeRootLevel) + ' from index ' + inputNodeIndex + ' - time taken', value: (performance.now() - proofWorkersTimeStart), datatype: 'ms' })
        logData.push({ src: 'proof_workers_customer_shares_step', data: 'process - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
        logData.push({ src: 'proof_workers_customer_shares_step', data: 'process - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
    }).catch(err => {
        logData.push({ src: 'proof_workers_customer_shares_step', data: 'ERROR: error writing to ./generated_proofs/subtree_proof_' + parentOfSubtreeLevel + '_' + parentOfSubtreeIdx + '.json', value: err, datatype: 'text' })
        csvWriter.writeRecords(logData).then(() => console.log('proof_workers_customer_shares_step logs-writing to file completed'));
        process.exit(1);
    });
    //csvWriter.writeRecords(logData).then(() => console.log('proof_workers_customer_shares_step logs-writing to file completed'));
    await csvWriter.writeRecords(logData).then(() => console.log('proof_workers_customer_shares_step logs-writing to file completed'));
    process.exit(0);
}
