import { assert } from "o1js";
import { CertificateAuthority } from "../src/data/data_certificate_authority.js";
import { GridOperator } from "../src/data/data_grid_operator.js";
import { SignedIntensityFactor } from "../src/types/carbon_intensity_factor.js";
import { TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP } from "../src/data/data_timestamps.js";

const ca = new CertificateAuthority();
const gridOperatorObj = new GridOperator();

console.time("Sign intensity and the public key")
const intensityFor30Days: SignedIntensityFactor[] = await gridOperatorObj.getSignedCarbonIntensityFactors(TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP);
console.timeEnd("Sign intensity and the public key")

intensityFor30Days.forEach((intensity) => {
    console.log(new Date(Number(intensity.timeFrom.toBigInt())));
    // console.log(new Date(Number(intensity.timeTo.toBigInt())));
});

// 30 days of half-hourly readings should have 1440 readings in total
console.log(intensityFor30Days.length);
assert(intensityFor30Days.length == 1440);

console.time("Verify intensity and public key signatures")
const gridOperatorPk = gridOperatorObj.getGridOperatorPk();
const gridOperatorId = gridOperatorObj.getId();

const signedGridOperatorPk = ca.signGridOperatorPk(gridOperatorPk, gridOperatorId);

// verify electricity supplier's public key
signedGridOperatorPk.pkSig.verify(
    ca.getCaPk(), 
    ca.getCaPk().toFields().concat(
        signedGridOperatorPk.pk.toFields().concat(gridOperatorId))).assertTrue();

// verify all intensity factors
intensityFor30Days.forEach((intensity, idx) => {
    // console.log("Verifying signature["+idx+"]:", intensity.timeFrom, intensity.timeTo);
    intensity.intensitySig.verify(
        signedGridOperatorPk.pk, 
        signedGridOperatorPk.pk.toFields().concat(
            [intensity.intensity, intensity.timeFrom, intensity.timeTo])).assertTrue();
});
console.timeEnd("Verify intensity and public key signatures")