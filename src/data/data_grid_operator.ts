// This creates an electricity grid operator. This role represent the carbon 
// intensity factor provider, and they sign the factors to prove authenticity.
// Their public key, which can be used to verify the signed intensity data, is 
// signed by the CA.
import { Field, PrivateKey, PublicKey, Signature } from "o1js";
import { SignedIntensityFactor } from "../types/carbon_intensity_factor.js";
import { CarbonIntensityData, NationalIntensity } from "./data_carbon_intensity.js";

import * as crypto from "crypto";

export class GridOperator {
    private id: Field;

    constructor() {
        this.id = Field(crypto.randomInt((2**48)-1));
        // this.ca = ca;
    }

    getId(): Field {
        return this.id;
    }

    // The secret key used to sign all the carbon intensity factors
    private gridSecretKey: PrivateKey = PrivateKey.random();
    // The corresponding public key used to verify the carbon intensity factors
    private gridPublicKey: PublicKey = this.gridSecretKey.toPublicKey();

    getGridOperatorPk(): PublicKey {
        return this.gridPublicKey;
    }

    async getSignedCarbonIntensityFactors(from: number, to: number): Promise<SignedIntensityFactor[]> {
        const intensityDataObj = new CarbonIntensityData();
        const intensityFactors: NationalIntensity[] = await intensityDataObj.getIntensityFactors(from, to);

        let signedIntensity: SignedIntensityFactor[] = [];

        intensityFactors.forEach((intensity) => {
            const intensitySig: Signature = Signature.create(
                this.gridSecretKey, 
                this.gridPublicKey.toFields().concat(
                    [Field(intensity.intensity.actual), Field(Date.parse(intensity.from)), Field(Date.parse(intensity.to))]
                )
            );

            signedIntensity.push(new SignedIntensityFactor({
                intensity: Field(intensity.intensity.actual), // gCO2/kWh
                intensitySig: intensitySig,
                timeFrom: Field(Date.parse(intensity.from)),
                timeTo: Field(Date.parse(intensity.to)),
            }));
        });

        return signedIntensity;
    }
}