// Generate test data as customer records and create a Merkle Tree using the randomly 
// generated data. Also generate random allocation of carbon emissions to each customer.
import * as crypto from "crypto";
import fs from 'fs';
import fsSync from 'fs/promises';
import { Field } from "o1js";
import { BATCH_NUM_OF_CUSTOMERS, MerkleTreeWithSums, NodeContent, NUM_OF_CUSTOMERS, TREE_HEIGHT, TREE_NUM_OF_LEAFS } from "../types/o1js_merkle_tree.js";
import { Customer, CUSTOMER_SHARES_TOTAL } from "../types/customer.js";
import { Invoice } from "../types/invoice.js";

export class CustomerData {
    // A convenient function to randomly create consumption percent figures for a set number of customers.
    // In reality the customer ids are pre-assigned to each customer, here we can simply use the incremental
    // index as the customer ids.
    // Each customer is assigned a secure nonce to generate the hash on each node on the Merkle Tree
    async generateCustomers(reportingPeriodFrom: number, reportingPeriodTo: number): Promise<Customer[]> {
        // Construct the set of customer records and serialise them to disc
        // In real life this would come from an internally managed database.
        let path = './customer_records/';

        if (!fs.existsSync(path)) {
            await fsSync.mkdir(
                path, { recursive: true }
            ).catch(err => {
                console.error('Error creating directory for', path, err);
                process.exit(1);
            });
        }
        await fsSync.writeFile(
            "./customer_records/customer.json", "["
        ).catch(err => {
            console.error('Error writing file:', err);
            process.exit(1);
        });

        let customer: Customer[] = [];

        // Generate random values between 2^40 and 2^48 (max of crypto.randomInt) for each customer share
        // Then allocate each share proportion to the random numbers that would add to the 
        // target total: sum of all (random * (target total))/sum of randoms = target total
        let randomShares: BigInt[] = [];
        let sumOfRandomShares = 0n;
        for (let i = 0; i < NUM_OF_CUSTOMERS; i++) {
            randomShares[i] = BigInt((crypto.randomInt((2**40), (2**48))));
            sumOfRandomShares += randomShares[i].valueOf();
        }

        let customerSharesAllocation: BigInt[] = [];
        let sumOfAllocatedShares = 0n;

        // We also want to generate random resource utilisation cost for each customer based on the
        // restriction that the ratio of customer emissions to cost is between a lower and a upper bound.
        let resourcesChargesAllocation: Field[] = [];

        for (let i = 0; i < NUM_OF_CUSTOMERS; i++) {
            let normalisedShare: BigInt = (randomShares[i].valueOf() * CUSTOMER_SHARES_TOTAL.valueOf()) / sumOfRandomShares.valueOf();
            customerSharesAllocation[i] = normalisedShare;
            sumOfAllocatedShares += customerSharesAllocation[i].valueOf();

            // Use the acceptable ratio to generate the resources utilisaiton cost for each customer
            // ratio = emission / cost
            // emission = total emissions * customer share
            // lower < ratio < upper ==> lower < (total emissions * customer share)/cost < upper
            // lower * cost < (total emissions * customer share) < upper * cost
            // cost > (total emissions * customer share)/lower and cost < (total emissions * customer share)/upper
            let lowerCostBound = normalisedShare.valueOf() / Invoice.acceptableUpperBound.toBigInt();
            let upperCostBound = normalisedShare.valueOf() / Invoice.acceptableLowerBound.toBigInt();

            let resourcesCharges = crypto.randomInt(
                Math.ceil(Number(lowerCostBound)),
                Math.floor(Number(upperCostBound)));
            resourcesChargesAllocation.push(Field(resourcesCharges));
        }

        console.log('Sum of normalised customer shares:', sumOfAllocatedShares);

        // Due to rounding discrepencies, the sum is unlikely to be exactly the same as the target total,
        // so we are alter the last generated share to make the total.
        // TODO: I wonder if in reality if there is a margin of error, that the total shares do not always add up
        // exactly to the target total anyway, and therefore the check should be against bounds instead of an exact number.
        if (sumOfAllocatedShares != CUSTOMER_SHARES_TOTAL) {
            let diff = CUSTOMER_SHARES_TOTAL - sumOfAllocatedShares;
            customerSharesAllocation[NUM_OF_CUSTOMERS - 1] = customerSharesAllocation[NUM_OF_CUSTOMERS - 1].valueOf() + diff.valueOf();
        }

        // These should be the same as the period used to generate the meter readings/intensity proofs
        // When a time is used as the "from" timestamp as the input for the carbon intensity REST API, it is actually 
        // the "to" timestamp of the half hour reading. For example, if the "from" field is set to 2025-06-03T12:30Z 
        // and the "to" field is set to 2025-06-03T13:00Z, the API actually returns two readings, one from 12:00 to 12:30
        // and one from 12:30 to 13:00.
        // Therefore the invoice period needs to be adjusted to be half an hour before what is set on the "from" time field
        // for the intensity and meter readings.
        // const measuredPeriodFrom: number = new Date('2025-06-19T12:00Z').getTime();
        // const measuredPeriodTo: number = new Date('2025-07-19T12:00Z').getTime();

        for (let i = 0; i < NUM_OF_CUSTOMERS; i++) {
            // Moke nonce more secure by using a high number of bits, e.g. >128bits (16bytes)
            const randomBytesBuf = crypto.randomBytes(24);
            const nonce = Field(BigInt('0x' + randomBytesBuf.toString('hex')));

            let newInvoice = new Invoice({
                customerId: Field(i),
                timeFrom: Field(reportingPeriodFrom),
                timeTo: Field(reportingPeriodTo),
                resourcesCharges: resourcesChargesAllocation[i],
                otherCharges: Field(crypto.randomInt(500, 10000))
            });

            let newCust = new Customer(
                Field(customerSharesAllocation[i].valueOf()),
                nonce,
                newInvoice
            );
            customer[i] = newCust;

            let custRecord: string;
            if (i == 0) {
                custRecord = customer[i].toJSON();
            } else {
                custRecord = ", " + customer[i].toJSON();
            }
            await fsSync.appendFile(
                "./customer_records/customer.json", custRecord
            ).catch(err => {
                console.error('Error writing file:', err);
                process.exit(1);
            });
        }

        await fsSync.appendFile(
            "./customer_records/customer.json", "]"
        ).catch(err => {
            console.error('Error writing file:', err);
            process.exit(1);
        });

        return customer;
    }

    async generateCustomerEmisisons(totalEmissions: Field, customers: Customer[]): Promise<Field[]> {
        let customerEmissionsAllocation = [];
        let sumOfAllocatedEmissions = Field(0);

        // To avoid division and lose precision, the total emissions are inflated by CUSTOMER_SHARES_TOTAL, as each customer shares are a fraction of CUSTOMER_SHARES_TOTAL.
        // So to calcuate each customer emissions allocation, instead of (Total*shares)/shares_total, we simply use (Total*shares)
        // In the verification check we therefore need to inflate the Total emissions by CUSTOMER_SHARES_TOTAL before the asserting check against each customer share.
        for (let i = 0; i < NUM_OF_CUSTOMERS; i++) {
            customerEmissionsAllocation[i] = totalEmissions.mul(customers[i].customerShares);
            sumOfAllocatedEmissions = sumOfAllocatedEmissions.add(Field(customerEmissionsAllocation[i]));
        }

        let inflatedTotalEmissions = totalEmissions.toBigInt() * CUSTOMER_SHARES_TOTAL;
        if (sumOfAllocatedEmissions.toBigInt() != inflatedTotalEmissions) {
            let diff = inflatedTotalEmissions - sumOfAllocatedEmissions.toBigInt();
            console.log("diff:", diff.toString());
            console.log("last original customer emissions allocation:", customerEmissionsAllocation[NUM_OF_CUSTOMERS - 1].toString());
            customerEmissionsAllocation[NUM_OF_CUSTOMERS - 1] = customerEmissionsAllocation[NUM_OF_CUSTOMERS - 1].add(Field(diff));
            console.log("last new customer emissions allocation:", customerEmissionsAllocation[NUM_OF_CUSTOMERS - 1].toString());
        }
        console.log('Sum of the customer emissions:', sumOfAllocatedEmissions.toString());

        // Construct the set of customer records and serialise them to disc
        let path = './customer_records';

        if (!fs.existsSync(path)) {
            await fsSync.mkdir(
                path, { recursive: true }
            ).catch(err => {
                console.error('Error creating directory for', path, err);
                process.exit(1);
            });
        }
        await fsSync.writeFile(
            "./customer_records/customer_emissions.json", "["
        ).catch(err => {
            console.error('Error writing file:', err);
            process.exit(1);
        });

        for (let i = 0; i < NUM_OF_CUSTOMERS; i++) {
            let custEmissions: string;
            if (i == 0) {
                custEmissions = customerEmissionsAllocation[i].toJSON();
            } else {
                custEmissions = ", " + customerEmissionsAllocation[i].toJSON();
            }
            await fsSync.appendFile(
                "./customer_records/customer_emissions.json", custEmissions
            ).catch(err => {
                console.error('Error writing file:', err);
                process.exit(1);
            });
        }

        await fsSync.appendFile(
            "./customer_records/customer_emissions.json", "]"
        ).catch(err => {
            console.error('Error writing file:', err);
            process.exit(1);
        });

        return customerEmissionsAllocation;
    }

    generateCustomerMerkleTree(customerRecords: Customer[]): MerkleTreeWithSums {
        let tree = new MerkleTreeWithSums(TREE_HEIGHT);

        // The customer records are provided monthly
        console.time("propagate merkle tree with customer records")
        for (let i = 0; i < TREE_NUM_OF_LEAFS; i++) {
            let newInvoice: Invoice;
            let newCustomerRecord: Customer;
            // fill customer data with Field(0) for the missing leafs to make the tree complete
            if (i >= customerRecords.length) {
                newInvoice = new Invoice({
                    customerId: Field(0),
                    timeFrom: Field(0),
                    timeTo: Field(0),
                    resourcesCharges: Field(0),
                    otherCharges: Field(0)
                })
                newCustomerRecord = new Customer(
                    Field(0),
                    Field(0),
                    newInvoice
                );
                customerRecords[i] = newCustomerRecord;
            }
            // Customer records passed in could be serialised JSON objects read from disc
            // Need to deserialise them using fromJSON for each object before getting the data. 
            tree.setLeaf(BigInt(i), new NodeContent({
                hash: Customer.fromJSON(customerRecords[i]).hash(),
                totalCustomerShares: Customer.fromJSON(customerRecords[i]).customerShares,
                totalResourceCharges: Customer.fromJSON(customerRecords[i]).invoice.resourcesCharges,
                totalOtherCharges: Customer.fromJSON(customerRecords[i]).invoice.otherCharges,
                ratioLowerBound: Invoice.acceptableLowerBound,
                ratioUpperBound: Invoice.acceptableUpperBound
            }));
        }
        console.timeEnd("propagate merkle tree with customer records")
        return tree;
    }

    generateBatchedSubTree(customerRecords: Customer[]): MerkleTreeWithSums {
        let tree = new MerkleTreeWithSums(Math.ceil(Math.log2(BATCH_NUM_OF_CUSTOMERS)) + 1);

        // The customer records are provided monthly
        console.time("propagate batched subtree with customer records")
        for (let i = 0; i < BATCH_NUM_OF_CUSTOMERS; i++) {
            //console.log("Processing leaf ", i);
            let newInvoice: Invoice;
            let newCustomerRecord: Customer;
            //fill customer data with Field(0) for the missing leafs
            if (i >= customerRecords.length) {
                newInvoice = new Invoice({
                    customerId: Field(0),
                    timeFrom: Field(0),
                    timeTo: Field(0),
                    resourcesCharges: Field(0),
                    otherCharges: Field(0)
                })
                newCustomerRecord = new Customer(
                    Field(0),
                    Field(0),
                    newInvoice
                );
                customerRecords[i] = newCustomerRecord;
            }
            // Customer records passed in could be serialised JSON objects read from disc
            // Need to deserialise them using fromJSON for each object before getting the data. 
            tree.setLeaf(BigInt(i), new NodeContent({
                hash: Customer.fromJSON(customerRecords[i]).hash(),
                totalCustomerShares: Customer.fromJSON(customerRecords[i]).customerShares,
                totalResourceCharges: Customer.fromJSON(customerRecords[i]).invoice.resourcesCharges,
                totalOtherCharges: Customer.fromJSON(customerRecords[i]).invoice.otherCharges,
                ratioLowerBound: Invoice.acceptableLowerBound,
                ratioUpperBound: Invoice.acceptableUpperBound
            }));
        }
        console.timeEnd("propagate batched subtree with customer records")
        return tree;
    }
}