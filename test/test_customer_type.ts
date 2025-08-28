import * as crypto from "crypto";
import fs from 'fs';
import fsAsync from 'fs/promises';

import { Field } from "o1js";
import { Invoice } from "../src/types/invoice.js";
import { Customer } from "../src/types/customer.js";
import { log, logStreamStart } from "../src/utils/util.js";

let path = './test_output'
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        console.error('Error creating directory for', path, err);
        process.exit(1);
    });
}
logStreamStart("./test_output/test_customer_types.out");

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
log(`Serialised sample customer record: ${serialisedCust}`);

await fsAsync.writeFile(
    "./test_output/test_customer.json", serialisedCust
).catch(err => {
    console.error('Error writing file:', err);
    process.exit(1);
});

const jsonFile = await fsAsync.readFile(
    "./test_output/test_customer.json", 'utf8'
).catch(err => {
    console.error('Error reading file:', err);
    process.exit(1);
});

let deserialisedCust = Customer.fromJSON(JSON.parse(jsonFile));
log(`
Deserialised customer record - 
customerShares: ${deserialisedCust.customerShares.toString()}
nonce: ${deserialisedCust.nonce.toString()}
customerID: ${deserialisedCust.invoice.customerId.toString()} 
timeFrom: ${deserialisedCust.invoice.timeFrom.toString()}
timeTo: ${deserialisedCust.invoice.timeTo.toString()}
resourcesCharges: ${deserialisedCust.invoice.resourcesCharges.toString()}
otherCharges: ${deserialisedCust.invoice.otherCharges.toString()}
hash: ${deserialisedCust.hash().toString()}
`);
deserialisedCust.hash().assertEquals(customer.hash());
deserialisedCust.customerShares.assertEquals(customer.customerShares);
deserialisedCust.nonce.assertEquals(nonce);
deserialisedCust.invoice.customerId.assertEquals(customer.invoice.customerId);
deserialisedCust.invoice.timeFrom.assertEquals(customer.invoice.timeFrom);
deserialisedCust.invoice.timeTo.assertEquals(customer.invoice.timeTo);
deserialisedCust.invoice.resourcesCharges.assertEquals(customer.invoice.resourcesCharges);
deserialisedCust.invoice.otherCharges.assertEquals(customer.invoice.otherCharges);

await fsAsync.rm("./test_output/test_customer.json")

