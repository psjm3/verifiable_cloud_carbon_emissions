import fs from 'fs';
import fsAsync from 'fs/promises';

import { assert, Field, Poseidon } from 'o1js';
import { Customer, CUSTOMER_SHARES_TOTAL } from '../src/types/customer.js'
import { CustomerData } from '../src/data/data_customers.js';
import { NUM_OF_CUSTOMERS, TREE_HEIGHT, TREE_NUM_OF_LEAFS } from '../src/types/merkle_tree.js';
import { TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP } from '../src/data/data_timestamps.js';
import { log, logStreamStart, logStreamStop } from '../src/utils/util.js';
import { DatabaseSync } from 'node:sqlite';
import { Invoice } from '../src/types/invoice.js';

// SET NUM_OF_CUSTOMERS and BATCH_NUM_OF_CUSTOMERS for the Merkle tree on src/types/merkle_tree.ts
let path = './test_output'
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        console.error('Error creating directory for', path, err);
        process.exit(1);
    });
}
logStreamStart(path+"/test_data_customer.out");

const customerDataObj = new CustomerData();

let records = await customerDataObj.generateCustomers(TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP);
log(`Number of customer records generated: ${records.length}\n`);

let sumOfShares = Field(0);
for (let i = 0; i < NUM_OF_CUSTOMERS; i++) {
    let customerJson = Customer.fromJSON(records[i]);
    sumOfShares = sumOfShares.add(customerJson.customerShares);
}
sumOfShares.assertEquals(Field(CUSTOMER_SHARES_TOTAL));

// Customer records are serialised to a file, now read from the saved file to 
// test that we can get the same customer records back
let customerRecordsRaw = await fsAsync.readFile('./customer_records/customer.json', 'utf8');
let customers = [];
let customerJsons = JSON.parse(customerRecordsRaw) as Customer[];
customerJsons.forEach((json) => {
    customers.push(Customer.fromJSON(json));
})

// Test only a sample of customer records if NUM_OF_CUSTOMERS is too big
for (let i=0; i<NUM_OF_CUSTOMERS; i++) {
    records[i].hash().assertEquals(customers[i].hash());
    records[i].customerShares.assertEquals(customers[i].customerShares); 
    records[i].invoice.customerId.assertEquals(customers[i].invoice.customerId);
    records[i].invoice.resourcesCharges.assertEquals(customers[i].invoice.resourcesCharges);
    records[i].invoice.otherCharges.assertEquals(customers[i].invoice.otherCharges);
    records[i].invoice.timeFrom.assertEquals(customers[i].invoice.timeFrom);
    records[i].invoice.timeTo.assertEquals(customers[i].invoice.timeTo);
}

let customerTree = customerDataObj.generateCustomerMerkleTree(customers);

// Merkle tree nodes are stored in an SQLite db, so also testing that the stored 
// values are the same as the original.
const db = new DatabaseSync('./customer_merkle_tree.db');
let query = db.prepare('SELECT * from customer_merkle_tree where tree_level=0');
let queryResults = query.all();

let endIdx = TREE_NUM_OF_LEAFS;
let sumOfSharesFromTree = Field(0);
let sumOfResourceCostsFromTree = Field(0);
let sumOfOtherCostsFromTree = Field(0);

for (let level = 0; level < TREE_HEIGHT; level++) {
    for (let nodeIdx = 0; nodeIdx < endIdx; nodeIdx++) {
        let node = customerTree.getNode(level, BigInt(nodeIdx));

        if (level == 0) {
            sumOfSharesFromTree = sumOfSharesFromTree.add(node.totalCustomerShares);
            sumOfResourceCostsFromTree = sumOfResourceCostsFromTree.add(node.totalResourceCharges);
            sumOfOtherCostsFromTree = sumOfOtherCostsFromTree.add(node.totalOtherCharges);
        }
        if (level == TREE_HEIGHT - 1 && nodeIdx == endIdx - 1) {
            node.totalCustomerShares.assertEquals(sumOfSharesFromTree);
            node.totalResourceCharges.assertEquals(sumOfResourceCostsFromTree);
            node.totalOtherCharges.assertEquals(sumOfOtherCostsFromTree);
        }
    }
    endIdx = endIdx / 2;
}

queryResults.forEach((result, idx) => {
    records[idx].hash().assertEquals(Field(BigInt(result.hash.toString())));
    records[idx].customerShares.assertEquals(Field(BigInt(result.totalCustomerShares.toString())));
    records[idx].invoice.resourcesCharges.assertEquals(Field(BigInt(result.totalResourceCharges.toString())));
    records[idx].invoice.otherCharges.assertEquals(Field(BigInt(result.totalOtherCharges.toString())));
    Invoice.acceptableLowerBound.assertEquals(Field(BigInt(result.ratioLowerBound.toString())));
    Invoice.acceptableUpperBound.assertEquals(Field(BigInt(result.ratioUpperBound.toString())));
})

query = db.prepare('SELECT * from customer_merkle_tree where tree_level='+(TREE_HEIGHT-1));
queryResults = query.all();
assert(queryResults.length == 1);
Field(BigInt(queryResults[0].totalCustomerShares.toString())).assertEquals(sumOfSharesFromTree);
Field(BigInt(queryResults[0].totalResourceCharges.toString())).assertEquals(sumOfResourceCostsFromTree);
Field(BigInt(queryResults[0].totalOtherCharges.toString())).assertEquals(sumOfOtherCostsFromTree);

db.close();

logStreamStop("./test_output/test_data_customer.out");
