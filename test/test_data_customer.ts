import fs from 'fs';
import fsAsync from 'fs/promises';

import { Field } from 'o1js';
import { Customer, CUSTOMER_SHARES_TOTAL } from '../src/types/customer.js'
import { CustomerData } from '../src/data/data_customers.js';
import { NUM_OF_CUSTOMERS, TREE_HEIGHT, TREE_NUM_OF_LEAFS } from '../src/types/o1js_merkle_tree.js';
import { TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP } from '../src/data/data_timestamps.js';
import { log, logStreamStart, logStreamStop } from '../src/utils/util.js';

// SET NUM_OF_CUSTOMERS and BATCH_NUM_OF_CUSTOMERS for the Merkle tree on src/types/o1js_merkle_tree.ts
let path = './test_output'
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        console.error('Error creating directory for', path, err);
        process.exit(1);
    });
}
logStreamStart("./test_output/test_data_customer.out");

const customerDataObj = new CustomerData();

let records = await customerDataObj.generateCustomers(TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP);
log(`Number of customer records generated: ${records.length}`);

let customerRecordsRaw = await fsAsync.readFile('./customer_records/customer.json', 'utf8');
let customers = JSON.parse(customerRecordsRaw) as Customer[];

let sumOfShares = Field(0);
for (let i = 0; i < NUM_OF_CUSTOMERS; i++) {
    let customerJson = Customer.fromJSON(customers[i]);
    sumOfShares = sumOfShares.add(customerJson.customerShares);
}

sumOfShares.assertEquals(Field(CUSTOMER_SHARES_TOTAL));

let customerTree = customerDataObj.generateCustomerMerkleTree(customers);

let endIdx = TREE_NUM_OF_LEAFS;
let sumOfSharesFromTree = Field(0);
let sumOfResourceCostsFromTree = Field(0);
let sumOfOtherCostsFromTree = Field(0);

for (let level = 0; level < TREE_HEIGHT; level++) {
    for (let nodeIdx = 0; nodeIdx < endIdx; nodeIdx++) {
        let node = customerTree.getNode(level, BigInt(nodeIdx));

        if (level == 0) {
log(`
Node Idx: ${nodeIdx},
Shares: ${node.totalCustomerShares.toString()},
Resources sum: ${node.totalResourceCharges.toString()},
Other costs sum: ${node.totalOtherCharges.toString()}`);
            sumOfSharesFromTree = sumOfSharesFromTree.add(node.totalCustomerShares);
            sumOfResourceCostsFromTree = sumOfResourceCostsFromTree.add(node.totalResourceCharges);
            sumOfOtherCostsFromTree = sumOfOtherCostsFromTree.add(node.totalOtherCharges);
        }
        if (level == TREE_HEIGHT - 1 && nodeIdx == endIdx - 1) {
log(`
sum of shares: ${sumOfSharesFromTree.toString()}
sum of resources costs: ${sumOfResourceCostsFromTree.toString()}
sum of other costs: ${sumOfOtherCostsFromTree.toString()}
The last node's shares sum: ${node.totalCustomerShares.toString()}
The last node's resources sum: ${node.totalResourceCharges.toString()}
The last node's other costs sum: ${node.totalOtherCharges.toString()}
`);
            node.totalCustomerShares.assertEquals(sumOfSharesFromTree);
            node.totalResourceCharges.assertEquals(sumOfResourceCostsFromTree);
            node.totalOtherCharges.assertEquals(sumOfOtherCostsFromTree);
        }
    }
    endIdx = endIdx / 2;
}

logStreamStop("./test_output/test_data_customer.out");
