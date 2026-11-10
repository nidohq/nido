use g_account_core::authority::*;

fn key(n: u8) -> Key {
    Key([n; 32])
}

fn account() -> Authority {
    Authority {
        account: AccountRef {
            tenant: [10; 32],
            network: [11; 32],
            kind: AccountKind::StellarG,
            address: key(1),
        },
        profile: Profile::SelfDirected,
        roles: Roles {
            bootstrap: key(1),
            local: key(2),
            service: key(3),
            recovery: key(4),
            fee: key(5),
        },
        master_weight: 0,
        thresholds: Thresholds {
            low: 2,
            medium: 2,
            high: 2,
        },
        signers: vec![
            Signer {
                key: key(2),
                weight: 2,
            },
            Signer {
                key: key(3),
                weight: 1,
            },
            Signer {
                key: key(4),
                weight: 1,
            },
        ],
    }
}

fn rotation(a: &Authority, kind: RotationKind) -> Rotation {
    let (old_key, weight) = match kind {
        RotationKind::ReplaceLocal | RotationKind::RecoverLocal => (a.roles.local, 2),
        RotationKind::ReplaceService => (a.roles.service, 1),
        RotationKind::ReplaceRecovery => (a.roles.recovery, 1),
    };
    Rotation {
        account: a.account,
        transaction_source: a.account.address,
        kind,
        old_key,
        new_key: key(9),
        operations: vec![
            Operation {
                source: None,
                body: OperationBody::SetSigner(Signer {
                    key: key(9),
                    weight,
                }),
            },
            Operation {
                source: None,
                body: OperationBody::SetSigner(Signer {
                    key: old_key,
                    weight: 0,
                }),
            },
        ],
    }
}

#[test]
fn all_key_coalitions_and_duplicate_evidence_match_mvp_authority() {
    let a = account();
    // Includes bootstrap, fee and an unregistered key, not only the three signers.
    for mask in 0..64u32 {
        let mut evidence = Vec::new();
        for bit in 0..6 {
            if mask & (1 << bit) != 0 {
                evidence.push(key(bit + 1));
            }
        }
        let expected = mask & 2 != 0 || mask & 12 == 12;
        for category in [Category::Low, Category::Medium, Category::High] {
            assert_eq!(can_authorize(&a, &evidence, category), Ok(expected));
        }
        let weight = authorization_weight(&a, &evidence).unwrap();
        evidence.extend_from_within(..);
        assert_eq!(authorization_weight(&a, &evidence), Ok(weight));
        assert!(weight <= 4);
    }
    assert_eq!(authorization_weight(&a, &vec![key(3); 1024]), Ok(1));
}

#[test]
fn thresholds_weights_master_and_profile_are_exact() {
    let a = account();
    for value in 0..=u8::MAX {
        for threshold in 0..3 {
            let mut b = a.clone();
            match threshold {
                0 => b.thresholds.low = value,
                1 => b.thresholds.medium = value,
                _ => b.thresholds.high = value,
            };
            assert_eq!(validate(&b).is_ok(), value == 2);
        }
        let mut b = a.clone();
        b.master_weight = value;
        assert_eq!(validate(&b).is_ok(), value == 0);
        for index in 0..3 {
            let mut b = a.clone();
            b.signers[index].weight = value;
            assert_eq!(validate(&b).is_ok(), value == a.signers[index].weight);
        }
    }
    let mut b = a;
    b.profile = Profile::Protected;
    assert_eq!(validate(&b), Err(Refusal::UnsupportedProfile));
}

#[test]
fn role_aliases_and_unexpected_signer_sets_are_rejected() {
    let a = account();
    for left in 0..5 {
        for right in 0..5 {
            if left == right {
                continue;
            }
            let mut keys = [key(1), key(2), key(3), key(4), key(5)];
            keys[left] = keys[right];
            let mut b = a.clone();
            b.roles = Roles {
                bootstrap: keys[0],
                local: keys[1],
                service: keys[2],
                recovery: keys[3],
                fee: keys[4],
            };
            assert!(validate(&b).is_err());
        }
    }
    for len in [0, 1, 2, 4, 10] {
        let mut b = a.clone();
        b.signers.resize(
            len,
            Signer {
                key: key(9),
                weight: 1,
            },
        );
        assert!(validate(&b).is_err());
    }
    for i in 0..3 {
        let mut b = a.clone();
        b.signers[i] = a.signers[(i + 1) % 3];
        assert!(validate(&b).is_err());
    }
    let mut permuted = a.clone();
    permuted.signers.reverse();
    assert_eq!(validate(&permuted), Ok(()));
}

#[test]
fn account_kind_and_bootstrap_address_must_match() {
    let mut a = account();
    a.account.kind = AccountKind::PerchC;
    assert_eq!(validate(&a), Err(Refusal::InvalidAccount));
    a.account.kind = AccountKind::StellarG;
    a.account.address = key(9);
    assert_eq!(validate(&a), Err(Refusal::InvalidAccount));
}

#[test]
fn all_rotations_preserve_identity_and_exact_retained_fields() {
    let a = account();
    for kind in [
        RotationKind::ReplaceLocal,
        RotationKind::RecoverLocal,
        RotationKind::ReplaceService,
        RotationKind::ReplaceRecovery,
    ] {
        let req = rotation(&a, kind);
        let evidence = if kind == RotationKind::RecoverLocal {
            vec![key(3), key(4)]
        } else {
            vec![key(2)]
        };
        let next = rotate(&a, &req, &evidence).unwrap();
        assert_eq!(validate(&next), Ok(()));
        assert_eq!(next.account, a.account);
        assert_eq!(next.master_weight, a.master_weight);
        assert_eq!(next.thresholds, a.thresholds);
        assert_eq!(next.profile, a.profile);
        assert_eq!(next.roles.bootstrap, a.roles.bootstrap);
        assert_eq!(next.roles.fee, a.roles.fee);
        for old in &a.signers {
            if old.key == req.old_key {
                assert!(!next.signers.iter().any(|s| s.key == req.old_key));
                assert!(next.signers.contains(&Signer {
                    key: req.new_key,
                    weight: old.weight
                }));
            } else {
                assert!(next.signers.contains(old));
            }
        }
        assert_eq!(
            can_authorize(&next, &[next.roles.local], Category::High),
            Ok(true)
        );
        assert_eq!(
            can_authorize(
                &next,
                &[next.roles.service, next.roles.recovery],
                Category::High
            ),
            Ok(true)
        );
        assert_eq!(authorization_weight(&next, &[req.old_key]), Ok(0));
    }
    assert_eq!(a, account());
}

#[test]
fn account_scope_sources_and_hostile_templates_are_rejected_without_mutation() {
    let a = account();
    let base = rotation(&a, RotationKind::ReplaceLocal);
    let mut bad = Vec::new();
    let mut r = base.clone();
    r.account.tenant[0] ^= 1;
    bad.push(r);
    let mut r = base.clone();
    r.account.network[0] ^= 1;
    bad.push(r);
    let mut r = base.clone();
    r.account.kind = AccountKind::PerchC;
    bad.push(r);
    let mut r = base.clone();
    r.account.address = key(8);
    bad.push(r);
    let mut r = base.clone();
    r.transaction_source = key(8);
    bad.push(r);
    let mut r = base.clone();
    r.old_key = key(8);
    bad.push(r);
    for k in 1..=5 {
        let mut r = base.clone();
        r.new_key = key(k);
        bad.push(r);
    }
    let mut r = base.clone();
    r.operations[0].source = Some(a.account.address);
    bad.push(r);
    let mut r = base.clone();
    r.operations[1].source = Some(key(8));
    bad.push(r);
    let mut r = base.clone();
    r.operations.reverse();
    bad.push(r);
    let mut r = base.clone();
    r.operations.pop();
    bad.push(r);
    let mut r = base.clone();
    r.operations.push(Operation {
        source: None,
        body: OperationBody::Unsupported,
    });
    bad.push(r);
    let mut r = base.clone();
    r.operations[0].body = OperationBody::SetSigner(Signer {
        key: key(9),
        weight: 1,
    });
    bad.push(r);
    let mut r = base.clone();
    r.operations[1].body = OperationBody::SetSigner(Signer {
        key: key(3),
        weight: 0,
    });
    bad.push(r);
    for req in bad {
        assert!(rotate(&a, &req, &[key(2)]).is_err());
        assert_eq!(a, account());
    }
}

#[test]
fn recovery_and_owner_template_evidence_cannot_be_interchanged() {
    let a = account();
    for kind in [
        RotationKind::ReplaceLocal,
        RotationKind::RecoverLocal,
        RotationKind::ReplaceService,
        RotationKind::ReplaceRecovery,
    ] {
        let req = rotation(&a, kind);
        for mask in 0..8 {
            let evidence: Vec<_> = (0..3)
                .filter(|i| mask & (1 << i) != 0)
                .map(|i| key(i + 2))
                .collect();
            let expected = if kind == RotationKind::RecoverLocal {
                mask & 6 == 6
            } else {
                mask & 1 != 0
            };
            assert_eq!(rotate(&a, &req, &evidence).is_ok(), expected);
        }
    }
}
