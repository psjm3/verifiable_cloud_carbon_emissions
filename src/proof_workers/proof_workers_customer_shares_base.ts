import cluster from "cluster";
import fs from 'fs';
import fsAsync from 'fs/promises';

import { BATCH_NUM_OF_CUSTOMERS, MerkleTreeWithSums } from "../types/merkle_tree.js";
import { verify } from "o1js";
import { customerSharesCircuit } from "../zkPrograms/zkprogram_customer_shares.js";
import { CustomerData } from "../data/data_customers.js";
import { Customer } from "../types/customer.js";
import { DEBUG } from "../utils/util.js";
import { createObjectCsvWriter } from "csv-writer";
import { CsvWriter } from "csv-writer/src/lib/csv-writer.js";
import { ObjectMap } from "csv-writer/src/lib/lang/object.js";

let startIdx = parseInt(process.argv[2]);
let numOfWorkers = parseInt(process.argv[3]);

const customerDataObj = new CustomerData();
let customerRecordsRaw = await fsAsync.readFile('./generated_customer_records/customer.json', 'utf8');
let customerRecords = JSON.parse(customerRecordsRaw) as Customer[];

if (cluster.isPrimary) {
    for (let i = 0; i < numOfWorkers; i++) {
        cluster.fork({ "startIdx": startIdx });
        startIdx = startIdx + BATCH_NUM_OF_CUSTOMERS;
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal) {
            console.log({ src: 'proof_workers_customer_shares_base', data: 'ERROR: worker ' + worker.process.pid + ' was killed by signal', value: signal, datatype: 'text' });
        } else if (code != 0) {
            console.log({ src: 'proof_workers_customer_shares_base', data: 'ERROR: worker ' + worker.process.pid + ' exited with error code', value: code, datatype: 'text' });
        } else {
            console.log({ src: 'proof_workers_customer_shares_base', data: 'worker ' + worker.process.pid + ' exited', value: "", datatype: 'text' });
        }
    });
} else {
    let batchIdx = parseInt(process.env.startIdx)

    const path = './generated_logs';
    if (!fs.existsSync(path)) {
        fsAsync.mkdir(
            path, { recursive: true }
        ).catch(err => {
            console.error(`ERROR: Proof_workers_customer_shares_base, Error creating directory for ${path}: ${err}\n`);
            process.exit(1);
        });
    }
    const logFile = path + '/proof_workers_customer_shares_base.out';
    let csvWriter: CsvWriter<ObjectMap<any>>;
    if (fs.existsSync(logFile)) {
        csvWriter = createObjectCsvWriter({
            append: true,
            path: logFile,
            header: [
                { id: 'src', title: 'src_file' },
                { id: 'data', title: 'data' },
                { id: 'value', title: 'value' },
                { id: 'datatype', title: 'data_type' },
            ]
        });
    } else {
        csvWriter = createObjectCsvWriter({
            path: logFile,
            header: [
                { id: 'src', title: 'src_file' },
                { id: 'data', title: 'data' },
                { id: 'value', title: 'value' },
                { id: 'datatype', title: 'data_type' },
            ]
        });
    }
    let logData = [];
    const proofWorkersTimeStart = performance.now();

    const recordsInSubTree: Customer[] = customerRecords.slice(batchIdx, batchIdx + BATCH_NUM_OF_CUSTOMERS);
    const subTree: MerkleTreeWithSums = customerDataObj.generateBatchedSubTree(recordsInSubTree);

    logData.push({ src: 'proof_workers_customer_shares_base', data: 'worker ' + process.pid + ' started from index ' + batchIdx, value: "", datatype: 'text' });

    /***** Customer Shares Base (Leaf Nodes) Proofs *****/
    const compilationTimeStart = performance.now();
    const customerTreeCircuitVk = (await customerSharesCircuit.compile()).verificationKey;
    logData.push({ src: 'proof_workers_customer_shares_base', data: 'customer shares circuit compilation - time taken', value: (performance.now() - compilationTimeStart), datatype: 'ms' });

    let subsetToProve = customerRecords.slice(batchIdx, batchIdx + BATCH_NUM_OF_CUSTOMERS)
    let subtreeRootLevel = Math.ceil(Math.log2(BATCH_NUM_OF_CUSTOMERS));
    let subtreeRootIdx = BigInt(Math.floor(batchIdx / (2 ** subtreeRootLevel)));

    /***** BASE CIRCUIT *****/
    const baseProofTimeStart = performance.now();
    const { proof: baseProof } = await customerSharesCircuit.baseSumOfSharesProof(
        subTree.getRoot(),
        subsetToProve
    );
    logData.push({ src: 'proof_workers_customer_shares_base', data: 'customer shares one BASE proof - time taken', value: (performance.now() - baseProofTimeStart), datatype: 'ms' });

    // sanity check that the generated proof can be verified before writing to disc.
    const validBaseProof = await verify(baseProof, customerTreeCircuitVk);
    if (DEBUG) {
        logData.push({ src: 'proof_workers_customer_shares_base', data: 'customer shares one BASE proof from index ' + batchIdx + ' verified?', value: validBaseProof, datatype: 'text' });
    }
    fsAsync.writeFile(
        "./generated_proofs/subtree_proof_" + subtreeRootLevel + "_" + subtreeRootIdx + ".json", JSON.stringify(baseProof.toJSON())
    ).then(() => {
        logData.push({ src: 'proof_workers_customer_shares_base', data: 'proof of one customer shares BASE batch from index ' + batchIdx + ' - time taken', value: (performance.now() - proofWorkersTimeStart), datatype: 'ms' })
        logData.push({ src: 'proof_workers_customer_shares_base', data: 'process - cpuUsage', value: (process.cpuUsage().user), datatype: 'us' })
        logData.push({ src: 'proof_workers_customer_shares_base', data: 'process - memUsage', value: process.memoryUsage().rss, datatype: 'bytes' })
    }).catch(err => {
        logData.push({ src: 'proof_workers_customer_shares_base', data: 'ERROR: error writing to ./generated_proofs/subtree_proof_' + subtreeRootLevel + '_' + subtreeRootIdx + '.json', value: err, datatype: 'text' })
        csvWriter.writeRecords(logData).then(() => console.log('proof_workers_customer_shares_base logs-writing to file completed'));
        process.exit(1);
    });
    // csvWriter.writeRecords(logData).then(() => console.log('proof_workers_customer_shares_base logs-writing to file completed'));
    await csvWriter.writeRecords(logData).then(() => console.log('proof_workers_customer_shares_base logs-writing to file completed'));
    process.exit(0);
}
