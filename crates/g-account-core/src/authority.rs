//! The self-directed MVP profile and its exact signer-replacement templates.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Key(pub [u8; 32]);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccountKind {
    StellarG,
    PerchC,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AccountRef {
    pub tenant: [u8; 32],
    pub network: [u8; 32],
    pub kind: AccountKind,
    pub address: Key,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Profile {
    SelfDirected,
    Protected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Roles {
    pub bootstrap: Key,
    pub local: Key,
    pub service: Key,
    pub recovery: Key,
    pub fee: Key,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Thresholds {
    pub low: u8,
    pub medium: u8,
    pub high: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    Low,
    Medium,
    High,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Signer {
    pub key: Key,
    pub weight: u8,
}

/// An untrusted decoded snapshot. Every public decision validates it first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Authority {
    pub account: AccountRef,
    pub profile: Profile,
    pub roles: Roles,
    pub master_weight: u8,
    pub thresholds: Thresholds,
    pub signers: Vec<Signer>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    UnsupportedProfile,
    InvalidAccount,
    InvalidMaster,
    InvalidThresholds,
    AliasedRoles,
    InvalidSigners,
    WrongAccount,
    WrongSource,
    WrongOldKey,
    InvalidNewKey,
    InvalidOperations,
    InsufficientEvidence,
}

pub fn contains_key(keys: &[Key], key: Key) -> bool {
    let mut i = 0;
    while i < keys.len() {
        if keys[i] == key {
            return true;
        }
        i += 1;
    }
    false
}

pub fn roles_distinct(r: &Roles) -> bool {
    r.bootstrap != r.local
        && r.bootstrap != r.service
        && r.bootstrap != r.recovery
        && r.bootstrap != r.fee
        && r.local != r.service
        && r.local != r.recovery
        && r.local != r.fee
        && r.service != r.recovery
        && r.service != r.fee
        && r.recovery != r.fee
}

pub fn validate(a: &Authority) -> Result<(), Refusal> {
    if a.profile != Profile::SelfDirected {
        return Err(Refusal::UnsupportedProfile);
    }
    if a.account.kind != AccountKind::StellarG || a.account.address != a.roles.bootstrap {
        return Err(Refusal::InvalidAccount);
    }
    if a.master_weight != 0 {
        return Err(Refusal::InvalidMaster);
    }
    if a.thresholds.low != 2 || a.thresholds.medium != 2 || a.thresholds.high != 2 {
        return Err(Refusal::InvalidThresholds);
    }
    if !roles_distinct(&a.roles) {
        return Err(Refusal::AliasedRoles);
    }
    if a.signers.len() != 3 {
        return Err(Refusal::InvalidSigners);
    }
    let mut local = false;
    let mut service = false;
    let mut recovery = false;
    let mut i = 0;
    while i < a.signers.len() {
        let s = a.signers[i];
        if s.key == a.roles.local && s.weight == 2 && !local {
            local = true;
        } else if s.key == a.roles.service && s.weight == 1 && !service {
            service = true;
        } else if s.key == a.roles.recovery && s.weight == 1 && !recovery {
            recovery = true;
        } else {
            return Err(Refusal::InvalidSigners);
        }
        i += 1;
    }
    if local && service && recovery {
        Ok(())
    } else {
        Err(Refusal::InvalidSigners)
    }
}

/// Evidence is a list of distinct-or-repeated verified public keys, not raw signatures.
/// Iterating the validated signer map ensures each registered key contributes once.
pub fn authorization_weight(a: &Authority, evidence: &[Key]) -> Result<u16, Refusal> {
    validate(a)?;
    let mut weight: u16 = 0;
    let mut i = 0;
    while i < a.signers.len() {
        if contains_key(evidence, a.signers[i].key) {
            weight += a.signers[i].weight as u16;
        }
        i += 1;
    }
    Ok(weight)
}

pub fn can_authorize(a: &Authority, evidence: &[Key], category: Category) -> Result<bool, Refusal> {
    let weight = authorization_weight(a, evidence)?;
    let threshold = match category {
        Category::Low => a.thresholds.low,
        Category::Medium => a.thresholds.medium,
        Category::High => a.thresholds.high,
    };
    Ok(weight >= threshold as u16)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RotationKind {
    ReplaceLocal,
    RecoverLocal,
    ReplaceService,
    ReplaceRecovery,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationBody {
    SetSigner(Signer),
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Operation {
    pub source: Option<Key>,
    pub body: OperationBody,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rotation {
    pub account: AccountRef,
    pub transaction_source: Key,
    pub kind: RotationKind,
    pub old_key: Key,
    pub new_key: Key,
    pub operations: Vec<Operation>,
}

/// Validate and compute a final authority state; never emits a signature or XDR.
/// Recovery lifecycle/service approval is a separate, not-yet-implemented gate.
pub fn rotate(a: &Authority, request: &Rotation, evidence: &[Key]) -> Result<Authority, Refusal> {
    validate(a)?;
    if request.account != a.account {
        return Err(Refusal::WrongAccount);
    }
    if request.transaction_source != a.account.address {
        return Err(Refusal::WrongSource);
    }
    let (old_key, weight) = match request.kind {
        RotationKind::ReplaceLocal | RotationKind::RecoverLocal => (a.roles.local, 2),
        RotationKind::ReplaceService => (a.roles.service, 1),
        RotationKind::ReplaceRecovery => (a.roles.recovery, 1),
    };
    if request.old_key != old_key {
        return Err(Refusal::WrongOldKey);
    }
    let new_key = request.new_key;
    if new_key == a.roles.bootstrap
        || new_key == a.roles.local
        || new_key == a.roles.service
        || new_key == a.roles.recovery
        || new_key == a.roles.fee
    {
        return Err(Refusal::InvalidNewKey);
    }
    if request.operations.len() != 2
        || request.operations[0].source.is_some()
        || request.operations[1].source.is_some()
        || request.operations[0].body
            != OperationBody::SetSigner(Signer {
                key: new_key,
                weight,
            })
        || request.operations[1].body
            != OperationBody::SetSigner(Signer {
                key: old_key,
                weight: 0,
            })
    {
        return Err(Refusal::InvalidOperations);
    }
    let approved = match request.kind {
        RotationKind::RecoverLocal => {
            contains_key(evidence, a.roles.service) && contains_key(evidence, a.roles.recovery)
        }
        _ => contains_key(evidence, a.roles.local),
    };
    if !approved {
        return Err(Refusal::InsufficientEvidence);
    }
    let mut next = a.clone();
    match request.kind {
        RotationKind::ReplaceLocal | RotationKind::RecoverLocal => next.roles.local = new_key,
        RotationKind::ReplaceService => next.roles.service = new_key,
        RotationKind::ReplaceRecovery => next.roles.recovery = new_key,
    }
    let mut i = 0;
    while i < next.signers.len() {
        if next.signers[i].key == old_key {
            next.signers[i] = Signer {
                key: new_key,
                weight,
            };
        }
        i += 1;
    }
    validate(&next)?;
    Ok(next)
}
