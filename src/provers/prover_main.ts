import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import fsSync from 'fs/promises';
import { customerSharesCircuit } from '../zkPrograms/zkprogram_customer_shares.js';
import { totalEmissionsCircuit } from '../zkPrograms/zkprogram_total_emissions.js';
import { perCustomerEmissionsCircuit } from '../zkPrograms/zkprogram_per_customer_proof.js';

// Create artifacts directories
async function createArtifactFolders() {
    const paths = [
        './generated_proofs/',
        './generated_public_keys/',
        './generated_smart_meters/',
        './generated_witnesses/',
        './generated_intensity/',
        './generated_meter_readings/'
    ]

    paths.forEach((path) => {
        if (!fs.existsSync(path)) {
            fsSync.mkdir(
                path, { recursive: true }
            ).catch(err => {
                console.error('Error creating directory for', path, err);
                process.exit(1);
            });
        }
    })
}


const totalEmissionsProofsExec = promisify(exec);
async function totalEmissionsProofsRunner() {
    try {
        const { stdout, stderr } = await totalEmissionsProofsExec(
            'tsx ./src/provers/prover_total_emissions.ts', 
            {maxBuffer: 512 * 1024}
        );
        console.log('stdout:', stdout);
        console.log('stderr:', stderr);
    } catch (e) {
        console.error(e);
    }
}

const customerSharesProofsExec = promisify(exec);
async function customerSharesProofsRunner() {
    const { stdout, stderr } = await customerSharesProofsExec(
        'tsx ./src/provers/prover_customer_shares.ts',
        {maxBuffer: 2048 * 1024}
    );
    console.log('stdout:', stdout);
    console.log('stderr:', stderr);
}

const perCustomerProofsExec = promisify(exec);
async function perCustomerProofsRunner() {
    const { stdout, stderr } = await perCustomerProofsExec(
        'tsx ./src/provers/prover_per_customer_emissions.ts',
        {maxBuffer: 512 * 1024}
    );
    console.log('stdout:', stdout);
    console.log('stderr:', stderr);
}

console.time("OVERALL TIME TAKEN FOR FULL SETS OF PROOFS")
await createArtifactFolders();

console.log("Get number of constraints for each zkprogram...")

let totalEmissionsAnalysis = await totalEmissionsCircuit.analyzeMethods();
console.log("Number of constraints for total emissions base", totalEmissionsAnalysis.baseTotalEmissionsProof.rows);
console.log("Number of constraints for total emissions rec", totalEmissionsAnalysis.stepTotalEmissionsProof.rows);

let customerSharesAnalysis = await customerSharesCircuit.analyzeMethods();
console.log("Number of constraints for customer shares base", customerSharesAnalysis.baseSumOfSharesProof.rows);
console.log("Number of constraints for customer shares rec", customerSharesAnalysis.stepOneSumOfSharesProof.rows);

let perCustomerEmissionssAnalysis = await perCustomerEmissionsCircuit.analyzeMethods();
console.log("Number of constraints for per customer emissions", perCustomerEmissionssAnalysis.emissionsProof.rows);

console.log("Running total emissions proof...")
console.time("OVERALL TIME TAKEN FOR GENERATING TOTAL EMISSIONS PROOFS")
await totalEmissionsProofsRunner();
console.timeEnd("OVERALL TIME TAKEN FOR GENERATING TOTAL EMISSIONS PROOFS")

console.log("Running customer shares proof...")
console.time("OVERALL TIME TAKEN FOR GENERATING CUSTOMER SHARES PROOFS")
await customerSharesProofsRunner();
console.timeEnd("OVERALL TIME TAKEN FOR GENERATING CUSTOMER SHARES PROOFS")

console.log("Running per customer carbon emissions proof...")
console.time("OVERALL TIME TAKEN FOR GENERATING 8 CUSTOMER CARBON EMISSIONS PROOFS")
await perCustomerProofsRunner();
console.timeEnd("OVERALL TIME TAKEN FOR GENERATING 8 CUSTOMER CARBON EMISSIONS PROOFS")

console.timeEnd("OVERALL TIME TAKEN FOR FULL SETS OF PROOFS")

console.log("Prover Main", process.pid, "CPU usage:", process.cpuUsage());
