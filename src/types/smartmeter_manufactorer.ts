import { Field, PublicKey, Signature, Struct } from "o1js";

export class SignedMeterPk extends Struct({
    meterPk: PublicKey,
    meterId: Field,
    meterPkSig: Signature,
}){
    toJSON(): string {
        return JSON.stringify({
            "meterPk": this.meterPk.toJSON(),
            "meterId": this.meterId.toJSON(),
            "meterPkSig": this.meterPkSig.toJSON(),
        })
    }

    static fromJSON(json: any): SignedMeterPk {        
        return new SignedMeterPk({
            meterPk: PublicKey.fromJSON(json.meterPk),
            meterId: Field(json.meterId),
            meterPkSig: Signature.fromJSON(json.meterPkSig), 
        });
    }

    verify(meterManufacturerPk: PublicKey) {
        return this.meterPkSig.verify(meterManufacturerPk, this.meterPk.toFields().concat(this.meterId));
    }
}