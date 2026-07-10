use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, BytesN,
    Env, Vec,
};
use soroban_sdk_tools::{contractstorage, PersistentMap};

const TTL_LEDGERS: u32 = 518_400; // ~30 days of ledgers
const CLAIM_DOMAIN: &[u8] = b"adsum:claim_vouch";

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TrustError {
    SelfVouch = 1,
    AlreadyVouched = 2,
    VouchNotFound = 3,
    PreVouchExists = 4,
    PreVouchNotFound = 5,
    PreVouchExpired = 6,
    InvalidMaxClaims = 7,
    ExpiryInPast = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreVouch {
    pub from: Address,
    pub expires: Option<u32>,
    pub max_claims: u32,
    pub claims: u32,
}

#[contractevent(topics = ["vouched"], data_format = "map")]
pub struct Vouched<'a> {
    #[topic]
    pub from: &'a Address,
    pub to: &'a Address,
}

#[contractevent(topics = ["vouch_revoked"], data_format = "map")]
pub struct VouchRevoked<'a> {
    #[topic]
    pub from: &'a Address,
    pub to: &'a Address,
}

#[contractevent(topics = ["pre_vouch_created"], data_format = "map")]
pub struct PreVouchCreated<'a> {
    #[topic]
    pub key: &'a BytesN<32>,
    pub from: &'a Address,
}

#[contractevent(topics = ["vouch_claimed"], data_format = "map")]
pub struct VouchClaimed<'a> {
    #[topic]
    pub key: &'a BytesN<32>,
    pub from: &'a Address,
    pub to: &'a Address,
}

#[contractstorage]
pub struct Graph {
    given: PersistentMap<Address, Vec<Address>>,
    received: PersistentMap<Address, Vec<Address>>,
    pre_vouches: PersistentMap<BytesN<32>, PreVouch>,
}

#[contract]
pub struct Contract;

fn add_edge(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError> {
    if from == to {
        return Err(TrustError::SelfVouch);
    }
    let graph = Graph::new(e);
    let mut given = graph.given.get(from).unwrap_or_else(|| Vec::new(e));
    if given.contains(to) {
        return Err(TrustError::AlreadyVouched);
    }
    given.push_back(to.clone());
    graph.given.set(from, &given);
    graph.given.extend_ttl(from, TTL_LEDGERS, TTL_LEDGERS);

    let mut received = graph.received.get(to).unwrap_or_else(|| Vec::new(e));
    received.push_back(from.clone());
    graph.received.set(to, &received);
    graph.received.extend_ttl(to, TTL_LEDGERS, TTL_LEDGERS);

    Vouched { from, to }.publish(e);
    Ok(())
}

impl Contract {
    /// Builds the domain-separated claim payload signed by the invite secret:
    /// `contract.to_xdr || "adsum:claim_vouch" || to.to_xdr`. The dapp
    /// reproduces these bytes in TypeScript; keep them stable.
    pub fn claim_payload_for(e: &Env, contract: &Address, to: &Address) -> Bytes {
        let mut payload = contract.clone().to_xdr(e);
        payload.append(&Bytes::from_slice(e, CLAIM_DOMAIN));
        payload.append(&to.clone().to_xdr(e));
        payload
    }
}

#[contractimpl]
impl Contract {
    pub fn vouch(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError> {
        from.require_auth();
        add_edge(e, from, to)
    }

    pub fn revoke(e: &Env, from: &Address, to: &Address) -> Result<(), TrustError> {
        from.require_auth();
        let graph = Graph::new(e);
        let mut given = graph.given.get(from).unwrap_or_else(|| Vec::new(e));
        let Some(gi) = given.first_index_of(to) else {
            return Err(TrustError::VouchNotFound);
        };
        given.remove(gi);
        graph.given.set(from, &given);

        let mut received = graph.received.get(to).unwrap_or_else(|| Vec::new(e));
        if let Some(ri) = received.first_index_of(from) {
            received.remove(ri);
            graph.received.set(to, &received);
        }

        VouchRevoked { from, to }.publish(e);
        Ok(())
    }

    pub fn vouches_given(e: &Env, a: &Address) -> Vec<Address> {
        Graph::new(e).given.get(a).unwrap_or_else(|| Vec::new(e))
    }

    pub fn vouches_received(e: &Env, a: &Address) -> Vec<Address> {
        Graph::new(e).received.get(a).unwrap_or_else(|| Vec::new(e))
    }

    pub fn has_vouched(e: &Env, from: &Address, to: &Address) -> bool {
        Graph::new(e)
            .given
            .get(from)
            .is_some_and(|v| v.contains(to))
    }

    pub fn extend_ttl(e: &Env, a: &Address) {
        let graph = Graph::new(e);
        if graph.given.get(a).is_some() {
            graph.given.extend_ttl(a, TTL_LEDGERS, TTL_LEDGERS);
        }
        if graph.received.get(a).is_some() {
            graph.received.extend_ttl(a, TTL_LEDGERS, TTL_LEDGERS);
        }
    }

    pub fn pre_vouch(
        e: &Env,
        from: &Address,
        key: &BytesN<32>,
        expires: Option<u32>,
        max_claims: u32,
    ) -> Result<(), TrustError> {
        from.require_auth();
        if max_claims == 0 {
            return Err(TrustError::InvalidMaxClaims);
        }
        if let Some(x) = expires {
            if x <= e.ledger().sequence() {
                return Err(TrustError::ExpiryInPast);
            }
        }
        let graph = Graph::new(e);
        if graph.pre_vouches.get(key).is_some() {
            return Err(TrustError::PreVouchExists);
        }
        let pv = PreVouch {
            from: from.clone(),
            expires,
            max_claims,
            claims: 0,
        };
        graph.pre_vouches.set(key, &pv);
        graph.pre_vouches.extend_ttl(key, TTL_LEDGERS, TTL_LEDGERS);
        PreVouchCreated { key, from }.publish(e);
        Ok(())
    }

    pub fn revoke_pre_vouch(e: &Env, from: &Address, key: &BytesN<32>) -> Result<(), TrustError> {
        from.require_auth();
        let graph = Graph::new(e);
        let pv = graph
            .pre_vouches
            .get(key)
            .ok_or(TrustError::PreVouchNotFound)?;
        if pv.from != *from {
            return Err(TrustError::PreVouchNotFound);
        }
        graph.pre_vouches.remove(key);
        Ok(())
    }

    pub fn get_pre_vouch(e: &Env, key: &BytesN<32>) -> Option<PreVouch> {
        Graph::new(e).pre_vouches.get(key)
    }

    pub fn claim_vouch(
        e: &Env,
        key: &BytesN<32>,
        to: &Address,
        sig: &BytesN<64>,
    ) -> Result<(), TrustError> {
        let graph = Graph::new(e);
        let mut pv = graph
            .pre_vouches
            .get(key)
            .ok_or(TrustError::PreVouchNotFound)?;
        if let Some(x) = pv.expires {
            if e.ledger().sequence() >= x {
                return Err(TrustError::PreVouchExpired);
            }
        }
        // The signature is the authorization: it binds this claim to `to`,
        // so an observed claim tx cannot be replayed for another address.
        // ed25519_verify TRAPS on an invalid signature (host error).
        let payload = Self::claim_payload_for(e, &e.current_contract_address(), to);
        e.crypto().ed25519_verify(key, &payload, sig);

        add_edge(e, &pv.from.clone(), to)?;

        pv.claims += 1;
        if pv.claims >= pv.max_claims {
            graph.pre_vouches.remove(key);
        } else {
            graph.pre_vouches.set(key, &pv);
        }
        VouchClaimed {
            key,
            from: &pv.from,
            to,
        }
        .publish(e);
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::storage::Persistent as _;
    use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
    use soroban_sdk::Env;

    fn setup() -> (Env, ContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Contract, ());
        let client = ContractClient::new(&env, &id);
        (env, client)
    }

    #[test]
    fn vouch_and_views() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);

        assert!(!client.has_vouched(&a, &b));
        client.vouch(&a, &b);
        assert!(client.has_vouched(&a, &b));
        assert!(!client.has_vouched(&b, &a));
        assert_eq!(client.vouches_given(&a).len(), 1);
        assert_eq!(client.vouches_given(&a).get(0), Some(b.clone()));
        assert_eq!(client.vouches_received(&b).len(), 1);
        assert_eq!(client.vouches_received(&b).get(0), Some(a.clone()));
        assert_eq!(client.vouches_given(&b).len(), 0);
        assert_eq!(client.vouches_received(&a).len(), 0);
    }

    #[test]
    fn vouch_emits_event() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        client.vouch(&a, &b);
        assert_eq!(env.events().all().events().len(), 1);
    }

    #[test]
    fn self_vouch_rejected() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        assert_eq!(client.try_vouch(&a, &a), Err(Ok(TrustError::SelfVouch)));
    }

    #[test]
    fn duplicate_vouch_rejected() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        client.vouch(&a, &b);
        assert_eq!(
            client.try_vouch(&a, &b),
            Err(Ok(TrustError::AlreadyVouched))
        );
    }

    #[test]
    fn revoke_removes_both_directions() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);
        client.vouch(&a, &b);
        client.vouch(&a, &c);
        client.vouch(&c, &b);

        client.revoke(&a, &b);

        assert!(!client.has_vouched(&a, &b));
        assert_eq!(client.vouches_given(&a).len(), 1);
        assert_eq!(client.vouches_given(&a).get(0), Some(c.clone()));
        assert_eq!(client.vouches_received(&b).len(), 1);
        assert_eq!(client.vouches_received(&b).get(0), Some(c.clone()));
        // re-vouch after revoke works
        client.vouch(&a, &b);
        assert!(client.has_vouched(&a, &b));
    }

    #[test]
    fn revoke_nonexistent_rejected() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        assert_eq!(
            client.try_revoke(&a, &b),
            Err(Ok(TrustError::VouchNotFound))
        );
    }

    #[test]
    fn extend_ttl_extends_both_entries() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);

        // No-op on an address with no entries at all -- must not panic.
        client.extend_ttl(&a);

        // a vouches for b (creates given[a] and received[b]); c vouches for a
        // (creates given[c] and received[a]) so that a has both a given[a]
        // and a received[a] entry to extend.
        client.vouch(&a, &b);
        client.vouch(&c, &a);

        // Both entries already extended to TTL_LEDGERS (518_400) from ledger
        // 0 by add_edge itself.
        let given_key = env.as_contract(&client.address, || {
            Graph::new(&env).given.get_storage_key(&a)
        });
        let received_key = env.as_contract(&client.address, || {
            Graph::new(&env).received.get_storage_key(&a)
        });
        let given_ttl = || {
            env.as_contract(&client.address, || {
                env.storage().persistent().get_ttl(&given_key)
            })
        };
        let received_ttl = || {
            env.as_contract(&client.address, || {
                env.storage().persistent().get_ttl(&received_key)
            })
        };
        assert_eq!(given_ttl(), TTL_LEDGERS);
        assert_eq!(received_ttl(), TTL_LEDGERS);

        // Advance to before the original TTL expires, then call extend_ttl.
        env.ledger().with_mut(|l| l.sequence_number = 500_000);
        client.extend_ttl(&a);

        // A real extension resets the TTL to TTL_LEDGERS measured from *now*
        // (live_until becomes 500_000 + 518_400 = 1_018_400). A stub that
        // skips the underlying `extend_ttl` calls would leave both entries'
        // live_until at the original 518_400, i.e. a remaining TTL of only
        // 18_400 -- this assertion catches that.
        assert_eq!(given_ttl(), TTL_LEDGERS);
        assert_eq!(received_ttl(), TTL_LEDGERS);

        // Still a no-op (no panic) for an address with entries in neither map.
        let d = Address::generate(&env);
        client.extend_ttl(&d);
    }

    #[test]
    fn pre_vouch_create_and_get() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let key = BytesN::from_array(&env, &[1u8; 32]);

        assert_eq!(client.get_pre_vouch(&key), None);
        client.pre_vouch(&a, &key, &None, &3);
        assert_eq!(env.events().all().events().len(), 1);
        let pv = client.get_pre_vouch(&key).unwrap();
        assert_eq!(pv.from, a);
        assert_eq!(pv.expires, None);
        assert_eq!(pv.max_claims, 3);
        assert_eq!(pv.claims, 0);
    }

    #[test]
    fn pre_vouch_duplicate_key_rejected() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let key = BytesN::from_array(&env, &[1u8; 32]);
        client.pre_vouch(&a, &key, &None, &1);
        assert_eq!(
            client.try_pre_vouch(&a, &key, &None, &1),
            Err(Ok(TrustError::PreVouchExists))
        );
    }

    #[test]
    fn pre_vouch_zero_claims_rejected() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let key = BytesN::from_array(&env, &[1u8; 32]);
        assert_eq!(
            client.try_pre_vouch(&a, &key, &None, &0),
            Err(Ok(TrustError::InvalidMaxClaims))
        );
    }

    #[test]
    fn pre_vouch_expiry_must_be_future() {
        let (env, client) = setup();
        env.ledger().with_mut(|l| l.sequence_number = 1000);
        let a = Address::generate(&env);
        let key = BytesN::from_array(&env, &[1u8; 32]);
        assert_eq!(
            client.try_pre_vouch(&a, &key, &Some(1000), &1),
            Err(Ok(TrustError::ExpiryInPast))
        );
        client.pre_vouch(&a, &key, &Some(1001), &1);
    }

    #[test]
    fn revoke_pre_vouch() {
        let (env, client) = setup();
        let a = Address::generate(&env);
        let stranger = Address::generate(&env);
        let key = BytesN::from_array(&env, &[1u8; 32]);
        client.pre_vouch(&a, &key, &None, &1);

        // non-creator cannot revoke (no creator leak: same NotFound error)
        assert_eq!(
            client.try_revoke_pre_vouch(&stranger, &key),
            Err(Ok(TrustError::PreVouchNotFound))
        );

        client.revoke_pre_vouch(&a, &key);
        assert_eq!(client.get_pre_vouch(&key), None);
        assert_eq!(
            client.try_revoke_pre_vouch(&a, &key),
            Err(Ok(TrustError::PreVouchNotFound))
        );
    }

    // -- claim_vouch tests --

    fn dalek_key(seed: u8) -> ed25519_dalek::SigningKey {
        ed25519_dalek::SigningKey::from_bytes(&[seed; 32])
    }

    /// Creates a pre-vouch for `from` under `signing_key`'s pubkey and returns
    /// (key, valid signature over `to`).
    fn make_invite(
        env: &Env,
        client: &ContractClient<'static>,
        from: &Address,
        to: &Address,
        signing_key: &ed25519_dalek::SigningKey,
        expires: Option<u32>,
        max_claims: u32,
    ) -> (BytesN<32>, BytesN<64>) {
        use ed25519_dalek::Signer as _;
        let key = BytesN::from_array(env, &signing_key.verifying_key().to_bytes());
        client.pre_vouch(from, &key, &expires, &max_claims);
        let payload = Contract::claim_payload_for(env, &client.address, to);
        let mut buf = [0u8; 1024];
        let len = payload.len() as usize;
        payload.copy_into_slice(&mut buf[..len]);
        let sig = signing_key.sign(&buf[..len]);
        (key, BytesN::from_array(env, &sig.to_bytes()))
    }

    #[test]
    fn claim_happy_path() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &bob, &sk, None, 2);

        client.claim_vouch(&key, &bob, &sig);

        assert!(client.has_vouched(&alice, &bob));
        assert_eq!(client.get_pre_vouch(&key).unwrap().claims, 1);
    }

    #[test]
    fn claim_deletes_entry_at_cap() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &bob, &sk, None, 1);

        client.claim_vouch(&key, &bob, &sig);

        assert_eq!(client.get_pre_vouch(&key), None);
        // further claims fail as NotFound (exhausted)
        let carol = Address::generate(&env);
        let (_k2, sig2) = {
            use ed25519_dalek::Signer as _;
            let payload = Contract::claim_payload_for(&env, &client.address, &carol);
            let mut buf = [0u8; 1024];
            let len = payload.len() as usize;
            payload.copy_into_slice(&mut buf[..len]);
            let sig = sk.sign(&buf[..len]);
            (key.clone(), BytesN::from_array(&env, &sig.to_bytes()))
        };
        assert_eq!(
            client.try_claim_vouch(&key, &carol, &sig2),
            Err(Ok(TrustError::PreVouchNotFound))
        );
    }

    #[test]
    fn claim_repeat_by_same_account_rejected() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &bob, &sk, None, 5);

        client.claim_vouch(&key, &bob, &sig);
        assert_eq!(
            client.try_claim_vouch(&key, &bob, &sig),
            Err(Ok(TrustError::AlreadyVouched))
        );
        // counter not consumed by the failed claim
        assert_eq!(client.get_pre_vouch(&key).unwrap().claims, 1);
    }

    #[test]
    fn claim_by_creator_rejected() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &alice, &sk, None, 1);
        assert_eq!(
            client.try_claim_vouch(&key, &alice, &sig),
            Err(Ok(TrustError::SelfVouch))
        );
    }

    #[test]
    fn claim_expired_rejected() {
        let (env, client) = setup();
        env.ledger().with_mut(|l| l.sequence_number = 1000);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &bob, &sk, Some(1500), 1);

        env.ledger().with_mut(|l| l.sequence_number = 1500);
        assert_eq!(
            client.try_claim_vouch(&key, &bob, &sig),
            Err(Ok(TrustError::PreVouchExpired))
        );
    }

    #[test]
    #[should_panic] // host trap from ed25519_verify, not a typed error
    #[allow(clippy::should_panic_without_expect)]
    fn claim_with_wrong_signature_traps() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        let sk = dalek_key(7);
        // signature binds to bob; submitting for carol must trap
        let (key, sig_for_bob) = make_invite(&env, &client, &alice, &bob, &sk, None, 1);
        client.claim_vouch(&key, &carol, &sig_for_bob);
    }

    #[test]
    #[should_panic] // signature from a different secret key
    #[allow(clippy::should_panic_without_expect)]
    fn claim_with_wrong_key_traps() {
        use ed25519_dalek::Signer as _;
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, _sig) = make_invite(&env, &client, &alice, &bob, &sk, None, 1);
        let other = dalek_key(9);
        let payload = Contract::claim_payload_for(&env, &client.address, &bob);
        let mut buf = [0u8; 1024];
        let len = payload.len() as usize;
        payload.copy_into_slice(&mut buf[..len]);
        let bad = other.sign(&buf[..len]);
        client.claim_vouch(&key, &bob, &BytesN::from_array(&env, &bad.to_bytes()));
    }

    #[test]
    fn claim_emits_vouched_and_claimed_events() {
        let (env, client) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let sk = dalek_key(7);
        let (key, sig) = make_invite(&env, &client, &alice, &bob, &sk, None, 1);
        client.claim_vouch(&key, &bob, &sig);
        // add_edge publishes Vouched, claim_vouch publishes VouchClaimed
        assert_eq!(env.events().all().events().len(), 2);
    }
}
