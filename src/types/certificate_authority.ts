import { Field, PublicKey, Signature, Struct } from "o1js";

export class SignedPublicKey extends Struct({
    pk: PublicKey,
    id: Field,
    pkSig: Signature,
    pkPk: PublicKey
}){
    toJSON(): string {
        return JSON.stringify({
            "pk": this.pk.toJSON(),
            "id": this.id.toJSON(),
            "pkSig": this.pkSig.toJSON(),
            "pkPk": this.pkPk.toJSON(),
        })
    }

    static fromJSON(json: any): SignedPublicKey {
        return new SignedPublicKey({
            pk: PublicKey.fromJSON(json.pk),
            id: Field(json.id),
            pkSig: Signature.fromJSON(json.pkSig),
            pkPk: PublicKey.fromJSON(json.pkPk), 
        });
    }

    verify(caPk: PublicKey) {
        return this.pkSig.verify(caPk, this.pk.toFields().concat(this.id.toFields()));
    }
}