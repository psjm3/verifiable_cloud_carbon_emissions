import { Field, Poseidon, Struct } from "o1js";
import { Invoice } from "./invoice.js";

// Normalise the random numbers so that each one is a fraction of 
// the target total. However, 100(%) would be too small for a million customers, 
// we are therefore using a big number 2^64 as the target total
export const CUSTOMER_SHARES_TOTAL = BigInt(2**64);

export const NUM_OF_VERIFIER = 1;

export class Customer extends Struct({
    customerShares: Field,
    nonce: Field,
    invoice: Invoice
}) {
    constructor(
        customerShares: Field,
        nonce: Field,
        invoice: Invoice
    ) {
        super({
            customerShares,
            nonce,
            invoice
        });
    }

    toJSON(): string {
        return JSON.stringify({
            "customerShares": this.customerShares.toJSON(),
            "nonce": this.nonce.toJSON(),
            "invoice": JSON.parse(this.invoice.toJSON())
        })
    }

    static fromJSON(json: any): Customer {
        return new Customer(
            Field(json.customerShares),
            Field(json.nonce),
            Invoice.fromJSON(json.invoice)
        );
    }

    hash(): Field {
        return Poseidon.hash([
            this.invoice.customerId, 
            this.invoice.resourcesCharges,
            this.invoice.timeFrom,
            this.invoice.timeTo,
            this.invoice.otherCharges,
            this.customerShares,
            this.nonce]);
            // Poseidon.hash([this.customerShares, this.nonce])]);
    }
}
