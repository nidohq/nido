export type ResolvedFriend = {
    kind: 'name';
    address: string;
    input: string;
} | {
    kind: 'contract';
    address: string;
    input: string;
} | {
    kind: 'account';
    address: string;
    input: string;
};
export interface ResolveFriendOptions {
    /** Inject the name-registry lookup so tests can mock it. */
    resolveName: (name: string) => Promise<string | null>;
}
export declare function resolveFriendInput(input: string, opts: ResolveFriendOptions): Promise<ResolvedFriend | null>;
//# sourceMappingURL=resolveFriendInput.d.ts.map