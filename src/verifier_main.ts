import fs from 'fs';
import fsAsync from 'fs/promises';

import {
    Bool,
    Field,
    PublicKey,
    verify
} from 'o1js';
import { JSONParse } from 'json-with-bigint';
import { strict as assert } from 'assert'
import { totalEmissionsCircuit } from './zkPrograms/zkprogram_total_emissions.js';
import { customerSharesCircuit } from './zkPrograms/zkprogram_customer_shares.js';
import { perCustomerEmissionsCircuit } from './zkPrograms/zkprogram_per_customer_proof.js';
import { CUSTOMER_SHARES_TOTAL, NUM_OF_VERIFIER } from './types/customer.js';
import { log, logStreamStart, logStreamStop } from './utils/util.js';

// TODO: create a lookup map
// publicInput indices:
    // 0: customerId
    // 1: timeFrom
    // 2: timeTo
    // 3: resourcesCharges
    // 4: otherCharges
    // 5: emissions
    // 6, 7: smartMeterCAPk: PublicKey
    // 8, 9: intensityCAPk: PublicKey
    // 10: customerTreeRootHash
    // 11, 12: smartMeterPk
    // 13, 14: gridOpeartorPk

/****************************/
/***** Public Witnesses *****/
/****************************/
const path = './generated_logs';
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        log(`ERROR: Verifier_main, Error creating directory for ${path}: ${err}\n`);
        process.exit(1);
    });
}
const logFile = path + '/verifier_main.out';
logStreamStart(logFile);

log(`Verifier_main, Starts\n`);
const verifierTimeStart = performance.now();

const customerIds: Field[] = [Field(0), Field(1), Field(2), Field(3), Field(4), Field(5), Field(6)];
const smartMeterCAPkRaw = fs.readFileSync('./generated_public_keys/pk_CA_meter.json', 'utf8');
const intensityCAPkRaw = fs.readFileSync('./generated_public_keys/pk_CA_grid_operator.json', 'utf8');
const meterPkRaw = fs.readFileSync('./generated_public_keys/meter_pk.json', 'utf8');
const gridOperatorPkRaw = fs.readFileSync('./generated_public_keys/grid_operator_pk.json', 'utf8');

const smartMeterCAPk = PublicKey.fromJSON(smartMeterCAPkRaw);
const intensityCAPk = PublicKey.fromJSON(intensityCAPkRaw);
const meterPk = PublicKey.fromJSON(meterPkRaw);
const gridOperatorPk = PublicKey.fromJSON(gridOperatorPkRaw);

const customerEmissionsData = fs.readFileSync("customer_records/customer_emissions.json", 'utf8');
const customerEmissionsJson = JSONParse(customerEmissionsData);

// The emissions were inflated to the sum of 2^64, to get the read emissions figures in gCO2e, 
// they need to be divided by 2^64.
let realCustomerEmissions = [];
for (let i=0; i<customerEmissionsJson.length; i++) {
    realCustomerEmissions.push(customerEmissionsJson[i] / CUSTOMER_SHARES_TOTAL);
}

// I think that the verifier needs to generate the verification key themselves, otherwise the prover
// could provide an arbitrary circuit and proof and it will be checked out!
// const verificationKeyData = fs.readFileSync('verification_key.txt');
const compileTotalEmissions = performance.now();
const totalEmissionsVk = (await totalEmissionsCircuit.compile()).verificationKey;
log(`Verifier_main, compilation_total_emissions, time, ${performance.now() - compileTotalEmissions}\n`);

const compileCustomerShares = performance.now();
const customerTreeCircuitVk = (await customerSharesCircuit.compile()).verificationKey;
log(`Verifier_main, compilation_customer_shares, time, ${performance.now() - compileCustomerShares}\n`);

const compilePerCustomer = performance.now();
const perCustomerProofVk = (await perCustomerEmissionsCircuit.compile()).verificationKey;
log(`Verifier_main, compilation_per_customer_emissions, time, ${performance.now() - compilePerCustomer}\n`);

for (let i = 0; i < NUM_OF_VERIFIER; i++) {
    const proofData = fs.readFileSync("emissions_proof_" + customerIds[i] + ".json", 'utf8');
    const proofJson = await JSON.parse(proofData);

    assert.equal(customerIds[i].toString(), proofJson["publicInput"][0]);

    // Verify that the revealed CA pks from the prover's output are the same as what are disclosed, 
    // maybe by asking the certificate authority or they might be public knowledge already.
    assert.equal(smartMeterCAPk.x.toJSON(), proofJson["publicInput"][6]);
    smartMeterCAPk.isOdd.assertEquals(Bool(proofJson["publicInput"][7]));
    
    assert.equal(intensityCAPk.x.toJSON(), proofJson["publicInput"][8]);
    intensityCAPk.isOdd.assertEquals(Bool(proofJson["publicInput"][9]));

    assert.equal(meterPk.x.toJSON(), proofJson["publicInput"][11]);
    meterPk.isOdd.assertEquals(Bool(proofJson["publicInput"][12]));

    assert.equal(gridOperatorPk.x.toJSON(), proofJson["publicInput"][13]);
    gridOperatorPk.isOdd.assertEquals(Bool(proofJson["publicInput"][14]));

    const emissions_in_gco2e = BigInt(proofJson["publicOutput"][0]) / CUSTOMER_SHARES_TOTAL;
    assert.equal(realCustomerEmissions[i], emissions_in_gco2e);

    const verifyOneCustomer = performance.now();
    let cpuStart = process.cpuUsage();
    const ok = await verify(proofJson, perCustomerProofVk);
    log(`Verifier_main, one_customer, time, ${performance.now() - verifyOneCustomer}, cpuUsage, ${process.cpuUsage(cpuStart).user}, memUsage, ${process.memoryUsage().rss}\n`);
    assert(ok);
    // Sign the tree root hash using a simulated financial audior key and verify it here.
}
log(`Verifier_main, Ends, time, ${performance.now() - verifierTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
logStreamStop(logFile);
