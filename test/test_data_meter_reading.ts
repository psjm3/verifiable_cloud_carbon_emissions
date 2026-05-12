import fs from 'fs';
import fsAsync from 'fs/promises';

import { assert, Field } from "o1js";
import { CertificateAuthority } from "../src/data/data_certificate_authority.js";
import { GridOperator } from "../src/data/data_grid_operator.js";
import { SmartMeterManufacturer } from "../src/data/data_meter_manufacturer.js";
import { SmartMeterData } from "../src/data/data_meter_reading.js";
import { SignedIntensityFactor } from "../src/types/carbon_intensity_factor.js";
import { SignedMeterReading } from "../src/types/meter_readings.js";
import { TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP } from "../src/data/data_timestamps.js";
import { log, logStreamStart, logStreamStop } from '../src/utils/util.js';

console.time("OVERALL");
const paths = [
    './generated_smart_meters/',
    './test_output'
]
paths.forEach((path) => {
    if (!fs.existsSync(path)) {
        fsAsync.mkdir(
            path, { recursive: true }
        ).catch(err => {
            console.error('Error creating directory for', path, err);
            process.exit(1);
        });
    }
});
logStreamStart("./test_output/test_data_meter_readings.out");

const gridOperatorObj = new GridOperator();
const meterManufacturerObj = new SmartMeterManufacturer();
await meterManufacturerObj.createSmartMeter();
// This is assuming that the manufacturer provides the serial numbers of all smart meters to the data centre
const smartMeterId = meterManufacturerObj.getMeterId();

const smartMeterDataObj = new SmartMeterData();
const smartMeterProps = await smartMeterDataObj.getSmartMeterProperties(smartMeterId);

const getIntensityTimeStart = performance.now();
const signedIntensityFor30Days: SignedIntensityFactor[] = await gridOperatorObj.getSignedCarbonIntensityFactors(
    TEST_PERIOD_FROM_TIMESTAMP,
    TEST_PERIOD_TO_TIMESTAMP
);
log(`
Time taken to sign intensities: ${performance.now() - getIntensityTimeStart}ms`);
assert(signedIntensityFor30Days.length == 1440);

let measuredPeriodFromTimestamps: Field[] = []
signedIntensityFor30Days.forEach((intensityObj) => {
    measuredPeriodFromTimestamps.push(intensityObj.timeFrom);
});

const getMeterReadingsTimeStart = performance.now()
const signedMeterReadingsFor30Days: SignedMeterReading[] = await smartMeterDataObj.signSmartMeterReadings(
    smartMeterId,
    measuredPeriodFromTimestamps,
    signedIntensityFor30Days[signedIntensityFor30Days.length - 1].timeTo
);
log(`
time taken to sign meter readings: ${performance.now() - getMeterReadingsTimeStart}ms`);
assert(signedMeterReadingsFor30Days.length == 1441);

const verifyMeterReadingSigTimeStart = performance.now();
signedMeterReadingsFor30Days.forEach(reading => {
    reading.meterReadingSig.verify(
        smartMeterProps.publicKey, 
        smartMeterProps.publicKey.toFields().concat(
            [reading.meterReadingData.meterReading, reading.meterReadingData.timestamp])
        ).assertTrue();
});
const ca = new CertificateAuthority();
const signedManufacturerPk = ca.signManufacturerPk(meterManufacturerObj.getManufacturerPk(), meterManufacturerObj.getManufacturerId());
signedManufacturerPk.verify(ca.getCaPk());
log(`
Time taken to verify meter readings signatures: ${performance.now() - verifyMeterReadingSigTimeStart}ms`);

console.timeEnd("OVERALL");
logStreamStop("./test_output/test_data_meter_readings.out");
