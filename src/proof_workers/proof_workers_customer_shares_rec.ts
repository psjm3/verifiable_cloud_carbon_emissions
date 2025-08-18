import cluster from "cluster";
import { NodeContent } from "../types/o1js_merkle_tree.js";
import { verify } from "o1js";

import fs from 'fs/promises';
import { customerSharesCircuit } from "../zkPrograms/zkprogram_customer_shares.js";

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
    console.log('Primary', process.pid, 'is running');
    // console.log("Got command line parameters:", process.argv[2], process.argv[3], process.argv[4])

    for (let i = 0; i < numOfWorkers; i++) {
        cluster.fork({ "subtreeRootLevel": subtreeRootLevel, "startNodeIndex": startNodeIndex });
        startNodeIndex = startNodeIndex + 2;
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal) {
            console.log('worker', worker.process.pid, 'was killed by signal', signal);
        } else if (code != 0) {
            console.log('worker', worker.process.pid, 'exited with error code', code);
        } else {
            console.log('worker', worker.process.pid, 'exited');
        }
    });
} else {
    let inputNodeIndex = parseInt(process.env.startNodeIndex)

    console.log(
        'Worker', process.pid,
        "level to prove:", parseInt(process.env.subtreeRootLevel),
        'inputNodeIndex', inputNodeIndex
    );

    /***** Customer Shares Base (Leaf Nodes) Proofs *****/
    // console.log("Compiling Customer Shares Circuit...");
    console.time("compileCustomerSharesProof");
    const customerTreeCircuitVk = (await customerSharesCircuit.compile()).verificationKey;
    console.timeEnd("compileCustomerSharesProof")

    let subtreeRootLevel = parseInt(process.env.subtreeRootLevel)
    let parentOfSubtreeLevel = subtreeRootLevel + 1;

    let leftSerialisedProofRaw = await fs.readFile("./generated_proofs/subtree_proof_" + subtreeRootLevel + "_" + inputNodeIndex + ".json", 'utf8');
    let leftSerialisedProof = await convertJsonToProof(customerSharesCircuit.Proof, JSON.parse(leftSerialisedProofRaw));

    let rightSerialisedProofRaw = await fs.readFile("./generated_proofs/subtree_proof_" + subtreeRootLevel + "_" + (inputNodeIndex + 1) + ".json", 'utf8');
    let rightSerialisedProof = await convertJsonToProof(customerSharesCircuit.Proof, JSON.parse(rightSerialisedProofRaw));

    let parentOfSubtreeIdx = BigInt(Math.floor(inputNodeIndex / 2));
    // console.log("subtree root level", parentOfSubtreeLevel, "subtree root idx:", parentOfSubtreeIdx);
    let subtreeRoot = await fs.readFile("./generated_proofs/subtree_root_" + parentOfSubtreeLevel + "_" + parentOfSubtreeIdx + ".json", 'utf8');
    let subtreeRootAsNode = JSON.parse(subtreeRoot) as NodeContent

    console.time("Generate one REC proof");
    const { proof: stepOneProof } = await customerSharesCircuit.stepOneSumOfSharesProof(
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
    console.timeEnd("Generate one REC proof");

    console.log(
        "Subtree from worker", process.pid, 
        "has hash:", stepOneProof.publicOutput.hash.toString(), 
        "consumption shares sum:", stepOneProof.publicOutput.totalCustomerShares.toString());

    // sanity check that the generated proof can be verified before writing to disc.
    const validProof = await verify(stepOneProof, customerTreeCircuitVk);
    //console.log('Node at level', parentOfSubtreeLevel, 'and index', parentOfSubtreeIdx, 'checked out?', validProof);

    await fs.writeFile(
        "./generated_proofs/subtree_proof_" + parentOfSubtreeLevel + "_" + parentOfSubtreeIdx + ".json", JSON.stringify(stepOneProof.toJSON())
    ).then(() => {
        console.log("Customer Shares Rec Worker", process.pid, "CPU usage:", process.cpuUsage());
    }).catch(err => {
        console.error('Error writing file:', err);
        process.exit(1);
    });
    process.exit(0);
}