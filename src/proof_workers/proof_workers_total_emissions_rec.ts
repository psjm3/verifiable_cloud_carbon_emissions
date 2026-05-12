import cluster from "cluster";
import fs from 'fs/promises';

import { totalEmissionsCircuit } from "../zkPrograms/zkprogram_total_emissions.js";
import { verify } from "o1js";
import { BATCH_NUM_OF_INTENSITY } from "../types/carbon_intensity_factor.js";

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

    const nextLevel = subtreeRootLevel + 1;
    const nextStartIndex = 2**nextLevel;
    for (let i = 0; i < numOfWorkers; i++) {
        startNodeIndex =  BATCH_NUM_OF_INTENSITY*i*nextStartIndex;
        cluster.fork({ "subtreeRootLevel": subtreeRootLevel, "startNodeIndex": startNodeIndex });
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

    console.time("compileTotalEmissions");
    const totalEmissionsVk = (await totalEmissionsCircuit.compile()).verificationKey;
    console.timeEnd("compileTotalEmissions");

    let cs = await totalEmissionsCircuit.analyzeMethods();
    console.log("Number of constraints for rec", cs.stepTotalEmissionsProof.rows);

    let subtreeRootLevel = parseInt(process.env.subtreeRootLevel)
    let parentOfSubtreeLevel = subtreeRootLevel + 1;
    let rightIdx = inputNodeIndex + BATCH_NUM_OF_INTENSITY*(2**subtreeRootLevel);

    let leftSerialisedProofRaw = await fs.readFile("./generated_proofs/total_emissions_proof_" + subtreeRootLevel + "_" + inputNodeIndex + ".json", 'utf8');
    let leftSerialisedProof = await convertJsonToProof(totalEmissionsCircuit.Proof, JSON.parse(leftSerialisedProofRaw));

    let rightSerialisedProofRaw = await fs.readFile("./generated_proofs/total_emissions_proof_" + subtreeRootLevel + "_" + rightIdx + ".json", 'utf8');
    let rightSerialisedProof = await convertJsonToProof(totalEmissionsCircuit.Proof, JSON.parse(rightSerialisedProofRaw));

    console.time("One stepTotalEmissionsProof");
    const { proof: subTotalEmissionsProof } = await totalEmissionsCircuit.stepTotalEmissionsProof(
        leftSerialisedProof,
        rightSerialisedProof
    );
    console.timeEnd("One stepTotalEmissionsProof");

    // Sanity Check to make sure that they can be verified
    // In the complete prototype the verification is done in a separate process
    const validTotalEmissionsProof = await verify(subTotalEmissionsProof, totalEmissionsVk);
    console.log('Total Emissions Proof checked out?', validTotalEmissionsProof);

    await fs.writeFile(
        "./generated_proofs/total_emissions_proof_" + parentOfSubtreeLevel + "_" + inputNodeIndex + ".json", JSON.stringify(subTotalEmissionsProof.toJSON())
    ).then(() => {
        console.log("Total Emissions Rec Worker", process.pid, "CPU usage:", process.cpuUsage());
    }).catch(err => {
        console.error('Error writing file:', err);
        process.exit(1);
    });
    process.exit(0);
}