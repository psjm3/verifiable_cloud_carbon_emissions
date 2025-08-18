import { Field } from "o1js";
import { CertificateAuthority } from "../src/data/data_certificate_authority.js";
import { GridOperator } from "../src/data/data_grid_operator.js";
import { SmartMeterManufacturer } from "../src/data/data_meter_manufacturer.js";
import { SmartMeterData } from "../src/data/data_meter_reading.js";
import { SignedIntensityFactor } from "../src/types/carbon_intensity_factor.js";
import { SignedMeterReading, SmartMeterProperties } from "../src/types/meter_readings.js";

import fs from 'fs/promises';
import { TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP } from "../src/data/data_timestamps.js";

const gridOperatorObj = new GridOperator();
const meterManufacturerObj = new SmartMeterManufacturer();
await meterManufacturerObj.createSmartMeter();
// This is assuming that the manufacturer provides the serial numbers of all smart meters to the data centre
const smartMeterId = meterManufacturerObj.getMeterId();

const smartMeterDataObj = new SmartMeterData();
const smartMeterProps = await smartMeterDataObj.getSmartMeterProperties(smartMeterId);

console.time("Sign intensity and the public key")
const signedIntensityFor30Days: SignedIntensityFactor[] = await gridOperatorObj.getSignedCarbonIntensityFactors(
    TEST_PERIOD_FROM_TIMESTAMP,
    TEST_PERIOD_TO_TIMESTAMP
);
console.timeEnd("Sign intensity and the public key")

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

console.log("Number of meter readings generated:", signedMeterReadingsFor30Days.length);

let idx = 0;
console.time("Verify meter reading and public key signatures")
signedMeterReadingsFor30Days.forEach(reading => {
    //console.log("Verifying signature["+idx+"]:", new Date(parseInt(reading.timeFrom.toString())), new Date(parseInt(reading.timeTo.toString())));
    reading.meterReadingSig.verify(smartMeterProps.publicKey, [reading.meterReadingData.meterReading, reading.meterReadingData.timestamp]).assertTrue();
    idx++;
});
const ca = new CertificateAuthority();
const signedManufacturerPk = ca.signManufacturerPk(meterManufacturerObj.getManufacturerPk(), meterManufacturerObj.getManufacturerId());
signedManufacturerPk.verify(ca.getCaPk());
console.timeEnd("Verify meter reading and public key signatures")

