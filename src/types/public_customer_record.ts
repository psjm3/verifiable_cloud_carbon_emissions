import { Field, PublicKey, Struct } from "o1js";
import { Invoice } from "./invoice.js";

export class PublicCustomerRecord extends Struct({
    customerInvoice: Invoice,     // Revealed to customer
    emissions: Field,             // Revealed to customer
    smartMeterCAPk: PublicKey,    // Revealed on transparency log
    intensityCAPk: PublicKey,     // Revealed on transparency log
    customerTreeRootHash: Field,  // Revealed on transparency log. Do not reveal node content other than the hash
    smartMeterPk: PublicKey,      // Revealed on transparency log
    gridOpeartorPk: PublicKey     // Revealed on transparency log
}){}