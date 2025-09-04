import fs from 'fs';
import fsAsync from 'fs/promises';

import { Field } from 'o1js';
import { Customer, CUSTOMER_SHARES_TOTAL } from '../src/types/customer.js'
import { CustomerData } from '../src/data/data_customers.js';
import { NUM_OF_CUSTOMERS, TREE_HEIGHT, TREE_NUM_OF_LEAFS } from '../src/types/merkle_tree.js';
import { TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP } from '../src/data/data_timestamps.js';
import { createObjectCsvWriter } from 'csv-writer';
import { CsvWriter } from 'csv-writer/src/lib/csv-writer.js';
import { ObjectMap } from 'csv-writer/src/lib/lang/object.js';

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
const logFile = path + '/test_data_customer.out';
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

const customerDataObj = new CustomerData();

let records = await customerDataObj.generateCustomers(TEST_PERIOD_FROM_TIMESTAMP, TEST_PERIOD_TO_TIMESTAMP, logData);
logData.push({ src: 'test_data_customer', data: 'Number of customer records generated', value: records.length, datatype: 'text' })

let customerRecordsRaw = await fsAsync.readFile('./generated_customer_records/customer.json', 'utf8');
let customers = JSON.parse(customerRecordsRaw) as Customer[];

let sumOfShares = Field(0);
for (let i = 0; i < NUM_OF_CUSTOMERS; i++) {
    let customerJson = Customer.fromJSON(customers[i]);
    sumOfShares = sumOfShares.add(customerJson.customerShares);
}

sumOfShares.assertEquals(Field(CUSTOMER_SHARES_TOTAL));

let customerTree = customerDataObj.generateCustomerMerkleTree(customers, logData);

let endIdx = TREE_NUM_OF_LEAFS;
let sumOfSharesFromTree = Field(0);
let sumOfResourceCostsFromTree = Field(0);
let sumOfOtherCostsFromTree = Field(0);

for (let level = 0; level < TREE_HEIGHT; level++) {
    for (let nodeIdx = 0; nodeIdx < endIdx; nodeIdx++) {
        let node = customerTree.getNode(level, BigInt(nodeIdx));

        if (level == 0) {
            logData.push({ src: 'test_data_customer', data: 'Node Idx', value: nodeIdx, datatype: 'number' })
            logData.push({ src: 'test_data_customer', data: 'Shares', value: node.totalCustomerShares.toString(), datatype: 'text' })
            logData.push({ src: 'test_data_customer', data: 'Resources sum', value: node.totalResourceCharges.toString(), datatype: 'text' })
            logData.push({ src: 'test_data_customer', data: 'Other costs sum', value: node.totalOtherCharges.toString(), datatype: 'text' })

            sumOfSharesFromTree = sumOfSharesFromTree.add(node.totalCustomerShares);
            sumOfResourceCostsFromTree = sumOfResourceCostsFromTree.add(node.totalResourceCharges);
            sumOfOtherCostsFromTree = sumOfOtherCostsFromTree.add(node.totalOtherCharges);
        }
        if (level == TREE_HEIGHT - 1 && nodeIdx == endIdx - 1) {
            logData.push({ src: 'test_data_customer', data: 'sum of share', value: sumOfSharesFromTree.toString(), datatype: 'text' })
            logData.push({ src: 'test_data_customer', data: 'sum of resources costs', value: sumOfResourceCostsFromTree.toString(), datatype: 'text' })
            logData.push({ src: 'test_data_customer', data: 'sum of other costs', value: sumOfOtherCostsFromTree.toString(), datatype: 'text' })
            logData.push({ src: 'test_data_customer', data: "The last node's shares sum", value: node.totalCustomerShares.toString(), datatype: 'text' })
            logData.push({ src: 'test_data_customer', data: "The last node's resources sum", value: node.totalResourceCharges.toString(), datatype: 'text' })
            logData.push({ src: 'test_data_customer', data: "The last node's other costs sum", value: node.totalOtherCharges.toString(), datatype: 'text' })

            node.totalCustomerShares.assertEquals(sumOfSharesFromTree);
            node.totalResourceCharges.assertEquals(sumOfResourceCostsFromTree);
            node.totalOtherCharges.assertEquals(sumOfOtherCostsFromTree);
        }
    }
    endIdx = endIdx / 2;
}

csvWriter.writeRecords(logData).then(() => console.log('test_data_customer logs-writing to file completed'));