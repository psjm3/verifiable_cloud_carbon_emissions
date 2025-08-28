import fs from 'fs';
import fsAsync from 'fs/promises';

import { assert } from "o1js";
import { CertificateAuthority } from "../src/data/data_certificate_authority.js";
import { GridOperator } from "../src/data/data_grid_operator.js";
import { SignedIntensityFactor } from "../src/types/carbon_intensity_factor.js";
import { TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP } from "../src/data/data_timestamps.js";
import { log, logStreamStart, logStreamStop } from '../src/utils/util.js';

let path = './test_output'
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        console.error('Error creating directory for', path, err);
        process.exit(1);
    });
}
logStreamStart("./test_output/test_data_carbon_intensity.out");

const ca = new CertificateAuthority();
const gridOperatorObj = new GridOperator();

const getIntensityTimeStart = performance.now();
const intensityFor30Days: SignedIntensityFactor[] = await gridOperatorObj.getSignedCarbonIntensityFactors(
    TEST_PERIOD_FROM_TIMESTAMP, 
    TEST_PERIOD_TO_TIMESTAMP
);
log(`
Time taken to sign 30 days intensity factors: ${performance.now() - getIntensityTimeStart}ms`);

intensityFor30Days.forEach((intensity, idx) => {
log(`
Intensity data ${idx}: ${new Date(Number(intensity.timeFrom.toBigInt()))}`);
});

// 30 days of half-hourly readings should have 1440 readings in total
log(`
Number of intensity generated: ${intensityFor30Days.length}`);
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
log(`
Time taken to verify 30 intensity signatures: ${performance.now() - verifyGridOperatorPkTimeStart}ms`);

// verify all intensity factors
const verifyIntensityTimeStart = performance.now();
intensityFor30Days.forEach((intensity) => {
    intensity.intensitySig.verify(
        signedGridOperatorPk.pk, 
        signedGridOperatorPk.pk.toFields().concat(
            [intensity.intensity, intensity.timeFrom, intensity.timeTo])).assertTrue();
});
log(`
Time taken to verify 30 intensity signatures: ${performance.now() - verifyIntensityTimeStart}ms`);
logStreamStop("./test_output/test_data_carbon_intensity.out");