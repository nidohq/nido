use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env, Vec,
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
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events as _};
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
}
