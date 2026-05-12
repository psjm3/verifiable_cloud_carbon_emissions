import fs from 'fs';
import fsAsync from 'fs/promises';

import { Field, Proof, PublicKey, verify } from "o1js";
import { MerkleWitnessWithSums, NodeContent, TREE_HEIGHT, TREE_NUM_OF_LEAFS, Witness } from "../types/merkle_tree.js";
import { totalEmissionsCircuit, TotalEmissionsCircuitOutput, TotalEmissionsCircuitPublicInput } from "../zkPrograms/zkprogram_total_emissions.js";
import { customerSharesCircuit } from "../zkPrograms/zkprogram_customer_shares.js";
import { PublicCustomerRecord } from "../types/public_customer_record.js";
import { perCustomerEmissionsCircuit } from "../zkPrograms/zkprogram_per_customer_proof.js";
import { Customer, CUSTOMER_SHARES_TOTAL, NUM_OF_VERIFIER } from "../types/customer.js";
import { SignedPublicKey } from "../types/certificate_authority.js";
import { SignedMeterPk } from "../types/smartmeter_manufactorer.js";
import { CertificateAuthority } from "../data/data_certificate_authority.js";
import { JSONParse } from 'json-with-bigint';
import { debugLog, log, logStreamStart, logStreamStop } from '../utils/util.js';
import { DatabaseSync } from 'node:sqlite';

function convertJsonToProof<
    JsonProof,
    SerialisedProof extends { fromJSON(jsonProof: JsonProof): Promise<JsonProof> }
>(SerialisedProof: SerialisedProof, jsonProof: JsonProof) {
    return SerialisedProof.fromJSON(jsonProof);
}

const path = './generated_logs';
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        console.error(`ERROR: Prover_per_customer_emissions, Error creating directory for ${path}: ${err}\n`);
        process.exit(1);
    });
}
const logFile = path + '/prover_per_customer_emissions.out';
logStreamStart(logFile);
const proverPerCustomerEmissionsTimeStart = performance.now();

async function generatePerCustomerEmissionsProofs(
    customerRecords: Customer[],
    customerEmissions: Field[],
    customerTreeRootHash: Field,
    witnesses: MerkleTreeWitness[],
    totalEmissionsProof: Proof<TotalEmissionsCircuitPublicInput, TotalEmissionsCircuitOutput>,
    customerSharesSerialisedProof: Proof<NodeContent, NodeContent>,
    signedGridOperatorPk: SignedPublicKey,
    signedMeterPk: SignedMeterPk,
    signedMeterManufacturerPk: SignedPublicKey,
    smartMeterCAPk: PublicKey,
    intensityCAPk: PublicKey,
    meterPk: PublicKey,
    gridOperatorPk: PublicKey
) {
    const compileTotalEmissionsTimeStart = performance.now();
    const totalEmissionsVk = (await totalEmissionsCircuit.compile()).verificationKey;
    log(`Prover_per_customer_emissions, total_emissions_circuit_compilation, time, ${performance.now() - compileTotalEmissionsTimeStart}\n`);

    const compileCustomerSharesTimeStart = performance.now();
    const customerTreeCircuitVk = (await customerSharesCircuit.compile()).verificationKey;
    log(`Prover_per_customer_emissions, total_emissions_circuit_compilation, time, ${performance.now() - compileCustomerSharesTimeStart}\n`);

    const compilePerCustomerEmissionsTimeStart = performance.now();
    const perCustomerProofVk = (await perCustomerEmissionsCircuit.compile()).verificationKey;
    log(`Prover_per_customer_emissions, total_emissions_circuit_compilation, time, ${performance.now() - compilePerCustomerEmissionsTimeStart}\n`);

    // Sign the public keys that are used to verify the carbon intensity and meter readings

    // These should be the same as the period used to generate the meter readings/intensity proofs
    // When a time is used as the "from" timestamp as the input for the carbon intensity REST API, it is actually 
    // the "to" timestamp of the half hour reading. For example, if the "from" field is set to 2025-06-03T12:30Z 
    // and the "to" field is set to 2025-06-03T13:00Z, the API actually returns two readings, one from 12:00 to 12:30
    // and one from 12:30 to 13:00.
    // Therefore the invoice period needs to be adjusted to be half an hour before what is set on the "from" time field
    // for the intensity and meter readings.

    // o1js can only support up to 90 proofs per prover (i.e. process) due to a memory leak. The node process reaches
    // 4.93Gb memory usage (RAM) and then hangs.
    for (let i = 0; i < NUM_OF_VERIFIER; i++) {
        let publicCustomerRecord = new PublicCustomerRecord({
            customerInvoice: customerRecords[i].invoice,
            emissions: customerEmissions[i],
            smartMeterCAPk,
            intensityCAPk,
            customerTreeRootHash,
            smartMeterPk: meterPk,
            gridOpeartorPk: gridOperatorPk
        })

        debugLog(`Prover_per_customer_emissions, 
        total emissions: ${totalEmissionsProof.publicOutput.totalEmissions.toString()}
        total customer shares: ${customerSharesSerialisedProof.publicOutput.totalCustomerShares.toString()}
        customerRecords[${i}].customer shares: ${customerRecords[i].customerShares.toString()}
        publicCustomerRecord emissions: ${publicCustomerRecord.emissions.toString()}`);

        const oneCustomerProofTimeStart = performance.now();
        const { proof: emissionsProof } = await perCustomerEmissionsCircuit.emissionsProof(
            publicCustomerRecord,
            witnesses[i],
            totalEmissionsProof,
            customerSharesSerialisedProof,
            signedGridOperatorPk,
            signedMeterPk,
            signedMeterManufacturerPk,
            customerRecords[i]
        );
        log(`Prover_per_customer_emissions, one_per_customer_emissions_proof, time, ${performance.now() - oneCustomerProofTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);

        fsAsync.writeFile("emissions_proof_" + publicCustomerRecord.customerInvoice.customerId + ".json", JSON.stringify(emissionsProof.toJSON())).catch(
            err => {
                log(`ERROR: Prover_per_customer_emissions, error writing to emissions_proof_${publicCustomerRecord.customerInvoice.customerId}.json: ${err}\n`);
            }
        );

        // Sanity Check to make sure that customer shares proof is valid and the shares add up to 100
        // In the complete prototype the verification is done in a separate process
        const validEmissionsProof = await verify(emissionsProof, perCustomerProofVk);
        debugLog(`Prover_per_customer_emissions, customer data all checked out? ${validEmissionsProof}\n`);
    }
    fsAsync.writeFile("verification_key.txt", perCustomerProofVk.data).catch(
        err => {
            log(`ERROR: Prover_per_customer_emissions, error writing to verification_key.txt: ${err}\n`);
        }
    );
}

/*************************************/
/***** Per Customer Proof STARTS *****/
/*************************************/
const totalEmissionsProofRaw = await fsAsync.readFile("./generated_proofs/total_emissions_proof_4_0.json", 'utf8');
const totalEmissionsProof = await convertJsonToProof(totalEmissionsCircuit.Proof, JSON.parse(totalEmissionsProofRaw));

let customerRecordsRaw = await fsAsync.readFile('./customer_records/customer.json', 'utf8');
let customerRecords = JSON.parse(customerRecordsRaw) as Customer[];

const customerEmissionsData = await fsAsync.readFile("customer_records/customer_emissions.json", 'utf8');
const customerEmissions = JSONParse(customerEmissionsData) as Field[];

// class MerkleTreeWitness extends MerkleWitnessWithSums(TREE_HEIGHT) { };
let witnesses: MerkleTreeWitness[] = [];
// // for (let i = 0; i < TREE_NUM_OF_LEAFS; i++) {
// for (let i = 0; i < NUM_OF_VERIFIER; i++) {
//     const witnessRaw = await fsAsync.readFile("./generated_witnesses/witness_for_" + i + ".json", 'utf8');
//     const witness = JSON.parse(witnessRaw);
//     witnesses.push(witness);
// }
/**********************************/
/* GENERATE MERKLE TREE WITNESSES */
/**********************************/
// Serialise tree witnesses for selected customer records, so that they can be used in
// per customer proof without having to rebuild the entire Merkle Tree
const generateMerkleTreeWitnessesTimeStart = performance.now();
class MerkleTreeWitness extends MerkleWitnessWithSums(TREE_HEIGHT) { };
const dbForGettingWitnesses = new DatabaseSync('./customer_merkle_tree.db');
// for (let i = 0; i < TREE_NUM_OF_LEAFS; i++) {
for (let i = 0n; i < NUM_OF_VERIFIER; i++) {
    if (i >= TREE_NUM_OF_LEAFS) {
        throw new Error(`index ${i} is out of range for ${TREE_NUM_OF_LEAFS} leaves.`);
    }
    const witness: Witness = [];
    for (let level = 0; level < TREE_HEIGHT - 1; level++) {
        let isLeft = i % 2n === 0n;
        let index = isLeft ? i + 1n : i - 1n
        let query = dbForGettingWitnesses.prepare('SELECT * from customer_merkle_tree where tree_level='+level+' and tree_node_index='+index);
        let queryResult = query.get();
        let returnNode:NodeContent = NodeContent.fromJSON(queryResult);
        witness.push({ isLeft, sibling:returnNode });
        i /= 2n;
    }
    witnesses.push(new MerkleTreeWitness(witness));
}
dbForGettingWitnesses.close();
log(`Prover_customer_shares, gen_merkle_tree_witnesses, time, ${performance.now() - generateMerkleTreeWitnessesTimeStart}, numOfVerifier, ${NUM_OF_VERIFIER}\n`);

const treeRootProofRaw = await fsAsync.readFile("./generated_proofs/subtree_proof_" + (TREE_HEIGHT - 1) + "_0.json", 'utf8');
const treeRootProof = await convertJsonToProof(customerSharesCircuit.Proof, JSON.parse(treeRootProofRaw));

const caObj = new CertificateAuthority();
const caPk = caObj.getCaPk();
// Serialise the public keys for the CA so that verifiers can use them as part of public witnesses
await fsAsync.writeFile(
    "./generated_public_keys/pk_CA_meter.json", caPk.toJSON()
).catch(err => {
    log(`ERROR: Prover_per_customer_emissions, error writing to ./generated_public_keys/pk_CA_meter.json: ${err}\n`);
    process.exit(1);
});
await fsAsync.writeFile(
    "./generated_public_keys/pk_CA_grid_operator.json", caPk.toJSON()
).catch(err => {
    log(`ERROR: Prover_per_customer_emissions, error writing to ./generated_public_keys/pk_CA_grid_operator.json: ${err}\n`);
    process.exit(1);
});

const gridOperatorPkRaw = await fsAsync.readFile("./generated_public_keys/grid_operator_pk.json", 'utf8');
const gridOperatorPk = PublicKey.fromJSON(gridOperatorPkRaw);
const gridOperatorIdRaw = await fsAsync.readFile("./generated_public_keys/grid_operator_id.json", 'utf8');
const gridOperatorId = Field.fromJSON(gridOperatorIdRaw);
const signedGridOperatorPk = caObj.signGridOperatorPk(gridOperatorPk, gridOperatorId);

const meterManufacturerIdRaw = await fsAsync.readFile("./generated_public_keys/meter_manufacturer_id.json", 'utf8');
const meterManufacturerId = Field.fromJSON(meterManufacturerIdRaw);
const meterManufacturerPkRaw = await fsAsync.readFile("./generated_public_keys/meter_manufacturer_pk.json", 'utf8');
const signedMeterManufacturerPk = caObj.signManufacturerPk(PublicKey.fromJSON(meterManufacturerPkRaw), meterManufacturerId);

const meterPkRaw = await fsAsync.readFile("./generated_public_keys/meter_pk.json", 'utf8');
const meterPk = PublicKey.fromJSON(meterPkRaw);
const signedMeterPkRaw = await fsAsync.readFile("./generated_public_keys/signed_meter_pk.json", 'utf8');
const signedMeterPk = SignedMeterPk.fromJSON(JSON.parse(signedMeterPkRaw));

// Sanity check, not part of the proofs
function customerSharesCheck(individuals: Customer[]): Field {
    let sum: Field = Field(0);
    for (let i = 0; i < individuals.length; i++) {
        sum = sum.add(individuals[i].customerShares);
    }
    return sum;
}
customerSharesCheck(customerRecords).assertEquals(Field(CUSTOMER_SHARES_TOTAL));
function customerEmissionsCheck(individuals: Field[]): Field {
    let sum: Field = Field(0);
    for (let i = 0; i < individuals.length; i++) {
        sum = sum.add(individuals[i]);
    }
    return sum;
}
customerEmissionsCheck(customerEmissions).assertEquals(totalEmissionsProof.publicOutput.totalEmissions.mul(Field(CUSTOMER_SHARES_TOTAL)));

// For each customer, prove that their customer record is part of the Merkle Tree and that their emissions are 
// calculated accurately using verified input data.
const perCustomerProofOverallTimeStart = performance.now();
await generatePerCustomerEmissionsProofs(
    customerRecords,
    customerEmissions,
    treeRootProof.publicOutput.hash,
    witnesses,
    totalEmissionsProof,
    treeRootProof,
    signedGridOperatorPk,
    signedMeterPk,
    signedMeterManufacturerPk,
    caObj.getCaPk(),
    caObj.getCaPk(),
    meterPk,
    gridOperatorPk
);
log(`Prover_per_customer_emissions, per_customer_emissions_proof_overall, time, ${performance.now() - perCustomerProofOverallTimeStart}\n`);

log(`Prover_per_customer_emissions, Ends, time, ${performance.now() - proverPerCustomerEmissionsTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
logStreamStop(logFile);
/***********************************/
/***** Per Customer Proof ENDS *****/
/***********************************/