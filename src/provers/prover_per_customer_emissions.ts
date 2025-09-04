import fs from 'fs';
import fsAsync from 'fs/promises';

import { Field, Proof, PublicKey, verify } from "o1js";
import { MerkleWitnessWithSums, NodeContent, TREE_HEIGHT } from "../types/merkle_tree.js";
import { totalEmissionsCircuit, TotalEmissionsCircuitOutput, TotalEmissionsCircuitPublicInput } from "../zkPrograms/zkprogram_total_emissions.js";
import { customerSharesCircuit } from "../zkPrograms/zkprogram_customer_shares.js";
import { PublicCustomerRecord } from "../types/public_customer_record.js";
import { perCustomerEmissionsCircuit } from "../zkPrograms/zkprogram_per_customer_proof.js";
import { Customer, CUSTOMER_SHARES_TOTAL, NUM_OF_VERIFIER } from "../types/customer.js";
import { SignedPublicKey } from "../types/certificate_authority.js";
import { SignedMeterPk } from "../types/smartmeter_manufactorer.js";
import { CertificateAuthority } from "../data/data_certificate_authority.js";
import { JSONParse } from 'json-with-bigint';
import { DEBUG } from '../utils/util.js';
import { createObjectCsvWriter } from 'csv-writer';
import { CsvWriter } from 'csv-writer/src/lib/csv-writer.js';
import { ObjectMap } from 'csv-writer/src/lib/lang/object.js';

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
let csvWriter : CsvWriter<ObjectMap<any>>;
if (fs.existsSync(logFile)) {
    csvWriter = createObjectCsvWriter({
        append: true,
        path: logFile,
        header: [
            {id: 'src', title: 'src_file'},
            {id: 'data', title: 'data'},
            {id: 'value', title: 'value'},
            {id: 'datatype', title: 'data_type'},
        ]
    });
} else {
    csvWriter = createObjectCsvWriter({
        path: logFile,
        header: [
            {id: 'src', title: 'src_file'},
            {id: 'data', title: 'data'},
            {id: 'value', title: 'value'},
            {id: 'datatype', title: 'data_type'},
        ]
    }); 
}
let logData = [];

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
    logData.push({ src: 'prover_per_customer_emissions', data: 'total emissions circuit compilation - time taken', value: (performance.now() - compileTotalEmissionsTimeStart), datatype: 'ms' });

    const compileCustomerSharesTimeStart = performance.now();
    const customerTreeCircuitVk = (await customerSharesCircuit.compile()).verificationKey;
    logData.push({ src: 'prover_per_customer_emissions', data: 'customer shares circuit compilation - time taken', value: (performance.now() - compileCustomerSharesTimeStart), datatype: 'ms' });

    const compilePerCustomerEmissionsTimeStart = performance.now();
    const perCustomerProofVk = (await perCustomerEmissionsCircuit.compile()).verificationKey;
    logData.push({ src: 'prover_per_customer_emissions', data: 'per customer emissions circuit compilation - time taken', value: (performance.now() - compilePerCustomerEmissionsTimeStart), datatype: 'ms' });

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

        if (DEBUG) {
            logData.push({ src: 'prover_per_customer_emissions', data: 'total emissions output for verifier ' + i, value: totalEmissionsProof.publicOutput.totalEmissions.toString(), datatype: 'text' });
            logData.push({ src: 'prover_per_customer_emissions', data: 'total customer shares output for verifier ' + i, value: customerSharesSerialisedProof.publicOutput.totalCustomerShares.toString(), datatype: 'text' });
            logData.push({ src: 'prover_per_customer_emissions', data: 'customer shares for verifier ' + i, value: customerRecords[i].customerShares.toString(), datatype: 'text' });
            logData.push({ src: 'prover_per_customer_emissions', data: 'publicCustomerRecord emissions for verifier ' + i, value: publicCustomerRecord.emissions.toString(), datatype: 'text' });
        }

        const oneCustomerProofTimeStart = performance.now();
        const startCpuMeasure = process.cpuUsage();
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
        logData.push({ src: 'prover_per_customer_emissions', data: 'per customer emissions proof for verifier ' + i + ' - time taken', value: (performance.now() - oneCustomerProofTimeStart), datatype: 'ms' });
        logData.push({ src: 'prover_per_customer_emissions', data: 'per customer emissions proof for verifier ' + i + ' - cpuUsage', value: (process.cpuUsage(startCpuMeasure).user), datatype: 'us' })
        logData.push({ src: 'prover_per_customer_emissions', data: 'per customer emissions proof for verifier ' + i + ' - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
        fsAsync.writeFile("emissions_proof_" + publicCustomerRecord.customerInvoice.customerId + ".json", JSON.stringify(emissionsProof.toJSON())).catch(
            err => {
                logData.push({ src: 'prover_total_emissions', data: 'Error writing to emissions_proof_'+publicCustomerRecord.customerInvoice.customerId+'.json', value: err, datatype: 'text' })
            }
        );

        // Sanity Check to make sure that customer shares proof is valid and the shares add up to 100
        // In the complete prototype the verification is done in a separate process
        const validEmissionsProof = await verify(emissionsProof, perCustomerProofVk);
        if (DEBUG) {
            logData.push({ src: 'prover_per_customer_emissions', data: 'per customer emissions proof for verifier ' + i + ' verified?', value: validEmissionsProof, datatype: 'text' });
        }
    }
    fsAsync.writeFile("verification_key.txt", perCustomerProofVk.data).catch(
        err => {
            logData.push({ src: 'prover_per_customer_emissions', data: 'Error writing to verification_key.txt', value: err, datatype: 'text' })
        }
    );
}

/*************************************/
/***** Per Customer Proof STARTS *****/
/*************************************/
const totalEmissionsProofRaw = await fsAsync.readFile("./generated_proofs/total_emissions_proof_4_0.json", 'utf8');
const totalEmissionsProof = await convertJsonToProof(totalEmissionsCircuit.Proof, JSON.parse(totalEmissionsProofRaw));

let customerRecordsRaw = await fsAsync.readFile('./generated_customer_records/customer.json', 'utf8');
let customerRecords = JSON.parse(customerRecordsRaw) as Customer[];

const customerEmissionsData = await fsAsync.readFile("./generated_customer_records/customer_emissions.json", 'utf8');
const customerEmissions = JSONParse(customerEmissionsData) as Field[];

class MerkleTreeWitness extends MerkleWitnessWithSums(TREE_HEIGHT) { };
let witnesses: MerkleTreeWitness[] = [];
// for (let i = 0; i < TREE_NUM_OF_LEAFS; i++) {
for (let i = 0; i < NUM_OF_VERIFIER; i++) {
    const witnessRaw = await fsAsync.readFile("./generated_witnesses/witness_for_" + i + ".json", 'utf8');
    const witness = JSON.parse(witnessRaw);
    witnesses.push(witness);
}

const treeRootProofRaw = await fsAsync.readFile("./generated_proofs/subtree_proof_" + (TREE_HEIGHT - 1) + "_0.json", 'utf8');
const treeRootProof = await convertJsonToProof(customerSharesCircuit.Proof, JSON.parse(treeRootProofRaw));

const caObj = new CertificateAuthority();
const caPk = caObj.getCaPk();
// Serialise the public keys for the CA so that verifiers can use them as part of public witnesses
await fsAsync.writeFile(
    "./generated_public_keys/pk_CA_meter.json", caPk.toJSON()
).catch(err => {
    logData.push({ src: 'prover_per_customer_emissions', data: 'Error writing to ./generated_public_keys/pk_CA_meter.json', value: err, datatype: 'text' })
    process.exit(1);
});
await fsAsync.writeFile(
    "./generated_public_keys/pk_CA_grid_operator.json", caPk.toJSON()
).catch(err => {
    logData.push({ src: 'prover_per_customer_emissions', data: 'Error writing to ./generated_public_keys/pk_CA_grid_operator.json', value: err, datatype: 'text' })
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
logData.push({ src: 'prover_per_customer_emissions', data: 'per customer emissions proof for ' + NUM_OF_VERIFIER + ' verifiers overall - time taken', value: (performance.now() - perCustomerProofOverallTimeStart), datatype: 'ms' })

logData.push({ src: 'prover_per_customer_emissions', data: 'prover overall - time taken', value: (performance.now() - proverPerCustomerEmissionsTimeStart), datatype: 'ms' })
logData.push({ src: 'prover_per_customer_emissions', data: 'process - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
logData.push({ src: 'prover_per_customer_emissions', data: 'process - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
csvWriter.writeRecords(logData).then(() => console.log('prover_per_customer_emissions logs-writing to file completed'));
/***********************************/
/***** Per Customer Proof ENDS *****/
/***********************************/