import fs from 'fs';
import fsAsync from 'fs/promises';

import { Field } from 'o1js';
import { generateCustomerSharesBaseProofs } from './prover_customer_shares_base.js';
import { BATCH_NUM_OF_CUSTOMERS, MerkleTreeWithSums, MerkleWitnessWithSums, TREE_HEIGHT, TREE_NUM_OF_LEAFS } from '../types/merkle_tree.js';
import { CustomerData } from '../data/data_customers.js';
import { Customer, CUSTOMER_SHARES_TOTAL, NUM_OF_VERIFIER } from '../types/customer.js';
import { BILLABLE_PERIOD_FROM_TIMESTAMP, BILLABLE_PERIOD_TO_TIMESTAMP } from '../data/data_timestamps.js';
import { totalEmissionsCircuit } from '../zkPrograms/zkprogram_total_emissions.js';
import { DEBUG } from '../utils/util.js';
import { generateCustomerSharesStepProofs } from './prover_customer_shares_step.js';
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
        console.error(`ERROR: prover_customer_shares, Error creating directory for ${path}: ${err}\n`);
        process.exit(1);
    });
}
const logFile = path + '/prover_customer_shares.out';
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

const proverCustomerSharesTimeStart = performance.now();

/************************/
/* GENEARTE SAMPLE DATA */
/************************/
// Write the randomly generated customer records to file, in real-life the data
// are more likely to be kept in a database.
const customerDataObj = new CustomerData();
const customerRecords: Customer[] = await customerDataObj.generateCustomers(BILLABLE_PERIOD_FROM_TIMESTAMP, BILLABLE_PERIOD_TO_TIMESTAMP, logData);
const customerMerkleTree: MerkleTreeWithSums = customerDataObj.generateCustomerMerkleTree(customerRecords, logData);

// Allocate emissions for the newly generated customers using the total emissions figure generated in the Total emissions proof.
const totalEmissionsProofRaw = await fsAsync.readFile("./generated_proofs/total_emissions_proof_4_0.json", 'utf8');
const totalEmissionsProof = await convertJsonToProof(totalEmissionsCircuit.Proof, JSON.parse(totalEmissionsProofRaw));
await customerDataObj.generateCustomerEmissions(totalEmissionsProof.publicOutput.totalEmissions, customerRecords, logData);

// Sanity check, not part of the proofs
function customerSharesCheck(individuals: Customer[]): Field {
    let sum: Field = Field(0);
    for (let i = 0; i < individuals.length; i++) {
        sum = sum.add(individuals[i].customerShares);
    }
    return sum;
}
customerSharesCheck(customerRecords).assertEquals(Field(CUSTOMER_SHARES_TOTAL));

/********************/
/* RUN BASE CIRCUIT */
/********************/
const customerSharesBaseTimeStart = performance.now();
await generateCustomerSharesBaseProofs(logData);
logData.push({ src: 'prover_customer_shares', data: 'customer shares base proof overall - time taken', value: (performance.now() - customerSharesBaseTimeStart), datatype: 'ms' })

// Need to get the input left and right nodes of the subtrees for generating
// the proofs further up after the base proofs (i.e. the root of the base subtrees),
// so that we don't have to rebuild the entire Merkle tree for each proof-batch.
let currentParentLevel: number = Math.ceil(Math.log2(BATCH_NUM_OF_CUSTOMERS)) + 1;
let numOfParentIdx = TREE_NUM_OF_LEAFS / (BATCH_NUM_OF_CUSTOMERS * 2);

let serialiseTreeRootsTimeStart = performance.now();
while (currentParentLevel != TREE_HEIGHT) {
    for (let i = 0n; i < numOfParentIdx; i++) {
        let subTreeRootNode = customerMerkleTree.getNode(currentParentLevel, i);
        await fsAsync.writeFile(
            "./generated_proofs/subtree_root_" + currentParentLevel + "_" + i + ".json", subTreeRootNode.toJSON()
        ).catch(err => {
            logData.push({ src: 'prover_total_emissions', data: 'Error writing to ./generated_proofs/subtree_root_'+currentParentLevel+'_'+i+'.json', value: err, datatype: 'text' })
            process.exit(1);
        });
    }
    currentParentLevel += 1;
    numOfParentIdx = numOfParentIdx / 2;
}
if (DEBUG) {
    logData.push({ src: 'prover_customer_shares', data: 'customer shares serialise subtree roots - time taken', value: (performance.now() - serialiseTreeRootsTimeStart), datatype: 'ms' })
}

/********************/
/* RUN STEP CIRCUIT */
/********************/
const customerSharesStepTimeStart = performance.now();
await generateCustomerSharesStepProofs(logData);
logData.push({ src: 'prover_customer_shares', data: 'customer shares step proof overall - time taken', value: (performance.now() - customerSharesStepTimeStart), datatype: 'ms' })

/**********************************/
/* GENERATE MERKLE TREE WITNESSES */
/**********************************/
// Serialise tree witnesses for selected customer records, so that they can be used in
// per customer proof without having to rebuild the entire Merkle Tree
const generateMerkleTreeWitnessesTimeStart = performance.now();
class MerkleTreeWitness extends MerkleWitnessWithSums(TREE_HEIGHT) { };
// for (let i = 0; i < TREE_NUM_OF_LEAFS; i++) {
for (let i = 0; i < NUM_OF_VERIFIER; i++) {
    let witness = new MerkleTreeWitness(customerMerkleTree.getWitness(BigInt(i)));

    let witnessJson = {
        path: [],
        isLeft: []
    };
    witness.path.forEach((path) => {
        witnessJson.path.push(JSON.parse(path.toJSON()));
    });
    witness.isLeft.forEach((isLeft) => {
        witnessJson.isLeft.push(isLeft);
    })

    await fsAsync.writeFile(
        "./generated_witnesses/witness_for_" + i + ".json", JSON.stringify(witnessJson)
    ).catch(err => {
        logData.push({ src: 'prover_customer_shares', data: 'Error writing to ../generated_witnesses/witness_for_'+i+'.json', value: err, datatype: 'text' })
        process.exit(1);
    });
}
logData.push({ src: 'prover_customer_shares', data: 'Merkle tree witnesses generation for  ' + NUM_OF_VERIFIER + ' verifiers - time taken', value: (performance.now() - generateMerkleTreeWitnessesTimeStart), datatype: 'ms' })

logData.push({ src: 'prover_customer_shares', data: 'prover overall - time taken', value: (performance.now() - proverCustomerSharesTimeStart), datatype: 'ms' })
logData.push({ src: 'prover_customer_shares', data: 'process - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
logData.push({ src: 'prover_customer_shares', data: 'process - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
csvWriter.writeRecords(logData).then(() => console.log('prover_customer_shares logs-writing to file completed'));