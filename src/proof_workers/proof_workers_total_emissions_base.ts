import cluster from "cluster";
import fs from 'fs/promises';

import { totalEmissionsCircuit } from "../zkPrograms/zkprogram_total_emissions.js";
import { PublicKey, verify } from "o1js";
import { BATCH_NUM_OF_INTENSITY, SignedIntensityFactor } from "../types/carbon_intensity_factor.js";
import { SignedMeterReading } from "../types/meter_readings.js";

let intensitiesRaw = await fs.readFile('./generated_intensity/intensity_factors.json', 'utf8');
let signedIntensityFor30Days = JSON.parse(intensitiesRaw) as SignedIntensityFactor[];
let meterReadingsRaw = await fs.readFile('./generated_meter_readings/meter_readings.json', 'utf8');
let signedMeterReadingsFor30Days = JSON.parse(meterReadingsRaw) as SignedMeterReading[];

let gridOperatorPkRaw = await fs.readFile('./generated_public_keys/grid_operator_pk.json', 'utf8');
let gridOperatorPk = PublicKey.fromJSON(gridOperatorPkRaw);
let meterPkRaw = await fs.readFile('./generated_public_keys/meter_pk.json', 'utf8');
let meterPk = PublicKey.fromJSON(meterPkRaw);

if (cluster.isPrimary) {
    console.log('Primary', process.pid, 'is running');

    let startIdx = parseInt(process.argv[2]);
    let numOfWorkers = parseInt(process.argv[3]);

    console.log("Starting workers with startIdx:", startIdx, "numOfWorkers:", numOfWorkers);

    for (let i = 0; i < numOfWorkers; i++) {
        cluster.fork({ "startIdx": startIdx });
        startIdx = startIdx + BATCH_NUM_OF_INTENSITY;
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
    let batchIdx = parseInt(process.env.startIdx)
    console.log(
        'Worker', process.pid,
        "batchIdx: ", batchIdx);
    console.time("compileTotalEmissions");
    const totalEmissionsVk = (await totalEmissionsCircuit.compile()).verificationKey;
    console.timeEnd("compileTotalEmissions");

    let cs = await totalEmissionsCircuit.analyzeMethods();
    console.log("Number of constraints for base", cs.baseTotalEmissionsProof.rows);

    console.time("One baseTotalEmissionsProof");
    const { proof: subTotalEmissionsProof } = await totalEmissionsCircuit.baseTotalEmissionsProof(
        signedIntensityFor30Days.slice(batchIdx, batchIdx + BATCH_NUM_OF_INTENSITY),
        gridOperatorPk,
        signedMeterReadingsFor30Days.slice(batchIdx, batchIdx + BATCH_NUM_OF_INTENSITY + 1),
        meterPk
    );
    console.timeEnd("One baseTotalEmissionsProof");

    // Sanity Check to make sure that they can be verified
    // In the complete prototype the verification is done in a separate process
    const validTotalEmissionsProof = await verify(subTotalEmissionsProof, totalEmissionsVk);
    console.log('Total Emissions Proof checked out?', validTotalEmissionsProof);

    fs.writeFile(
        "./generated_proofs/total_emissions_proof_0_" + batchIdx + ".json", JSON.stringify(subTotalEmissionsProof.toJSON())
    ).then(() => {
        console.log("Total Emissions Base Worker", process.pid, "CPU usage:", process.cpuUsage());
        process.exit(0);
    }).catch(err => {
        console.error('Error writing file:', err);
        process.exit(1);
    });
}