// This creates a certificate authority, CA, who acts as a trusted party
// to sign the public keys from untrusted parties, providing evidence that the 
// public keys are authentic.
import { Field, PrivateKey, PublicKey, Signature } from "o1js"
import { SignedPublicKey } from "../types/certificate_authority.js";

import * as crypto from "crypto";

export class CertificateAuthority {
    private id: Field;

    constructor() {
        this.id = Field(crypto.randomInt((2**48)-1));
    }

    getId(): Field {
        return this.id;
    }

    // We assume that the CA uses the same of secret and public keys to keep things simple.
    // To make it more realistic we could easily extend this to be a map.

    // Private key used to sign both the grid operator and electricity supplier's public keys
    private caSecretKey: PrivateKey = PrivateKey.random();
    // Public key used for the verifications for grid operator and electricity supplier's public keys
    private caPublicKey: PublicKey = this.caSecretKey.toPublicKey();

    signPublicKey(pk: PublicKey, id: Field): SignedPublicKey {
        // The public key is signed with the provider's id and the CA's public key
        const pkSig: Signature = Signature.create(this.caSecretKey, this.caPublicKey.toFields().concat(pk.toFields()).concat(id));
        return new SignedPublicKey({
            pk,
            id,
            pkSig,
            pkPk: this.caPublicKey
            // TODO: do we need to add validity period for the public key signature?
            // timeFrom: Field,
            // timeTo: Field,
        })
    }

    signManufacturerPk(pk:PublicKey, id:Field): SignedPublicKey  {
        return this.signPublicKey(pk, id);
    }

    signGridOperatorPk(pk:PublicKey, id:Field): SignedPublicKey  {
        return this.signPublicKey(pk, id);
    }

    getCaPk(): PublicKey {
        return this.caPublicKey;
    }
}