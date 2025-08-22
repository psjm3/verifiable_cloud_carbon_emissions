import { Field } from 'o1js';
import { Customer, CUSTOMER_SHARES_TOTAL } from '../src/types/customer.js'
import { CustomerData } from '../src/data/data_customers.js';
import { NUM_OF_CUSTOMERS, TREE_HEIGHT, TREE_NUM_OF_LEAFS } from '../src/types/o1js_merkle_tree.js';
import fs from 'fs/promises';
import { TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP } from '../src/data/data_timestamps.js';

const customerDataObj = new CustomerData();

let records = await customerDataObj.generateCustomers(TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP);
console.log("Number of customer records:", records.length);

let customerRecordsRaw = await fs.readFile('./customer_records/customer.json', 'utf8');
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

for (let level=0; level<TREE_HEIGHT; level++) {
    for (let nodeIdx=0; nodeIdx<endIdx; nodeIdx++) {
        let node = customerTree.getNode(level, BigInt(nodeIdx));
        console.log(
            "Level:", level, 
            "Node Idx:", nodeIdx, 
            "Shares:", node.totalCustomerShares.toString(),
            "Resources sum:", node.totalResourceCharges.toString(),
            "Other costs sum:", node.totalOtherCharges.toString()
        );
        if (level == 0) {
            sumOfSharesFromTree = sumOfSharesFromTree.add(node.totalCustomerShares);
            sumOfResourceCostsFromTree = sumOfResourceCostsFromTree.add(node.totalResourceCharges);
            sumOfOtherCostsFromTree = sumOfOtherCostsFromTree.add(node.totalOtherCharges);
        }
        if (level == TREE_HEIGHT - 1 && nodeIdx == endIdx -1) {
            console.log("Last node, sum of shares:", sumOfSharesFromTree.toString());
            console.log("Last node, sum of resources costs:", sumOfResourceCostsFromTree.toString());
            console.log("Last node, sum of other costs:", sumOfOtherCostsFromTree.toString());
            console.log("This node's shares sum:", node.totalCustomerShares.toString());
            console.log("This node's resources sum:", node.totalResourceCharges.toString());
            console.log("This node's other costs sum:", node.totalOtherCharges.toString());
            node.totalCustomerShares.assertEquals(sumOfSharesFromTree);
            node.totalResourceCharges.assertEquals(sumOfResourceCostsFromTree);
            node.totalOtherCharges.assertEquals(sumOfOtherCostsFromTree);
        }
    }
    endIdx = endIdx / 2;
}
