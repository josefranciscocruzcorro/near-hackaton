//! Pruebas unitarias (blockchain simulada de near-sdk).
//! Las comprobaciones que genera el macro en el wrapper wasm (`#[private]`, métodos no
//! `#[payable]`) se cubren en las pruebas de sandbox (`integration-tests`).

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const USDC: u128 = 1_000_000; // 6 decimales
/// 2025-11-14T01:00:00Z (día UTC 20_406).
const T0: u64 = 1_763_082_000 * 1_000_000_000;

fn owner() -> AccountId {
    "owner.near".parse().unwrap()
}
fn agent() -> AccountId {
    "agent.near".parse().unwrap()
}
fn usdc() -> AccountId {
    "usdc.near".parse().unwrap()
}
fn stranger() -> AccountId {
    "mallory.near".parse().unwrap()
}
fn treasury_id() -> AccountId {
    "tesorero.owner.near".parse().unwrap()
}
fn dest() -> AccountId {
    "3e2f1c0d9b8a7f6e5d4c3b2a1908f7e6d5c4b3a2918f7e6d5c4b3a2918f7e6d5"
        .parse()
        .unwrap()
}

struct Env {
    predecessor: AccountId,
    timestamp: u64,
    balance: NearToken,
    deposit: NearToken,
    gas: Gas,
    promise_results: Vec<PromiseResult>,
}

impl Env {
    fn new(predecessor: AccountId) -> Self {
        Self {
            predecessor,
            timestamp: T0,
            balance: NearToken::from_near(5),
            deposit: NearToken::from_yoctonear(0),
            gas: Gas::from_tgas(100),
            promise_results: vec![],
        }
    }
    fn at(mut self, timestamp: u64) -> Self {
        self.timestamp = timestamp;
        self
    }
    fn balance(mut self, balance: NearToken) -> Self {
        self.balance = balance;
        self
    }
    fn deposit(mut self, deposit: NearToken) -> Self {
        self.deposit = deposit;
        self
    }
    fn gas(mut self, gas: Gas) -> Self {
        self.gas = gas;
        self
    }
    fn results(mut self, results: Vec<PromiseResult>) -> Self {
        self.promise_results = results;
        self
    }
    fn apply(self) {
        let ctx = VMContextBuilder::new()
            .current_account_id(treasury_id())
            .signer_account_id(self.predecessor.clone())
            .predecessor_account_id(self.predecessor)
            .block_timestamp(self.timestamp)
            .account_balance(self.balance)
            .attached_deposit(self.deposit)
            .prepaid_gas(self.gas)
            .build();
        testing_env!(
            ctx,
            test_vm_config(),
            RuntimeFeesConfig::test(),
            Default::default(),
            self.promise_results
        );
    }
}

fn as_(who: AccountId) {
    Env::new(who).apply();
}

/// Llamada firmada con exactamente 1 yoctoNEAR (clave full-access).
fn signed(who: AccountId) {
    Env::new(who).deposit(ONE_YOCTO).apply();
}

fn setup() -> Treasury {
    as_(owner());
    Treasury::new(
        owner(),
        usdc(),
        Some(agent()),
        U128(50 * USDC),
        U128(100 * USDC),
    )
}

/// Eventos NEP-297 emitidos hasta ahora en la ejecución actual.
fn events() -> Vec<Value> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str::<Value>(j).unwrap())
        .collect()
}

fn last_event() -> Value {
    events().pop().expect("no event emitted")
}

fn pay(c: &mut Treasury, id: &str, amount: u128) {
    as_(agent());
    let _ = c.pay(id.to_string(), dest(), U128(amount));
}

fn complete(c: &mut Treasury, id: &str, ok: bool, at: u64) -> bool {
    let result = if ok {
        PromiseResult::Successful(vec![])
    } else {
        PromiseResult::Failed
    };
    Env::new(treasury_id()).at(at).results(vec![result]).apply();
    c.on_pay_complete(id.to_string())
}

// ---------------------------------------------------------------- init / vistas

#[test]
fn init_sets_config() {
    let c = setup();
    let cfg = c.get_config();
    assert_eq!(cfg.owner_id, owner());
    assert_eq!(cfg.agent_id, Some(agent()));
    assert_eq!(cfg.usdc_contract_id, usdc());
    assert_eq!(cfg.max_per_payment, U128(50 * USDC));
    assert_eq!(cfg.daily_limit, U128(100 * USDC));
    assert!(!cfg.paused);
    assert_eq!(cfg.spent_today, U128(0));
    assert_eq!(cfg.remaining_today, U128(100 * USDC));
    assert_eq!(cfg.day, T0 / DAY_NS);
}

#[test]
fn init_without_agent() {
    as_(owner());
    let c = Treasury::new(owner(), usdc(), None, U128(1), U128(1));
    assert_eq!(c.get_config().agent_id, None);
}

#[test]
#[should_panic(expected = "ERR_INVALID_LIMITS")]
fn init_rejects_max_over_daily() {
    as_(owner());
    Treasury::new(owner(), usdc(), None, U128(2), U128(1));
}

#[test]
#[should_panic(expected = "ERR_INVALID_LIMITS")]
fn init_rejects_zero_limits() {
    as_(owner());
    Treasury::new(owner(), usdc(), None, U128(0), U128(0));
}

#[test]
fn config_json_shape_matches_adr() {
    let c = setup();
    let v = serde_json::to_value(c.get_config()).unwrap();
    let obj = v.as_object().unwrap();
    let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "agent_id",
            "daily_limit",
            "day",
            "max_per_payment",
            "owner_id",
            "paused",
            "remaining_today",
            "spent_today",
            "usdc_contract_id"
        ]
    );
    assert_eq!(v["max_per_payment"], "50000000");
    assert_eq!(v["daily_limit"], "100000000");
    assert_eq!(v["spent_today"], "0");
    assert!(v["day"].is_u64());
    assert!(v["paused"].is_boolean());
}

#[test]
fn payment_json_shape_matches_adr() {
    let mut c = setup();
    pay(&mut c, "pay-1", 7 * USDC);
    let v = serde_json::to_value(c.get_payment("pay-1".into()).unwrap()).unwrap();
    assert_eq!(v["payment_id"], "pay-1");
    assert_eq!(v["deposit_address"], dest().as_str());
    assert_eq!(v["amount"], "7000000");
    assert_eq!(v["status"], "Pending");
    assert_eq!(v["created_at_ns"], T0);
    assert_eq!(v.as_object().unwrap().len(), 5);
}

// ---------------------------------------------------------------- pay: camino feliz

#[test]
fn pay_records_pending_and_schedules_promises() {
    let mut c = setup();
    as_(agent());
    let _ = c.pay("pay-1".into(), dest(), U128(10 * USDC));

    let p = c.get_payment("pay-1".into()).unwrap();
    assert_eq!(p.status, PaymentStatus::Pending);
    assert_eq!(p.amount, U128(10 * USDC));
    assert_eq!(p.deposit_address, dest());
    assert_eq!(p.created_at_ns, T0);
    assert_eq!(c.get_config().spent_today, U128(10 * USDC));
    assert_eq!(c.get_config().remaining_today, U128(90 * USDC));

    let ev = last_event();
    assert_eq!(ev["standard"], "tesorero");
    assert_eq!(ev["version"], "1.0.0");
    assert_eq!(ev["event"], "payment_requested");
    assert_eq!(ev["data"][0]["payment_id"], "pay-1");
    assert_eq!(ev["data"][0]["amount"], "10000000");
    assert_eq!(ev["data"][0]["deposit_address"], dest().as_str());
    // Formato literal exacto del prefijo.
    assert!(get_logs().iter().any(|l| l.starts_with(
        r#"EVENT_JSON:{"standard":"tesorero","version":"1.0.0","event":"payment_requested","data":[{"#
    )));

    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 3);
    // 1) usdc.storage_deposit con 0.00125 NEAR
    assert_eq!(receipts[0].receiver_id, usdc());
    match &receipts[0].actions[0] {
        MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            prepaid_gas,
            ..
        } => {
            assert_eq!(method_name, b"storage_deposit");
            assert_eq!(*attached_deposit, STORAGE_DEPOSIT);
            assert!(*prepaid_gas >= GAS_FOR_STORAGE_DEPOSIT);
            let a: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(a["account_id"], dest().as_str());
            assert_eq!(a["registration_only"], true);
        }
        other => panic!("unexpected action {other:?}"),
    }
    // 2) usdc.ft_transfer con 1 yocto y memo = payment_id
    assert_eq!(receipts[1].receiver_id, usdc());
    match &receipts[1].actions[0] {
        MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            prepaid_gas,
            ..
        } => {
            assert_eq!(method_name, b"ft_transfer");
            assert_eq!(*attached_deposit, ONE_YOCTO);
            assert!(*prepaid_gas >= GAS_FOR_FT_TRANSFER);
            let a: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(a["receiver_id"], dest().as_str());
            assert_eq!(a["amount"], "10000000");
            assert_eq!(a["memo"], "pay-1");
        }
        other => panic!("unexpected action {other:?}"),
    }
    // 3) self.on_pay_complete
    assert_eq!(receipts[2].receiver_id, treasury_id());
    match &receipts[2].actions[0] {
        MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            prepaid_gas,
            ..
        } => {
            assert_eq!(method_name, b"on_pay_complete");
            assert_eq!(attached_deposit.as_yoctonear(), 0);
            assert!(*prepaid_gas >= GAS_FOR_ON_PAY_COMPLETE);
            let a: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(a["payment_id"], "pay-1");
        }
        other => panic!("unexpected action {other:?}"),
    }
}

#[test]
fn callback_success_marks_done() {
    let mut c = setup();
    pay(&mut c, "pay-1", 10 * USDC);
    assert!(complete(&mut c, "pay-1", true, T0 + 5));
    assert_eq!(
        c.get_payment("pay-1".into()).unwrap().status,
        PaymentStatus::Done
    );
    assert_eq!(c.get_config().spent_today, U128(10 * USDC));
    let ev = last_event();
    assert_eq!(ev["event"], "payment_completed");
    assert_eq!(ev["data"][0]["payment_id"], "pay-1");
}

#[test]
fn callback_failure_marks_failed_and_restores_quota() {
    let mut c = setup();
    pay(&mut c, "pay-1", 10 * USDC);
    pay(&mut c, "pay-2", 20 * USDC);
    assert_eq!(c.get_config().spent_today, U128(30 * USDC));
    assert!(!complete(&mut c, "pay-2", false, T0 + 5));
    assert_eq!(
        c.get_payment("pay-2".into()).unwrap().status,
        PaymentStatus::Failed
    );
    assert_eq!(c.get_config().spent_today, U128(10 * USDC));
    let ev = last_event();
    assert_eq!(ev["event"], "payment_failed");
    assert_eq!(ev["data"][0]["amount"], "20000000");
}

#[test]
fn callback_failure_next_day_does_not_touch_new_day_quota() {
    let mut c = setup();
    pay(&mut c, "pay-1", 40 * USDC);
    // Al día siguiente se gasta algo y luego llega el fallo del pago de ayer.
    let tomorrow = T0 + DAY_NS;
    Env::new(agent()).at(tomorrow).apply();
    let _ = c.pay("pay-2".into(), dest(), U128(15 * USDC));
    assert_eq!(c.get_config().spent_today, U128(15 * USDC));
    assert!(!complete(&mut c, "pay-1", false, tomorrow + 1));
    assert_eq!(c.get_config().spent_today, U128(15 * USDC));
    assert_eq!(
        c.get_payment("pay-1".into()).unwrap().status,
        PaymentStatus::Failed
    );
}

#[test]
fn callback_with_no_results_counts_as_failure() {
    let mut c = setup();
    pay(&mut c, "pay-1", 10 * USDC);
    Env::new(treasury_id()).apply();
    assert!(!c.on_pay_complete("pay-1".into()));
    assert_eq!(
        c.get_payment("pay-1".into()).unwrap().status,
        PaymentStatus::Failed
    );
}

#[test]
fn callback_is_not_reapplied_on_final_status() {
    let mut c = setup();
    pay(&mut c, "pay-1", 10 * USDC);
    assert!(complete(&mut c, "pay-1", true, T0));
    // Un segundo callback (no debería ocurrir) no cambia nada.
    assert!(complete(&mut c, "pay-1", false, T0));
    assert_eq!(
        c.get_payment("pay-1".into()).unwrap().status,
        PaymentStatus::Done
    );
    assert_eq!(c.get_config().spent_today, U128(10 * USDC));
}

#[test]
#[should_panic(expected = "ERR_UNKNOWN_PAYMENT_ID")]
fn callback_unknown_id_panics() {
    let mut c = setup();
    complete(&mut c, "nope", true, T0);
}

// ---------------------------------------------------------------- pay: guardas

#[test]
#[should_panic(expected = "ERR_NOT_AGENT")]
fn pay_rejects_non_agent() {
    let mut c = setup();
    as_(stranger());
    let _ = c.pay("pay-1".into(), dest(), U128(USDC));
}

#[test]
#[should_panic(expected = "ERR_NOT_AGENT")]
fn pay_rejects_owner_too() {
    let mut c = setup();
    as_(owner());
    let _ = c.pay("pay-1".into(), dest(), U128(USDC));
}

#[test]
#[should_panic(expected = "ERR_NOT_AGENT")]
fn pay_rejects_when_no_agent() {
    let mut c = setup();
    signed(owner());
    c.set_agent(None);
    as_(agent());
    let _ = c.pay("pay-1".into(), dest(), U128(USDC));
}

#[test]
#[should_panic(expected = "ERR_PAUSED")]
fn pay_rejects_when_paused() {
    let mut c = setup();
    as_(agent());
    c.pause();
    let _ = c.pay("pay-1".into(), dest(), U128(USDC));
}

#[test]
#[should_panic(expected = "ERR_OVER_MAX_PER_PAYMENT")]
fn pay_rejects_over_max() {
    let mut c = setup();
    pay(&mut c, "pay-1", 50 * USDC + 1);
}

#[test]
fn pay_accepts_exact_max() {
    let mut c = setup();
    pay(&mut c, "pay-1", 50 * USDC);
    assert_eq!(c.get_config().spent_today, U128(50 * USDC));
}

#[test]
#[should_panic(expected = "ERR_ZERO_AMOUNT")]
fn pay_rejects_zero() {
    let mut c = setup();
    pay(&mut c, "pay-1", 0);
}

#[test]
fn pay_accepts_exact_daily_limit() {
    let mut c = setup();
    pay(&mut c, "a", 50 * USDC);
    pay(&mut c, "b", 50 * USDC);
    let cfg = c.get_config();
    assert_eq!(cfg.spent_today, U128(100 * USDC));
    assert_eq!(cfg.remaining_today, U128(0));
}

#[test]
#[should_panic(expected = "ERR_OVER_DAILY_LIMIT")]
fn pay_rejects_one_unit_over_daily_limit() {
    let mut c = setup();
    pay(&mut c, "a", 50 * USDC);
    pay(&mut c, "b", 50 * USDC);
    pay(&mut c, "c", 1);
}

#[test]
#[should_panic(expected = "ERR_OVER_DAILY_LIMIT")]
fn pay_rejects_partial_overflow_of_daily_limit() {
    let mut c = setup();
    pay(&mut c, "a", 50 * USDC);
    pay(&mut c, "b", 40 * USDC);
    pay(&mut c, "c", 10 * USDC + 1);
}

#[test]
fn day_rollover_resets_counter() {
    let mut c = setup();
    pay(&mut c, "a", 50 * USDC);
    pay(&mut c, "b", 50 * USDC);
    // Último nanosegundo del mismo día: sigue bloqueado.
    let end_of_day = (T0 / DAY_NS + 1) * DAY_NS - 1;
    Env::new(agent()).at(end_of_day).apply();
    assert_eq!(c.get_config().remaining_today, U128(0));
    // Primer nanosegundo del día siguiente: contador a cero (también en la vista).
    let next_day = end_of_day + 1;
    Env::new(agent()).at(next_day).apply();
    let cfg = c.get_config();
    assert_eq!(cfg.spent_today, U128(0));
    assert_eq!(cfg.remaining_today, U128(100 * USDC));
    assert_eq!(cfg.day, T0 / DAY_NS + 1);
    let _ = c.pay("c".into(), dest(), U128(50 * USDC));
    assert_eq!(c.get_config().spent_today, U128(50 * USDC));
}

#[test]
#[should_panic(expected = "ERR_OVER_DAILY_LIMIT")]
fn same_day_late_still_limited() {
    let mut c = setup();
    pay(&mut c, "a", 50 * USDC);
    pay(&mut c, "b", 50 * USDC);
    let end_of_day = (T0 / DAY_NS + 1) * DAY_NS - 1;
    Env::new(agent()).at(end_of_day).apply();
    let _ = c.pay("c".into(), dest(), U128(1));
}

#[test]
#[should_panic(expected = "ERR_DUPLICATE_PAYMENT_ID")]
fn pay_rejects_duplicate_id() {
    let mut c = setup();
    pay(&mut c, "pay-1", USDC);
    pay(&mut c, "pay-1", USDC);
}

#[test]
#[should_panic(expected = "ERR_DUPLICATE_PAYMENT_ID")]
fn pay_rejects_duplicate_id_even_after_failure() {
    let mut c = setup();
    pay(&mut c, "pay-1", USDC);
    complete(&mut c, "pay-1", false, T0);
    pay(&mut c, "pay-1", USDC);
}

#[test]
fn payment_id_validation() {
    let valid = [
        "a".to_string(),
        "A-z_09".to_string(),
        "x".repeat(64),
        "3fa85f64-5717-4562-b3fc-2c963f66afa6".to_string(),
    ];
    for id in valid {
        let mut c = setup();
        pay(&mut c, &id, USDC);
        assert!(c.get_payment(id).is_some());
    }
    let invalid = [
        String::new(),
        "x".repeat(65),
        "has space".to_string(),
        "dot.dot".to_string(),
        "slash/".to_string(),
        "ñ".to_string(),
        "emoji-\u{1F600}".to_string(),
        "quote\"".to_string(),
    ];
    for id in invalid {
        let mut c = setup();
        as_(agent());
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = c.pay(id.clone(), dest(), U128(USDC));
        }));
        assert!(r.is_err(), "id {id:?} should be rejected");
    }
}

#[test]
#[should_panic(expected = "ERR_INVALID_PAYMENT_ID")]
fn pay_rejects_invalid_id_message() {
    let mut c = setup();
    pay(&mut c, "bad id", USDC);
}

#[test]
#[should_panic(expected = "ERR_INSUFFICIENT_NEAR_FOR_STORAGE")]
fn pay_rejects_without_near_for_storage() {
    let mut c = setup();
    // Sólo cubre el storage actual, no el registro nuevo + 0.00125 NEAR.
    let used = u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear();
    Env::new(agent())
        .balance(NearToken::from_yoctonear(
            used + STORAGE_DEPOSIT.as_yoctonear(),
        ))
        .apply();
    let _ = c.pay("pay-1".into(), dest(), U128(USDC));
}

#[test]
fn pay_accepts_with_just_enough_near() {
    let mut c = setup();
    let byte_cost = env::storage_byte_cost().as_yoctonear();
    let need = u128::from(env::storage_usage() + PAYMENT_RECORD_MAX_BYTES) * byte_cost
        + STORAGE_DEPOSIT.as_yoctonear();
    Env::new(agent())
        .balance(NearToken::from_yoctonear(need))
        .apply();
    let _ = c.pay("pay-1".into(), dest(), U128(USDC));
    assert!(c.get_payment("pay-1".into()).is_some());
}

#[test]
fn payment_record_fits_storage_estimate() {
    let mut c = setup();
    as_(agent());
    let before = env::storage_usage();
    let long_id = "x".repeat(64);
    let _ = c.pay(long_id, dest(), U128(USDC));
    drop(c); // flush de las colecciones
    let after = env::storage_usage();
    let used = after - before;
    println!("worst-case payment record: {used} bytes");
    assert!(used > 200, "flush did not happen ({used} bytes)");
    assert!(
        used <= PAYMENT_RECORD_MAX_BYTES,
        "payment used {used} bytes > estimate {PAYMENT_RECORD_MAX_BYTES}"
    );
}

#[test]
#[should_panic(expected = "ERR_NOT_ENOUGH_GAS")]
fn pay_rejects_low_gas() {
    let mut c = setup();
    Env::new(agent()).gas(Gas::from_tgas(59)).apply();
    let _ = c.pay("pay-1".into(), dest(), U128(USDC));
}

// ---------------------------------------------------------------- pausa

#[test]
fn agent_can_pause() {
    let mut c = setup();
    as_(agent());
    c.pause();
    assert!(c.get_config().paused);
    let ev = last_event();
    assert_eq!(ev["event"], "paused");
    assert_eq!(ev["data"][0]["by"], agent().as_str());
}

#[test]
fn owner_can_pause_and_unpause() {
    let mut c = setup();
    as_(owner());
    c.pause();
    assert!(c.get_config().paused);
    signed(owner());
    c.unpause();
    assert!(!c.get_config().paused);
    assert_eq!(last_event()["event"], "unpaused");
    // Tras reanudar, el agente vuelve a poder pagar.
    pay(&mut c, "pay-1", USDC);
}

#[test]
fn pause_is_idempotent() {
    let mut c = setup();
    as_(agent());
    c.pause();
    c.pause();
    assert_eq!(events().len(), 1);
    assert!(c.get_config().paused);
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn agent_cannot_unpause() {
    let mut c = setup();
    as_(agent());
    c.pause();
    // Ni siquiera con 1 yocto.
    signed(agent());
    c.unpause();
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER_OR_AGENT")]
fn stranger_cannot_pause() {
    let mut c = setup();
    as_(stranger());
    c.pause();
}

// ---------------------------------------------------------------- owner

#[test]
fn set_limits_by_owner() {
    let mut c = setup();
    signed(owner());
    c.set_limits(U128(5 * USDC), U128(5 * USDC));
    let cfg = c.get_config();
    assert_eq!(cfg.max_per_payment, U128(5 * USDC));
    assert_eq!(cfg.daily_limit, U128(5 * USDC));
    let ev = last_event();
    assert_eq!(ev["event"], "limits_updated");
    assert_eq!(ev["data"][0]["max_per_payment"], "5000000");
    assert_eq!(ev["data"][0]["daily_limit"], "5000000");
}

#[test]
fn lowering_daily_limit_below_spent_blocks_further_payments() {
    let mut c = setup();
    pay(&mut c, "a", 30 * USDC);
    signed(owner());
    c.set_limits(U128(10 * USDC), U128(20 * USDC));
    assert_eq!(c.get_config().remaining_today, U128(0));
    as_(agent());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.pay("b".into(), dest(), U128(1));
    }));
    assert!(r.is_err());
}

#[test]
#[should_panic(expected = "ERR_INVALID_LIMITS")]
fn set_limits_rejects_max_over_daily() {
    let mut c = setup();
    signed(owner());
    c.set_limits(U128(10), U128(9));
}

#[test]
#[should_panic(expected = "ERR_INVALID_LIMITS")]
fn set_limits_rejects_zero_max() {
    let mut c = setup();
    signed(owner());
    c.set_limits(U128(0), U128(9));
}

#[test]
#[should_panic(expected = "ERR_INVALID_LIMITS")]
fn set_limits_rejects_zero_daily() {
    let mut c = setup();
    signed(owner());
    c.set_limits(U128(0), U128(0));
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn set_limits_rejects_agent() {
    let mut c = setup();
    signed(agent());
    c.set_limits(U128(1_000 * USDC), U128(1_000 * USDC));
}

#[test]
fn set_agent_by_owner() {
    let mut c = setup();
    signed(owner());
    let new_agent: AccountId = "agent2.near".parse().unwrap();
    c.set_agent(Some(new_agent.clone()));
    assert_eq!(c.get_config().agent_id, Some(new_agent.clone()));
    let ev = last_event();
    assert_eq!(ev["event"], "agent_updated");
    assert_eq!(ev["data"][0]["old_agent_id"], agent().as_str());
    assert_eq!(ev["data"][0]["new_agent_id"], new_agent.as_str());
    // El agente antiguo ya no puede pagar; el nuevo sí.
    as_(agent());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = c.pay("x".into(), dest(), U128(1));
    }));
    assert!(r.is_err());
    as_(new_agent);
    let _ = c.pay("y".into(), dest(), U128(1));
    assert!(c.get_payment("y".into()).is_some());
}

#[test]
fn set_agent_none_emits_null() {
    let mut c = setup();
    signed(owner());
    c.set_agent(None);
    assert_eq!(c.get_config().agent_id, None);
    assert!(last_event()["data"][0]["new_agent_id"].is_null());
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn set_agent_rejects_agent() {
    let mut c = setup();
    signed(agent());
    c.set_agent(Some(stranger()));
}

#[test]
fn set_owner_transfers_control() {
    let mut c = setup();
    signed(owner());
    let new_owner: AccountId = "new-owner.near".parse().unwrap();
    c.set_owner(new_owner.clone());
    assert_eq!(c.get_config().owner_id, new_owner);
    let ev = last_event();
    assert_eq!(ev["event"], "owner_updated");
    assert_eq!(ev["data"][0]["old_owner_id"], owner().as_str());
    assert_eq!(ev["data"][0]["new_owner_id"], new_owner.as_str());
    // El owner viejo pierde permisos.
    signed(owner());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.unpause();
    }));
    assert!(r.is_err());
    signed(new_owner);
    c.set_limits(U128(1), U128(1));
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn set_owner_rejects_stranger() {
    let mut c = setup();
    signed(stranger());
    c.set_owner(stranger());
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn unpause_rejects_stranger() {
    let mut c = setup();
    signed(stranger());
    c.unpause();
}

// ---------------------------------------------------------------- withdraw

fn withdraw_env(who: AccountId, deposit: u128) {
    Env::new(who)
        .deposit(NearToken::from_yoctonear(deposit))
        .apply();
}

#[test]
fn withdraw_schedules_transfer() {
    let mut c = setup();
    withdraw_env(owner(), 1);
    let _ = c.withdraw(owner(), U128(25 * USDC));
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, usdc());
    match &receipts[0].actions[0] {
        MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            ..
        } => {
            assert_eq!(method_name, b"ft_transfer");
            assert_eq!(*attached_deposit, ONE_YOCTO);
            let a: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(a["receiver_id"], owner().as_str());
            assert_eq!(a["amount"], "25000000");
        }
        other => panic!("unexpected action {other:?}"),
    }
    assert_eq!(receipts[1].receiver_id, treasury_id());
}

#[test]
fn withdraw_works_while_paused() {
    let mut c = setup();
    as_(agent());
    c.pause();
    withdraw_env(owner(), 1);
    let _ = c.withdraw(owner(), U128(USDC));
    assert_eq!(get_created_receipts().len(), 2);
}

#[test]
fn withdraw_callback_emits_event_on_success() {
    let mut c = setup();
    Env::new(treasury_id())
        .results(vec![PromiseResult::Successful(vec![])])
        .apply();
    assert!(c.on_withdraw_complete(owner(), U128(USDC)));
    let ev = last_event();
    assert_eq!(ev["event"], "withdrawn");
    assert_eq!(ev["data"][0]["receiver_id"], owner().as_str());
    assert_eq!(ev["data"][0]["amount"], "1000000");
}

#[test]
fn withdraw_callback_logs_failure() {
    let mut c = setup();
    Env::new(treasury_id())
        .results(vec![PromiseResult::Failed])
        .apply();
    assert!(!c.on_withdraw_complete(owner(), U128(USDC)));
    assert!(events().is_empty());
    assert!(get_logs()[0].starts_with("ERR_WITHDRAW_FAILED"));
}

#[test]
#[should_panic(expected = "ERR_REQUIRES_ONE_YOCTO")]
fn withdraw_requires_one_yocto() {
    let mut c = setup();
    withdraw_env(owner(), 0);
    let _ = c.withdraw(owner(), U128(USDC));
}

#[test]
#[should_panic(expected = "ERR_REQUIRES_ONE_YOCTO")]
fn withdraw_rejects_more_than_one_yocto() {
    let mut c = setup();
    withdraw_env(owner(), 2);
    let _ = c.withdraw(owner(), U128(USDC));
}

#[test]
#[should_panic(expected = "ERR_NOT_OWNER")]
fn withdraw_rejects_agent() {
    let mut c = setup();
    withdraw_env(agent(), 1);
    let _ = c.withdraw(agent(), U128(USDC));
}

#[test]
#[should_panic(expected = "ERR_ZERO_AMOUNT")]
fn withdraw_rejects_zero() {
    let mut c = setup();
    withdraw_env(owner(), 1);
    let _ = c.withdraw(owner(), U128(0));
}

// ---------------------------------------------------------------- ft_on_transfer

#[test]
fn ft_on_transfer_accepts_usdc() {
    let mut c = setup();
    as_(usdc());
    match c.ft_on_transfer(owner(), U128(100 * USDC), String::new()) {
        PromiseOrValue::Value(v) => assert_eq!(v, U128(0)),
        PromiseOrValue::Promise(_) => panic!("expected value"),
    }
}

#[test]
fn ft_on_transfer_refunds_other_tokens() {
    let mut c = setup();
    as_("fake-usdc.near".parse().unwrap());
    match c.ft_on_transfer(owner(), U128(100 * USDC), String::new()) {
        PromiseOrValue::Value(v) => assert_eq!(v, U128(100 * USDC)),
        PromiseOrValue::Promise(_) => panic!("expected value"),
    }
}

#[test]
fn ft_on_transfer_refunds_direct_call() {
    // Alguien llama directamente a ft_on_transfer haciéndose pasar por un depósito.
    let mut c = setup();
    as_(stranger());
    match c.ft_on_transfer(stranger(), U128(5), "x".into()) {
        PromiseOrValue::Value(v) => assert_eq!(v, U128(5)),
        PromiseOrValue::Promise(_) => panic!("expected value"),
    }
}

// ---------------------------------------------------------------- vistas paginadas

#[test]
fn get_payment_missing_is_none() {
    let c = setup();
    assert!(c.get_payment("nope".into()).is_none());
}

#[test]
fn get_payments_pages_in_order() {
    let mut c = setup();
    for i in 0..5 {
        pay(&mut c, &format!("p{i}"), USDC);
    }
    complete(&mut c, "p1", true, T0);
    complete(&mut c, "p3", false, T0);

    let all = c.get_payments(0, 10);
    let ids: Vec<&str> = all.iter().map(|p| p.payment_id.as_str()).collect();
    assert_eq!(ids, ["p0", "p1", "p2", "p3", "p4"]);
    assert_eq!(all[1].status, PaymentStatus::Done);
    assert_eq!(all[3].status, PaymentStatus::Failed);
    assert_eq!(all[0].status, PaymentStatus::Pending);

    let page = c.get_payments(2, 2);
    let ids: Vec<&str> = page.iter().map(|p| p.payment_id.as_str()).collect();
    assert_eq!(ids, ["p2", "p3"]);

    assert!(c.get_payments(5, 10).is_empty());
    assert!(c.get_payments(100, 10).is_empty());
    assert!(c.get_payments(0, 0).is_empty());
    assert!(c.get_payments(u64::MAX, u64::MAX).is_empty());
}

#[test]
fn get_payments_caps_page_size() {
    let mut c = setup();
    signed(owner());
    c.set_limits(U128(1), U128(1_000));
    for i in 0..(MAX_PAGE_SIZE + 5) {
        pay(&mut c, &format!("p{i}"), 1);
    }
    assert_eq!(c.get_payments(0, 1_000).len() as u64, MAX_PAGE_SIZE);
    assert_eq!(c.get_payments(MAX_PAGE_SIZE, 1_000).len(), 5);
}

// ---------------------------------------------------------------- 1 yocto en métodos de owner

/// Genera pruebas que rechazan 0 y 2 yoctoNEAR en un método de owner.
macro_rules! requires_one_yocto {
    ($zero:ident, $two:ident, |$c:ident| $call:expr) => {
        #[test]
        #[should_panic(expected = "ERR_REQUIRES_ONE_YOCTO")]
        fn $zero() {
            let mut $c = setup();
            as_(owner());
            $call;
        }

        #[test]
        #[should_panic(expected = "ERR_REQUIRES_ONE_YOCTO")]
        fn $two() {
            let mut $c = setup();
            Env::new(owner())
                .deposit(NearToken::from_yoctonear(2))
                .apply();
            $call;
        }
    };
}

requires_one_yocto!(unpause_rejects_zero_yocto, unpause_rejects_two_yocto, |c| c
    .unpause());
requires_one_yocto!(
    set_agent_rejects_zero_yocto,
    set_agent_rejects_two_yocto,
    |c| c.set_agent(Some(stranger()))
);
requires_one_yocto!(
    set_limits_rejects_zero_yocto,
    set_limits_rejects_two_yocto,
    |c| c.set_limits(U128(1), U128(1))
);
requires_one_yocto!(
    set_owner_rejects_zero_yocto,
    set_owner_rejects_two_yocto,
    |c| c.set_owner(stranger())
);

#[test]
fn owner_methods_accept_exactly_one_yocto() {
    let mut c = setup();
    as_(owner());
    c.pause();
    signed(owner());
    c.unpause();
    c.set_limits(U128(2), U128(3));
    c.set_agent(Some(stranger()));
    c.set_owner(stranger());
    let cfg = c.get_config();
    assert!(!cfg.paused);
    assert_eq!(cfg.max_per_payment, U128(2));
    assert_eq!(cfg.agent_id, Some(stranger()));
    assert_eq!(cfg.owner_id, stranger());
}

#[test]
fn pause_needs_no_deposit_for_agent_or_owner() {
    let mut c = setup();
    as_(agent());
    c.pause();
    assert!(c.get_config().paused);
    signed(owner());
    c.unpause();
    as_(owner());
    c.pause();
    assert!(c.get_config().paused);
}
