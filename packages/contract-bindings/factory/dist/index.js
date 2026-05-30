import { Buffer } from "buffer";
import { Client as ContractClient, Spec as ContractSpec, } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
if (typeof window !== "undefined") {
    //@ts-ignore Buffer exists
    window.Buffer = window.Buffer || Buffer;
}
export class Client extends ContractClient {
    options;
    static async deploy(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options) {
        return ContractClient.deploy(null, options);
    }
    constructor(options) {
        super(new ContractSpec(["AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAAAAAAA",
            "AAAAAAAAAAAAAAANZ2V0X2NfYWRkcmVzcwAAAAAAAAEAAAAAAAAABmZ1bmRlcgAAAAAAEwAAAAEAAAAT",
            "AAAAAAAAAGVEZXBsb3kgYW4gYWNjb3VudCBjb250cmFjdCBhbmQgYWRkIGEgcGFzc2tleSB0byBpdC4gTGFzdGx5IHRyYW5zZmVyIGZ1bmRzIHRvIHRoZSBjb250cmFjdCdzIGFjY291bnQuCgAAAAAAAA5jcmVhdGVfYWNjb3VudAAAAAAAAwAAAAAAAAAGZnVuZGVyAAAAAAATAAAAAAAAAANrZXkAAAAD7gAAAEEAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAAT"]), options);
        this.options = options;
    }
    fromJSON = {
        get_c_address: (this.txFromJSON),
        create_account: (this.txFromJSON)
    };
}
