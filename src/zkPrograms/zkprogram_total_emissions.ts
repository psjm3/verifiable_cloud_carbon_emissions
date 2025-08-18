import {
    Field,
    ZkProgram,
    PublicKey,
    Struct,
    Provable,
    SelfProof,
} from 'o1js';
import { BATCH_NUM_OF_INTENSITY, SignedIntensityFactor } from '../types/carbon_intensity_factor.js';
import { SignedMeterReading } from '../types/meter_readings.js';

export class TotalEmissionsCircuitPublicInput extends Struct({
    smartMeterManufacturerCAPk: PublicKey,
    electricitySupplierCAPk: PublicKey
}) { }

export class TotalEmissionsCircuitOutput extends Struct({
    totalEmissions: Field,
    gridOperatorPk: PublicKey,
    smartMeterPk: PublicKey,
    periodStartTime: Field,
    periodEndTime: Field
}) { }

// This circuit generates a proof that the total carbon emissions for a data centre
// is calculated using the verified input: total emission = intensity * total_power
// The public input is the pair of CA public keys, used to verify the smart meter 
// manufacturer's and electricity supplier's public keys.
// The public output is the CA public keys and the total emissions
export const totalEmissionsCircuit = ZkProgram({
    name: 'Proof of total emissions from this data centre',
    publicOutput: TotalEmissionsCircuitOutput,
    methods: {
        baseTotalEmissionsProof: {
            privateInputs: [
                Provable.Array(SignedIntensityFactor, BATCH_NUM_OF_INTENSITY),
                PublicKey,
                Provable.Array(SignedMeterReading, BATCH_NUM_OF_INTENSITY+1),
                PublicKey,
            ],
            async method(
                signedIntensityFactors: SignedIntensityFactor[],
                gridOperatorPk: PublicKey,
                signedMeterReadings: SignedMeterReading[],
                smartMeterPk: PublicKey
            ) {
                let sumOfEmissions: Field = Field(0);

                for (let i = 0; i < BATCH_NUM_OF_INTENSITY; i++) {
                    signedIntensityFactors[i].intensitySig.verify(
                        gridOperatorPk, 
                        gridOperatorPk.toFields().concat(
                            [signedIntensityFactors[i].intensity, signedIntensityFactors[i].timeFrom, signedIntensityFactors[i].timeTo]
                        )
                    ).assertTrue();
                }; 
                for (let i = 0; i < BATCH_NUM_OF_INTENSITY+1; i++) {
                    signedMeterReadings[i].meterReadingSig.verify(
                        smartMeterPk, 
                        smartMeterPk.toFields().concat(
                            [signedMeterReadings[i].meterReadingData.meterReading, signedMeterReadings[i].meterReadingData.timestamp]
                        )
                    ).assertTrue();
                }

                // The meter readings are accumulated snapshots, we need to calulate the actual power consumption between two set times from the same period of 
                // the carbon intensity before we calculate the carbon emissions
                for (let i = 0; i < BATCH_NUM_OF_INTENSITY; i++) {
                    let intensityFrom = signedIntensityFactors[i].timeFrom;
                    let intensityTo = signedIntensityFactors[i].timeTo;

                    let meterReadingFrom = signedMeterReadings[i].meterReadingData.timestamp;
                    let meterReadingTo = signedMeterReadings[i+1].meterReadingData.timestamp;

                    intensityFrom.assertEquals(meterReadingFrom);
                    intensityTo.assertEquals(meterReadingTo);

                    const actualReading = signedMeterReadings[i+1].meterReadingData.meterReading.sub(signedMeterReadings[i].meterReadingData.meterReading);
                    const totalEmission = signedIntensityFactors[i].intensity.mul(actualReading);
                    sumOfEmissions = sumOfEmissions.add(totalEmission);
                }

                const periodStartTime = signedMeterReadings[0].meterReadingData.timestamp;
                const periodEndTime = signedMeterReadings[BATCH_NUM_OF_INTENSITY].meterReadingData.timestamp;

                // Output the total emission, which will be used in the per customer proof, and the public keys from the CAs
                return { publicOutput: new TotalEmissionsCircuitOutput({ 
                    totalEmissions: sumOfEmissions, 
                    gridOperatorPk,
                    smartMeterPk,
                    periodStartTime, 
                    periodEndTime }) }
            }
        },
        stepTotalEmissionsProof: {
            privateInputs: [
                SelfProof,
                SelfProof
            ],
            async method(
                subTotalEmissionsProofOne: SelfProof<TotalEmissionsCircuitPublicInput, TotalEmissionsCircuitOutput>,
                subTotalEmissionsProofTwo: SelfProof<TotalEmissionsCircuitPublicInput, TotalEmissionsCircuitOutput>,
            ) {
                subTotalEmissionsProofOne.verify();
                subTotalEmissionsProofTwo.verify();

                subTotalEmissionsProofOne.publicOutput.gridOperatorPk.assertEquals(
                    subTotalEmissionsProofTwo.publicOutput.gridOperatorPk
                )
                subTotalEmissionsProofOne.publicOutput.smartMeterPk.assertEquals(
                    subTotalEmissionsProofTwo.publicOutput.smartMeterPk
                )
                let sumOfEmissions: Field = Field(0);
                sumOfEmissions = subTotalEmissionsProofOne.publicOutput.totalEmissions.add(subTotalEmissionsProofTwo.publicOutput.totalEmissions)

                subTotalEmissionsProofOne.publicOutput.periodEndTime.assertEquals(subTotalEmissionsProofTwo.publicOutput.periodStartTime);

                // Output the total emission, which will be used in the per customer proof, and the public keys from the CAs
                return { publicOutput: new TotalEmissionsCircuitOutput({ 
                    totalEmissions: sumOfEmissions,
                    gridOperatorPk: subTotalEmissionsProofOne.publicOutput.gridOperatorPk,
                    smartMeterPk: subTotalEmissionsProofOne.publicOutput.smartMeterPk,
                    periodStartTime: subTotalEmissionsProofOne.publicOutput.periodStartTime,
                    periodEndTime: subTotalEmissionsProofTwo.publicOutput.periodEndTime
                }) }
            }
        },
    }
})
