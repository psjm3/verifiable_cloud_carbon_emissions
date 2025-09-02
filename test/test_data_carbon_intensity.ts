import fs from 'fs';
import fsAsync from 'fs/promises';

import { assert } from "o1js";
import { CertificateAuthority } from "../src/data/data_certificate_authority.js";
import { GridOperator } from "../src/data/data_grid_operator.js";
import { SignedIntensityFactor } from "../src/types/carbon_intensity_factor.js";
import { TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP } from "../src/data/data_timestamps.js";
import { createObjectCsvWriter } from 'csv-writer';
import { CsvWriter } from 'csv-writer/src/lib/csv-writer.js';
import { ObjectMap } from 'csv-writer/src/lib/lang/object.js';

let path = './test_output'
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        console.error('Error creating directory for', path, err);
        process.exit(1);
    });
}
const logFile = path + '/test_data_carbon_intensity.out';
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

const ca = new CertificateAuthority();
const gridOperatorObj = new GridOperator();

const getIntensityTimeStart = performance.now();
const intensityFor30Days: SignedIntensityFactor[] = await gridOperatorObj.getSignedCarbonIntensityFactors(
    TEST_PERIOD_FROM_TIMESTAMP, 
    TEST_PERIOD_TO_TIMESTAMP
);
logData.push({ src: 'test_data_carbon_intensity', data: 'Get 30 days signed intensity factors - time taken', value: (performance.now() - getIntensityTimeStart), datatype: 'ms' });

intensityFor30Days.forEach((intensity, idx) => {
    logData.push({ src: 'test_data_carbon_intensity', data: 'Intensity data' + idx, value: new Date(Number(intensity.timeFrom.toBigInt())), datatype: 'number' });
});


// 30 days of half-hourly readings should have 1440 readings in total
logData.push({ src: 'test_data_carbon_intensity', data: 'Number of intensity generated', value: intensityFor30Days.length, datatype: 'number' });
assert(intensityFor30Days.length == 1440);

const gridOperatorPk = gridOperatorObj.getGridOperatorPk();
const gridOperatorId = gridOperatorObj.getId();

const signedGridOperatorPk = ca.signGridOperatorPk(gridOperatorPk, gridOperatorId);

// verify electricity supplier's public key
const verifyGridOperatorPkTimeStart = performance.now();
signedGridOperatorPk.pkSig.verify(
    ca.getCaPk(), 
    ca.getCaPk().toFields().concat(
        signedGridOperatorPk.pk.toFields().concat(gridOperatorId))).assertTrue();
logData.push({ src: 'test_data_carbon_intensity', data: 'Verified grid operator public key signature - time taken', value: (performance.now() - verifyGridOperatorPkTimeStart), datatype: 'ms' });

// verify all intensity factors
const verifyIntensityTimeStart = performance.now();
intensityFor30Days.forEach((intensity) => {
    intensity.intensitySig.verify(
        signedGridOperatorPk.pk, 
        signedGridOperatorPk.pk.toFields().concat(
            [intensity.intensity, intensity.timeFrom, intensity.timeTo])).assertTrue();
});
logData.push({ src: 'test_data_carbon_intensity', data: 'Verified 30 days intensity signatures - time taken', value: (performance.now() - verifyIntensityTimeStart), datatype: 'ms' });
csvWriter.writeRecords(logData).then(() => console.log('test_data_carbon_intensity logs-writing to file completed'));