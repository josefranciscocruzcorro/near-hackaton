using System.Net;
using Tesorero.Application.Contracts;
using Tesorero.Application.Services;
using Tesorero.Domain;
using Tesorero.IntegrationTests.Infrastructure;

namespace Tesorero.IntegrationTests;

/// <summary>Autonomous Live payments through the NEAR treasury contract (ADR-0005).</summary>
public sealed class AutonomousLiveTests(LiveInstanceFactory factory) : IClassFixture<LiveInstanceFactory>
{
    private async Task<HttpClient> LiveOwnerAsync()
    {
        var owner = await factory.ClientAsAsync("owner");
        (await owner.PutJsonAsync("/api/settings", new SettingsInput("Cafetería La Ceiba", "tesorero.ceiba.near", ExecutionMode.Live)))
            .EnsureSuccessStatusCode();
        return owner;
    }

    private async Task<BillDto> NewRoutineBillAsync(HttpClient owner, string reference, decimal amount)
    {
        var lumen = (await (await owner.GetAsync("/api/payees", Ct)).ReadAsync<List<PayeeDto>>()).Single(p => p.Name == "Lumen Cloud");
        return await (await owner.PostJsonAsync("/api/bills", new BillInput(lumen.Id, reference, "Routine", amount,
            DateOnly.FromDateTime(DateTime.UtcNow), Category.Software, null))).ReadAsync<BillDto>();
    }

    private async Task<PaymentDto> RunAgentAndGetPaymentAsync(HttpClient owner, Guid billId)
    {
        factory.Llm.Enqueue(r => AgentFlowTests.PayEverything(r));
        (await owner.PostJsonAsync("/api/agent/runs", new { })).EnsureSuccessStatusCode();
        await factory.DrainJobsAsync();
        return (await (await owner.GetAsync("/api/payments", Ct)).ReadAsync<List<PaymentDto>>()).Single(p => p.BillId == billId);
    }

    [Fact]
    public async Task Agent_pays_through_the_treasury_contract_and_intents_settles_without_any_human_signature()
    {
        var owner = await LiveOwnerAsync();
        var settings = await (await owner.GetAsync("/api/settings", Ct)).ReadAsync<SettingsDto>();
        settings.Demo.Should().BeFalse();
        settings.AgentAccountId.Should().Be("agent-implicit-0001");

        var bill = await NewRoutineBillAsync(owner, "AUTO-1", 25);
        var payment = await RunAgentAndGetPaymentAsync(owner, bill.Id);

        payment.Simulation.Should().BeFalse();
        payment.Status.Should().Be(PaymentStatus.Processing);
        payment.OnChainTxHash.Should().NotBeNullOrEmpty();
        payment.OnChainTxUrl.Should().StartWith("https://nearblocks.io/txns/");
        payment.DepositTxHash.Should().Be(payment.OnChainTxHash);
        var onChain = factory.Chain.Payments[payment.Id.ToString("N")];
        onChain.Amount.Should().Be((UInt128)25_000_000);
        onChain.DepositAddress.Should().Be(payment.Quote!.DepositAddress);
        factory.Intents.Quotes.Last(q => q.AmountIn == "25000000").RefundTo.Should().Be("tesorero.ceiba.near", "refunds go back to the contract");

        factory.Intents.Statuses[payment.Quote.DepositAddress!] = "SUCCESS";
        await factory.InScopeAsync(sp => sp.GetRequiredService<PaymentService>().PollAsync(CancellationToken.None));
        (await (await owner.GetAsync($"/api/payments/{payment.Id}", Ct)).ReadAsync<PaymentDto>()).Status.Should().Be(PaymentStatus.Settled);
        (await (await owner.GetAsync($"/api/bills/{bill.Id}", Ct)).ReadAsync<BillDto>()).Status.Should().Be(BillStatus.Paid);

        var dash = await (await owner.GetAsync("/api/dashboard", Ct)).ReadAsync<DashboardDto>();
        dash.Treasury.OnChain.Should().NotBeNull();
        dash.Treasury.OnChain!.MaxPerPayment.Should().Be(1000);
        dash.Treasury.OnChain.DailyLimit.Should().Be(2000);
    }

    [Fact]
    public async Task A_retried_job_never_pays_twice_because_the_contract_already_knows_the_payment()
    {
        var owner = await LiveOwnerAsync();
        var bill = await NewRoutineBillAsync(owner, "IDEMP-1", 30);
        var payment = await RunAgentAndGetPaymentAsync(owner, bill.Id);
        var calls = factory.Chain.PayCalls;

        // Simulate a crash/retry: the job runs again for the same payment.
        await factory.InScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<Tesorero.Infrastructure.Persistence.AppDbContext>();
            var p = await db.Payments.FindAsync([payment.Id], CancellationToken.None);
            p!.Status = PaymentStatus.Approved;
            await db.SaveChangesAsync(CancellationToken.None);
            await sp.GetRequiredService<PaymentService>().ExecuteAsync(payment.Id, CancellationToken.None);
            return 0;
        });

        factory.Chain.PayCalls.Should().Be(calls, "the contract already recorded this payment id, so the server reconciles instead of paying");
        (await (await owner.GetAsync($"/api/payments/{payment.Id}", Ct)).ReadAsync<PaymentDto>()).Status.Should().Be(PaymentStatus.Processing);
    }

    [Fact]
    public async Task An_unconfirmed_transaction_keeps_the_bill_scheduled_instead_of_risking_a_second_payment()
    {
        var owner = await LiveOwnerAsync();
        var bill = await NewRoutineBillAsync(owner, "RPC-DOWN", 35);
        factory.Chain.ThrowOnPay = true;
        try
        {
            var payment = await RunAgentAndGetPaymentAsync(owner, bill.Id);

            payment.Status.Should().Be(PaymentStatus.AwaitingDeposit);
            payment.LastError.Should().Contain("Could not confirm");
            (await (await owner.GetAsync($"/api/bills/{bill.Id}", Ct)).ReadAsync<BillDto>()).Status.Should().Be(BillStatus.Scheduled);
        }
        finally
        {
            factory.Chain.ThrowOnPay = false;
        }
    }

    [Fact]
    public async Task On_chain_limits_are_the_last_line_of_defence_even_if_the_server_policy_allows_the_payment()
    {
        var owner = await LiveOwnerAsync();
        var max = factory.Chain.MaxPerPayment;
        factory.Chain.MaxPerPayment = 10_000_000; // 10 USDC on-chain, below the server policy
        try
        {
            var bill = await NewRoutineBillAsync(owner, "OVER-CHAIN", 40);
            var payment = await RunAgentAndGetPaymentAsync(owner, bill.Id);

            payment.Status.Should().Be(PaymentStatus.Failed);
            payment.LastError.Should().Contain("per-payment maximum");
            (await (await owner.GetAsync($"/api/bills/{bill.Id}", Ct)).ReadAsync<BillDto>()).Status.Should().Be(BillStatus.Open);
        }
        finally
        {
            factory.Chain.MaxPerPayment = max;
        }
    }

    [Fact]
    public async Task Stopping_payments_is_instant_and_reversible_while_freezing_the_contract_is_an_explicit_emergency()
    {
        var owner = await LiveOwnerAsync();
        var approver = await factory.ClientAsAsync("approver");
        factory.Chain.Paused = false;
        try
        {
            // Stop: nothing leaves (even approved payments), the contract is untouched, and it is reversible from the app.
            (await approver.PostAsync("/api/payments/stop", null, Ct)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
            var stopped = await (await owner.PostAsync("/api/payments/stop", null, Ct)).ReadAsync<PolicyDto>();
            stopped.AgentEnabled.Should().BeFalse();
            factory.Chain.Paused.Should().BeFalse("stopping payments does not freeze the contract");
            var audit = await (await owner.GetAsync("/api/audit?take=20", Ct)).ReadAsync<List<AuditEventDto>>();
            audit.Should().Contain(e => e.Action == "payments.stopped");
            (await (await owner.PostAsync("/api/payments/resume", null, Ct)).ReadAsync<PolicyDto>()).AgentEnabled.Should().BeTrue();

            // Freeze: pauses the contract on-chain (only the owner's wallet can unpause it).
            (await approver.PostAsync("/api/treasury/freeze", null, Ct)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await owner.PostAsync("/api/treasury/freeze", null, Ct)).StatusCode.Should().Be(HttpStatusCode.OK);
            factory.Chain.Paused.Should().BeTrue();
            audit = await (await owner.GetAsync("/api/audit?take=20", Ct)).ReadAsync<List<AuditEventDto>>();
            audit.Should().Contain(e => e.Action == "treasury.frozen");
        }
        finally
        {
            await owner.PostAsync("/api/payments/resume", null, Ct);
            factory.Chain.Paused = false;
        }
    }

    [Fact]
    public async Task Payee_addresses_are_verified_with_near_intents_before_they_can_receive_money()
    {
        var owner = await factory.ClientAsAsync("owner");
        factory.Intents.FailQuotes = true;
        try
        {
            var response = await owner.PostJsonAsync("/api/payees", new PayeeInput("Unroutable", null, Category.Supplier,
                "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", "0x3333333333333333333333333333333333333333", true, null));
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            (await response.Content.ReadAsStringAsync(Ct)).Should().Contain("recipientAddress").And.Contain("NEAR Intents could not route");
        }
        finally
        {
            factory.Intents.FailQuotes = false;
        }
    }
}

/// <summary>The public demo can be reset by its Owner and can never move real money.</summary>
public sealed class DemoInstanceTests(TesoreroFactory factory) : IClassFixture<TesoreroFactory>
{
    [Fact]
    public async Task Demo_instance_reports_itself_and_forbids_live_mode()
    {
        var instance = await (await factory.CreateClient().GetAsync("/api/instance", Ct)).ReadAsync<InstanceDto>();
        instance.Demo.Should().BeTrue();
        instance.NeedsSetup.Should().BeFalse();

        var owner = await factory.ClientAsAsync("owner");
        var response = await owner.PutJsonAsync("/api/settings", new SettingsInput("Demo", "tesorero.ceiba.near", ExecutionMode.Live));
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync(Ct)).Should().Contain("disabled on the public demo");
    }

    [Fact]
    public async Task Owner_can_reset_the_demo_and_sessions_stay_valid()
    {
        var owner = await factory.ClientAsAsync("owner");
        factory.Llm.Enqueue(r => AgentFlowTests.PayEverything(r));
        await owner.PostJsonAsync("/api/agent/runs", new { });
        await factory.DrainJobsAsync();
        await factory.DrainJobsAsync();
        (await (await owner.GetAsync("/api/payments", Ct)).ReadAsync<List<PaymentDto>>()).Count.Should().BeGreaterThan(2);

        (await (await factory.ClientAsAsync("approver")).PostAsync("/api/demo/reset", null, Ct)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await owner.PostAsync("/api/demo/reset", null, Ct)).StatusCode.Should().Be(HttpStatusCode.NoContent);

        var payments = await (await owner.GetAsync("/api/payments", Ct)).ReadAsync<List<PaymentDto>>();
        payments.Should().HaveCount(2, "only the two seeded historical payments remain");
        var bills = await (await owner.GetAsync("/api/bills?status=Open", Ct)).ReadAsync<List<BillDto>>();
        bills.Select(b => b.Reference).Should().Contain(["ACR-2041", "MLS-007", "ACR-2042-URGENT"]);
        (await (await owner.GetAsync("/api/agent/runs", Ct)).ReadAsync<List<AgentRunSummaryDto>>()).Should().BeEmpty();
        var audit = await (await owner.GetAsync("/api/audit", Ct)).ReadAsync<List<AuditEventDto>>();
        audit.Should().Contain(e => e.Action == "demo.reset");
    }

    [Fact]
    public async Task Shared_demo_accounts_are_read_only_and_invited_users_disappear_on_reset()
    {
        var owner = await factory.ClientAsAsync("owner");
        var users = await (await owner.GetAsync("/api/users", Ct)).ReadAsync<List<UserAdminDto>>();
        var approver = users.Single(u => u.Email == "approver@tesorero.demo");

        (await owner.PutJsonAsync($"/api/users/{approver.Id}", new UpdateUserRequest("Hacked", Role.Approver, false))).StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await owner.PutJsonAsync($"/api/users/{approver.Id}/password", new ResetPasswordRequest("someone-elses-pass"))).StatusCode.Should().Be(HttpStatusCode.Conflict);
        var change = await (await factory.ClientAsAsync("auditor")).PostJsonAsync("/api/auth/change-password", new ChangePasswordRequest("Demo!2026", "a-brand-new-pass-1"));
        change.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await change.Content.ReadAsStringAsync(Ct)).Should().Contain("read-only on the public demo");

        var invited = await owner.PostJsonAsync("/api/users", new CreateUserRequest("visitor@example.com", "Visitor", Role.Auditor, "visitor-password-1"));
        invited.StatusCode.Should().Be(HttpStatusCode.Created);

        (await owner.PostAsync("/api/demo/reset", null, Ct)).StatusCode.Should().Be(HttpStatusCode.NoContent);
        var after = await (await owner.GetAsync("/api/users", Ct)).ReadAsync<List<UserAdminDto>>();
        after.Select(u => u.Email).Should().BeEquivalentTo(["owner@tesorero.demo", "approver@tesorero.demo", "auditor@tesorero.demo"]);
        after.Should().OnlyContain(u => u.IsActive);
        (await factory.ClientAsAsync("approver")).Should().NotBeNull("demo passwords are restored on reset");
    }
}
