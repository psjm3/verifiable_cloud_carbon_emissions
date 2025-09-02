import * as crypto from "crypto";
import fs from 'fs';
import fsAsync from 'fs/promises';

import { Field } from "o1js";
import { Invoice } from "../src/types/invoice.js";
import { Customer } from "../src/types/customer.js";
import { createObjectCsvWriter } from "csv-writer";
import { CsvWriter } from "csv-writer/src/lib/csv-writer.js";
import { ObjectMap } from "csv-writer/src/lib/lang/object.js";

let path = './test_output'
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        console.error('Error creating directory for', path, err);
        process.exit(1);
    });
}
const logFile = path + '/test_customer_types.out';
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

const randomBytesBuf = crypto.randomBytes(24);
const nonce = Field(BigInt('0x' + randomBytesBuf.toString('hex')));

let invoice = new Invoice({
    customerId: Field(222),
    timeFrom: Field(333),
    timeTo: Field(444),
    resourcesCharges: Field(555),
    otherCharges: Field(666)
})
let customer = new Customer(
    Field(111),
    nonce,
    invoice
);

let serialisedCust: string = customer.toJSON();
logData.push({ src: 'test_customer_type', data: 'Serialised sample customer record', value: serialisedCust, datatype: 'text' });

await fsAsync.writeFile(
    "./test_output/test_customer.json", serialisedCust
).catch(err => {
    logData.push({ src: 'test_customer_type', data: 'Error writing to ./test_output/test_customer.json', value: err, datatype: 'text' });
    process.exit(1);
});

const jsonFile = await fsAsync.readFile(
    "./test_output/test_customer.json", 'utf8'
).catch(err => {
    logData.push({ src: 'test_customer_type', data: 'Error reading ./test_output/test_customer.json', value: err, datatype: 'text' });
    process.exit(1);
});

let deserialisedCust = Customer.fromJSON(JSON.parse(jsonFile));
logData.push({ src: 'test_customer_type', data: 'Deserialised customer record - customerShares', value: deserialisedCust.customerShares.toString(), datatype: 'text' });
logData.push({ src: 'test_customer_type', data: 'Deserialised customer record - nonce', value: deserialisedCust.nonce.toString(), datatype: 'text' });
logData.push({ src: 'test_customer_type', data: 'Deserialised customer record - customerID', value: deserialisedCust.invoice.customerId.toString(), datatype: 'text' });
logData.push({ src: 'test_customer_type', data: 'Deserialised customer record - timeFrom', value: deserialisedCust.invoice.timeFrom.toString(), datatype: 'text' });
logData.push({ src: 'test_customer_type', data: 'Deserialised customer record - timeTo', value: deserialisedCust.invoice.timeTo.toString(), datatype: 'text' });
logData.push({ src: 'test_customer_type', data: 'Deserialised customer record - resourcesCharges', value: deserialisedCust.invoice.resourcesCharges.toString(), datatype: 'text' });
logData.push({ src: 'test_customer_type', data: 'Deserialised customer record - otherCharges', value: deserialisedCust.invoice.otherCharges.toString(), datatype: 'text' });
logData.push({ src: 'test_customer_type', data: 'Deserialised customer record - hash', value: deserialisedCust.hash().toString(), datatype: 'text' });

deserialisedCust.hash().assertEquals(customer.hash());
deserialisedCust.customerShares.assertEquals(customer.customerShares);
deserialisedCust.nonce.assertEquals(nonce);
deserialisedCust.invoice.customerId.assertEquals(customer.invoice.customerId);
deserialisedCust.invoice.timeFrom.assertEquals(customer.invoice.timeFrom);
deserialisedCust.invoice.timeTo.assertEquals(customer.invoice.timeTo);
deserialisedCust.invoice.resourcesCharges.assertEquals(customer.invoice.resourcesCharges);
deserialisedCust.invoice.otherCharges.assertEquals(customer.invoice.otherCharges);

await fsAsync.rm("./test_output/test_customer.json");

csvWriter.writeRecords(logData).then(() => console.log('test_customer_type logs-writing to file completed'));
