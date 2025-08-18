import {
    Field,
    ZkProgram,
    Proof,
    Poseidon
} from 'o1js';
import { totalEmissionsCircuit, TotalEmissionsCircuitOutput, TotalEmissionsCircuitPublicInput } from './zkprogram_total_emissions.js';
import { customerSharesCircuit } from './zkprogram_customer_shares.js';
import { MerkleWitnessWithSums, NodeContent, TREE_HEIGHT } from '../types/o1js_merkle_tree.js';
import { PublicCustomerRecord } from '../types/public_customer_record.js';
import { Customer, CUSTOMER_SHARES_TOTAL } from '../types/customer.js';
import { SignedPublicKey } from '../types/certificate_authority.js';
import { SignedMeterPk } from '../types/smartmeter_manufactorer.js';
import { Invoice } from '../types/invoice.js';

class MerkleTreeWitness extends MerkleWitnessWithSums(TREE_HEIGHT) { }

export const perCustomerEmissionsCircuit = ZkProgram({
    name: 'Proof of emission for an individual customer',
    publicInput: PublicCustomerRecord,
    publicOutput: Field,
    methods: {
        emissionsProof: {
            privateInputs: [
                MerkleTreeWitness,
                totalEmissionsCircuit.Proof, 
                customerSharesCircuit.Proof, 
                SignedPublicKey, 
                SignedMeterPk,
                SignedPublicKey, 
                Customer],
            async method(
                publicCustomerRecord: PublicCustomerRecord,
                witnessForThisCustomer: MerkleTreeWitness,
                totalEmissionsProof: Proof<TotalEmissionsCircuitPublicInput, TotalEmissionsCircuitOutput>,
                totalCustomerShareProof: Proof<NodeContent, NodeContent>,
                signedGridOperatorPk: SignedPublicKey,
                signedMeterPk: SignedMeterPk,
                signedMeterManufacturerPk: SignedPublicKey,
                privateCustomerData: Customer,
            ) {
                totalEmissionsProof.verify();
                totalCustomerShareProof.verify();

                // Verify the grid operator's public key used in the total emissions proof by checking that
                // (a) it is the same as the signed public key and (b) the signature on the public key is 
                // verified using the CA public key
                totalEmissionsProof.publicOutput.gridOperatorPk.assertEquals(signedGridOperatorPk.pk);
                publicCustomerRecord.gridOpeartorPk.assertEquals(signedGridOperatorPk.pk);
                signedGridOperatorPk.pkSig.verify(
                    publicCustomerRecord.intensityCAPk,
                    publicCustomerRecord.intensityCAPk.toFields().concat(
                        signedGridOperatorPk.pk.toFields()).concat(
                            signedGridOperatorPk.id)
                ).assertTrue();

                // Likewise we verify the Smart Meter's public key used to sign the meter readings is geniune 
                // by checking that it is the same as the signed public key and the signature on the key is valid 
                // against the CA public key.
                totalEmissionsProof.publicOutput.smartMeterPk.assertEquals(signedMeterPk.meterPk);
                publicCustomerRecord.smartMeterPk.assertEquals(signedMeterPk.meterPk);
                signedMeterPk.meterPkSig.verify(
                    signedMeterManufacturerPk.pk,
                    signedMeterManufacturerPk.pk.toFields().concat(
                        signedMeterPk.meterPk.toFields()).concat(
                            signedMeterPk.meterId)
                ).assertTrue();

                // Lastly we verify the Meter Manufacturer's public key (private witness here) is valid 
                // by checking that it is the same as the signed public key and the signature on the key can be verified 
                // against the CA public key.     
                signedMeterManufacturerPk.pkSig.verify(
                    publicCustomerRecord.smartMeterCAPk,
                    publicCustomerRecord.smartMeterCAPk.toFields().concat(
                        signedMeterManufacturerPk.pk.toFields()).concat(
                            signedMeterManufacturerPk.id)
                ).assertTrue();

                // Prove that the public ID as well as the customer billable data match with what's on the customer record,
                // and the customer record exists on the customer merkle tree.
                // The customer record can only exist if the witness path from its node as a leaf to the root equals
                // to the customer tree root, which is a public output from the customer shares proof.
                publicCustomerRecord.customerInvoice.customerId.assertEquals(privateCustomerData.invoice.customerId);

                // Also check that the hash of the public data matches with the hash of the private input of the customer data
                const calcHash = Poseidon.hash([
                    publicCustomerRecord.customerInvoice.customerId,
                    publicCustomerRecord.customerInvoice.resourcesCharges,
                    publicCustomerRecord.customerInvoice.timeFrom,
                    publicCustomerRecord.customerInvoice.timeTo,
                    publicCustomerRecord.customerInvoice.otherCharges,
                    privateCustomerData.customerShares, 
                    privateCustomerData.nonce
                ]);

                calcHash.assertEquals(privateCustomerData.hash());

                const computedRoot = witnessForThisCustomer.calculateRoot(new NodeContent({
                    hash: privateCustomerData.hash(),
                    totalCustomerShares: privateCustomerData.customerShares,
                    totalResourceCharges: privateCustomerData.invoice.resourcesCharges,
                    totalOtherCharges: privateCustomerData.invoice.otherCharges,
                    ratioLowerBound: Invoice.acceptableLowerBound,
                    ratioUpperBound: Invoice.acceptableUpperBound
                }));

                totalCustomerShareProof.publicOutput.hash.assertEquals(
                    computedRoot.hash,
                    'Tree witness with provided customer record is not correct'
                );

                // Prove that sum of customer shares = 100*num_of_customers
                // because the customer share figures are inflated num_of_customers times 
                // to make them integers.
                totalCustomerShareProof.publicOutput.totalCustomerShares.assertEquals(
                    CUSTOMER_SHARES_TOTAL,
                    'Customer shares do not add up to 100% of the total'
                );

                // Prove that the public claim of the carbon emissions for this customer is indeed
                // the right fraction of the total emissions.
                let emissionsBasedOnUsage = totalEmissionsProof.publicOutput.totalEmissions.mul(privateCustomerData.customerShares);
                // The "consumptionPercent" was inflated to make the total big enough such that each value can be represented
                // with an integer. So to check we need to also inflate the emissions from the publicCustomerRecord
                //let inflatedPublicEmissions = publicCustomerRecord.emissions.mul(CUSTOMER_SHARES_TOTAL);
                emissionsBasedOnUsage.assertEquals(publicCustomerRecord.emissions);

                // Finally also prove that the ratio of the emissions to the billable data obtained for this customer
                // is within acceptable bounds
                // But first that the customer id matches
                //privateCustomerData.customerId.assertEquals(Invoice.customerId);

                // Also need to check the time periods all match
                totalEmissionsProof.publicOutput.periodStartTime.assertEquals(privateCustomerData.invoice.timeFrom);
                totalEmissionsProof.publicOutput.periodEndTime.assertEquals(privateCustomerData.invoice.timeTo);

                return { publicOutput: publicCustomerRecord.emissions }
            }
        },
    }
})
