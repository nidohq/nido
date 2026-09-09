import { z } from 'zod';
/** Author must paste this verbatim to acknowledge a rule with no signature
 *  check of its own. Mirrors perch-ir's ACK_SENTINEL. */
export declare const ACK_SENTINEL = "this-policy-authenticates-or-anyone-can-fire-this-rule";
declare const signerDecl: z.ZodUnion<[z.ZodObject<{
    id: z.ZodString;
    verifier: z.ZodString;
    key: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    verifier: string;
    key: string;
}, {
    id: string;
    verifier: string;
    key: string;
}>, z.ZodObject<{
    id: z.ZodString;
    address: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    address: string;
}, {
    id: string;
    address: string;
}>]>;
declare const scope: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"contract">;
    address: z.ZodString;
}, "strict", z.ZodTypeAny, {
    type: "contract";
    address: string;
}, {
    type: "contract";
    address: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"self-admin">;
}, "strict", z.ZodTypeAny, {
    type: "self-admin";
}, {
    type: "self-admin";
}>]>;
declare const principals: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"all">;
    signers: z.ZodArray<z.ZodString, "many">;
}, "strict", z.ZodTypeAny, {
    type: "all";
    signers: string[];
}, {
    type: "all";
    signers: string[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"self-authenticating">;
    policy: z.ZodString;
    'install-param-hex': z.ZodString;
    ack: z.ZodString;
}, "strict", z.ZodTypeAny, {
    type: "self-authenticating";
    policy: string;
    'install-param-hex': string;
    ack: string;
}, {
    type: "self-authenticating";
    policy: string;
    'install-param-hex': string;
    ack: string;
}>]>;
declare const argPred: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"is-self">;
}, "strict", z.ZodTypeAny, {
    type: "is-self";
}, {
    type: "is-self";
}>, z.ZodObject<{
    type: z.ZodLiteral<"address-eq">;
    address: z.ZodString;
}, "strict", z.ZodTypeAny, {
    type: "address-eq";
    address: string;
}, {
    type: "address-eq";
    address: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"string-in">;
    values: z.ZodArray<z.ZodString, "many">;
}, "strict", z.ZodTypeAny, {
    type: "string-in";
    values: string[];
}, {
    type: "string-in";
    values: string[];
}>, z.ZodObject<{
    type: z.ZodLiteral<"string-prefix">;
    prefix: z.ZodString;
}, "strict", z.ZodTypeAny, {
    type: "string-prefix";
    prefix: string;
}, {
    type: "string-prefix";
    prefix: string;
}>, z.ZodObject<{
    type: z.ZodLiteral<"u32-eq">;
    value: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    value: number;
    type: "u32-eq";
}, {
    value: number;
    type: "u32-eq";
}>]>;
declare const argConstraint: z.ZodObject<{
    index: z.ZodNumber;
    pred: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"is-self">;
    }, "strict", z.ZodTypeAny, {
        type: "is-self";
    }, {
        type: "is-self";
    }>, z.ZodObject<{
        type: z.ZodLiteral<"address-eq">;
        address: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "address-eq";
        address: string;
    }, {
        type: "address-eq";
        address: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"string-in">;
        values: z.ZodArray<z.ZodString, "many">;
    }, "strict", z.ZodTypeAny, {
        type: "string-in";
        values: string[];
    }, {
        type: "string-in";
        values: string[];
    }>, z.ZodObject<{
        type: z.ZodLiteral<"string-prefix">;
        prefix: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "string-prefix";
        prefix: string;
    }, {
        type: "string-prefix";
        prefix: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"u32-eq">;
        value: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        value: number;
        type: "u32-eq";
    }, {
        value: number;
        type: "u32-eq";
    }>]>;
}, "strict", z.ZodTypeAny, {
    index: number;
    pred: {
        type: "is-self";
    } | {
        type: "address-eq";
        address: string;
    } | {
        type: "string-in";
        values: string[];
    } | {
        type: "string-prefix";
        prefix: string;
    } | {
        value: number;
        type: "u32-eq";
    };
}, {
    index: number;
    pred: {
        type: "is-self";
    } | {
        type: "address-eq";
        address: string;
    } | {
        type: "string-in";
        values: string[];
    } | {
        type: "string-prefix";
        prefix: string;
    } | {
        value: number;
        type: "u32-eq";
    };
}>;
declare const capConstraint: z.ZodObject<{
    token: z.ZodOptional<z.ZodString>;
    limit: z.ZodString;
    'period-ledgers': z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    limit: string;
    'period-ledgers': number;
    token?: string | undefined;
}, {
    limit: string;
    'period-ledgers': number;
    token?: string | undefined;
}>;
declare const rule: z.ZodObject<{
    name: z.ZodString;
    scope: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"contract">;
        address: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "contract";
        address: string;
    }, {
        type: "contract";
        address: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"self-admin">;
    }, "strict", z.ZodTypeAny, {
        type: "self-admin";
    }, {
        type: "self-admin";
    }>]>;
    principals: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"all">;
        signers: z.ZodArray<z.ZodString, "many">;
    }, "strict", z.ZodTypeAny, {
        type: "all";
        signers: string[];
    }, {
        type: "all";
        signers: string[];
    }>, z.ZodObject<{
        type: z.ZodLiteral<"self-authenticating">;
        policy: z.ZodString;
        'install-param-hex': z.ZodString;
        ack: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: "self-authenticating";
        policy: string;
        'install-param-hex': string;
        ack: string;
    }, {
        type: "self-authenticating";
        policy: string;
        'install-param-hex': string;
        ack: string;
    }>]>;
    functions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    args: z.ZodOptional<z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        pred: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"is-self">;
        }, "strict", z.ZodTypeAny, {
            type: "is-self";
        }, {
            type: "is-self";
        }>, z.ZodObject<{
            type: z.ZodLiteral<"address-eq">;
            address: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            type: "address-eq";
            address: string;
        }, {
            type: "address-eq";
            address: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"string-in">;
            values: z.ZodArray<z.ZodString, "many">;
        }, "strict", z.ZodTypeAny, {
            type: "string-in";
            values: string[];
        }, {
            type: "string-in";
            values: string[];
        }>, z.ZodObject<{
            type: z.ZodLiteral<"string-prefix">;
            prefix: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            type: "string-prefix";
            prefix: string;
        }, {
            type: "string-prefix";
            prefix: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"u32-eq">;
            value: z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            value: number;
            type: "u32-eq";
        }, {
            value: number;
            type: "u32-eq";
        }>]>;
    }, "strict", z.ZodTypeAny, {
        index: number;
        pred: {
            type: "is-self";
        } | {
            type: "address-eq";
            address: string;
        } | {
            type: "string-in";
            values: string[];
        } | {
            type: "string-prefix";
            prefix: string;
        } | {
            value: number;
            type: "u32-eq";
        };
    }, {
        index: number;
        pred: {
            type: "is-self";
        } | {
            type: "address-eq";
            address: string;
        } | {
            type: "string-in";
            values: string[];
        } | {
            type: "string-prefix";
            prefix: string;
        } | {
            value: number;
            type: "u32-eq";
        };
    }>, "many">>;
    'not-after-ledger': z.ZodOptional<z.ZodNumber>;
    cap: z.ZodOptional<z.ZodObject<{
        token: z.ZodOptional<z.ZodString>;
        limit: z.ZodString;
        'period-ledgers': z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        limit: string;
        'period-ledgers': number;
        token?: string | undefined;
    }, {
        limit: string;
        'period-ledgers': number;
        token?: string | undefined;
    }>>;
}, "strict", z.ZodTypeAny, {
    name: string;
    scope: {
        type: "contract";
        address: string;
    } | {
        type: "self-admin";
    };
    principals: {
        type: "all";
        signers: string[];
    } | {
        type: "self-authenticating";
        policy: string;
        'install-param-hex': string;
        ack: string;
    };
    functions?: string[] | undefined;
    args?: {
        index: number;
        pred: {
            type: "is-self";
        } | {
            type: "address-eq";
            address: string;
        } | {
            type: "string-in";
            values: string[];
        } | {
            type: "string-prefix";
            prefix: string;
        } | {
            value: number;
            type: "u32-eq";
        };
    }[] | undefined;
    'not-after-ledger'?: number | undefined;
    cap?: {
        limit: string;
        'period-ledgers': number;
        token?: string | undefined;
    } | undefined;
}, {
    name: string;
    scope: {
        type: "contract";
        address: string;
    } | {
        type: "self-admin";
    };
    principals: {
        type: "all";
        signers: string[];
    } | {
        type: "self-authenticating";
        policy: string;
        'install-param-hex': string;
        ack: string;
    };
    functions?: string[] | undefined;
    args?: {
        index: number;
        pred: {
            type: "is-self";
        } | {
            type: "address-eq";
            address: string;
        } | {
            type: "string-in";
            values: string[];
        } | {
            type: "string-prefix";
            prefix: string;
        } | {
            value: number;
            type: "u32-eq";
        };
    }[] | undefined;
    'not-after-ledger'?: number | undefined;
    cap?: {
        limit: string;
        'period-ledgers': number;
        token?: string | undefined;
    } | undefined;
}>;
export declare const policyDocSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    network: z.ZodOptional<z.ZodString>;
    signers: z.ZodArray<z.ZodUnion<[z.ZodObject<{
        id: z.ZodString;
        verifier: z.ZodString;
        key: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        id: string;
        verifier: string;
        key: string;
    }, {
        id: string;
        verifier: string;
        key: string;
    }>, z.ZodObject<{
        id: z.ZodString;
        address: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        id: string;
        address: string;
    }, {
        id: string;
        address: string;
    }>]>, "many">;
    rules: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        scope: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"contract">;
            address: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            type: "contract";
            address: string;
        }, {
            type: "contract";
            address: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"self-admin">;
        }, "strict", z.ZodTypeAny, {
            type: "self-admin";
        }, {
            type: "self-admin";
        }>]>;
        principals: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"all">;
            signers: z.ZodArray<z.ZodString, "many">;
        }, "strict", z.ZodTypeAny, {
            type: "all";
            signers: string[];
        }, {
            type: "all";
            signers: string[];
        }>, z.ZodObject<{
            type: z.ZodLiteral<"self-authenticating">;
            policy: z.ZodString;
            'install-param-hex': z.ZodString;
            ack: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            type: "self-authenticating";
            policy: string;
            'install-param-hex': string;
            ack: string;
        }, {
            type: "self-authenticating";
            policy: string;
            'install-param-hex': string;
            ack: string;
        }>]>;
        functions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        args: z.ZodOptional<z.ZodArray<z.ZodObject<{
            index: z.ZodNumber;
            pred: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"is-self">;
            }, "strict", z.ZodTypeAny, {
                type: "is-self";
            }, {
                type: "is-self";
            }>, z.ZodObject<{
                type: z.ZodLiteral<"address-eq">;
                address: z.ZodString;
            }, "strict", z.ZodTypeAny, {
                type: "address-eq";
                address: string;
            }, {
                type: "address-eq";
                address: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"string-in">;
                values: z.ZodArray<z.ZodString, "many">;
            }, "strict", z.ZodTypeAny, {
                type: "string-in";
                values: string[];
            }, {
                type: "string-in";
                values: string[];
            }>, z.ZodObject<{
                type: z.ZodLiteral<"string-prefix">;
                prefix: z.ZodString;
            }, "strict", z.ZodTypeAny, {
                type: "string-prefix";
                prefix: string;
            }, {
                type: "string-prefix";
                prefix: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"u32-eq">;
                value: z.ZodNumber;
            }, "strict", z.ZodTypeAny, {
                value: number;
                type: "u32-eq";
            }, {
                value: number;
                type: "u32-eq";
            }>]>;
        }, "strict", z.ZodTypeAny, {
            index: number;
            pred: {
                type: "is-self";
            } | {
                type: "address-eq";
                address: string;
            } | {
                type: "string-in";
                values: string[];
            } | {
                type: "string-prefix";
                prefix: string;
            } | {
                value: number;
                type: "u32-eq";
            };
        }, {
            index: number;
            pred: {
                type: "is-self";
            } | {
                type: "address-eq";
                address: string;
            } | {
                type: "string-in";
                values: string[];
            } | {
                type: "string-prefix";
                prefix: string;
            } | {
                value: number;
                type: "u32-eq";
            };
        }>, "many">>;
        'not-after-ledger': z.ZodOptional<z.ZodNumber>;
        cap: z.ZodOptional<z.ZodObject<{
            token: z.ZodOptional<z.ZodString>;
            limit: z.ZodString;
            'period-ledgers': z.ZodNumber;
        }, "strict", z.ZodTypeAny, {
            limit: string;
            'period-ledgers': number;
            token?: string | undefined;
        }, {
            limit: string;
            'period-ledgers': number;
            token?: string | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        name: string;
        scope: {
            type: "contract";
            address: string;
        } | {
            type: "self-admin";
        };
        principals: {
            type: "all";
            signers: string[];
        } | {
            type: "self-authenticating";
            policy: string;
            'install-param-hex': string;
            ack: string;
        };
        functions?: string[] | undefined;
        args?: {
            index: number;
            pred: {
                type: "is-self";
            } | {
                type: "address-eq";
                address: string;
            } | {
                type: "string-in";
                values: string[];
            } | {
                type: "string-prefix";
                prefix: string;
            } | {
                value: number;
                type: "u32-eq";
            };
        }[] | undefined;
        'not-after-ledger'?: number | undefined;
        cap?: {
            limit: string;
            'period-ledgers': number;
            token?: string | undefined;
        } | undefined;
    }, {
        name: string;
        scope: {
            type: "contract";
            address: string;
        } | {
            type: "self-admin";
        };
        principals: {
            type: "all";
            signers: string[];
        } | {
            type: "self-authenticating";
            policy: string;
            'install-param-hex': string;
            ack: string;
        };
        functions?: string[] | undefined;
        args?: {
            index: number;
            pred: {
                type: "is-self";
            } | {
                type: "address-eq";
                address: string;
            } | {
                type: "string-in";
                values: string[];
            } | {
                type: "string-prefix";
                prefix: string;
            } | {
                value: number;
                type: "u32-eq";
            };
        }[] | undefined;
        'not-after-ledger'?: number | undefined;
        cap?: {
            limit: string;
            'period-ledgers': number;
            token?: string | undefined;
        } | undefined;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    signers: ({
        id: string;
        verifier: string;
        key: string;
    } | {
        id: string;
        address: string;
    })[];
    version: 1;
    rules: {
        name: string;
        scope: {
            type: "contract";
            address: string;
        } | {
            type: "self-admin";
        };
        principals: {
            type: "all";
            signers: string[];
        } | {
            type: "self-authenticating";
            policy: string;
            'install-param-hex': string;
            ack: string;
        };
        functions?: string[] | undefined;
        args?: {
            index: number;
            pred: {
                type: "is-self";
            } | {
                type: "address-eq";
                address: string;
            } | {
                type: "string-in";
                values: string[];
            } | {
                type: "string-prefix";
                prefix: string;
            } | {
                value: number;
                type: "u32-eq";
            };
        }[] | undefined;
        'not-after-ledger'?: number | undefined;
        cap?: {
            limit: string;
            'period-ledgers': number;
            token?: string | undefined;
        } | undefined;
    }[];
    network?: string | undefined;
}, {
    signers: ({
        id: string;
        verifier: string;
        key: string;
    } | {
        id: string;
        address: string;
    })[];
    version: 1;
    rules: {
        name: string;
        scope: {
            type: "contract";
            address: string;
        } | {
            type: "self-admin";
        };
        principals: {
            type: "all";
            signers: string[];
        } | {
            type: "self-authenticating";
            policy: string;
            'install-param-hex': string;
            ack: string;
        };
        functions?: string[] | undefined;
        args?: {
            index: number;
            pred: {
                type: "is-self";
            } | {
                type: "address-eq";
                address: string;
            } | {
                type: "string-in";
                values: string[];
            } | {
                type: "string-prefix";
                prefix: string;
            } | {
                value: number;
                type: "u32-eq";
            };
        }[] | undefined;
        'not-after-ledger'?: number | undefined;
        cap?: {
            limit: string;
            'period-ledgers': number;
            token?: string | undefined;
        } | undefined;
    }[];
    network?: string | undefined;
}>;
export type PolicyDoc = z.infer<typeof policyDocSchema>;
export type SignerDecl = z.infer<typeof signerDecl>;
export type Scope = z.infer<typeof scope>;
export type Principals = z.infer<typeof principals>;
export type Rule = z.infer<typeof rule>;
export type ArgConstraint = z.infer<typeof argConstraint>;
export type ArgPred = z.infer<typeof argPred>;
export type CapConstraint = z.infer<typeof capConstraint>;
/** Parse and validate an already-JSON-parsed value into a PolicyDoc, throwing a
 *  ZodError on any shape/version/unknown-field violation (fail-closed). */
export declare function parsePolicyDoc(value: unknown): PolicyDoc;
/** Parse from a JSON string. Note: JSON.parse silently keeps the last of any
 *  duplicate keys — raw-text duplicate rejection is a tracked follow-up. */
export declare function parsePolicyDocJson(json: string): PolicyDoc;
export {};
//# sourceMappingURL=schema.d.ts.map