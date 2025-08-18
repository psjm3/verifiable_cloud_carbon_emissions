import { assert, Bool, Field, Poseidon, Provable, SelfProof, ZkProgram } from "o1js";
import { BATCH_NUM_OF_CUSTOMERS, MerkleTreeWithSums, NodeContent } from "../types/o1js_merkle_tree.js";
import { Customer, CUSTOMER_SHARES_TOTAL } from "../types/customer.js";
import { Invoice } from "../types/invoice.js";

export const customerSharesCircuit = ZkProgram({
    name: 'Proof of customer shares add up to an expected sum',
    publicInput: NodeContent,
    publicOutput: NodeContent,
    methods: {
        baseSumOfSharesProof: {
            privateInputs: [Provable.Array(Customer, BATCH_NUM_OF_CUSTOMERS)],
            async method(
                subTreeRoot: NodeContent,
                privateCustomerData: Customer[],
            ) {
                let customerTree = new MerkleTreeWithSums(Math.ceil(Math.log2(BATCH_NUM_OF_CUSTOMERS))+1);

                // Prove that all the customer records make up this tree and their shares add up to the total at the root
                for (let i=0; i<BATCH_NUM_OF_CUSTOMERS; i++) {
                    // First check that each customer share is within the valid range
                    //assert(privateCustomerData[i].consumptionPercent.greaterThanOrEqual(Field(0)));
                    assert(privateCustomerData[i].customerShares.lessThanOrEqual(Field(CUSTOMER_SHARES_TOTAL)));
                    // Also check that each cost is less than CUSTOMER_SHARES_TOTAL
                    // This is to ensure that the costs sum cannot go overflow in the field calculations
                    assert(privateCustomerData[i].invoice.resourcesCharges.lessThan(Field(CUSTOMER_SHARES_TOTAL)));
                    assert(privateCustomerData[i].invoice.otherCharges.lessThan(Field(CUSTOMER_SHARES_TOTAL)));

                    customerTree.setLeaf(BigInt(i), new NodeContent({
                        hash: Customer.fromJSON(privateCustomerData[i]).hash(), 
                        totalCustomerShares: Customer.fromJSON(privateCustomerData[i]).customerShares,
                        totalResourceCharges: Customer.fromJSON(privateCustomerData[i]).invoice.resourcesCharges,
                        totalOtherCharges: Customer.fromJSON(privateCustomerData[i]).invoice.otherCharges,
                        ratioLowerBound: subTreeRoot.ratioLowerBound,
                        ratioUpperBound: subTreeRoot.ratioUpperBound
                    }));

                    // check that the customer shares to billable costs ratio is within bounds
                    // lowerBound < (shares / cost) < upperBound ==> (lowerBound * cost) < shares < (upperBound * cost)
                    const ratioWithinRange = 
                        privateCustomerData[i].customerShares.greaterThanOrEqual(
                            privateCustomerData[i].invoice.resourcesCharges.mul(subTreeRoot.ratioLowerBound))
                        .and(
                        privateCustomerData[i].customerShares.lessThanOrEqual(
                            privateCustomerData[i].invoice.resourcesCharges.mul(subTreeRoot.ratioUpperBound))
                        );

                    // Provable.log("privateCustomerData[",i,"].customerShare:", privateCustomerData[i].customerShare);
                    // Provable.log("privateCustomerData[",i,"].Invoice.resourcesCharges.mul(subTreeRoot.ratioLowerBound):", privateCustomerData[i].Invoice.resourcesCharges.mul(subTreeRoot.ratioLowerBound));
                    // Provable.log("privateCustomerData[",i,"].Invoice.resourcesCharges.mul(subTreeRoot.ratioUpperBound):", privateCustomerData[i].Invoice.resourcesCharges.mul(subTreeRoot.ratioUpperBound));
                    // Provable.log("ratioWithinRange:", ratioWithinRange, "for privateCustomerData[i].customerShare");
                    assert(Provable.if(
                        privateCustomerData[i].invoice.resourcesCharges.lessThan(
                            Invoice.resourcesCostsLowerBoundThreshold).and(
                        privateCustomerData[i].customerShares.lessThan(
                            Invoice.customerShareLowerBoundThreshold)),
                        Bool(true),
                        ratioWithinRange
                        ));

                }
                // Prove that the private customer records provided by the prover 
                // form a merkle tree that has the same root hash as the public root hash
                subTreeRoot.hash.assertEquals(
                    customerTree.getRoot().hash,
                    "Base nodes do not match with their parent's hash on the merkle tree"
                );
                // Prove that sum of customer shares = sum on the root node of this subtree.
                subTreeRoot.totalResourceCharges.assertEquals(
                    customerTree.getRoot().totalResourceCharges,
                    "Base nodes do not match with their parent's sum on the merkle tree"
                );
                subTreeRoot.totalOtherCharges.assertEquals(
                    customerTree.getRoot().totalOtherCharges,
                    "Base nodes do not match with their parent's sum on the merkle tree"
                );

                return { publicOutput: subTreeRoot }
            }
        },
        stepOneSumOfSharesProof: {
            privateInputs: [ 
                SelfProof, 
                SelfProof,
            ],
            async method(
                publicTreeRoot: NodeContent,
                leftProof: SelfProof<NodeContent, NodeContent>,
                rightProof: SelfProof<NodeContent, NodeContent>,
            ){
                leftProof.verify();
                rightProof.verify();

                let calcHash = Poseidon.hash([leftProof.publicOutput.hash, rightProof.publicOutput.hash]);
                let calctotalCustomerShares = leftProof.publicOutput.totalCustomerShares.add(rightProof.publicOutput.totalCustomerShares);
                let calcResourcesCostsSum = leftProof.publicOutput.totalResourceCharges.add(rightProof.publicOutput.totalResourceCharges);
                let calctotalOtherCharges = leftProof.publicOutput.totalOtherCharges.add(rightProof.publicOutput.totalOtherCharges);

                publicTreeRoot.hash.assertEquals(
                    calcHash,
                    "Intermediate nodes do not match with their parent's hash on the merkle tree"
                );

                publicTreeRoot.totalCustomerShares.assertEquals(
                    calctotalCustomerShares,
                    "Intermediate nodes do not match with their parent's sum on the merkle tree"
                );
                publicTreeRoot.totalResourceCharges.assertEquals(
                    calcResourcesCostsSum,
                    "Intermediate nodes do not match with their parent's sum on the merkle tree"
                );           
                publicTreeRoot.totalOtherCharges.assertEquals(
                    calctotalOtherCharges,
                    "Intermediate nodes do not match with their parent's sum on the merkle tree"
                );
                return { publicOutput: publicTreeRoot }
            }
        }
    }
})
