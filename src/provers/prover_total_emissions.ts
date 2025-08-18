import { Field, Signature } from "o1js";
import { BATCH_NUM_OF_INTENSITY, SignedIntensityFactor } from "../types/carbon_intensity_factor.js";
import { SignedMeterReading } from "../types/meter_readings.js";
import { GridOperator } from "../data/data_grid_operator.js";
import { SmartMeterData } from "../data/data_meter_reading.js";
import { SmartMeterManufacturer } from "../data/data_meter_manufacturer.js";
import { CARBON_INTENSITY_FROM_TIMESTAMP, CARBON_INTENSITY_TO_TIMESTAMP } from "../data/data_timestamps.js";

import fs from 'fs/promises';
import os from 'node:os';
import { promisify } from 'util';
import { exec } from 'child_process';

async function generateTotalEmissionsProof(numOfIntensities: number) {
    console.time("OVERALL TIME TAKEN FOR GENERATING TOTAL EMISSIONS BASE PROOFS");

    // By using a separate to run batches of base proofs, and then recursively generate proofs for further up the 
    // tree until the root, it allows many more customer records to be on the same database/merkle tree. This can 
    // scale up subject to file system storage and CPU time/capacity limitations.
    const baseProofsRunner = promisify(exec);
    const numCPUs = os.availableParallelism();
    let numOfWorkers = (numOfIntensities / BATCH_NUM_OF_INTENSITY) > numCPUs ? numCPUs : (numOfIntensities / BATCH_NUM_OF_INTENSITY);
    for (let i = 0; i < numOfIntensities - 1; i += (BATCH_NUM_OF_INTENSITY * numOfWorkers)) {
        async function baseProofsRunnerExec() {
            const { stdout, stderr } = await baseProofsRunner('tsx ./src/proof_workers/proof_workers_total_emissions_base.ts ' + i + ' ' + numOfWorkers);
            console.log('stdout:', stdout);
            console.log('stderr:', stderr);
        }
        console.time("Generate ONE total emissions BASE proofs");
        await baseProofsRunnerExec();
        console.timeEnd("Generate ONE total emissions BASE proofs");
    }
    console.timeEnd("OVERALL TIME TAKEN FOR GENERATING TOTAL EMISSIONS BASE PROOFS");

    // TODO: Handle the case when it  is not a complete tree
    console.time("ALL STEP totalEmissionsProof");
    const recProofsRunner = promisify(exec);
    let numOfSteps = (numOfIntensities / BATCH_NUM_OF_INTENSITY);
    const levelsOfSums = Math.ceil(Math.log2(numOfSteps));

    numOfWorkers = numOfWorkers / 2;
    for (let level = 0; level < levelsOfSums; level++) {
        // for (let i = stepIdx; i < (numOfIntensities-BATCH_NUM_OF_INTENSITY); i += (idxMultiple*2)) {
        console.log('level:', level, 'numOfWorkers:', numOfWorkers);
        async function recProofsRunnerExec() {
            const { stdout, stderr } = await recProofsRunner(
                'tsx ./src/proof_workers/proof_workers_total_emissions_rec.ts ' +
                numOfWorkers + ' ' +
                0 + ' ' +
                level
            );
            console.log('stdout:', stdout);
            console.log('stderr:', stderr);
        }
        await recProofsRunnerExec();
        numOfWorkers = numOfWorkers / 2;
    }
    console.timeEnd("ALL STEP totalEmissionsProof");
}

/************************************/
/***** Private Witnesses STARTS *****/
/************************************/
const REGENERATE_INTENSITY = true;

const gridOperatorObj = new GridOperator();
const gridOperatorId = gridOperatorObj.getId();
const gridOperatorPk = gridOperatorObj.getGridOperatorPk();
fs.writeFile(
    "./generated_public_keys/grid_operator_id.json", gridOperatorId.toJSON()
).catch(err => {
    console.error('Error writing file:', err);
});
fs.writeFile(
    "./generated_public_keys/grid_operator_pk.json", gridOperatorPk.toJSON()
).catch(err => {
    console.error('Error writing file:', err);
});

const meterManufacturerObj = new SmartMeterManufacturer();
const meterManufacturerId = meterManufacturerObj.getManufacturerId();
const meterManufacturerPk = meterManufacturerObj.getManufacturerPk();
fs.writeFile(
    "./generated_public_keys/meter_manufacturer_id.json", meterManufacturerId.toJSON()
).catch(err => {
    console.error('Error writing file:', err);
});
fs.writeFile(
    "./generated_public_keys/meter_manufacturer_pk.json", meterManufacturerPk.toJSON()
).catch(err => {
    console.error('Error writing file:', err);
});

await meterManufacturerObj.createSmartMeter();
// This is assuming that the manufacturer provides the serial numbers of all smart meters to the data centre
const smartMeterId = meterManufacturerObj.getMeterId();
const smartMeterDataObj = new SmartMeterData();
const smartMeterProps = await smartMeterDataObj.getSmartMeterProperties(smartMeterId);
const signedMeterPk = meterManufacturerObj.signSmartMeterPK();
fs.writeFile(
    "./generated_public_keys/signed_meter_pk.json", signedMeterPk.toJSON()
).catch(err => {
    console.error('Error writing file:', err);
});
fs.writeFile(
    "./generated_public_keys/meter_pk.json", smartMeterProps.publicKey.toJSON()
).catch(err => {
    console.error('Error writing file:', err);
});
fs.writeFile(
    "./generated_public_keys/meter_id.json", smartMeterId.toJSON()
).catch(err => {
    console.error('Error writing file:', err);
});

// Only get the intensity factors from the NESO API if needed a fresh set and only after the obtained data
// has been tested - the data obtained from a date range is not reliable in the sense that for a 30 days 
// period you don't always get 1440 half-hourly factors, some data could be missing.
let signedIntensityFor30Days: SignedIntensityFactor[] = [];

// TODO: also check if the intensity_factors.json exists
if (REGENERATE_INTENSITY) {
    console.time("Sign intensity and the public key")
    signedIntensityFor30Days = await gridOperatorObj.getSignedCarbonIntensityFactors(
        CARBON_INTENSITY_FROM_TIMESTAMP,
        CARBON_INTENSITY_TO_TIMESTAMP
    );
    console.timeEnd("Sign intensity and the public key")

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
    fs.writeFile(
        "./generated_intensity/intensity_factors.json", JSON.stringify(intensitiesJson)
    ).catch(err => {
        console.error('Error writing file:', err);
    });
} else {
    let intensitiesRaw = await fs.readFile('./generated_intensity/intensity_factors.json', 'utf8');
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
console.log("Number of intensity signed:", signedIntensityFor30Days.length);
signedIntensityFor30Days.forEach((intensityObj) => {
    measuredPeriodFromTimestamps.push(intensityObj.timeFrom);
});

console.time("Sign meter readings and the public key")
const signedMeterReadingsFor30Days: SignedMeterReading[] = await smartMeterDataObj.signSmartMeterReadings(
    smartMeterId,
    measuredPeriodFromTimestamps,
    signedIntensityFor30Days[signedIntensityFor30Days.length - 1].timeTo
);
console.timeEnd("Sign meter readings and the public key")
console.log("Number of meter readings signed:", signedMeterReadingsFor30Days.length);

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
fs.writeFile(
    "./generated_meter_readings/meter_readings.json", JSON.stringify(meterReadingsJson)
).catch(err => {
    console.error('Error writing file:', err);
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
console.log("Known total emissions:", knownTotalEmissions.toString());

/**********************************/
/***** Private Witnesses ENDS *****/
/**********************************/

/***** Total Emissions Proof STARTS *****/
await generateTotalEmissionsProof(signedMeterReadingsFor30Days.length);
/***** Total Emissions Proof ENDS *****/