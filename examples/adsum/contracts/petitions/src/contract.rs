use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String, Vec,
};
use soroban_sdk_tools::{contractstorage, InstanceItem, PersistentMap};

// Caps are UTF-8 BYTE counts (soroban String::len is bytes) — client validation must match.
pub const TITLE_MAX: u32 = 100;
pub const BODY_MAX: u32 = 2000;
const TTL_LEDGERS: u32 = 518_400; // ~30 days of ledgers

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Petition {
    pub creator: Address,
    pub title: String,
    pub body: String,
    pub goal: Option<u32>,
    pub deadline: Option<u32>,
    pub sig_count: u32,
    pub created_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PetitionError {
    NotFound = 1,
    TitleInvalid = 2,
    BodyInvalid = 3,
    DeadlineInPast = 4,
    Expired = 5,
    AlreadySigned = 6,
}

#[contractevent(topics = ["petition_created"], data_format = "map")]
pub struct PetitionCreated<'a> {
    #[topic]
    pub id: &'a u32,
    pub creator: &'a Address,
}

#[contractevent(topics = ["petition_signed"], data_format = "map")]
pub struct PetitionSigned<'a> {
    #[topic]
    pub id: &'a u32,
    pub signer: &'a Address,
}

#[contractstorage]
pub struct Registry {
    petitions: PersistentMap<u32, Petition>,
    signatures: PersistentMap<(u32, Address), ()>,
    signer_by_index: PersistentMap<(u32, u32), Address>,
    count: InstanceItem<u32>,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn create_petition(
        e: &Env,
        creator: &Address,
        title: &String,
        body: &String,
        goal: Option<u32>,
        deadline: Option<u32>,
    ) -> Result<u32, PetitionError> {
        creator.require_auth();
        if title.is_empty() || title.len() > TITLE_MAX {
            return Err(PetitionError::TitleInvalid);
        }
        if body.is_empty() || body.len() > BODY_MAX {
            return Err(PetitionError::BodyInvalid);
        }
        let current = e.ledger().sequence();
        if let Some(d) = deadline {
            if d <= current {
                return Err(PetitionError::DeadlineInPast);
            }
        }
        let registry = Registry::new(e);
        let id = registry.count.get().unwrap_or(0);
        let petition = Petition {
            creator: creator.clone(),
            title: title.clone(),
            body: body.clone(),
            goal,
            deadline,
            sig_count: 0,
            created_ledger: current,
        };
        registry.petitions.set(&id, &petition);
        registry.petitions.extend_ttl(&id, TTL_LEDGERS, TTL_LEDGERS);
        registry.count.set(&(id + 1));
        PetitionCreated { id: &id, creator }.publish(e);
        Ok(id)
    }

    pub fn get_petition(e: &Env, id: u32) -> Option<Petition> {
        Registry::new(e).petitions.get(&id)
    }

    pub fn petition_count(e: &Env) -> u32 {
        Registry::new(e).count.get().unwrap_or(0)
    }

    pub fn sign(e: &Env, id: u32, signer: &Address) -> Result<(), PetitionError> {
        signer.require_auth();
        let registry = Registry::new(e);
        let mut petition = registry.petitions.get(&id).ok_or(PetitionError::NotFound)?;
        if let Some(d) = petition.deadline {
            if e.ledger().sequence() >= d {
                return Err(PetitionError::Expired);
            }
        }
        if registry.signatures.get(&(id, signer.clone())).is_some() {
            return Err(PetitionError::AlreadySigned);
        }
        registry.signatures.set(&(id, signer.clone()), &());
        registry
            .signer_by_index
            .set(&(id, petition.sig_count), signer);
        registry
            .signatures
            .extend_ttl(&(id, signer.clone()), TTL_LEDGERS, TTL_LEDGERS);
        registry
            .signer_by_index
            .extend_ttl(&(id, petition.sig_count), TTL_LEDGERS, TTL_LEDGERS);
        petition.sig_count += 1;
        registry.petitions.set(&id, &petition);
        registry.petitions.extend_ttl(&id, TTL_LEDGERS, TTL_LEDGERS);
        PetitionSigned { id: &id, signer }.publish(e);
        Ok(())
    }

    pub fn has_signed(e: &Env, id: u32, addr: &Address) -> bool {
        Registry::new(e)
            .signatures
            .get(&(id, addr.clone()))
            .is_some()
    }

    pub fn get_signers(e: &Env, id: u32, start: u32, limit: u32) -> Vec<Address> {
        let registry = Registry::new(e);
        let mut out = Vec::new(e);
        if let Some(p) = registry.petitions.get(&id) {
            let end = start.saturating_add(limit).min(p.sig_count);
            for i in start..end {
                if let Some(a) = registry.signer_by_index.get(&(id, i)) {
                    out.push_back(a);
                }
            }
        }
        out
    }

    pub fn extend_ttl(e: &Env, id: u32) -> Result<(), PetitionError> {
        let registry = Registry::new(e);
        if registry.petitions.get(&id).is_none() {
            return Err(PetitionError::NotFound);
        }
        registry.petitions.extend_ttl(&id, TTL_LEDGERS, TTL_LEDGERS);
        Ok(())
    }

    /// Callable by anyone (same keep-alive idiom as `extend_ttl`). Extends
    /// the `signer_by_index` and `signatures` entries for signer indices
    /// `[start, min(start + limit, sig_count))`. Paginated because a
    /// petition's signer set is unbounded.
    pub fn extend_signatures_ttl(
        e: &Env,
        id: u32,
        start: u32,
        limit: u32,
    ) -> Result<(), PetitionError> {
        let registry = Registry::new(e);
        let petition = registry.petitions.get(&id).ok_or(PetitionError::NotFound)?;
        let end = start.saturating_add(limit).min(petition.sig_count);
        for i in start..end {
            if let Some(signer) = registry.signer_by_index.get(&(id, i)) {
                registry
                    .signer_by_index
                    .extend_ttl(&(id, i), TTL_LEDGERS, TTL_LEDGERS);
                registry
                    .signatures
                    .extend_ttl(&(id, signer), TTL_LEDGERS, TTL_LEDGERS);
            }
        }
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
    fn create_and_get() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let title = String::from_str(&env, "Save the park");
        let body = String::from_str(&env, "We the undersigned ask the city to keep the park.");

        let id = client.create_petition(&creator, &title, &body, &Some(100), &None);

        assert_eq!(id, 0);
        assert_eq!(client.petition_count(), 1);
        let p = client.get_petition(&0).unwrap();
        assert_eq!(p.creator, creator);
        assert_eq!(p.title, title);
        assert_eq!(p.body, body);
        assert_eq!(p.goal, Some(100));
        assert_eq!(p.deadline, None);
        assert_eq!(p.sig_count, 0);
        assert_eq!(p.created_ledger, env.ledger().sequence());
    }

    #[test]
    fn create_emits_event() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        assert_eq!(env.events().all().events().len(), 1);
    }

    #[test]
    fn ids_increment() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let title = String::from_str(&env, "t");
        let body = String::from_str(&env, "b");
        assert_eq!(
            client.create_petition(&creator, &title, &body, &None, &None),
            0
        );
        assert_eq!(
            client.create_petition(&creator, &title, &body, &None, &None),
            1
        );
        assert_eq!(client.petition_count(), 2);
    }

    #[test]
    fn title_validation() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let body = String::from_str(&env, "b");

        let empty = String::from_str(&env, "");
        assert_eq!(
            client.try_create_petition(&creator, &empty, &body, &None, &None),
            Err(Ok(PetitionError::TitleInvalid))
        );

        // 101 chars: over TITLE_MAX
        let over = String::from_str(&env, core::str::from_utf8(&[b'a'; 101]).unwrap());
        assert_eq!(
            client.try_create_petition(&creator, &over, &body, &None, &None),
            Err(Ok(PetitionError::TitleInvalid))
        );

        // exactly 100: OK
        let max = String::from_str(&env, core::str::from_utf8(&[b'a'; 100]).unwrap());
        assert!(client
            .try_create_petition(&creator, &max, &body, &None, &None)
            .is_ok());
    }

    #[test]
    fn body_validation() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let title = String::from_str(&env, "t");

        let empty = String::from_str(&env, "");
        assert_eq!(
            client.try_create_petition(&creator, &title, &empty, &None, &None),
            Err(Ok(PetitionError::BodyInvalid))
        );

        let over = String::from_str(&env, core::str::from_utf8(&[b'a'; 2001]).unwrap());
        assert_eq!(
            client.try_create_petition(&creator, &title, &over, &None, &None),
            Err(Ok(PetitionError::BodyInvalid))
        );

        let max = String::from_str(&env, core::str::from_utf8(&[b'a'; 2000]).unwrap());
        assert!(client
            .try_create_petition(&creator, &title, &max, &None, &None)
            .is_ok());
    }

    #[test]
    fn deadline_must_be_future() {
        let (env, client) = setup();
        env.ledger().with_mut(|l| l.sequence_number = 1000);
        let creator = Address::generate(&env);
        let title = String::from_str(&env, "t");
        let body = String::from_str(&env, "b");

        assert_eq!(
            client.try_create_petition(&creator, &title, &body, &None, &Some(1000)),
            Err(Ok(PetitionError::DeadlineInPast))
        );
        assert_eq!(
            client.try_create_petition(&creator, &title, &body, &None, &Some(999)),
            Err(Ok(PetitionError::DeadlineInPast))
        );
        assert!(client
            .try_create_petition(&creator, &title, &body, &None, &Some(1001))
            .is_ok());
    }

    #[test]
    fn get_missing_returns_none() {
        let (_env, client) = setup();
        assert_eq!(client.get_petition(&42), None);
    }

    #[test]
    fn sign_happy_path() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let signer = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );

        assert!(!client.has_signed(&id, &signer));
        client.sign(&id, &signer);
        assert!(client.has_signed(&id, &signer));
        assert_eq!(client.get_petition(&id).unwrap().sig_count, 1);
    }

    #[test]
    fn sign_emits_event() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let signer = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        client.sign(&id, &signer);
        assert_eq!(env.events().all().events().len(), 1);
    }

    #[test]
    fn sign_unknown_petition() {
        let (env, client) = setup();
        let signer = Address::generate(&env);
        assert_eq!(
            client.try_sign(&99, &signer),
            Err(Ok(PetitionError::NotFound))
        );
    }

    #[test]
    fn double_sign_rejected() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let signer = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        client.sign(&id, &signer);
        assert_eq!(
            client.try_sign(&id, &signer),
            Err(Ok(PetitionError::AlreadySigned))
        );
        assert_eq!(client.get_petition(&id).unwrap().sig_count, 1);
    }

    #[test]
    fn sign_at_and_after_deadline_rejected() {
        let (env, client) = setup();
        env.ledger().with_mut(|l| l.sequence_number = 1000);
        let creator = Address::generate(&env);
        let signer = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &Some(1010),
        );

        // strictly before deadline: OK
        env.ledger().with_mut(|l| l.sequence_number = 1009);
        client.sign(&id, &signer);

        // at deadline: rejected
        let late = Address::generate(&env);
        env.ledger().with_mut(|l| l.sequence_number = 1010);
        assert_eq!(client.try_sign(&id, &late), Err(Ok(PetitionError::Expired)));

        // after deadline: rejected
        env.ledger().with_mut(|l| l.sequence_number = 2000);
        assert_eq!(client.try_sign(&id, &late), Err(Ok(PetitionError::Expired)));
    }

    #[test]
    fn distinct_signers_counted() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        for _ in 0..3 {
            client.sign(&id, &Address::generate(&env));
        }
        assert_eq!(client.get_petition(&id).unwrap().sig_count, 3);
    }

    #[test]
    fn signer_pagination() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        let mut signers = soroban_sdk::Vec::new(&env);
        for _ in 0..5 {
            let s = Address::generate(&env);
            client.sign(&id, &s);
            signers.push_back(s);
        }

        // full page, insertion order
        assert_eq!(client.get_signers(&id, &0, &10), signers);
        // partial pages
        assert_eq!(client.get_signers(&id, &0, &2).len(), 2);
        assert_eq!(client.get_signers(&id, &4, &2).len(), 1);
        assert_eq!(client.get_signers(&id, &0, &2).get(0), signers.get(0));
        assert_eq!(client.get_signers(&id, &2, &2).get(0), signers.get(2));
        // start past end / zero limit / unknown petition
        assert_eq!(client.get_signers(&id, &5, &2).len(), 0);
        assert_eq!(client.get_signers(&id, &0, &0).len(), 0);
        assert_eq!(client.get_signers(&99, &0, &10).len(), 0);
    }

    #[test]
    fn extend_ttl_requires_existing() {
        let (env, client) = setup();
        assert_eq!(client.try_extend_ttl(&99), Err(Ok(PetitionError::NotFound)));

        let creator = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );

        // create_petition already extended TTL to TTL_LEDGERS (518_400) from
        // ledger 0.
        let key = env.as_contract(&client.address, || {
            Registry::new(&env).petitions.get_storage_key(&id)
        });
        let ttl = || env.as_contract(&client.address, || env.storage().persistent().get_ttl(&key));
        assert_eq!(ttl(), TTL_LEDGERS);

        // Advance to before the original TTL expires, then call extend_ttl.
        env.ledger().with_mut(|l| l.sequence_number = 500_000);
        client.extend_ttl(&id);

        // A real extension resets the TTL to TTL_LEDGERS measured from *now*
        // (live_until becomes 500_000 + 518_400 = 1_018_400). A stub that
        // skips the underlying `extend_ttl` call would leave the entry's
        // live_until at the original 518_400, i.e. a remaining TTL of only
        // 18_400 -- this assertion catches that.
        assert_eq!(ttl(), TTL_LEDGERS);

        // Confirm the entry now truly survives past the *original* 518_400
        // expiry point.
        env.ledger().with_mut(|l| l.sequence_number = 600_000);
        assert!(client.get_petition(&id).is_some());
    }

    #[test]
    fn extend_signatures_ttl_extends_entries() {
        let (env, client) = setup();
        let creator = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        let mut signers = soroban_sdk::Vec::new(&env);
        for _ in 0..3 {
            let s = Address::generate(&env);
            client.sign(&id, &s);
            signers.push_back(s);
        }
        let target = signers.get(1).unwrap();

        // sign() already extended both entries' TTL to TTL_LEDGERS (518_400)
        // from ledger 0.
        let index_key = env.as_contract(&client.address, || {
            Registry::new(&env)
                .signer_by_index
                .get_storage_key(&(id, 1))
        });
        let sig_key = env.as_contract(&client.address, || {
            Registry::new(&env)
                .signatures
                .get_storage_key(&(id, target.clone()))
        });
        let ttl =
            |key: &_| env.as_contract(&client.address, || env.storage().persistent().get_ttl(key));
        assert_eq!(ttl(&index_key), TTL_LEDGERS);
        assert_eq!(ttl(&sig_key), TTL_LEDGERS);

        // Advance to before the original TTL expires, then call
        // extend_signatures_ttl.
        env.ledger().with_mut(|l| l.sequence_number = 400_000);
        client.extend_signatures_ttl(&id, &0, &10);

        // A real extension resets the TTL to TTL_LEDGERS measured from *now*
        // (live_until becomes 400_000 + 518_400 = 918_400). A stub that
        // skips the underlying `extend_ttl` calls would leave the entries'
        // live_until at the original 518_400, i.e. a remaining TTL of only
        // 118_400 -- this assertion catches that.
        assert_eq!(ttl(&index_key), TTL_LEDGERS);
        assert_eq!(ttl(&sig_key), TTL_LEDGERS);
    }

    #[test]
    fn extend_signatures_ttl_pagination_and_errors() {
        let (env, client) = setup();
        assert_eq!(
            client.try_extend_signatures_ttl(&99, &0, &10),
            Err(Ok(PetitionError::NotFound))
        );

        let creator = Address::generate(&env);
        let id = client.create_petition(
            &creator,
            &String::from_str(&env, "t"),
            &String::from_str(&env, "b"),
            &None,
            &None,
        );
        for _ in 0..3 {
            client.sign(&id, &Address::generate(&env));
        }

        // limit 0: no-op, still Ok.
        assert!(client.try_extend_signatures_ttl(&id, &0, &0).is_ok());
        // start past end: no-op, still Ok.
        assert!(client.try_extend_signatures_ttl(&id, &5, &10).is_ok());
    }
}
