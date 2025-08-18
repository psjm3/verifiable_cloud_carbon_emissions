import cluster from "cluster";
import { BATCH_NUM_OF_CUSTOMERS, MerkleTreeWithSums } from "../types/o1js_merkle_tree.js";
import { verify } from "o1js";
import fs from 'fs/promises';
import { customerSharesCircuit } from "../zkPrograms/zkprogram_customer_shares.js";
import { CustomerData } from "../data/data_customers.js";
import { Customer } from "../types/customer.js";

const customerDataObj = new CustomerData();
let customerRecordsRaw = await fs.readFile('./customer_records/customer.json', 'utf8');
let customerRecords = JSON.parse(customerRecordsRaw) as Customer[];

if (cluster.isPrimary) {
    console.log('Primary', process.pid, 'is running');

    let startIdx = parseInt(process.argv[2]);
    let numOfWorkers = parseInt(process.argv[3]);

    console.log("Starting workers with startIdx:", startIdx, "numOfWorkers:", numOfWorkers);

    for (let i = 0; i < numOfWorkers; i++) {
        cluster.fork({ "startIdx": startIdx });
        startIdx = startIdx + BATCH_NUM_OF_CUSTOMERS;
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal) {
            console.log('worker', worker.process.pid, 'was killed by signal', signal);
        } else if (code != 0) {
            console.log('worker', worker.process.pid, 'exited with error code', code);
        } else {
            console.log('worker', worker.process.pid, 'exited');
        }
    });
} else {
    let batchIdx = parseInt(process.env.startIdx)
    const recordsInSubTree: Customer[] = customerRecords.slice(batchIdx, batchIdx + BATCH_NUM_OF_CUSTOMERS);
    const subTree: MerkleTreeWithSums = customerDataObj.generateBatchedSubTree(recordsInSubTree);

    console.log(
        'Worker', process.pid, 
        "batchIdx: ", batchIdx,
        "tree root hash:", subTree.getRoot().hash.toString(), "consumption shares sum:", subTree.getRoot().totalCustomerShares.toString());

    /***** Customer Shares Base (Leaf Nodes) Proofs *****/
    console.log("Compiling Customer Shares Circuit...");
    console.time("compileCustomerSharesProof");
    const customerTreeCircuitVk = (await customerSharesCircuit.compile()).verificationKey;
    console.timeEnd("compileCustomerSharesProof")

    let subsetToProve = customerRecords.slice(batchIdx, batchIdx + BATCH_NUM_OF_CUSTOMERS)
    //console.log("How many records to pass to the base proof?", subsetToProve.length);
    let subtreeRootLevel = Math.ceil(Math.log2(BATCH_NUM_OF_CUSTOMERS));
    // console.log('pid:', process.pid, 'subtreeRootLevel:', subtreeRootLevel);
    let subtreeRootIdx = BigInt(Math.floor(batchIdx / (2 ** subtreeRootLevel)));
    // console.log('pid', process.pid, 'subtreeRootIdx:', subtreeRootIdx);
    const { proof: baseProof } = await customerSharesCircuit.baseSumOfSharesProof(
        subTree.getRoot(),
        subsetToProve
    );
    // console.log("Subtree from worker", process.pid, "has hash:", baseProof.publicOutput.hash.toString(), "consumption shares sum:", baseProof.publicOutput.totalCustomerShares.toString());

    // sanity check that the generated proof can be verified before writing to disc.
    const validBaseProof = await verify(baseProof, customerTreeCircuitVk);
    console.log('BASE customer', subtreeRootIdx, 'checked out?', validBaseProof);
    
    fs.writeFile(
        "./generated_proofs/subtree_proof_" + subtreeRootLevel + "_" + subtreeRootIdx + ".json", JSON.stringify(baseProof.toJSON())
    ).then(() => {
        console.log("Customer Shares Base Worker", process.pid, "CPU usage:", process.cpuUsage());
        process.exit(0);
    }).catch(err => {
        console.error('Error writing file:', err);
        process.exit(1);
    });

}