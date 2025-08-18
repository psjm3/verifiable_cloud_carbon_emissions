import {
    Field, 
    Signature,
    PublicKey,
    ZkProgram,
    Struct,
} from 'o1js';

export class CarbonIntensityCircuitOutput extends Struct({
    intensity: Field,
    caPk: PublicKey
}) {}

// Circuit to verify that:
//   - the carbon intensity has been signed using the electricity supplier's private key; 
//   - the electricity supplier's public key has been signed using a CA's private key.
// The "public" output is the proof, intensity, and the CA's public key, public in the sense 
// that the prover can use it for generating further proofs
export const carbonIntensityCircuit = ZkProgram({
    name: 'Proof of signatures in the carbon intensity chain',
    publicInput: Field,
    publicOutput: CarbonIntensityCircuitOutput,

    methods: {
        intensity_proof: {
            privateInputs: [Signature, PublicKey, Signature, PublicKey],
            async method(
                intensity: Field, 
                intensitySig: Signature,
                eSupplierPk: PublicKey,
                eSupplierPkSig: Signature,
                caPk: PublicKey
            ) {
                // Verify that the signature of the meter reading, total_power, is valid
                intensitySig.verify(eSupplierPk, [intensity]).assertTrue();
                eSupplierPkSig.verify(caPk, eSupplierPk.toFields()).assertTrue();

                return { publicOutput: new CarbonIntensityCircuitOutput({intensity: intensity, caPk: caPk}) }
            }
        }
    }
});