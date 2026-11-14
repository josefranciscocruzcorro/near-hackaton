using System.Net;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Contracts;
using Tesorero.Domain;
using Tesorero.IntegrationTests.Infrastructure;

namespace Tesorero.IntegrationTests;

/// <summary>Treasury created, funded and watched from the app (ADR-0007).</summary>
public sealed class TreasuryVaultTests(LiveInstanceFactory factory) : IClassFixture<LiveInstanceFactory>
{
    private const string Agent = "agent-implicit-0001";

    /// <summary>One ordered story: tests in a class share the tenant, and xUnit does not guarantee their order.</summary>
    [Fact]
    public async Task Owner_creates_a_locked_treasury_with_one_deposit_funds_it_from_another_chain_and_sees_its_movements()
    {
        var owner = await factory.ClientAsAsync("owner");
        var approver = await factory.ClientAsAsync("approver");

        var empty = await (await owner.GetAsync("/api/treasury", Ct)).ReadAsync<TreasuryOverviewDto>();
        empty.Setup.Should().BeNull();
        empty.AgentAccountId.Should().Be(Agent);

        // Only the Owner prepares it, with a real wallet and coherent on-chain limits.
        (await approver.PostJsonAsync("/api/treasury/setup", new TreasurySetupInput("ana.near", 50, 100))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var missing = await owner.PostJsonAsync("/api/treasury/setup", new TreasurySetupInput("missing-wallet.near", 50, 100));
        missing.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await missing.Content.ReadAsStringAsync(Ct)).Should().Contain("ownerAccountId").And.Contain("does not exist");
        (await owner.PostJsonAsync("/api/treasury/setup", new TreasurySetupInput("ana.near", 200, 100))).StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // Prepared: a fresh implicit account that will become the contract, waiting for NEAR.
        var created = await owner.PostJsonAsync("/api/treasury/setup", new TreasurySetupInput("Ana.near", 50, 100));
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var setup = await created.ReadAsync<TreasurySetupDto>();
        setup.Status.Should().Be(TreasurySetupStatus.AwaitingFunds);
        setup.OwnerAccountId.Should().Be("ana.near");
        setup.AccountId.Should().MatchRegex("^[0-9a-f]{64}$");
        setup.ReceivedNear.Should().Be(0);
        setup.RequiredNear.Should().Be(2.5m);
        setup.CodeHash.Should().Be(Tesorero.Infrastructure.Near.EmbeddedTreasuryCode.ExpectedSha256);

        // Discard and start over: a new address.
        (await owner.DeleteAsync("/api/treasury/setup", Ct)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        setup = await (await owner.PostJsonAsync("/api/treasury/setup", new TreasurySetupInput("ana.near", 40, 80))).ReadAsync<TreasurySetupDto>();
        var account = setup.AccountId;

        // Changing the limits keeps the same address.
        var updated = await owner.PostJsonAsync("/api/treasury/setup", new TreasurySetupInput("ana.near", 50, 100));
        updated.StatusCode.Should().Be(HttpStatusCode.Created);
        (await updated.ReadAsync<TreasurySetupDto>()).AccountId.Should().Be(account);

        // Nothing happens without the NEAR deposit.
        var early = await owner.PostAsync("/api/treasury/setup/deploy", null, Ct);
        early.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await early.Content.ReadAsStringAsync(Ct)).Should().Contain("funds").And.Contain(account);

        // The owner sends 2.5 NEAR to the address (from a wallet or an exchange).
        factory.Accounts.Fund(account, 2.5m);
        var waiting = await (await owner.GetAsync("/api/treasury", Ct)).ReadAsync<TreasuryOverviewDto>();
        waiting.Setup!.ReceivedNear.Should().Be(2.5m);
        (await owner.DeleteAsync("/api/treasury/setup", Ct)).StatusCode.Should().Be(HttpStatusCode.Conflict, "funds already arrived");

        // A failure halfway (USDC registration) leaves it Failed and resumable.
        factory.Accounts.FailOn = "storage_deposit";
        var failed = await (await owner.PostAsync("/api/treasury/setup/deploy", null, Ct)).ReadAsync<TreasurySetupDto>();
        failed.Status.Should().Be(TreasurySetupStatus.Failed);
        failed.LastError.Should().Contain("simulated failure");
        failed.Steps.Select(s => s.Status).Should().Equal("done", "failed", "pending", "pending");

        var ready = await (await owner.PostAsync("/api/treasury/setup/deploy", null, Ct)).ReadAsync<TreasurySetupDto>();
        ready.Status.Should().Be(TreasurySetupStatus.Ready);
        ready.Steps.Should().OnlyContain(s => s.Status == "done");
        ready.CompletedAt.Should().NotBeNull();

        // On-chain effects: deployed once (the retry resumed), initialized with the owner's choices, agent got gas, key deleted.
        factory.Accounts.Sent.Count(t => t.Actions.Any(a => a is ChainDeploy)).Should().Be(1);
        var config = factory.Chain.Contracts[account];
        config.OwnerId.Should().Be("ana.near");
        config.AgentId.Should().Be(Agent);
        config.MaxPerPayment.Should().Be((UInt128)50_000_000);
        config.DailyLimit.Should().Be((UInt128)100_000_000);
        factory.Accounts.UsdcRegistered.Should().Contain(account);
        factory.Accounts.BalanceOf(Agent).Should().Be(0.3m);
        (await factory.Accounts.GetAsync(account, Ct))!.AccessKeys.Should().Be(0, "the treasury is locked");

        var overview = await (await owner.GetAsync("/api/treasury", Ct)).ReadAsync<TreasuryOverviewDto>();
        overview.TreasuryAccountId.Should().Be(account, "the new contract becomes the organization's treasury");
        overview.OwnerAccountId.Should().Be("ana.near");
        overview.Checks.Should().OnlyContain(c => c.Ok);
        overview.Checks.Select(c => c.Id).Should().Contain("reserveCovered");
        overview.ReadyForLive.Should().BeTrue();

        // The app's rules now follow the on-chain limits the owner chose.
        var aligned = await (await owner.GetAsync("/api/policy", Ct)).ReadAsync<PolicyDto>();
        aligned.MaxPerPaymentUsd.Should().Be(50);
        aligned.DailyLimitUsd.Should().Be(100);
        aligned.ApprovalThresholdUsd.Should().BeLessThanOrEqualTo(50);
        aligned.MonthlyLimitUsd.Should().BeGreaterThanOrEqualTo(100);
        overview.ExecutionMode.Should().Be(ExecutionMode.Simulation, "going Live stays a separate, explicit decision");
        (await owner.PostJsonAsync("/api/treasury/setup", new TreasurySetupInput("ana.near", 50, 100))).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await owner.DeleteAsync("/api/treasury/setup", Ct)).StatusCode.Should().Be(HttpStatusCode.Conflict);

        // Live only with this organization's verified treasury.
        factory.Chain.Wallets.Add("plain-wallet.near");
        var settings = await (await owner.GetAsync("/api/settings", Ct)).ReadAsync<SettingsDto>();
        var refused = await owner.PutJsonAsync("/api/settings", new SettingsInput(settings.OrganizationName, "plain-wallet.near", ExecutionMode.Live));
        refused.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await refused.Content.ReadAsStringAsync(Ct)).Should().Contain("executionMode").And.Contain("not a Tesorero treasury");
        (await owner.PutJsonAsync("/api/settings", new SettingsInput(settings.OrganizationName, account, ExecutionMode.Live))).StatusCode.Should().Be(HttpStatusCode.OK);

        // Funding from another chain: USDT on Ethereum → USDC on NEAR straight into the contract.
        var options = await (await owner.GetAsync("/api/treasury/funding-options", Ct)).ReadAsync<FundingOptionsDto>();
        options.Assets.Should().NotContain(a => a.Chain == "near" && a.Symbol == "USDC", "USDC on NEAR is sent directly");
        var usdt = options.Assets.First();
        usdt.Symbol.Should().Be("USDT");
        usdt.ChainName.Should().Be("Ethereum (ERC20)");

        (await owner.PostJsonAsync("/api/treasury/fundings", new FundingInput(usdt.AssetId, 20, " "))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        factory.Intents.FailQuotes = true;
        var tooSmall = await owner.PostJsonAsync("/api/treasury/fundings", new FundingInput(usdt.AssetId, 20, "0xrefund"));
        factory.Intents.FailQuotes = false;
        tooSmall.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await tooSmall.Content.ReadAsStringAsync(Ct)).Should().Contain("\"funding\"").And.Contain("recipient is invalid", "provider errors that are not about the amount are form-level");

        var funding = await (await owner.PostJsonAsync("/api/treasury/fundings", new FundingInput(usdt.AssetId, 20, "0xrefund"))).ReadAsync<FundingDto>();
        funding.Status.Should().Be(FundingStatus.PendingDeposit);
        funding.DepositAddress.Should().StartWith("deposit-");
        funding.ExpectedUsdc.Should().BeApproximately(19.98m, 0.01m);
        var quote = factory.Intents.Quotes[^1];
        quote.Dry.Should().BeFalse();
        quote.Recipient.Should().Be(account);
        quote.RefundTo.Should().Be("0xrefund");
        quote.AmountIn.Should().Be("20000000");
        quote.DestinationAsset.Should().Be("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");

        factory.Intents.Statuses[funding.DepositAddress] = "SUCCESS";
        var fundings = await (await owner.GetAsync("/api/treasury/fundings", Ct)).ReadAsync<List<FundingDto>>();
        fundings.Single(f => f.Id == funding.Id).Status.Should().Be(FundingStatus.Success);
        (await approver.PostJsonAsync("/api/treasury/fundings", new FundingInput(usdt.AssetId, 20, "0xrefund"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);

        // Movements: the creation, a funding, and an outgoing USDC transfer Tesorero did not make → alert.
        var now = DateTimeOffset.UtcNow;
        factory.Indexer.Transfers.Add(new IndexedTransfer("faketx001", now.AddMinutes(-30), false, "NEAR", null, 1.62m, null));
        factory.Indexer.Transfers.Add(new IndexedTransfer("fundtx", now.AddMinutes(-10), true, "USDC", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", 19.98m, "intents.near"));
        factory.Indexer.Transfers.Add(new IndexedTransfer("drain", now, false, "USDC", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", 19m, "thief.near"));
        var movements = await (await owner.GetAsync("/api/treasury/movements", Ct)).ReadAsync<MovementsDto>();
        movements.AccountId.Should().Be(account);
        movements.Items.Single(m => m.TxHash == "faketx001").Kind.Should().Be("setup");
        movements.Items.Single(m => m.TxHash == "fundtx").Kind.Should().Be("funding");
        var drain = movements.Items.Single(m => m.TxHash == "drain");
        drain.Flagged.Should().BeTrue();
        drain.Asset.Should().Be("USDC");
        movements.Alerts.Should().Be(1);
    }
}

public sealed class TreasuryVaultDemoTests(TesoreroFactory factory) : IClassFixture<TesoreroFactory>
{
    [Fact]
    public async Task The_public_demo_shows_the_treasury_but_never_creates_or_funds_one()
    {
        var owner = await factory.ClientAsAsync("owner");
        var overview = await owner.GetAsync("/api/treasury", Ct);
        overview.StatusCode.Should().Be(HttpStatusCode.OK);
        (await overview.ReadAsync<TreasuryOverviewDto>()).Demo.Should().BeTrue();
        (await owner.PostJsonAsync("/api/treasury/setup", new TreasurySetupInput("ana.near", 50, 100))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await owner.PostJsonAsync("/api/treasury/fundings", new FundingInput("x", 20, "0xrefund"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await owner.GetAsync("/api/treasury/movements", Ct)).StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
