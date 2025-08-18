import {
    Field,
} from 'o1js';
import fs from 'fs/promises';

import { generateCustomerSharesRecProofs } from './prover_customer_shares_rec.js';
import { generateCustomerSharesBaseProofs } from './prover_customer_shares_base.js';
import { BATCH_NUM_OF_CUSTOMERS, MerkleTreeWithSums, MerkleWitnessWithSums, TREE_HEIGHT, TREE_NUM_OF_LEAFS } from '../types/o1js_merkle_tree.js';
import { CustomerData } from '../data/data_customers.js';
import { Customer, CUSTOMER_SHARES_TOTAL } from '../types/customer.js';
import { BILLABLE_PERIOD_FROM_TIMESTAMP, BILLABLE_PERIOD_TO_TIMESTAMP } from '../data/data_timestamps.js';
import { totalEmissionsCircuit } from '../zkPrograms/zkprogram_total_emissions.js';

function convertJsonToProof<
    JsonProof,
    SerialisedProof extends { fromJSON(jsonProof: JsonProof): Promise<JsonProof> }
>(SerialisedProof: SerialisedProof, jsonProof: JsonProof) {
    return SerialisedProof.fromJSON(jsonProof);
}
// Write the randomly generated customer records to file, in real-life the data
// are more likely to be kept in a database.
const customerDataObj = new CustomerData();
const customerRecords: Customer[] = await customerDataObj.generateCustomers(BILLABLE_PERIOD_FROM_TIMESTAMP, BILLABLE_PERIOD_TO_TIMESTAMP);
const customerMerkleTree: MerkleTreeWithSums = customerDataObj.generateCustomerMerkleTree(customerRecords);

// Generate emissions for the newly generated customers and write to disc via CustomerData.generateCustomerEmissions()
const totalEmissionsProofRaw = await fs.readFile("./generated_proofs/total_emissions_proof_4_0.json", 'utf8');
const totalEmissionsProof = await convertJsonToProof(totalEmissionsCircuit.Proof, JSON.parse(totalEmissionsProofRaw));
await customerDataObj.generateCustomerEmisisons(totalEmissionsProof.publicOutput.totalEmissions, customerRecords);

// Sanity check, not part of the proofs
function customerSharesCheck(individuals: Customer[]): Field {
    let sum: Field = Field(0);
    for (let i = 0; i < individuals.length; i++) {
        sum = sum.add(individuals[i].customerShares);
    }
    return sum;
}
customerSharesCheck(customerRecords).assertEquals(Field(CUSTOMER_SHARES_TOTAL));

await generateCustomerSharesBaseProofs();

// Need to get the input left and right nodes of the subtrees for generating
// the proofs further up after the base proofs (i.e. the root of the base subtrees),
// so that we don't have to rebuild the entire Merkle tree for each proof-batch.
let currentParentLevel: number = Math.ceil(Math.log2(BATCH_NUM_OF_CUSTOMERS)) + 1;
let numOfParentIdx = TREE_NUM_OF_LEAFS / (BATCH_NUM_OF_CUSTOMERS * 2);

console.time("Serialise subtree roots");
while (currentParentLevel != TREE_HEIGHT) {
    for (let i = 0n; i < numOfParentIdx; i++) {
        let subTreeRootNode = customerMerkleTree.getNode(currentParentLevel, i);
        console.log(
            'currentParentLevel:', currentParentLevel,
            'index:', i,
            'subTreeRootNode hash:', subTreeRootNode.hash.toString(),
            'subTreeRootNode consumption shares sum:', subTreeRootNode.totalCustomerShares.toString(),
            'subTreeRootNode resources costs sum:', subTreeRootNode.totalResourceCharges.toString(),
            'subTreeRootNode other costs sum:', subTreeRootNode.totalOtherCharges.toString()
        );

        await fs.writeFile(
            "./generated_proofs/subtree_root_" + currentParentLevel + "_" + i + ".json", subTreeRootNode.toJSON()
        ).catch(err => {
            console.error('Error writing file:', err);
            process.exit(1);
        });
    }
    currentParentLevel += 1;
    numOfParentIdx = numOfParentIdx / 2;
}
console.timeEnd("Serialise subtree roots");

await generateCustomerSharesRecProofs();

// Serialise tree witnesses for selected customer records, so that they can be used in
// per customer proof without having to rebuild the entire Merkle Tree
class MerkleTreeWitness extends MerkleWitnessWithSums(TREE_HEIGHT) { };
// for (let i = 0; i < TREE_NUM_OF_LEAFS; i++) {
for (let i = 0; i < 8; i++) {
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
    
    await fs.writeFile(
        "./generated_witnesses/witness_for_" + i + ".json", JSON.stringify(witnessJson)
    ).catch(err => {
        console.error('Error writing file:', err);
        process.exit(1);
    });
}

