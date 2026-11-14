using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Tesorero.Application.Contracts;
using Tesorero.Domain;
using Tesorero.IntegrationTests.Infrastructure;

namespace Tesorero.IntegrationTests;

public sealed partial class AgentFlowTests(TesoreroFactory factory) : IClassFixture<TesoreroFactory>
{
    /// <summary>A scripted "AI" that proposes paying every bill it is shown (worst case for the guardrails).</summary>
    internal static string PayEverything(Tesorero.Application.Abstractions.LlmRequest request, string? extraJson = null)
    {
        var ids = BillIdRegex().Matches(request.UserPrompt).Select(m => m.Groups[1].Value).Distinct().ToList();
        var decisions = ids.Select(id => $$"""{"billId":"{{id}}","payNow":true,"reason":"Pay now."}""").ToList();
        if (extraJson is not null)
        {
            decisions.Add(extraJson);
        }

        return $$"""{"summary":"Paying everything.","decisions":[{{string.Join(',', decisions)}}]}""";
    }

    [GeneratedRegex("\"billId\":\"([0-9a-f-]{36})\"")]
    private static partial Regex BillIdRegex();

    [Fact]
    public async Task Full_cycle_ai_proposes_policy_decides_humans_approve_and_intents_settle()
    {
        var owner = await factory.ClientAsAsync("owner");
        var approver = await factory.ClientAsAsync("approver");
        factory.Llm.Enqueue(r => PayEverything(r, $$"""{"billId":"{{Guid.NewGuid()}}","payNow":true,"reason":"injected"}"""));

        // 1. Owner starts the agent; the run is queued.
        var start = await owner.PostJsonAsync("/api/agent/runs", new { mode = "Plan" });
        start.StatusCode.Should().Be(HttpStatusCode.Accepted);
        var summary = await start.ReadAsync<AgentRunSummaryDto>();
        summary.Status.Should().Be(AgentRunStatus.Running);

        // A second start while running is refused.
        (await owner.PostJsonAsync("/api/agent/runs", new { })).StatusCode.Should().Be(HttpStatusCode.Conflict);

        // 2. Background job runs the plan.
        await factory.DrainJobsAsync();
        var run = await (await owner.GetAsync($"/api/agent/runs/{summary.Id}", Ct)).ReadAsync<AgentRunDto>();
        run.Status.Should().Be(AgentRunStatus.Completed);
        run.Model.Should().StartWith("fake-");
        var byRef = run.Decisions.ToDictionary(d => d.BillReference);

        byRef.Keys.Should().NotContain("LUM-2026-12", "it is outside the 7-day planning horizon");
        byRef["ACR-2041"].PolicyOutcome.Should().Be(PolicyOutcome.Allow);
        byRef["LUM-2026-11"].PolicyOutcome.Should().Be(PolicyOutcome.Allow);
        byRef["KN-2026-11"].PolicyOutcome.Should().Be(PolicyOutcome.Allow);
        byRef["PFC-889"].PolicyOutcome.Should().Be(PolicyOutcome.RequireApproval);
        byRef["PFC-889"].PolicyReasons.Select(r => r.Code).Should().Contain("NewPayeeCooldown");
        byRef["MLS-007"].PolicyOutcome.Should().Be(PolicyOutcome.RequireApproval);
        byRef["MLS-007"].PolicyReasons.Select(r => r.Code).Should().Contain("AboveApprovalThreshold");
        byRef["BRL-001"].PolicyOutcome.Should().Be(PolicyOutcome.Block);
        byRef["BRL-001"].PolicyReasons.Select(r => r.Code).Should().Contain("PayeeNotAllowlisted");
        byRef["ACR-2042-URGENT"].PolicyOutcome.Should().Be(PolicyOutcome.Block);
        byRef["ACR-2042-URGENT"].PolicyReasons.Select(r => r.Code).Should().Contain(["SuspiciousInstructions", "ExceedsMaxPerPayment"]);

        // The invented bill id from the "injected" decision was ignored and audited.
        var audit = await (await owner.GetAsync("/api/audit?take=200", Ct)).ReadAsync<List<AuditEventDto>>();
        audit.Should().Contain(e => e.Action == "agent.output.rejected");

        // 3. Allowed payments execute with a dry (simulated) NEAR Intents quote.
        await factory.DrainJobsAsync();
        var payments = await (await owner.GetAsync("/api/payments", Ct)).ReadAsync<List<PaymentDto>>();
        var acr = payments.Single(p => p.BillReference == "ACR-2041");
        acr.Status.Should().Be(PaymentStatus.Settled);
        acr.Simulation.Should().BeTrue();
        acr.Quote!.AmountIn.Should().Be("480000000");
        acr.DestinationChain.Should().Be("base");
        factory.Intents.Quotes.Should().OnlyContain(q => q.Dry);
        payments.Single(p => p.BillReference == "ACR-2042-URGENT").Status.Should().Be(PaymentStatus.Blocked);

        var bills = await (await owner.GetAsync("/api/bills", Ct)).ReadAsync<List<BillDto>>();
        bills.Single(b => b.Reference == "ACR-2041").Status.Should().Be(BillStatus.Paid);
        bills.Single(b => b.Reference == "MLS-007").Status.Should().Be(BillStatus.Scheduled);
        bills.Single(b => b.Reference == "BRL-001").Status.Should().Be(BillStatus.Open);

        // 4. Humans decide the exceptions.
        var mls = payments.Single(p => p.BillReference == "MLS-007");
        var pfc = payments.Single(p => p.BillReference == "PFC-889");
        (await approver.PostJsonAsync($"/api/payments/{pfc.Id}/reject", new { note = "" })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var rejected = await (await approver.PostJsonAsync($"/api/payments/{pfc.Id}/reject", new { note = "Address change not confirmed by phone" })).ReadAsync<PaymentDto>();
        rejected.Status.Should().Be(PaymentStatus.Rejected);
        rejected.DecidedBy.Should().Be("approver@tesorero.demo");

        var approved = await (await approver.PostJsonAsync($"/api/payments/{mls.Id}/approve", new { note = "Milestone delivered" })).ReadAsync<PaymentDto>();
        approved.Status.Should().Be(PaymentStatus.Approved);
        (await approver.PostJsonAsync($"/api/payments/{mls.Id}/approve", new { })).StatusCode.Should().Be(HttpStatusCode.Conflict);
        await factory.DrainJobsAsync();
        (await (await owner.GetAsync($"/api/payments/{mls.Id}", Ct)).ReadAsync<PaymentDto>()).Status.Should().Be(PaymentStatus.Settled);

        bills = await (await owner.GetAsync("/api/bills", Ct)).ReadAsync<List<BillDto>>();
        bills.Single(b => b.Reference == "PFC-889").Status.Should().Be(BillStatus.Open, "rejecting puts the bill back in the queue");

        // 5. A second run does not re-propose handled (paid, scheduled or rejected) bills.
        factory.Llm.Enqueue(r => PayEverything(r));
        var second = await (await owner.PostJsonAsync("/api/agent/runs", new { })).ReadAsync<AgentRunSummaryDto>();
        await factory.DrainJobsAsync();
        var secondRun = await (await owner.GetAsync($"/api/agent/runs/{second.Id}", Ct)).ReadAsync<AgentRunDto>();
        secondRun.Decisions.Select(d => d.BillReference).Should().BeEquivalentTo(["ACR-2042-URGENT", "BRL-001"]);

        // 6. Dashboard reflects committed spend and pending approvals.
        var dash = await (await owner.GetAsync("/api/dashboard", Ct)).ReadAsync<DashboardDto>();
        dash.Spend.Today.Should().Be(480 + 129 + 950 + 1850);
        dash.PendingApprovals.Should().Be(0);
        dash.LastAgentRun!.Id.Should().Be(second.Id);
        dash.ExecutionMode.Should().Be(ExecutionMode.Simulation);
    }

    [Fact]
    public async Task Red_team_drill_evaluates_every_bill_without_creating_payments()
    {
        var owner = await factory.ClientAsAsync("owner");
        var before = (await (await owner.GetAsync("/api/payments", Ct)).ReadAsync<List<PaymentDto>>()).Count;
        var llmCalls = factory.Llm.Requests.Count;

        var start = await (await owner.PostJsonAsync("/api/agent/runs", new { mode = "RedTeamDrill" })).ReadAsync<AgentRunSummaryDto>();
        await factory.DrainJobsAsync();
        var run = await (await owner.GetAsync($"/api/agent/runs/{start.Id}", Ct)).ReadAsync<AgentRunDto>();

        run.Trigger.Should().Be(AgentTrigger.RedTeamDrill);
        run.Status.Should().Be(AgentRunStatus.Completed);
        run.Decisions.Should().NotBeEmpty().And.OnlyContain(d => d.PayNow && d.PaymentId == null && d.PolicyOutcome != null);
        run.Decisions.Should().Contain(d => d.PolicyOutcome == PolicyOutcome.Block);
        run.Summary.Should().Contain("No payment was created");
        factory.Llm.Requests.Count.Should().Be(llmCalls, "a drill never calls the AI");
        (await (await owner.GetAsync("/api/payments", Ct)).ReadAsync<List<PaymentDto>>()).Should().HaveCount(before);
    }

    [Fact]
    public async Task Ai_failure_marks_the_run_failed_without_side_effects()
    {
        var owner = await factory.ClientAsAsync("owner");
        factory.Llm.Enqueue("this is not json");

        var start = await (await owner.PostJsonAsync("/api/agent/runs", new { })).ReadAsync<AgentRunSummaryDto>();
        await factory.DrainJobsAsync();
        var run = await (await owner.GetAsync($"/api/agent/runs/{start.Id}", Ct)).ReadAsync<AgentRunDto>();

        run.Status.Should().Be(AgentRunStatus.Failed);
        run.Error.Should().NotBeNullOrWhiteSpace();
        run.Decisions.Should().BeEmpty();
        run.FinishedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task Prompt_sent_to_the_ai_contains_limits_and_marks_descriptions_untrusted()
    {
        var owner = await factory.ClientAsAsync("owner");
        // Only the prompt matters here: the plan pays nothing, so the shared demo data stays intact
        // for the other tests in this class (xUnit does not guarantee their order).
        factory.Llm.Enqueue("""{"summary":"Nothing to pay today.","decisions":[]}""");
        var start = await (await owner.PostJsonAsync("/api/agent/runs", new { })).ReadAsync<AgentRunSummaryDto>();
        await factory.DrainJobsAsync();

        var request = factory.Llm.Requests[^1];
        request.SystemPrompt.Should().Contain("UNTRUSTED");
        request.SystemPrompt.Should().NotContain("Spanish", "the app asked in English");
        using var doc = JsonDocument.Parse(request.UserPrompt[request.UserPrompt.IndexOf('{', StringComparison.Ordinal)..]);
        doc.RootElement.GetProperty("limits").GetProperty("dailyLimit").GetDecimal().Should().Be(5000);
        start.Id.Should().NotBeEmpty();
    }

    [Fact]
    public async Task The_agent_writes_in_the_language_of_the_app_that_started_it()
    {
        var owner = await factory.ClientAsAsync("owner");
        factory.Llm.Enqueue("""{"summary":"Nada que pagar hoy.","decisions":[]}""");
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/agent/runs") { Content = JsonContent.Create(new { mode = "Plan" }) };
        request.Headers.AcceptLanguage.ParseAdd("es-EC");
        (await owner.SendAsync(request, Ct)).StatusCode.Should().Be(HttpStatusCode.Accepted);
        await factory.DrainJobsAsync();
        factory.Llm.Requests[^1].SystemPrompt.Should().Contain("in Spanish");
    }
}
