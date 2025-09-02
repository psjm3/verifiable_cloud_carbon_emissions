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
import { DEBUG } from '../utils/util.js';
import { createObjectCsvWriter } from 'csv-writer';
import { CsvWriter } from 'csv-writer/src/lib/csv-writer.js';
import { ObjectMap } from 'csv-writer/src/lib/lang/object.js';

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
let csvWriter : CsvWriter<ObjectMap<any>>;
if (fs.existsSync(logFile)) {
    csvWriter = createObjectCsvWriter({
        append: true,
        path: logFile,
        header: [
            {id: 'src', title: 'src_file'},
            {id: 'data', title: 'data'},
            {id: 'value', title: 'value'},
            {id: 'datatype', title: 'data_type'},
        ]
    });
} else {
    csvWriter = createObjectCsvWriter({
        path: logFile,
        header: [
            {id: 'src', title: 'src_file'},
            {id: 'data', title: 'data'},
            {id: 'value', title: 'value'},
            {id: 'datatype', title: 'data_type'},
        ]
    }); 
}
let logData = [];

const proverTotalEmissionsTimeStart = performance.now();

async function generateTotalEmissionsProof(numOfIntensities: number) {
    // By using a separate to run batches of base proofs, and then recursively generate proofs for further up the 
    // tree until the root, it allows many more customer records to be on the same database/merkle tree. This can 
    // scale up subject to file system storage and CPU time/capacity limitations.
    const baseTotalEmissionsTimeStart = performance.now();
    const baseProofsRunner = promisify(exec);
    const numCPUs = os.availableParallelism();
    let numOfWorkers = (numOfIntensities / BATCH_NUM_OF_INTENSITY) > numCPUs ? numCPUs : (numOfIntensities / BATCH_NUM_OF_INTENSITY);
    for (let i = 0; i < numOfIntensities - 1; i += (BATCH_NUM_OF_INTENSITY * numOfWorkers)) {
        async function baseProofsRunnerExec() {
            try {
                await baseProofsRunner('tsx ./src/proof_workers/proof_workers_total_emissions_base.ts ' + i + ' ' + numOfWorkers);
            } catch (err) {
                logData.push({ src: 'prover_total_emissions', data: 'ERROR: child process proof_workers_total_emissions_base.ts', value: err, datatype: 'text' })
            }
        }
        const runTotalEmissionsBaseTimeStart = performance.now();
        await baseProofsRunnerExec();
        logData.push({ 
            src: 'prover_total_emissions', 
            data: 'total emissions base proof one batch at iteraton ' + i + ' with number of workers ' + numOfWorkers + ' - time taken', 
            value: (performance.now() - runTotalEmissionsBaseTimeStart), 
            datatype: 'ms'
        })
    }
    logData.push({ src: 'prover_total_emissions', data: 'total emissions base proof overall - time taken', value: (performance.now() - baseTotalEmissionsTimeStart), datatype: 'ms' })

    // TODO: Handle the case when it  is not a complete tree
    const stepTotalEmissionsTimeStart = performance.now();
    const stepProofsRunner = promisify(exec);
    let numOfSteps = (numOfIntensities / BATCH_NUM_OF_INTENSITY);
    const levelsOfSums = Math.ceil(Math.log2(numOfSteps));

    numOfWorkers = numOfWorkers / 2;
    for (let level = 0; level < levelsOfSums; level++) {
        async function stepProofsRunnerExec() {
            try {
                await stepProofsRunner(
                    'tsx ./src/proof_workers/proof_workers_total_emissions_step.ts ' +
                    numOfWorkers + ' ' +
                    0 + ' ' +
                    level
                );
            } catch (err) {
                logData.push({ src: 'prover_total_emissions', data: 'ERROR: child process proof_workers_total_emissions_step.ts', value: err, datatype: 'text' })
            }
        }
        const runTotalEmissionsStepTimeStart = performance.now();
        await stepProofsRunnerExec();
        logData.push({
            src: 'prover_total_emissions',
            data: 'total emissions step proof one batch at level ' + level + ' with number of workers ' + numOfWorkers + ' - time taken',
            value: (performance.now() - runTotalEmissionsStepTimeStart),
            datatype: 'ms'
        })
        numOfWorkers = numOfWorkers / 2;
    }
    logData.push({ src: 'prover_total_emissions', data: 'total emissions step proof overall - time taken', value: (performance.now() - stepTotalEmissionsTimeStart), datatype: 'ms' })
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
    logData.push({ src: 'prover_total_emissions', data: 'Error writing to ./generated_public_keys/grid_operator_id.json', value: err, datatype: 'text' })
});
fsAsync.writeFile(
    "./generated_public_keys/grid_operator_pk.json", gridOperatorPk.toJSON()
).catch(err => {
    logData.push({ src: 'prover_total_emissions', data: 'Error writing to ./generated_public_keys/grid_operator_pk.json', value: err, datatype: 'text' })
});

const meterManufacturerObj = new SmartMeterManufacturer();
const meterManufacturerId = meterManufacturerObj.getManufacturerId();
const meterManufacturerPk = meterManufacturerObj.getManufacturerPk();
fsAsync.writeFile(
    "./generated_public_keys/meter_manufacturer_id.json", meterManufacturerId.toJSON()
).catch(err => {
    logData.push({ src: 'prover_total_emissions', data: 'Error writing to ./generated_public_keys/meter_manufacturer_id.json', value: err, datatype: 'text' })
});
fsAsync.writeFile(
    "./generated_public_keys/meter_manufacturer_pk.json", meterManufacturerPk.toJSON()
).catch(err => {
    logData.push({ src: 'prover_total_emissions', data: 'Error writing to ./generated_public_keys/meter_manufacturer_pk.json', value: err, datatype: 'text' })
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
    logData.push({ src: 'prover_total_emissions', data: 'Error writing to ../generated_public_keys/signed_meter_pk.json', value: err, datatype: 'text' })
});
fsAsync.writeFile(
    "./generated_public_keys/meter_pk.json", smartMeterProps.publicKey.toJSON()
).catch(err => {
    logData.push({ src: 'prover_total_emissions', data: 'Error writing to ./generated_public_keys/meter_pk.json', value: err, datatype: 'text' })
});
fsAsync.writeFile(
    "./generated_public_keys/meter_id.json", smartMeterId.toJSON()
).catch(err => {
    logData.push({ src: 'prover_total_emissions', data: 'Error writing to ./generated_public_keys/meter_id.json', value: err, datatype: 'text' })
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
    logData.push({ src: 'prover_total_emissions', data: 'get 30 days signed carbon intensity factore - time taken', value: (performance.now() - signIntensiyTimeStart), datatype: 'ms' })

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
        "./generated_intensities/intensity_factors.json", JSON.stringify(intensitiesJson)
    ).catch(err => {
        logData.push({ src: 'prover_total_emissions', data: 'Error writing to ./generated_intensities/intensity_factors.json', value: err, datatype: 'text' })
    });
} else {
    let intensitiesRaw = await fsAsync.readFile('./generated_intensities/intensity_factors.json', 'utf8');
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
if (DEBUG) {
    logData.push({ src: 'prover_total_emissions', data: 'Number of carbon intensity factors signed', value: signedIntensityFor30Days.length, datatype: 'number' })
}

let measuredPeriodFromTimestamps: Field[] = []
signedIntensityFor30Days.forEach((intensityObj) => {
    measuredPeriodFromTimestamps.push(intensityObj.timeFrom);
});

const signMeterReadingsTimeStart = performance.now();
const signedMeterReadingsFor30Days: SignedMeterReading[] = await smartMeterDataObj.signSmartMeterReadings(
    smartMeterId,
    measuredPeriodFromTimestamps,
    signedIntensityFor30Days[signedIntensityFor30Days.length - 1].timeTo
);
logData.push({ src: 'prover_total_emissions', data: 'get 30 days signed meter readings - time taken', value: (performance.now() - signMeterReadingsTimeStart), datatype: 'ms' })
if (DEBUG) {
    logData.push({ src: 'prover_total_emissions', data: 'Number of meter readings signed', value: signedMeterReadingsFor30Days.length, datatype: 'number' })
}

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
    logData.push({ src: 'prover_total_emissions', data: 'Error writing to ./generated_meter_readings/meter_readings.json', value: err, datatype: 'text' })
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
if (DEBUG) {
    logData.push({ src: 'prover_total_emissions', data: 'The generated total emissions', value: knownTotalEmissions.toString(), datatype: 'text' })
}

/*******************************/
/* RUN TOTAL EMISSIONS CIRCUIT */
/*******************************/
const totalEmissionsTimeStart = performance.now();
await generateTotalEmissionsProof(signedMeterReadingsFor30Days.length);
logData.push({ src: 'prover_total_emissions', data: 'generate total emissions proof - time taken', value: (performance.now() - totalEmissionsTimeStart), datatype: 'ms' })

logData.push({ src: 'prover_total_emissions', data: 'prover overall - time taken', value: (performance.now() - proverTotalEmissionsTimeStart), datatype: 'ms' })
logData.push({ src: 'prover_total_emissions', data: 'process - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
logData.push({ src: 'prover_total_emissions', data: 'process - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
csvWriter.writeRecords(logData).then(() => console.log('prover_total_emissions logs-writing to file completed'));