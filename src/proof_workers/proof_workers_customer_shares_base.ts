import cluster from "cluster";
import fs from 'fs';
import fsAsync from 'fs/promises';

import { BATCH_NUM_OF_CUSTOMERS, MerkleTreeWithSums } from "../types/merkle_tree.js";
import { verify } from "o1js";
import { customerSharesCircuit } from "../zkPrograms/zkprogram_customer_shares.js";
import { CustomerData } from "../data/data_customers.js";
import { Customer } from "../types/customer.js";
import { debugLog, log, logStreamStart, logStreamStop } from "../utils/util.js";

const path = './generated_logs';
if (!fs.existsSync(path)) {
    fsAsync.mkdir(
        path, { recursive: true }
    ).catch(err => {
        log(`ERROR: Proof_workers_customer_shares_base, Error creating directory for ${path}: ${err}\n`);
        process.exit(1);
    });
}

let startIdx = parseInt(process.argv[2]);
let numOfWorkers = parseInt(process.argv[3]);

const logFile = path + '/proof_workers_customer_shares_base.out';
logStreamStart(logFile);

const customerDataObj = new CustomerData();
let customerRecordsRaw = await fsAsync.readFile('./customer_records/customer.json', 'utf8');
let customerRecords = JSON.parse(customerRecordsRaw) as Customer[];

if (cluster.isPrimary) {
    log(`Proof_workers_customer_shares_base, primary_process_${process.pid}_is_running...\n`);

    for (let i = 0; i < numOfWorkers; i++) {
        cluster.fork({ "startIdx": startIdx });
        startIdx = startIdx + BATCH_NUM_OF_CUSTOMERS;
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal) {
            log(`ERROR: Proof_workers_customer_shares_base, worker ${worker.process.pid} was killed by signal ${signal}\n`);
        } else if (code != 0) {
            log(`ERROR: Proof_workers_customer_shares_base, worker ${worker.process.pid} exited with error code ${code}\n`);
        } else {
            debugLog(`Proof_workers_customer_shares_base, worker ${worker.process.pid} exited\n`);
        }
    });
} else {
    const proofWorkersTimeStart = performance.now();

    let batchIdx = parseInt(process.env.startIdx)
    const recordsInSubTree: Customer[] = customerRecords.slice(batchIdx, batchIdx + BATCH_NUM_OF_CUSTOMERS);
    const subTree: MerkleTreeWithSums = customerDataObj.generateBatchedSubTree(recordsInSubTree);
    
    debugLog(`Proof_workers_customer_shares_base, worker ${process.pid} started with batchIdx ${batchIdx}\n`);

    /***** Customer Shares Base (Leaf Nodes) Proofs *****/
    const compilationTimeStart = performance.now();
    const customerTreeCircuitVk = (await customerSharesCircuit.compile()).verificationKey;
    log(`Proof_workers_customer_shares_base, customer_shares_circuit_compilation, time, ${performance.now() - compilationTimeStart}\n`);

    let subsetToProve = customerRecords.slice(batchIdx, batchIdx + BATCH_NUM_OF_CUSTOMERS)
    let subtreeRootLevel = Math.ceil(Math.log2(BATCH_NUM_OF_CUSTOMERS));
    let subtreeRootIdx = BigInt(Math.floor(batchIdx / (2 ** subtreeRootLevel)));

    /***** BASE CIRCUIT *****/
    const baseProofTimeStart = performance.now();
    const { proof: baseProof } = await customerSharesCircuit.baseSumOfSharesProof(
        subTree.getRoot(),
        subsetToProve
    );
    log(`Proof_workers_customer_shares_base, one_base_proof, time, ${performance.now() - baseProofTimeStart}\n`);

    // sanity check that the generated proof can be verified before writing to disc.
    const validBaseProof = await verify(baseProof, customerTreeCircuitVk);
    debugLog(`Proof_workers_customer_shares_base, base customer ${subtreeRootIdx} checked out? ${validBaseProof}\n`);
    
    fsAsync.writeFile(
        "./generated_proofs/subtree_proof_" + subtreeRootLevel + "_" + subtreeRootIdx + ".json", JSON.stringify(baseProof.toJSON())
    ).then(() => {
        log(`Proof_workers_customer_shares_base, Ends, worker_pid, ${process.pid}, start_idx, ${batchIdx}, time, ${performance.now() - proofWorkersTimeStart}, cpuUsage, ${process.cpuUsage().user}, memUsage, ${process.memoryUsage().rss}\n`);
        logStreamStop(path);
        process.exit(0);
    }).catch(err => {
        log(`ERROR: Proof_workers_customer_shares_base, error writing to ./generated_proofs/subtree_proof_${subtreeRootLevel}_${subtreeRootIdx}.json: ${err}\n`);
        logStreamStop(path);
        process.exit(1);
    });
}
