# Verifiable Carbon Emissions Experiment using o1js

## Directory Structure
The test directory contains standalone programs that validate the test data used as different circuit inputs.

The src directory contains the main code for the three circuits. It is further divided into sub-folders:
- data: Generate test data used as circuit input, namely customer records, carbon intensity factors, smart meter readings and public keys used for verifying the digital signatures on intensity and meter readings.
- proof_workers: Standalone programs that are executed as child processes to run the circuits.
- provers: Main programs simulate the tasks what the prover needs to run: the total emisisons circuit first, followed by the customer shares circuit and finally the per-customer emissions circuit to generate the final proof for each customer.
- types: Data types for the test data.
- utils: Useful utitlity functions that make it easier for coding.
- zkPrograms: Circuits for each proof. They are written and structured using o1js' ZkProgram API and recursion proof framework.
- verifier_main.ts: Not a directory, this is the main program a verifier (a customer) runs to verify the generated carbon emisisons proof.

## Runtime set up
### nvm
If your environment does not have [nvm](https://github.com/nvm-sh/nvm) already installed, first install nvm (current latest version is v0.40.3, which can be replaced with a more up-to-date version)
```shell
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```
(or)
```
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```
Follow the last step provided at the end of the installation to start using nvm.

To verify that nvm has been installed:
```shell
command -v nvm
```

### node and npm
Once you have nvm installed you can then install the Nodejs and typescript runtime by installing node and npm:
```shell
nvm install node
npm install typescript --save-dev
```

### Node.js modules required
```shell
npm install tsx
npm install o1js
npm install json-with-bigint
```

## Run Provers
Before running any of the provers, review the following constants first:

- The timestamps for the reporting period and invoices. They are defined in src/data/data_timestamps.ts. Please note that the carbon intensity factors are obtained using the [National Energy System Operator (NESO)'s API](https://carbon-intensity.github.io/api-definitions/#get-intensity-from-to), they seem to only provide data dated no more than 60 days from current date. Also, the data set could be incomplete between the specified date range. In our experiment we found that, for example, between the 07-15 and 08-14 30 days period, there were a few half-hourly factors missing. Therefore in `src/provers/prover_total_emissions.ts`, the generated intensity factors are serialised if a new set is needed, or it would skip the API call to pull the data and simply read from a previously serialised set of signed factors. To get a fresh set of intensity factors, set the `REGENERATE_INTENSITY` flag to true, or to skip the API call set it to false.

- The number of customer records you want to process. This determines the size of the Merkle Tree (i.e. number of leaf nodes) that is used in the customer shares proof. The number of customers, `NUM_OF_CUSTOMERS`, is defined in `src/types/o1js_merkke_tree.ts`. Please note that it might be easier to set the size to be a power of 2. This is because the Merkle Tree has to be a complete balanced tree, if the number of leaf nodes is not a power of 2, the code would fill the missing nodes with empty customer records to make it complete.

- The batch size of customer records/Merkle tree leafs, `BATCH_NUM_OF_CUSTOMERS`, for the customer shares circuit is defined in `src/types/o1js_merkke_tree.ts`. This determines how many leaf nodes can be processed in a single proof. Note that the maximum batch size is 128 given the maximum number of constraints is limited by o1js.

- The number of verifier, `NUM_OF_VERIFIER`, is defined in `src/types/customer.ts'. This determines how many per-customer emissions proofs are generated and how many are verified by the verifier.

```shell
npm exec tsx src/provers/prover_main.ts
```
or if not using the utils.log() function to write the log messages to a file, this command could pipe all stdout and stderr to a file:
```shell
npm exec tsx src/provers/prover_main.ts 2>&1 | tee prover_main.txt
```

Each prover can be invoked directly and run standalone.

(To generate the total emissions proof only)
```shell
npm exec tsx src/provers/prover_total_emissions.ts
```
(To generate the customer shares proof only, it depends on a pre-existing total emissions proof output)
```shell
npm exec tsx src/provers/prover_customer_shares.ts
```

## Run Verifier
```shell
npm exec tsx src/verifier_main.ts
```
