//! # tesorero-treasury
//!
//! Contrato de tesorería de Tesorero (ADR-0005). Custodia USDC (NEP-141) y sólo deja
//! pagar a la cuenta **agente**, dentro de un límite por pago y un límite diario (día UTC
//! según `block_timestamp`), con pausa de emergencia. El owner fija límites, agente y
//! retira fondos con su propia wallet.
//!
//! Flujo de `pay`:
//! `usdc.storage_deposit(deposit_address, registration_only)` → `usdc.ft_transfer(...)`
//! → `self.on_pay_complete(payment_id)`, que marca `Done` o `Failed` (y en ese caso
//! devuelve el cupo diario si seguimos en el mismo día UTC).

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseError, PromiseOrValue,
};

#[cfg(test)]
mod tests;

/// Nanosegundos en un día UTC.
pub const DAY_NS: u64 = 86_400 * 1_000_000_000;
/// Depósito de storage NEP-145 que se adjunta a `usdc.storage_deposit` (0.00125 NEAR).
pub const STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
/// Depósito obligatorio de `ft_transfer` (NEP-141).
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

/// Gas estático por tramo de la cadena de promesas. El gas sobrante se reparte además
/// entre los tramos (peso por defecto 1), así que son mínimos garantizados.
pub const GAS_FOR_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
pub const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(15);
pub const GAS_FOR_ON_PAY_COMPLETE: Gas = Gas::from_tgas(10);
pub const GAS_FOR_ON_WITHDRAW_COMPLETE: Gas = Gas::from_tgas(5);
/// Gas mínimo adjunto a `pay` (los tramos suman 35 Tgas + la propia ejecución).
pub const MIN_GAS_FOR_PAY: Gas = Gas::from_tgas(60);
/// Gas mínimo adjunto a `withdraw`.
pub const MIN_GAS_FOR_WITHDRAW: Gas = Gas::from_tgas(40);

/// Cota superior (bytes) del storage que añade un pago: registro + entrada del índice,
/// con `payment_id` y `deposit_address` de 64 caracteres y los 40 bytes por entrada que
/// cobra el protocolo. Se usa para exigir NEAR suficiente *antes* de escribir.
pub const PAYMENT_RECORD_MAX_BYTES: u64 = 400;
/// Longitud máxima de `payment_id`.
pub const MAX_PAYMENT_ID_LEN: usize = 64;
/// Tamaño máximo de página de `get_payments`.
pub const MAX_PAGE_SIZE: u64 = 100;

/// Interfaz NEP-141 / NEP-145 del token USDC que usamos.
#[ext_contract(ext_ft)]
#[allow(dead_code)]
pub trait FungibleToken {
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Payments,
    PaymentIds,
}

/// Estado de un pago.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaymentStatus {
    Pending,
    Done,
    Failed,
}

/// Registro de un pago en storage (el `payment_id` es la clave).
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct PaymentRecord {
    pub deposit_address: AccountId,
    pub amount: u128,
    pub status: PaymentStatus,
    pub created_at_ns: u64,
}

/// Vista JSON de un pago (`get_payment` / `get_payments`).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PaymentView {
    pub payment_id: String,
    pub deposit_address: AccountId,
    pub amount: U128,
    pub status: PaymentStatus,
    pub created_at_ns: u64,
}

/// Vista JSON de la configuración (`get_config`).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub agent_id: Option<AccountId>,
    pub usdc_contract_id: AccountId,
    pub max_per_payment: U128,
    pub daily_limit: U128,
    pub paused: bool,
    pub spent_today: U128,
    pub remaining_today: U128,
    pub day: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Treasury {
    owner_id: AccountId,
    agent_id: Option<AccountId>,
    usdc_contract_id: AccountId,
    max_per_payment: u128,
    daily_limit: u128,
    paused: bool,
    /// Índice del día UTC al que corresponde `spent_today`.
    current_day: u64,
    spent_today: u128,
    payments: LookupMap<String, PaymentRecord>,
    payment_ids: Vector<String>,
}

#[near]
impl Treasury {
    #[init]
    pub fn new(
        owner_id: AccountId,
        usdc_contract_id: AccountId,
        agent_id: Option<AccountId>,
        max_per_payment: U128,
        daily_limit: U128,
    ) -> Self {
        assert_valid_limits(max_per_payment.0, daily_limit.0);
        Self {
            owner_id,
            agent_id,
            usdc_contract_id,
            max_per_payment: max_per_payment.0,
            daily_limit: daily_limit.0,
            paused: false,
            current_day: today(),
            spent_today: 0,
            payments: LookupMap::new(StorageKey::Payments),
            payment_ids: Vector::new(StorageKey::PaymentIds),
        }
    }

    // ------------------------------------------------------------------ agente

    /// Paga `amount` (unidades base de USDC, 6 decimales) a `deposit_address`.
    /// Sólo el agente. Idempotente por `payment_id`: un id repetido se rechaza.
    pub fn pay(&mut self, payment_id: String, deposit_address: AccountId, amount: U128) -> Promise {
        self.assert_agent();
        require!(!self.paused, "ERR_PAUSED");
        require!(env::prepaid_gas() >= MIN_GAS_FOR_PAY, "ERR_NOT_ENOUGH_GAS");
        assert_valid_payment_id(&payment_id);
        require!(
            !self.payments.contains_key(&payment_id),
            "ERR_DUPLICATE_PAYMENT_ID"
        );
        let amount = amount.0;
        require!(amount > 0, "ERR_ZERO_AMOUNT");
        require!(amount <= self.max_per_payment, "ERR_OVER_MAX_PER_PAYMENT");

        self.roll_day();
        let new_spent = self
            .spent_today
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("ERR_OVER_DAILY_LIMIT"));
        require!(new_spent <= self.daily_limit, "ERR_OVER_DAILY_LIMIT");
        self.assert_enough_near_for_payment();

        let created_at_ns = env::block_timestamp();
        self.payments.insert(
            payment_id.clone(),
            PaymentRecord {
                deposit_address: deposit_address.clone(),
                amount,
                status: PaymentStatus::Pending,
                created_at_ns,
            },
        );
        self.payment_ids.push(payment_id.clone());
        self.spent_today = new_spent;

        emit(
            "payment_requested",
            &PaymentEvent {
                payment_id: &payment_id,
                deposit_address: &deposit_address,
                amount: U128(amount),
            },
        );

        ext_ft::ext(self.usdc_contract_id.clone())
            .with_attached_deposit(STORAGE_DEPOSIT)
            .with_static_gas(GAS_FOR_STORAGE_DEPOSIT)
            .storage_deposit(Some(deposit_address.clone()), Some(true))
            .then(
                ext_ft::ext(self.usdc_contract_id.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_FOR_FT_TRANSFER)
                    .ft_transfer(deposit_address, U128(amount), Some(payment_id.clone())),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_PAY_COMPLETE)
                    .on_pay_complete(payment_id),
            )
    }

    /// Callback de `pay`: lee el resultado de `ft_transfer`.
    #[private]
    pub fn on_pay_complete(&mut self, payment_id: String) -> bool {
        let success = last_promise_succeeded();

        let mut record = self
            .payments
            .get(&payment_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_UNKNOWN_PAYMENT_ID"));
        if record.status != PaymentStatus::Pending {
            // No debería ocurrir: el callback sólo se agenda una vez por pago.
            return record.status == PaymentStatus::Done;
        }

        let event = PaymentEvent {
            payment_id: &payment_id,
            deposit_address: &record.deposit_address,
            amount: U128(record.amount),
        };
        if success {
            emit("payment_completed", &event);
            record.status = PaymentStatus::Done;
        } else {
            emit("payment_failed", &event);
            self.roll_day();
            if record.created_at_ns / DAY_NS == self.current_day {
                self.spent_today = self.spent_today.saturating_sub(record.amount);
            }
            record.status = PaymentStatus::Failed;
        }
        self.payments.insert(payment_id, record);
        success
    }

    /// Kill switch: lo puede llamar el owner o el agente. Idempotente.
    pub fn pause(&mut self) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner_id || self.agent_id.as_ref() == Some(&caller),
            "ERR_NOT_OWNER_OR_AGENT"
        );
        if !self.paused {
            self.paused = true;
            emit("paused", &ByEvent { by: &caller });
        }
    }

    /// Recibe USDC (NEP-141 `ft_transfer_call`). Sólo acepta el token configurado.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = msg;
        if env::predecessor_account_id() == self.usdc_contract_id {
            env::log_str(&format!("deposit of {} from {}", amount.0, sender_id));
            PromiseOrValue::Value(U128(0))
        } else {
            env::log_str("ERR_TOKEN_NOT_ACCEPTED: refunding");
            PromiseOrValue::Value(amount)
        }
    }

    // ------------------------------------------------------------------ owner
    // Todos exigen exactamente 1 yoctoNEAR: sólo una clave full-access (confirmación en la
    // wallet) puede cambiar privilegios o reanudar tras una pausa de emergencia.

    #[payable]
    pub fn unpause(&mut self) {
        self.assert_owner_one_yocto();
        if self.paused {
            self.paused = false;
            emit(
                "unpaused",
                &ByEvent {
                    by: &env::predecessor_account_id(),
                },
            );
        }
    }

    #[payable]
    pub fn set_agent(&mut self, agent_id: Option<AccountId>) {
        self.assert_owner_one_yocto();
        let old = self.agent_id.take();
        self.agent_id = agent_id;
        emit(
            "agent_updated",
            &AgentEvent {
                old_agent_id: old.as_ref(),
                new_agent_id: self.agent_id.as_ref(),
            },
        );
    }

    #[payable]
    pub fn set_limits(&mut self, max_per_payment: U128, daily_limit: U128) {
        self.assert_owner_one_yocto();
        assert_valid_limits(max_per_payment.0, daily_limit.0);
        self.max_per_payment = max_per_payment.0;
        self.daily_limit = daily_limit.0;
        emit(
            "limits_updated",
            &LimitsEvent {
                max_per_payment,
                daily_limit,
            },
        );
    }

    #[payable]
    pub fn set_owner(&mut self, new_owner_id: AccountId) {
        self.assert_owner_one_yocto();
        let old = std::mem::replace(&mut self.owner_id, new_owner_id);
        emit(
            "owner_updated",
            &OwnerEvent {
                old_owner_id: &old,
                new_owner_id: &self.owner_id,
            },
        );
    }

    /// Retira USDC del contrato. Owner, exactamente 1 yoctoNEAR (fuerza clave full-access).
    #[payable]
    pub fn withdraw(&mut self, receiver_id: AccountId, amount: U128) -> Promise {
        self.assert_owner_one_yocto();
        require!(amount.0 > 0, "ERR_ZERO_AMOUNT");
        require!(
            env::prepaid_gas() >= MIN_GAS_FOR_WITHDRAW,
            "ERR_NOT_ENOUGH_GAS"
        );
        ext_ft::ext(self.usdc_contract_id.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(
                receiver_id.clone(),
                amount,
                Some("tesorero withdraw".to_string()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_WITHDRAW_COMPLETE)
                    .on_withdraw_complete(receiver_id, amount),
            )
    }

    /// Callback de `withdraw`: emite `withdrawn` sólo si la transferencia salió bien.
    #[private]
    pub fn on_withdraw_complete(&mut self, receiver_id: AccountId, amount: U128) -> bool {
        let success = last_promise_succeeded();

        if success {
            emit(
                "withdrawn",
                &WithdrawnEvent {
                    receiver_id: &receiver_id,
                    amount,
                },
            );
        } else {
            env::log_str(&format!(
                "ERR_WITHDRAW_FAILED: {} to {}",
                amount.0, receiver_id
            ));
        }
        success
    }

    // ------------------------------------------------------------------ vistas

    pub fn get_config(&self) -> ConfigView {
        let day = today();
        let spent = if day == self.current_day {
            self.spent_today
        } else {
            0
        };
        ConfigView {
            owner_id: self.owner_id.clone(),
            agent_id: self.agent_id.clone(),
            usdc_contract_id: self.usdc_contract_id.clone(),
            max_per_payment: U128(self.max_per_payment),
            daily_limit: U128(self.daily_limit),
            paused: self.paused,
            spent_today: U128(spent),
            remaining_today: U128(self.daily_limit.saturating_sub(spent)),
            day,
        }
    }

    pub fn get_payment(&self, payment_id: String) -> Option<PaymentView> {
        let record = self.payments.get(&payment_id)?;
        Some(to_view(payment_id, record))
    }

    /// Página de pagos en orden de creación. `limit` se acota a 100.
    pub fn get_payments(&self, from_index: u64, limit: u64) -> Vec<PaymentView> {
        let len = u64::from(self.payment_ids.len());
        let end = from_index.saturating_add(limit.min(MAX_PAGE_SIZE)).min(len);
        (from_index..end)
            .filter_map(|i| {
                let id = self.payment_ids.get(u32::try_from(i).ok()?)?;
                let record = self.payments.get(id)?;
                Some(to_view(id.clone(), record))
            })
            .collect()
    }
}

// ---------------------------------------------------------------------- internos

impl Treasury {
    /// Owner + exactamente 1 yoctoNEAR (`ERR_NOT_OWNER` / `ERR_REQUIRES_ONE_YOCTO`).
    fn assert_owner_one_yocto(&self) {
        self.assert_owner();
        require!(
            env::attached_deposit() == ONE_YOCTO,
            "ERR_REQUIRES_ONE_YOCTO"
        );
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "ERR_NOT_OWNER"
        );
    }

    fn assert_agent(&self) {
        require!(
            self.agent_id.as_ref() == Some(&env::predecessor_account_id()),
            "ERR_NOT_AGENT"
        );
    }

    /// Reinicia el contador si cambió el día UTC.
    fn roll_day(&mut self) {
        let day = today();
        if day != self.current_day {
            self.current_day = day;
            self.spent_today = 0;
        }
    }

    /// Exige NEAR líquido para cubrir el storage actual + el nuevo registro + el
    /// storage deposit que se adjunta a `usdc.storage_deposit`.
    fn assert_enough_near_for_payment(&self) {
        let byte_cost = env::storage_byte_cost().as_yoctonear();
        let storage_needed =
            u128::from(env::storage_usage().saturating_add(PAYMENT_RECORD_MAX_BYTES))
                .saturating_mul(byte_cost);
        let required = storage_needed.saturating_add(STORAGE_DEPOSIT.as_yoctonear());
        require!(
            env::account_balance().as_yoctonear() >= required,
            "ERR_INSUFFICIENT_NEAR_FOR_STORAGE"
        );
    }
}

/// `true` si la �nica promesa de la que depende este callback termin� bien. No copia el
/// valor devuelto (`max_len = 0`): un resultado no vac�o tambi�n cuenta como �xito.
fn last_promise_succeeded() -> bool {
    if env::promise_results_count() != 1 {
        return false;
    }
    match env::promise_result_checked(0, 0) {
        Ok(_) | Err(PromiseError::TooLong(_)) => true,
        Err(_) => false,
    }
}

fn today() -> u64 {
    env::block_timestamp() / DAY_NS
}

fn assert_valid_limits(max_per_payment: u128, daily_limit: u128) {
    require!(
        max_per_payment > 0 && daily_limit > 0 && max_per_payment <= daily_limit,
        "ERR_INVALID_LIMITS"
    );
}

fn assert_valid_payment_id(payment_id: &str) {
    let ok = !payment_id.is_empty()
        && payment_id.len() <= MAX_PAYMENT_ID_LEN
        && payment_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    require!(ok, "ERR_INVALID_PAYMENT_ID");
}

fn to_view(payment_id: String, record: &PaymentRecord) -> PaymentView {
    PaymentView {
        payment_id,
        deposit_address: record.deposit_address.clone(),
        amount: U128(record.amount),
        status: record.status,
        created_at_ns: record.created_at_ns,
    }
}

// ---------------------------------------------------------------------- eventos

pub const EVENT_STANDARD: &str = "tesorero";
pub const EVENT_VERSION: &str = "1.0.0";

/// Emite un evento NEP-297: `EVENT_JSON:{"standard":"tesorero","version":"1.0.0","event":..,"data":[..]}`.
fn emit<T: Serialize>(event: &str, data: &T) {
    let data = near_sdk::serde_json::to_string(data)
        .unwrap_or_else(|_| env::panic_str("ERR_EVENT_SERIALIZATION"));
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"{EVENT_STANDARD}","version":"{EVENT_VERSION}","event":"{event}","data":[{data}]}}"#
    ));
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct PaymentEvent<'a> {
    payment_id: &'a str,
    deposit_address: &'a AccountId,
    amount: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ByEvent<'a> {
    by: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct AgentEvent<'a> {
    old_agent_id: Option<&'a AccountId>,
    new_agent_id: Option<&'a AccountId>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct LimitsEvent {
    max_per_payment: U128,
    daily_limit: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct OwnerEvent<'a> {
    old_owner_id: &'a AccountId,
    new_owner_id: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct WithdrawnEvent<'a> {
    receiver_id: &'a AccountId,
    amount: U128,
}
