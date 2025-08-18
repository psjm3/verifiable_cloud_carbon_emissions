/**
 * This file contains all code related to the [Merkle Tree](https://en.wikipedia.org/wiki/Merkle_tree) implementation available in o1js.
 */

import { Bool, Field, FlexibleProvable, Poseidon, Provable, Struct } from "o1js";
import { Invoice } from "./invoice.js";
export { Witness, MerkleTreeWithSums, MerkleWitnessWithSums, BaseMerkleWitnessWithSums };

// These constants need to be set here because the provable Merkle tree witness class requires to 
// have a fixed size array and the size depends on the tree height.
// Alternative is to move the Merkle tree witness definitions into the 
// customer data class.

export const NUM_OF_CUSTOMERS = 128;
export const BATCH_NUM_OF_CUSTOMERS =128;

// Number of proofs required is 2^treeHeight - 1, and we need to have all the proofs to the root.
// The nodes that haven't got any customer data will have to be constructed using dummy Field(0) 
// leafs so that we can calculate the hashes
// Therefore we need to fill the leafs up to the maximum number required to make the tree balanced
// with Field(0) as the content
// number of leafs L = (number of nodes N + 1)/2
// N = (2^tree height H) - 1
// therefore L = 2^(H-1)
export const TREE_HEIGHT = Math.ceil(Math.log2(NUM_OF_CUSTOMERS))+1;
export const TREE_NUM_OF_LEAFS = 2**(TREE_HEIGHT-1);

export class NodeContent extends Struct({
    hash: Field,
    totalCustomerShares: Field,
    totalResourceCharges: Field,
    totalOtherCharges: Field,
    ratioLowerBound: Field,
    ratioUpperBound: Field
}) { 
    toJSON(): string {
        return JSON.stringify({
            "hash": this.hash.toJSON(), 
            "totalCustomerShares": this.totalCustomerShares.toJSON(),
            "totalResourceCharges": this.totalResourceCharges.toJSON(),
            "totalOtherCharges": this.totalOtherCharges.toJSON(),
            "ratioLowerBound": this.ratioLowerBound.toJSON(),
            "ratioUpperBound": this.ratioUpperBound.toJSON()
        });
    }

    static fromJSON(json: any): NodeContent {
        super.fromJSON(json);
        return new NodeContent({
            hash: Field(json.hash),
            totalCustomerShares: Field(json.totalCustomerShares),
            totalResourceCharges: Field(json.totalResourceCharges),
            totalOtherCharges: Field(json.totalOtherCharges),
            ratioLowerBound: Field(json.ratioLowerBound),
            ratioUpperBound: Field(json.ratioUpperBound)
        });
    }

}

type Witness = { isLeft: boolean; sibling: NodeContent }[];

class MerkleTreeWithSums {
    nodes: Record<number, Record<string, NodeContent>> = {};
    zeroes: NodeContent[];

    /**
     * Creates a new, empty [Merkle Tree](https://en.wikipedia.org/wiki/Merkle_tree).
     * @param height The height of Merkle Tree.
     * @returns A new MerkleTree
     */
    constructor(public readonly height: number) {
        this.zeroes = new Array(height);
        this.zeroes[0] = new NodeContent({
            hash: Field(0),
            totalCustomerShares: Field(0),
            totalResourceCharges: Field(0),
            totalOtherCharges: Field(0),
            ratioLowerBound: Invoice.acceptableLowerBound, // set this to the known value for all the nodes
            ratioUpperBound: Invoice.acceptableUpperBound  // set this to the known value for all the nodes
        });
        for (let i = 1; i < height; i += 1) {
            this.zeroes[i] = new NodeContent({
                hash: Poseidon.hash([this.zeroes[i - 1].hash, this.zeroes[i - 1].hash]),
                totalCustomerShares: this.zeroes[i - 1].totalCustomerShares.add(this.zeroes[i - 1].totalCustomerShares),
                totalResourceCharges: this.zeroes[i-1].totalResourceCharges.add(this.zeroes[i-1].totalResourceCharges),
                totalOtherCharges: this.zeroes[i-1].totalOtherCharges.add(this.zeroes[i-1].totalOtherCharges),
                ratioLowerBound: Invoice.acceptableLowerBound, // set this to the known value for all the nodes
                ratioUpperBound: Invoice.acceptableUpperBound  // set this to the known value for all the nodes
            });
        }
    }

    clone(): MerkleTreeWithSums {
        let newTree = new MerkleTreeWithSums(this.height);
        for (let [level, nodes] of Object.entries(this.nodes)) {
            newTree.nodes[level as any as number] = { ...nodes };
        }
        return newTree;
    }

    /**
     * Returns a node which lives at a given index and level.
     * @param level Level of the node.
     * @param index Index of the node.
     * @returns The data of the node.
     */
    getNode(level: number, index: bigint): NodeContent {
        return this.nodes[level]?.[index.toString()] ?? this.zeroes[level];
    }

    /**
     * Returns a leaf at a given index.
     * @param index Index of the leaf.
     * @returns The data of the leaf.
     */
    getLeaf(index: bigint): NodeContent {
        return this.getNode(0, index);
    }

    /**
     * Returns the root of the [Merkle Tree](https://en.wikipedia.org/wiki/Merkle_tree).
     * @returns The root of the Merkle Tree.
     */
    getRoot(): NodeContent {
        return this.getNode(this.height - 1, 0n);
    }

    // TODO: this allows to set a node at an index larger than the size. OK?
    private setNode(level: number, index: bigint, value: NodeContent) {
        (this.nodes[level] ??= {})[index.toString()] = value;
    }

    // TODO: if this is passed an index bigger than the max, it will set a couple of out-of-bounds nodes but not affect the real Merkle root. OK?
    /**
     * Sets the value of a leaf node at a given index to a given value.
     * @param index Position of the leaf node.
     * @param leaf New value.
     */
    setLeaf(index: bigint, leaf: NodeContent) {
        if (index >= this.leafCount) {
            throw new Error(`index ${index} is out of range for ${this.leafCount} leaves.`);
        }
        this.setNode(0, index, leaf);
        //console.log("level: 0 index:", index, "hash:", leaf.hash.toString(), "sum:", leaf.sum.toString());

        let currIndex = index;
        for (let level = 1; level < this.height; level++) {
            currIndex /= 2n;

            const left = this.getNode(level - 1, currIndex * 2n);
            const right = this.getNode(level - 1, currIndex * 2n + 1n);

            // assert that the ration lower and upper bounds are the same

            left.ratioLowerBound.assertEquals(right.ratioLowerBound);
            left.ratioUpperBound.assertEquals(right.ratioUpperBound);


            //console.log("level:", level, "index:", currIndex, "hashing left:", left.hash.toString(), " right:", right.hash.toString());
            let newNode = new NodeContent({
                hash: Poseidon.hash([left.hash, right.hash]),
                totalCustomerShares: left.totalCustomerShares.add(right.totalCustomerShares),
                totalResourceCharges: left.totalResourceCharges.add(right.totalResourceCharges),
                totalOtherCharges: left.totalOtherCharges.add(right.totalOtherCharges),
                // The share to cost ratio lower and upper bounds are the same on all nodes
                ratioLowerBound: left.ratioLowerBound,
                ratioUpperBound: left.ratioUpperBound
            });

            //console.log("level:", level, "index:", currIndex, "hash:", newNode.hash.toString(), "sum:", newNode.sum.toString());

            this.setNode(level, currIndex, newNode);
        }
    }

    /**
     * Returns the witness (also known as [Merkle Proof or Merkle Witness](https://computersciencewiki.org/index.php/Merkle_proof)) for the leaf at the given index.
     * @param index Position of the leaf node.
     * @returns The witness that belongs to the leaf.
     */
    getWitness(index: bigint): Witness {
        if (index >= this.leafCount) {
            throw new Error(`index ${index} is out of range for ${this.leafCount} leaves.`);
        }
        const witness = [];
        for (let level = 0; level < this.height - 1; level++) {
            const isLeft = index % 2n === 0n;
            const sibling = this.getNode(level, isLeft ? index + 1n : index - 1n);
            witness.push({ isLeft, sibling });
            index /= 2n;
        }
        return witness;
    }

    // TODO: this will always return true if the merkle tree was constructed normally; seems to be only useful for testing. remove?
    /**
     * Checks if the witness that belongs to the leaf at the given index is a valid witness.
     * @param index Position of the leaf node.
     * @returns True if the witness for the leaf node is valid.
     */
    validate(index: bigint): boolean {
        const path = this.getWitness(index);
        let hash = this.getNode(0, index).hash;
        let totalCustomerShares = this.getNode(0, index).totalCustomerShares;
        let totalResourceCharges = this.getNode(0, index).totalResourceCharges;
        let totalOtherCharges = this.getNode(0, index).totalOtherCharges;
        let ratioLowerBound = this.getNode(0, index).ratioLowerBound;
        let ratioUpperBound = this.getNode(0, index).ratioUpperBound;

        for (const node of path) {
            hash = Poseidon.hash(node.isLeft ? [hash, node.sibling.hash] : [node.sibling.hash, hash]);
            totalCustomerShares = node.sibling.totalCustomerShares.add(node.sibling.totalCustomerShares);
            totalResourceCharges = node.sibling.totalResourceCharges.add(node.sibling.totalResourceCharges);
            totalOtherCharges = node.sibling.totalOtherCharges.add(node.sibling.totalOtherCharges);
            ratioLowerBound = node.sibling.ratioLowerBound;
            ratioUpperBound = node.sibling.ratioUpperBound;
        }

        return hash.toString() === 
            this.getRoot().hash.toString() && 
            totalCustomerShares.toString() === this.getRoot().totalCustomerShares.toString() &&
            totalResourceCharges.toString() === this.getRoot().totalResourceCharges.toString() &&
            totalOtherCharges.toString() === this.getRoot().totalOtherCharges.toString() &&
            ratioLowerBound.toString() === this.getRoot().ratioLowerBound.toString() &&
            ratioUpperBound.toString() === this.getRoot().ratioUpperBound.toString();
    }

    // TODO: should this take an optional offset? should it fail if the array is too long?
    /**
     * Fills all leaves of the tree.
     * @param leaves Values to fill the leaves with.
     */
    fill(leaves: NodeContent[]) {
        leaves.forEach((value, index) => {
            this.setLeaf(BigInt(index), value);
        });
    }

    /**
     * Returns the amount of leaf nodes.
     * @returns Amount of leaf nodes.
     */
    get leafCount(): bigint {
        return 2n ** BigInt(this.height - 1);
    }
}

/**
 * The {@link BaseMerkleWitness} class defines a circuit-compatible base class for [Merkle Witness](https://computersciencewiki.org/index.php/Merkle_proof).
 */
class BaseMerkleWitnessWithSums extends Struct({
    path: Provable.Array(NodeContent, TREE_HEIGHT-1),
    isLeft: Provable.Array(Bool, TREE_HEIGHT-1)
}) {
    static height: number;
    // path: NodeContent[];
    // isLeft: Bool[];

    height(): number {
        return (this.constructor as any).height;
    }

    /**
     * Takes a {@link Witness} and turns it into a circuit-compatible Witness.
     * @param witness Witness.
     * @returns A circuit-compatible Witness.
     */
    constructor(witness: Witness) {
        super({path:[], isLeft:[]});
        let height = witness.length + 1;
        if (height !== this.height()) {
            throw Error(
                `Length of witness ${height}-1 doesn't match static tree height ${this.height()}.`
            );
        }
        this.path = witness.map((item) => item.sibling);
        this.isLeft = witness.map((item) => Bool(item.isLeft));
    }


    // height(): Field {
    //     return (this.from as any).height;
    // }

    /**
     * Calculates a root depending on the leaf value.
     * @param leaf Value of the leaf node that belongs to this Witness.
     * @returns The calculated root.
     */
    calculateRoot(leaf: NodeContent): NodeContent {
        let node = leaf;

        //console.log("Calculating root for: (hash)", leaf.hash.toString(), "(sum)", leaf.sum.toString());

        for (let i = 1; i < this.height(); ++i) {

            let isLeft: Bool = this.isLeft[i - 1];
            //console.log("At level:", i, "isLeft:", isLeft.toString());

            //console.log("node:", node.hash.toString(), "this.path[i-1]:", this.path[i-1].hash.toString());

            const [left, right] = conditionalSwap(isLeft, node, this.path[i - 1]);

            //console.log("left hash:", left.hash.toString(), "right hash:", right.hash.toString());
            //console.log("left sum:", left.sum.toString(), "right sum:", right.sum.toString());

            left.ratioLowerBound.assertEquals(right.ratioLowerBound);
            right.ratioUpperBound.assertEquals(right.ratioUpperBound);

            node = new NodeContent({
                hash: Poseidon.hash([left.hash, right.hash]),
                totalCustomerShares: left.totalCustomerShares.add(right.totalCustomerShares),
                totalResourceCharges: left.totalResourceCharges.add(right.totalResourceCharges),
                totalOtherCharges: left.totalOtherCharges.add(right.totalOtherCharges),
                ratioLowerBound: left.ratioLowerBound,
                ratioUpperBound: right.ratioUpperBound
            });

        }
        return node;
    }

    /**
     * Calculates the index of the leaf node that belongs to this Witness.
     * @returns Index of the leaf.
     */
    calculateIndex(): Field {
        let powerOfTwo = Field(1);
        let index = Field(0);
        let n = this.height();

        for (let i = 1; i < n; ++i) {
            index = Provable.if(this.isLeft[i - 1], index, index.add(powerOfTwo));
            powerOfTwo = powerOfTwo.mul(2);
        }

        return index;
    }
}

function arrayProp<T>(elementType: FlexibleProvable<T>, length: number) {
    return function (target: any, key: string) {
        if (!target.hasOwnProperty('_fields')) {
            target._fields = [];
        }
        target._fields.push([key, Provable.Array(elementType, length)]);
    };
}

/**
 * Returns a circuit-compatible Witness for a specific Tree height.
 * @param height Height of the Merkle Tree that this Witness belongs to.
 * @returns A circuit-compatible Merkle Witness.
 */
function MerkleWitnessWithSums(height: number): typeof BaseMerkleWitnessWithSums {
    class MerkleWitness_ extends BaseMerkleWitnessWithSums {
        static height = height;
    }
    arrayProp(NodeContent, height - 1)(MerkleWitness_.prototype, 'path');
    arrayProp(Bool, height - 1)(MerkleWitness_.prototype, 'isLeft');
    return MerkleWitness_;
}

// swap two values if the boolean is false, otherwise keep them as they are
// more efficient than 2x `Provable.if()` by reusing an intermediate variable
function conditionalSwap(b: Bool, x: NodeContent, y: NodeContent): [ NodeContent, NodeContent ] {
    let mHash = b.toField().mul(x.hash.sub(y.hash)); // b*(x - y)
    let mtotalCustomerShares = b.toField().mul(x.totalCustomerShares.sub(y.totalCustomerShares)); // b*(x - y)
    let mResourcesCostsSum = b.toField().mul(x.totalResourceCharges.sub(y.totalResourceCharges)); // b*(x - y)
    let mtotalOtherCharges = b.toField().mul(x.totalOtherCharges.sub(y.totalOtherCharges)); // b*(x - y)

    const x_ = new NodeContent({
        hash: y.hash.add(mHash), // y + b*(x - y)
        totalCustomerShares: y.totalCustomerShares.add(mtotalCustomerShares),
        totalResourceCharges: y.totalResourceCharges.add(mResourcesCostsSum),
        totalOtherCharges: y.totalOtherCharges.add(mtotalOtherCharges),
        ratioLowerBound: y.ratioLowerBound,
        ratioUpperBound: y.ratioUpperBound
    });
    const y_ = new NodeContent({
        hash: x.hash.sub(mHash), // x - b*(x - y) = x + b*(y - x)
        totalCustomerShares: x.totalCustomerShares.sub(mtotalCustomerShares),
        totalResourceCharges: x.totalResourceCharges.sub(mResourcesCostsSum),
        totalOtherCharges: x.totalOtherCharges.add(mtotalOtherCharges),
        ratioLowerBound: x.ratioLowerBound,
        ratioUpperBound: x.ratioUpperBound
    });
    return [x_, y_];
}
