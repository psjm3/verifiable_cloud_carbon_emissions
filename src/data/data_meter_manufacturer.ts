// This creates a Smart Meter Manufacturer, whose role is to sign the public keys of
// the smart meters they produce.
import { Field, PrivateKey, PublicKey, Signature } from "o1js";
import { SignedMeterPk } from "../types/smartmeter_manufactorer.js";
import { SmartMeterProperties } from "../types/meter_readings.js";
import * as crypto from "crypto";
import fs from 'fs/promises';

export class SmartMeterManufacturer {
    private manufacturerId: Field;
    private meterId: Field // We are just using one smart meter in the prototype for simplicity, this could be turned into an array map for multiple meters.

    // maximum int accepted by randomInt is 2^48
    constructor() {
        this.manufacturerId = Field(crypto.randomInt((2 ** 48) - 1));
        this.meterId = Field(crypto.randomInt((2 ** 48) - 1));
    }

    getManufacturerId(): Field {
        return this.manufacturerId;
    }

    getMeterId(): Field {
        return this.meterId;
    }

    // Assuming, for simplicity, that the manufacturer uses the same secret and public 
    // key pair to sign all meter's public keys.
    // Private key used to sign all the public keys of smart meters 
    private manufacturerSecretKey: PrivateKey = PrivateKey.random();
    // Public key used to verify the manufacturered smart meters' public keys.
    private manufacturerPublicKey: PublicKey = this.manufacturerSecretKey.toPublicKey();

    getManufacturerPk(): PublicKey {
        return this.manufacturerPublicKey;
    }

    // Assuming, for simplicity, that the manufacturer only produces one smart meter, and hence only 
    // one pair of secret and public keys is needed.
    private meterSecretKey: PrivateKey = PrivateKey.random();
    private meterPublicKey: PublicKey = this.meterSecretKey.toPublicKey();


    signSmartMeterPK(): SignedMeterPk {
        const pkSig: Signature = Signature.create(
            this.manufacturerSecretKey, 
            this.manufacturerPublicKey.toFields().concat(
                this.meterPublicKey.toFields()).concat(this.meterId));

        return new SignedMeterPk({
            meterPk: this.meterPublicKey,
            meterId: this.meterId,
            meterPkSig: pkSig,
        })
    }

    // Serialise the serial number of the meter, secret key, public key and the public key+serial number signature from the manufacturer
    async createSmartMeter() {
        // Use hashed meter id for the signature
        // const signedSmartMeterPk: SignedMeterPk = manufacturer.signSmartMeterPublicKey(this.smartMeterPublicKey, this.id);

        const props = new SmartMeterProperties({
            id: this.meterId,
            secretKey: this.meterSecretKey,
            publicKey: this.meterPublicKey,
            // smartMeterSignature: signedSmartMeterPk,
            // manufacturerId: manufacturer.getId()
        });

        await fs.writeFile(
            "./generated_smart_meters/properties_" + this.meterId.toString() + ".json", props.toJSON()
        ).catch(err => {
            console.error('Error writing file:', err);
            process.exit(1);
        });
    }
}