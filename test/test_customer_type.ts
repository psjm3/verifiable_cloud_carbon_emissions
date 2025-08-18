import * as crypto from "crypto";
import fs from 'fs/promises';
import { Field } from "o1js";
import { Invoice } from "../src/types/invoice.js";
import { Customer } from "../src/types/customer.js";

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
console.log(serialisedCust)

await fs.writeFile(
    "./test_customer.json", serialisedCust
).catch(err => {
    console.error('Error writing file:', err);
    process.exit(1);
});

const jsonFile = await fs.readFile(
    "./test_customer.json", 'utf8'
).catch(err => {
    console.error('Error reading file:', err);
    process.exit(1);
});

let deserialisedCust = Customer.fromJSON(JSON.parse(jsonFile));
console.log(
    deserialisedCust.customerShares.toString(), ' ',
    deserialisedCust.nonce.toString(), ' ',
    deserialisedCust.invoice.customerId.toString(), ' ', 
    deserialisedCust.invoice.resourcesCharges.toString(),
    deserialisedCust.hash().toString()
);

deserialisedCust.customerShares.assertEquals(Field(111));
deserialisedCust.nonce.assertEquals(nonce);
deserialisedCust.invoice.customerId.assertEquals(Field(222));
deserialisedCust.invoice.timeFrom.assertEquals(Field(333));
deserialisedCust.invoice.timeTo.assertEquals(Field(444));
deserialisedCust.invoice.resourcesCharges.assertEquals(Field(555));
deserialisedCust.invoice.otherCharges.assertEquals(Field(666));

deserialisedCust.hash().assertEquals(customer.hash());

await fs.rm("./test_customer.json")

