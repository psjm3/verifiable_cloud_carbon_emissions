import os from 'node:os';
import fs from 'fs';
import fsAsync from 'fs/promises';

import { promisify } from 'util';
import { exec } from 'child_process';
import { Field, Signature } from "o1js";
import { BATCH_NUM_OF_INTENSITY, SignedIntensityFactor } from "../types/carbon_intensity_factor.js";
import { SignedMeterReading } from "../types/meter_readings.js";
import { GridOperator } from "../data/data_grid_operator.js";
import { SmartMeterData } from "../data/data_meter_reading.js";
import { SmartMeterManufacturer } from "../data/data_meter_manufacturer.js";
import { CARBON_INTENSITY_FROM_TIMESTAMP, CARBON_INTENSITY_TO_TIMESTAMP } from "../data/data_timestamps.js";
import { debugLog, log, logStreamStart, logStreamStop } from '../utils/util.js';

const path = './generated_logs';
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        console.error(`ERROR: Prover_total_emissions, Error creating directory for ${path}: ${err}\n`);
        process.exit(1);
    });
}
const logFile = path + '/prover_total_emissions.out';
logStreamStart(logFile);

const proverTotalEmissionsTimeStart = performance.now();
log(`Prover_total_emissions, Starts\n`);

async function generateTotalEmissionsProof(numOfIntensities: number) {
    // By using a separate to run batches of base proofs, and then recursively generate proofs for further up the 
    // tree until the root, it allows many more customer records to be on the same database/merkle tree. This can 
    // scale up subject to file system storage and CPU time/capacity limitations.
    const baseTotalEmissionsTimeStart = performance.now();
    const baseProofsRunner = promisify(exec);
    const numCPUs = os.availableParallelism();
    // let numOfWorkers = (numOfIntensities / BATCH_NUM_OF_INTENSITY) > numCPUs ? numCPUs : (numOfIntensities / BATCH_NUM_OF_INTENSITY);
    let numOfWorkers = 10;
    for (let i = 0; i < numOfIntensities - 1; i += (BATCH_NUM_OF_INTENSITY * numOfWorkers)) {
        log(`Prover_total_emissions, base_proof, numOfIntensities, ${numOfIntensities}, iteration, ${i}, numOfWorkers, ${numOfWorkers}\n`);

        async function baseProofsRunnerExec() {
            const { stdout, stderr } = await baseProofsRunner('tsx ./src/proof_workers/proof_workers_total_emissions_base.ts ' + ' ' + numOfIntensities + ' ' + i + ' ' + numOfWorkers);
            if (stdout != "") {
                log(`${stdout}\n`);
            }
            if (stderr != "") {
                log(`${stderr}\n`);
            }
        }
        const runTotalEmissionsBaseTimeStart = performance.now();
        await baseProofsRunnerExec();
        log(`Prover_total_emissions, base_proof_runner_one_batch, time, ${performance.now() - runTotalEmissionsBaseTimeStart}, iteration, ${i}, num_of_workers, ${numOfWorkers}\n`);
    }
    log(`Prover_total_emissions, total_emissions_base_overall, time, ${performance.now() - baseTotalEmissionsTimeStart}\n`);

    // TODO: Handle the case when it  is not a complete tree
    const stepTotalEmissionsTimeStart = performance.now();
    const stepProofsRunner = promisify(exec);
    let numOfSteps = (numOfIntensities / BATCH_NUM_OF_INTENSITY);
    const levelsOfSums = Math.ceil(Math.log2(numOfSteps));

    for (let level = 0; level < levelsOfSums-1; level++) {
        for (let i = 0; i < numOfIntensities - 1; i += (BATCH_NUM_OF_INTENSITY * (2**(level+1)) * numOfWorkers)) {
            log(`Prover_total_emissions, step_proof, level, ${level}, startIdx, ${i}\n`);
            async function stepProofsRunnerExec() {
                const { stdout, stderr } = await stepProofsRunner(
                    'tsx ./src/proof_workers/proof_workers_total_emissions_step.ts ' +
                    numOfIntensities + ' ' + 
                    numOfWorkers + ' ' + 
                    i + ' ' +
                    level
                );
                if (stdout != "") {
                    log(`${stdout}\n`);
                }
                if (stderr != "") {
                    log(`${stderr}\n`);
                }
            }
            const runTotalEmissionsStepTimeStart = performance.now();
            await stepProofsRunnerExec();
            log(`Prover_total_emissions, step_proof_runner_one_batch, time, ${performance.now() - runTotalEmissionsStepTimeStart}\n`);
        }
    }
    log(`Prover_total_emissions, total_emissions_step_overall, time, ${performance.now() - stepTotalEmissionsTimeStart}\n`);
}

/************************/
/* GENEARTE SAMPLE DATA */
/************************/
const REGENERATE_INTENSITY = true;

const gridOperatorObj = new GridOperator();
const gridOperatorId = gridOperatorObj.getId();
const gridOperatorPk = gridOperatorObj.getGridOperatorPk();
fsAsync.writeFile(
    "./generated_public_keys/grid_operator_id.json", gridOperatorId.toJSON()
).catch(err => {
    log(`ERROR: Prover_total_emissions, Error writing to ./generated_public_keys/grid_operator_id.json: ${err}\n`);
});
fsAsync.writeFile(
    "./generated_public_keys/grid_operator_pk.json", gridOperatorPk.toJSON()
).catch(err => {
    log(`ERROR: Prover_total_emissions, Error writing to ./generated_public_keys/grid_operator_pk.json: ${err}\n`);
});

const meterManufacturerObj = new SmartMeterManufacturer();
const meterManufacturerId = meterManufacturerObj.getManufacturerId();
const meterManufacturerPk = meterManufacturerObj.getManufacturerPk();
fsAsync.writeFile(
    "./generated_public_keys/meter_manufacturer_id.json", meterManufacturerId.toJSON()
).catch(err => {
    log(`ERROR: Prover_total_emissions, Error writing to ./generated_public_keys/meter_manufacturer_id.json: ${err}\n`);
});
fsAsync.writeFile(
    "./generated_public_keys/meter_manufacturer_pk.json", meterManufacturerPk.toJSON()
).catch(err => {
    log(`ERROR: Prover_total_emissions, Error writing to ./generated_public_keys/meter_manufacturer_pk.json: ${err}\n`);
});

await meterManufacturerObj.createSmartMeter();
// This is assuming that the manufacturer provides the serial numbers of all smart meters to the data centre
const smartMeterId = meterManufacturerObj.getMeterId();
const smartMeterDataObj = new SmartMeterData();
const smartMeterProps = await smartMeterDataObj.getSmartMeterProperties(smartMeterId);
const signedMeterPk = meterManufacturerObj.signSmartMeterPK();
fsAsync.writeFile(
    "./generated_public_keys/signed_meter_pk.json", signedMeterPk.toJSON()
).catch(err => {
    log(`ERROR: Prover_total_emissions, Error writing to ./generated_public_keys/signed_meter_pk.json: ${err}\n`);
});
fsAsync.writeFile(
    "./generated_public_keys/meter_pk.json", smartMeterProps.publicKey.toJSON()
).catch(err => {
    log(`ERROR: Prover_total_emissions, Error writing to ./generated_public_keys/meter_pk.jso: ${err}\n`);

});
fsAsync.writeFile(
    "./generated_public_keys/meter_id.json", smartMeterId.toJSON()
).catch(err => {
    log(`ERROR: Prover_total_emissions, Error writing to ./generated_public_keys/meter_id.json: ${err}\n`);

});

// Only get the intensity factors from the NESO API if needed a fresh set and only after the obtained data
// has been tested - the data obtained from a date range is not reliable in the sense that for a 30 days 
// period you don't always get 1440 half-hourly factors, some data could be missing.
let signedIntensityFor30Days: SignedIntensityFactor[] = [];

// TODO: also check if the intensity_factors.json exists
if (REGENERATE_INTENSITY) {
    const signIntensiyTimeStart = performance.now();
    signedIntensityFor30Days = await gridOperatorObj.getSignedCarbonIntensityFactors(
        CARBON_INTENSITY_FROM_TIMESTAMP,
        CARBON_INTENSITY_TO_TIMESTAMP
    );
    log(`Prover_total_emissions, sign_30_days_intensity_factors, time, ${performance.now() - signIntensiyTimeStart}\n`);

    // Also need to serialise the signed intensity factors for the spawn prover processes.
    let intensitiesJson = [];
    signedIntensityFor30Days.forEach((intensity) => {
        intensitiesJson.push({
            intensity: intensity.intensity.toJSON(),
            intensitySig: intensity.intensitySig.toJSON(),
            timeFrom: intensity.timeFrom.toJSON(),
            timeTo: intensity.timeTo.toJSON(),
        })
    })
    fsAsync.writeFile(
        "./src/data/intensity_factors.json", JSON.stringify(intensitiesJson)
    ).catch(err => {
        log(`ERROR: Prover_total_emissions, Error writing to ./src/data/intensity_factors.json: ${err}`);
    });
} else {
    let intensitiesRaw = await fsAsync.readFile('./src/data/intensity_factors.json', 'utf8');
    let signedIntensityFor30DaysSerialised = JSON.parse(intensitiesRaw) as SignedIntensityFactor[];
    signedIntensityFor30DaysSerialised.forEach((signedIntensity) => {
        signedIntensityFor30Days.push(new SignedIntensityFactor({
            intensity: Field(signedIntensity.intensity),
            intensitySig: Signature.fromJSON(signedIntensity.intensitySig),
            timeFrom: Field(signedIntensity.timeFrom),
            timeTo: Field(signedIntensity.timeTo)
        }))
    })
}

let measuredPeriodFromTimestamps: Field[] = []
debugLog(`Prover_total_emissions, Number of carbon intensity factors signed, ${signedIntensityFor30Days.length}\n`);
signedIntensityFor30Days.forEach((intensityObj) => {
    measuredPeriodFromTimestamps.push(intensityObj.timeFrom);
});

const signMeterReadingsTimeStart = performance.now();
const signedMeterReadingsFor30Days: SignedMeterReading[] = await smartMeterDataObj.signSmartMeterReadings(
    smartMeterId,
    measuredPeriodFromTimestamps,
    signedIntensityFor30Days[signedIntensityFor30Days.length - 1].timeTo
);
log(`Prover_total_emissions, sign_30_days_meter_readings, time, ${performance.now() - signMeterReadingsTimeStart}\n`);
debugLog(`Prover_total_emissions, Number of meter readings signed, ${signedMeterReadingsFor30Days.length}\n`);

let meterReadingsJson = [];
signedMeterReadingsFor30Days.forEach((reading) => {
    meterReadingsJson.push({
        meterReadingData: {
            meterReading: reading.meterReadingData.meterReading.toJSON(),
            timestamp: reading.meterReadingData.timestamp.toJSON()
        },
        meterReadingSig: reading.meterReadingSig.toJSON(),
    })
})
fsAsync.writeFile(
    "./generated_meter_readings/meter_readings.json", JSON.stringify(meterReadingsJson)
).catch(err => {
    log(`ERROR, Prover_total_emissions, Error writing to ./generated_meter_readings/meter_readings.json: ${err}\n`);
});

// For sanity checks
// We need to measure the power consumption between each interval, not the accumulated figure at each timestamp.
let knownTotalEmissions = Field(0);
signedIntensityFor30Days.forEach((intensity, index) => {
    let intensityFrom = intensity.timeFrom;
    let intensityTo = intensity.timeTo;

    let meterReadingFrom = signedMeterReadingsFor30Days[index].meterReadingData.timestamp;
    let meterReadingTo = signedMeterReadingsFor30Days[index + 1].meterReadingData.timestamp;

    intensityFrom.assertEquals(meterReadingFrom);
    intensityTo.assertEquals(meterReadingTo);

    const actualReading = signedMeterReadingsFor30Days[index + 1].meterReadingData.meterReading.sub(signedMeterReadingsFor30Days[index].meterReadingData.meterReading);
    const totalEmission = intensity.intensity.mul(actualReading);
    knownTotalEmissions = knownTotalEmissions.add(totalEmission);
})
debugLog(`Prover_total_emissions, Known total emissions, ${knownTotalEmissions.toString()}\n`);

/*******************************/
/* RUN TOTAL EMISSIONS CIRCUIT */
/*******************************/
const totalEmissionsTimeStart = performance.now();
await generateTotalEmissionsProof(signedMeterReadingsFor30Days.length);
log(`Prover_total_emissions, total_emissions_overall, time, ${performance.now() - totalEmissionsTimeStart}\n`);

log(`Prover_total_emissions, Ends, time, ${performance.now() - proverTotalEmissionsTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
logStreamStop(logFile);