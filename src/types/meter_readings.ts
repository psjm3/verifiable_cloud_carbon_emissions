import { Field, PrivateKey, PublicKey, Signature, Struct } from "o1js";

export class SmartMeterProperties extends Struct({
    id: Field,
    secretKey: PrivateKey,
    publicKey: PublicKey,
}){
    toJSON(): string {
        return JSON.stringify({
            "id": this.id,
            "secretKey": this.secretKey.toJSON(),
            "publicKey": this.publicKey.toJSON(),
            // "smartMeterSignature": JSON.parse(this.smartMeterSignature.toJSON()),
            // "manufacturerId": this.manufacturerId.toJSON()
        })
    }

    static fromJSON(json: any): SmartMeterProperties {        
        return new SmartMeterProperties({
            id: json.id,
            secretKey: PrivateKey.fromJSON(json.secretKey),
            publicKey: PublicKey.fromJSON(json.publicKey), 
        });
    }
}

export class MeterReading extends Struct({
    meterReading: Field,
    timestamp: Field
}){}

export class SignedMeterReading extends Struct({
    meterReadingData: MeterReading,
    meterReadingSig: Signature,
}){}
