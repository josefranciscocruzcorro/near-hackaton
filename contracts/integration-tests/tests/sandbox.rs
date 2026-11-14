//! Pruebas de integración en sandbox (nearcore local vía near-workspaces).
//!
//! Requieren los wasm ya compilados en `contracts/res/` (`./contracts/build.sh`).
//! `./contracts/test.sh` hace ambas cosas.

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

const USDC: u128 = 1_000_000;
const STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const PAY_GAS: Gas = Gas::from_tgas(100);

/// Cuenta implícita "fresca" (64 hex), como las deposit addresses de 1Click.
const DEST: &str = "8f6c2b1f0e7d4a3b9c5e1d2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b";

fn wasm(name: &str) -> Vec<u8> {
    let path = format!("{}/../res/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e} (ejecuta contracts/build.sh)"))
}

struct Ctx {
    worker: Worker<Sandbox>,
    owner: Account,
    agent: Account,
    stranger: Account,
    ft: Contract,
    treasury: Contract,
}

async fn subaccount(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(near))
        .transact()
        .await?
        .into_result()?)
}

async fn deploy_ft(root: &Account, name: &str, owner: &Account) -> anyhow::Result<Contract> {
    let acc = subaccount(root, name, 20).await?;
    let ft = acc.deploy(&wasm("mock_ft.wasm")).await?.into_result()?;
    ft.call("new")
        .args_json(
            json!({ "owner_id": owner.id(), "total_supply": (1_000_000 * USDC).to_string() }),
        )
        .transact()
        .await?
        .into_result()?;
    Ok(ft)
}

/// Despliega mock USDC + treasury (max 50, diario 100), registra el treasury en el token
/// y lo fondea con `fund` unidades vía `ft_transfer_call` (msg "").
async fn setup(fund: u128) -> anyhow::Result<Ctx> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let owner = subaccount(&root, "owner", 50).await?;
    let agent = subaccount(&root, "agent", 10).await?;
    let stranger = subaccount(&root, "mallory", 10).await?;
    let ft = deploy_ft(&root, "usdc", &owner).await?;

    let t_acc = subaccount(&root, "tesorero", 10).await?;
    let treasury = t_acc
        .deploy(&wasm("tesorero_treasury.wasm"))
        .await?
        .into_result()?;
    treasury
        .call("new")
        .args_json(json!({
            "owner_id": owner.id(),
            "usdc_contract_id": ft.id(),
            "agent_id": agent.id(),
            "max_per_payment": (50 * USDC).to_string(),
            "daily_limit": (100 * USDC).to_string(),
        }))
        .transact()
        .await?
        .into_result()?;

    owner
        .call(ft.id(), "storage_deposit")
        .args_json(json!({ "account_id": treasury.id(), "registration_only": true }))
        .deposit(STORAGE_DEPOSIT)
        .transact()
        .await?
        .into_result()?;

    if fund > 0 {
        let res = owner
            .call(ft.id(), "ft_transfer_call")
            .args_json(
                json!({ "receiver_id": treasury.id(), "amount": fund.to_string(), "msg": "" }),
            )
            .deposit(ONE_YOCTO)
            .gas(Gas::from_tgas(100))
            .transact()
            .await?;
        assert!(res.is_success(), "{res:?}");
        assert_eq!(
            res.json::<String>()?,
            fund.to_string(),
            "ft_transfer_call used amount"
        );
    }

    Ok(Ctx {
        worker,
        owner,
        agent,
        stranger,
        ft,
        treasury,
    })
}

async fn ft_balance(ctx: &Ctx, account: &str) -> anyhow::Result<u128> {
    let v: String = ctx
        .ft
        .view("ft_balance_of")
        .args_json(json!({ "account_id": account }))
        .await?
        .json()?;
    Ok(v.parse()?)
}

async fn config(ctx: &Ctx) -> anyhow::Result<Value> {
    Ok(ctx.treasury.view("get_config").await?.json()?)
}

async fn payment(ctx: &Ctx, id: &str) -> anyhow::Result<Value> {
    Ok(ctx
        .treasury
        .view("get_payment")
        .args_json(json!({ "payment_id": id }))
        .await?
        .json()?)
}

async fn pay_as(
    who: &Account,
    ctx: &Ctx,
    id: &str,
    to: &str,
    amount: u128,
    gas: Gas,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(who
        .call(ctx.treasury.id(), "pay")
        .args_json(json!({ "payment_id": id, "deposit_address": to, "amount": amount.to_string() }))
        .gas(gas)
        .transact()
        .await?)
}

async fn pay(ctx: &Ctx, id: &str, to: &str, amount: u128) -> anyhow::Result<ExecutionFinalResult> {
    pay_as(&ctx.agent, ctx, id, to, amount, PAY_GAS).await
}

/// Valor de retorno final (el de `on_pay_complete` / `on_withdraw_complete`).
fn ret_bool(res: &ExecutionFinalResult) -> bool {
    res.clone().json::<bool>().expect("bool return value")
}

fn assert_fails_with(res: &ExecutionFinalResult, needle: &str) {
    assert!(
        res.is_failure(),
        "expected failure with {needle}, got {res:?}"
    );
    let dbg = format!("{:?}", res.clone().into_result().unwrap_err());
    assert!(dbg.contains(needle), "expected {needle} in {dbg}");
}

/// Eventos NEP-297 del estándar `tesorero` (se ignoran los `nep141` del token).
fn events(res: &ExecutionFinalResult) -> Vec<String> {
    res.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str::<Value>(j).unwrap())
        .filter(|v| v["standard"] == "tesorero")
        .map(|v| {
            assert_eq!(v["version"], "1.0.0");
            v["event"].as_str().unwrap().to_string()
        })
        .collect()
}

/// Eventos `nep141` del token (para comprobar que la transferencia ocurrió).
fn ft_events(res: &ExecutionFinalResult) -> Vec<Value> {
    res.logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str::<Value>(j).unwrap())
        .filter(|v| v["standard"] == "nep141")
        .collect()
}

#[tokio::test]
async fn pay_happy_path_to_fresh_implicit_account() -> anyhow::Result<()> {
    let ctx = setup(200 * USDC).await?;
    assert_eq!(
        ft_balance(&ctx, ctx.treasury.id().as_str()).await?,
        200 * USDC
    );

    let before = ctx.worker.view_account(ctx.treasury.id()).await?;
    let res = pay(&ctx, "pay-1", DEST, 10 * USDC).await?;
    assert!(res.is_success(), "{res:?}");
    assert!(ret_bool(&res), "on_pay_complete should return true");
    assert!(
        res.receipt_failures().is_empty(),
        "{:?}",
        res.receipt_failures()
    );
    assert_eq!(events(&res), ["payment_requested", "payment_completed"]);
    let ft = ft_events(&res);
    assert_eq!(ft.len(), 1, "{ft:?}");
    assert_eq!(ft[0]["event"], "ft_transfer");
    assert_eq!(ft[0]["data"][0]["memo"], "pay-1");
    assert_eq!(ft[0]["data"][0]["new_owner_id"], DEST);
    assert_eq!(ft[0]["data"][0]["amount"], "10000000");
    let after = ctx.worker.view_account(ctx.treasury.id()).await?;

    assert_eq!(ft_balance(&ctx, DEST).await?, 10 * USDC);
    assert_eq!(
        ft_balance(&ctx, ctx.treasury.id().as_str()).await?,
        190 * USDC
    );
    let p = payment(&ctx, "pay-1").await?;
    assert_eq!(p["status"], "Done");
    assert_eq!(p["amount"], "10000000");
    assert_eq!(p["deposit_address"], DEST);
    let cfg = config(&ctx).await?;
    assert_eq!(cfg["spent_today"], "10000000");
    assert_eq!(cfg["remaining_today"], "90000000");

    // Segundo pago al mismo destino (ya registrado: storage_deposit reembolsa).
    let res2 = pay(&ctx, "pay-2", DEST, 5 * USDC).await?;
    assert!(res2.is_success() && ret_bool(&res2), "{res2:?}");
    assert_eq!(ft_balance(&ctx, DEST).await?, 15 * USDC);
    let after2 = ctx.worker.view_account(ctx.treasury.id()).await?;

    let list: Vec<Value> = ctx
        .treasury
        .view("get_payments")
        .args_json(json!({ "from_index": 0, "limit": 10 }))
        .await?
        .json()?;
    assert_eq!(list.len(), 2);
    assert_eq!(list[0]["payment_id"], "pay-1");
    assert_eq!(list[1]["payment_id"], "pay-2");

    println!(
        "METRIC pay(new receiver): gas_burnt={} Tgas, storage_delta={} bytes, near_delta={} yocto",
        res.total_gas_burnt.as_tgas(),
        after.storage_usage - before.storage_usage,
        before.balance.as_yoctonear() as i128 - after.balance.as_yoctonear() as i128,
    );
    println!(
        "METRIC pay(registered receiver): gas_burnt={} Tgas, storage_delta={} bytes, near_delta={} yocto",
        res2.total_gas_burnt.as_tgas(),
        after2.storage_usage - after.storage_usage,
        after.balance.as_yoctonear() as i128 - after2.balance.as_yoctonear() as i128,
    );
    println!(
        "METRIC treasury storage after init+2 payments: {} bytes",
        after2.storage_usage
    );
    Ok(())
}

#[tokio::test]
async fn pay_with_minimum_gas_completes() -> anyhow::Result<()> {
    let ctx = setup(100 * USDC).await?;
    let res = pay_as(&ctx.agent, &ctx, "min-gas", DEST, USDC, Gas::from_tgas(60)).await?;
    assert!(res.is_success() && ret_bool(&res), "{res:?}");
    assert_eq!(payment(&ctx, "min-gas").await?["status"], "Done");

    let low = pay_as(&ctx.agent, &ctx, "low-gas", DEST, USDC, Gas::from_tgas(59)).await?;
    assert_fails_with(&low, "ERR_NOT_ENOUGH_GAS");
    assert!(payment(&ctx, "low-gas").await?.is_null());
    Ok(())
}

#[tokio::test]
async fn failed_transfer_marks_failed_and_restores_quota() -> anyhow::Result<()> {
    // El treasury sólo tiene 5 USDC: ft_transfer de 10 falla dentro de los límites.
    let ctx = setup(5 * USDC).await?;
    let res = pay(&ctx, "pay-fail", DEST, 10 * USDC).await?;
    assert!(res.is_success(), "outer tx resolves via callback: {res:?}");
    assert!(!ret_bool(&res), "on_pay_complete should return false");
    assert!(!res.receipt_failures().is_empty());
    assert_eq!(events(&res), ["payment_requested", "payment_failed"]);

    assert_eq!(payment(&ctx, "pay-fail").await?["status"], "Failed");
    let cfg = config(&ctx).await?;
    assert_eq!(cfg["spent_today"], "0");
    assert_eq!(cfg["remaining_today"], "100000000");
    assert_eq!(ft_balance(&ctx, DEST).await?, 0);
    assert_eq!(
        ft_balance(&ctx, ctx.treasury.id().as_str()).await?,
        5 * USDC
    );

    // El id queda consumido: reintentar exige un id nuevo.
    let dup = pay(&ctx, "pay-fail", DEST, USDC).await?;
    assert_fails_with(&dup, "ERR_DUPLICATE_PAYMENT_ID");
    Ok(())
}

#[tokio::test]
async fn guards_and_pause() -> anyhow::Result<()> {
    let ctx = setup(200 * USDC).await?;

    let r = pay_as(&ctx.stranger, &ctx, "x1", DEST, USDC, PAY_GAS).await?;
    assert_fails_with(&r, "ERR_NOT_AGENT");
    let r = pay_as(&ctx.owner, &ctx, "x1", DEST, USDC, PAY_GAS).await?;
    assert_fails_with(&r, "ERR_NOT_AGENT");
    assert_fails_with(
        &pay(&ctx, "x1", DEST, 50 * USDC + 1).await?,
        "ERR_OVER_MAX_PER_PAYMENT",
    );
    assert_fails_with(&pay(&ctx, "x1", DEST, 0).await?, "ERR_ZERO_AMOUNT");
    assert_fails_with(
        &pay(&ctx, "bad id", DEST, USDC).await?,
        "ERR_INVALID_PAYMENT_ID",
    );

    assert!(pay(&ctx, "a", DEST, 50 * USDC).await?.json::<bool>()?);
    assert!(pay(&ctx, "b", DEST, 50 * USDC).await?.json::<bool>()?);
    assert_fails_with(&pay(&ctx, "c", DEST, 1).await?, "ERR_OVER_DAILY_LIMIT");
    assert_fails_with(&pay(&ctx, "a", DEST, 1).await?, "ERR_DUPLICATE_PAYMENT_ID");
    assert_eq!(config(&ctx).await?["remaining_today"], "0");

    // Callback privado.
    let r = ctx
        .agent
        .call(ctx.treasury.id(), "on_pay_complete")
        .args_json(json!({ "payment_id": "a" }))
        .transact()
        .await?;
    assert_fails_with(&r, "is private");

    // Pausa: el agente puede, sólo el owner reanuda.
    let r = ctx
        .stranger
        .call(ctx.treasury.id(), "pause")
        .transact()
        .await?;
    assert_fails_with(&r, "ERR_NOT_OWNER_OR_AGENT");
    let r = ctx
        .agent
        .call(ctx.treasury.id(), "pause")
        .transact()
        .await?;
    assert!(r.is_success(), "{r:?}");
    assert_eq!(events(&r), ["paused"]);
    assert_eq!(config(&ctx).await?["paused"], true);

    // Subimos el límite para que lo único que bloquee sea la pausa.
    let r = ctx
        .owner
        .call(ctx.treasury.id(), "set_limits")
        .args_json(json!({ "max_per_payment": (50 * USDC).to_string(), "daily_limit": (1_000 * USDC).to_string() }))
        .deposit(ONE_YOCTO)        .transact()
        .await?;
    assert!(r.is_success(), "{r:?}");
    assert_eq!(events(&r), ["limits_updated"]);
    assert_fails_with(&pay(&ctx, "c", DEST, USDC).await?, "ERR_PAUSED");

    let r = ctx
        .agent
        .call(ctx.treasury.id(), "unpause")
        .deposit(ONE_YOCTO)
        .transact()
        .await?;
    assert_fails_with(&r, "ERR_NOT_OWNER");
    let r = ctx
        .owner
        .call(ctx.treasury.id(), "unpause")
        .deposit(ONE_YOCTO)
        .transact()
        .await?;
    assert!(r.is_success(), "{r:?}");
    assert_eq!(events(&r), ["unpaused"]);
    assert!(pay(&ctx, "c", DEST, USDC).await?.json::<bool>()?);

    // Owner-only + validación de límites.
    let r = ctx
        .agent
        .call(ctx.treasury.id(), "set_limits")
        .args_json(json!({ "max_per_payment": "1", "daily_limit": "1" }))
        .deposit(ONE_YOCTO)
        .transact()
        .await?;
    assert_fails_with(&r, "ERR_NOT_OWNER");
    let r = ctx
        .owner
        .call(ctx.treasury.id(), "set_limits")
        .args_json(json!({ "max_per_payment": "2", "daily_limit": "1" }))
        .deposit(ONE_YOCTO)
        .transact()
        .await?;
    assert_fails_with(&r, "ERR_INVALID_LIMITS");
    // Métodos de owner: exactamente 1 yoctoNEAR (0 y 2 se rechazan).
    for method in ["set_limits", "set_agent", "set_owner", "unpause"] {
        let args = match method {
            "set_limits" => json!({ "max_per_payment": "1", "daily_limit": "1" }),
            "set_agent" => json!({ "agent_id": ctx.stranger.id() }),
            "set_owner" => json!({ "new_owner_id": ctx.stranger.id() }),
            _ => json!({}),
        };
        for yocto in [0u128, 2] {
            let r = ctx
                .owner
                .call(ctx.treasury.id(), method)
                .args_json(args.clone())
                .deposit(NearToken::from_yoctonear(yocto))
                .transact()
                .await?;
            assert_fails_with(&r, "ERR_REQUIRES_ONE_YOCTO");
        }
    }
    let cfg = config(&ctx).await?;
    assert_eq!(cfg["owner_id"], ctx.owner.id().as_str());
    assert_eq!(cfg["agent_id"], ctx.agent.id().as_str());
    assert_eq!(cfg["max_per_payment"], (50 * USDC).to_string());

    // pause sigue sin depósito (y no lo acepta): owner con 0 vale, con 1 yocto no.
    let r = ctx
        .owner
        .call(ctx.treasury.id(), "pause")
        .deposit(ONE_YOCTO)
        .transact()
        .await?;
    assert_fails_with(&r, "doesn't accept deposit");
    let r = ctx
        .owner
        .call(ctx.treasury.id(), "pause")
        .transact()
        .await?;
    assert!(r.is_success(), "{r:?}");
    assert_eq!(config(&ctx).await?["paused"], true);
    Ok(())
}

#[tokio::test]
async fn rotate_agent_and_owner() -> anyhow::Result<()> {
    let ctx = setup(100 * USDC).await?;
    let root = ctx.worker.root_account()?;
    let agent2 = subaccount(&root, "agent2", 5).await?;

    let r = ctx
        .owner
        .call(ctx.treasury.id(), "set_agent")
        .args_json(json!({ "agent_id": agent2.id() }))
        .deposit(ONE_YOCTO)
        .transact()
        .await?;
    assert!(r.is_success(), "{r:?}");
    assert_eq!(events(&r), ["agent_updated"]);
    assert_fails_with(&pay(&ctx, "old", DEST, USDC).await?, "ERR_NOT_AGENT");
    let r = pay_as(&agent2, &ctx, "new", DEST, USDC, PAY_GAS).await?;
    assert!(ret_bool(&r), "{r:?}");

    let new_owner = subaccount(&root, "owner2", 5).await?;
    let r = ctx
        .owner
        .call(ctx.treasury.id(), "set_owner")
        .args_json(json!({ "new_owner_id": new_owner.id() }))
        .deposit(ONE_YOCTO)
        .transact()
        .await?;
    assert!(r.is_success(), "{r:?}");
    assert_eq!(events(&r), ["owner_updated"]);
    let r = ctx
        .owner
        .call(ctx.treasury.id(), "unpause")
        .deposit(ONE_YOCTO)
        .transact()
        .await?;
    assert_fails_with(&r, "ERR_NOT_OWNER");
    assert_eq!(config(&ctx).await?["owner_id"], new_owner.id().as_str());
    Ok(())
}

#[tokio::test]
async fn withdraw_requires_one_yocto_and_owner() -> anyhow::Result<()> {
    let ctx = setup(100 * USDC).await?;
    let owner_before = ft_balance(&ctx, ctx.owner.id().as_str()).await?;

    let r = ctx
        .owner
        .call(ctx.treasury.id(), "withdraw")
        .args_json(json!({ "receiver_id": ctx.owner.id(), "amount": (40 * USDC).to_string() }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert_fails_with(&r, "ERR_REQUIRES_ONE_YOCTO");

    let r = ctx
        .agent
        .call(ctx.treasury.id(), "withdraw")
        .args_json(json!({ "receiver_id": ctx.agent.id(), "amount": (40 * USDC).to_string() }))
        .deposit(ONE_YOCTO)
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert_fails_with(&r, "ERR_NOT_OWNER");

    let r = ctx
        .owner
        .call(ctx.treasury.id(), "withdraw")
        .args_json(json!({ "receiver_id": ctx.owner.id(), "amount": (40 * USDC).to_string() }))
        .deposit(ONE_YOCTO)
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(r.is_success() && ret_bool(&r), "{r:?}");
    assert_eq!(events(&r), ["withdrawn"]);
    assert_eq!(
        ft_balance(&ctx, ctx.owner.id().as_str()).await?,
        owner_before + 40 * USDC
    );
    assert_eq!(
        ft_balance(&ctx, ctx.treasury.id().as_str()).await?,
        60 * USDC
    );

    // Retirar más de lo que hay: el callback informa del fallo, sin evento withdrawn.
    let r = ctx
        .owner
        .call(ctx.treasury.id(), "withdraw")
        .args_json(json!({ "receiver_id": ctx.owner.id(), "amount": (61 * USDC).to_string() }))
        .deposit(ONE_YOCTO)
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(r.is_success() && !ret_bool(&r), "{r:?}");
    assert!(events(&r).is_empty());
    assert!(r
        .logs()
        .iter()
        .any(|l| l.starts_with("ERR_WITHDRAW_FAILED")));
    assert_eq!(
        ft_balance(&ctx, ctx.treasury.id().as_str()).await?,
        60 * USDC
    );
    println!(
        "METRIC withdraw: gas_burnt={} Tgas",
        r.total_gas_burnt.as_tgas()
    );
    Ok(())
}

#[tokio::test]
async fn other_tokens_are_refunded() -> anyhow::Result<()> {
    let ctx = setup(0).await?;
    let root = ctx.worker.root_account()?;
    let fake = deploy_ft(&root, "fake", &ctx.owner).await?;
    ctx.owner
        .call(fake.id(), "storage_deposit")
        .args_json(json!({ "account_id": ctx.treasury.id(), "registration_only": true }))
        .deposit(STORAGE_DEPOSIT)
        .transact()
        .await?
        .into_result()?;
    let r = ctx
        .owner
        .call(fake.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": ctx.treasury.id(), "amount": (7 * USDC).to_string(), "msg": "" }))
        .deposit(ONE_YOCTO)
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(r.is_success(), "{r:?}");
    assert_eq!(r.json::<String>()?, "0", "nothing used: full refund");
    let bal: String = fake
        .view("ft_balance_of")
        .args_json(json!({ "account_id": ctx.treasury.id() }))
        .await?
        .json()?;
    assert_eq!(bal, "0");
    Ok(())
}

#[tokio::test]
async fn deploy_cost_metrics() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let acc = subaccount(&root, "tesorero", 10).await?;
    let code = wasm("tesorero_treasury.wasm");
    let contract = acc.deploy(&code).await?.into_result()?;
    let owner: AccountId = "owner.test.near".parse()?;
    let r = contract
        .call("new")
        .args_json(json!({
            "owner_id": owner,
            "usdc_contract_id": "usdc.test.near",
            "agent_id": null,
            "max_per_payment": "1",
            "daily_limit": "1",
        }))
        .transact()
        .await?;
    assert!(r.is_success(), "{r:?}");
    let details = worker.view_account(contract.id()).await?;
    println!(
        "METRIC deploy: wasm={} bytes, storage_usage after init={} bytes (~{} NEAR locked at 1e19 yocto/byte)",
        code.len(),
        details.storage_usage,
        details.storage_usage as f64 / 100_000.0
    );
    Ok(())
}
