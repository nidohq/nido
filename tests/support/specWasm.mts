import { xdr } from '@stellar/stellar-sdk';

/** A spec type, by name: `address`, `muxed`, `i128` or `u32`. */
export type SpecType = 'address' | 'muxed' | 'i128' | 'u32';

const TYPES: Record<SpecType, () => xdr.ScSpecTypeDef> = {
  address: () => xdr.ScSpecTypeDef.scSpecTypeAddress(),
  muxed: () => xdr.ScSpecTypeDef.scSpecTypeMuxedAddress(),
  i128: () => xdr.ScSpecTypeDef.scSpecTypeI128(),
  u32: () => xdr.ScSpecTypeDef.scSpecTypeU32(),
};

/** Unsigned LEB128, as wasm section sizes are written. */
function leb(n: number): Buffer {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

/** A wasm module holding only a `contractspecv0` custom section that
 *  declares `fns`: enough for a contract-spec reader, nothing to run. */
export function specWasm(fns: { name: string; inputs: SpecType[] }[]): Buffer {
  const spec = Buffer.concat(
    fns.map((fn) =>
      xdr.ScSpecEntry.scSpecEntryFunctionV0(
        new xdr.ScSpecFunctionV0({
          doc: '',
          name: fn.name,
          inputs: fn.inputs.map((t, i) => new xdr.ScSpecFunctionInputV0({ doc: '', name: `a${i}`, type: TYPES[t]() })),
          outputs: [],
        }),
      ).toXDR(),
    ),
  );
  const name = Buffer.from('contractspecv0');
  const payload = Buffer.concat([leb(name.length), name, spec]);
  return Buffer.concat([Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0]), leb(payload.length), payload]);
}
