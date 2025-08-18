// per customer invoice for their usage of 30 days
// ratio between invoice value and emissions should all be within bounds (porportion to profits)

import { Field, Struct } from "o1js";

export class Invoice extends Struct({
    customerId: Field,
    timeFrom: Field,
    timeTo: Field,
    resourcesCharges: Field, // based on usage
    otherCharges: Field,
}) {

    // Assuming data centre power consumption is 100MW and wholesale electtricity price is $40/MWh, then 
    // Data centre pays: $4000 per hour = $2,880,000 per 30 days, we assume that the data centre's revenue per 30 days is ~ $10,000,000 = 1000,000,000 = 2^30 cents
    // We are using 2^64 as the total number of shares across all customers
    // so the absolute ratio of shares per cent = 2^34 share/cent
    // Therefore a reasonable bounds for the ratio would be 2^33 as the lower and 2^35 as the upper bound.

    // If we assume that the data centre has a million customers, then each customer pays ~$10 per 30 days.

    // We want to exclude the negligble shares/cost ratio, so we say customers who pay less than
    // $0.64 (¢2^6) and (honest data) 2^40 shares.
    // i.e. exclude customers' share that is 10,000,000th of the total
    static resourcesCostsLowerBoundThreshold = Field(2**6); // US cent
    static customerShareLowerBoundThreshold = Field(2**40);

    static acceptableLowerBound = Field((2**23)); // shares per US cent
    static acceptableUpperBound = Field((2**25)); // shares per US cent

    toJSON(): string {
        return JSON.stringify({
            "customerId": this.customerId.toJSON(),
            "timeFrom": this.timeFrom.toJSON(),
            "timeTo": this.timeTo.toJSON(),
            "resourcesCharges": this.resourcesCharges.toJSON(),
            "otherCharges": this.otherCharges.toJSON()
        })
    }

    static fromJSON(json: any): Invoice {
        return new Invoice({
            customerId: Field(json.customerId),
            timeFrom: Field(json.timeFrom),
            timeTo: Field(json.timeTo),
            resourcesCharges: Field(json.resourcesCharges),
            otherCharges: Field(json.otherCharges)
         });
    }
}