import { Field, Signature, Struct } from "o1js";

// Have to choose a batch number that is a factor in 1440, which is how many 
// metrics we use for a 30 days proof per customer.
// 120 throws this error because the number of constraints is too high:
// RuntimeError: unreachable
// at plonk_wasm.wasm.alloc::raw_vec::handle_error::h7466a2a6ac1d1e3a (wasm://wasm/plonk_wasm.wasm-0133c842:wasm-function[3874]:0x466e23)
// at plonk_wasm.wasm.alloc::raw_vec::RawVec<T,A>::reserve::do_reserve_and_handle::h0f08975b8c99baba (wasm://wasm/plonk_wasm.wasm-0133c842:wasm-function[3226]:0x45412b)
// 96 has 64,941 constraints
export const BATCH_NUM_OF_INTENSITY = 90;

export class SignedIntensityFactor extends Struct({
    intensity: Field,
    intensitySig: Signature,
    timeFrom: Field,
    timeTo: Field,
}){}