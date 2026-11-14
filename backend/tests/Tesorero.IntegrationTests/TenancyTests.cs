using System.Net;
using System.Net.Http.Headers;
using Microsoft.EntityFrameworkCore;
using Tesorero.Application.Contracts;
using Tesorero.Domain;
using Tesorero.Infrastructure.Persistence;
using Tesorero.IntegrationTests.Infrastructure;

namespace Tesorero.IntegrationTests;

/// <summary>Signup, verification, setup and strict isolation between organizations (ADR-0006).</summary>
public sealed class TenancyTests(FreshInstanceFactory factory) : IClassFixture<FreshInstanceFactory>
{
    private const string Password = "Correct-Horse-2026";
    private const string BaseUsdc = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

    private static SignupRequest Signup(string slug, string email, string near = "acme.near", string? website = "", bool terms = true) =>
        new($"Org {slug}", slug, "Ana Sol", email, near, "en", terms, website);

    private static string Token(string link) => Uri.UnescapeDataString(link[(link.IndexOf("token=", StringComparison.Ordinal) + 6)..]);

    /// <summary>Signs up, verifies the e-mail and completes setup; returns the Owner's client on the tenant's subdomain.</summary>
    private async Task<HttpClient> CreateTenantAsync(string slug)
    {
        var email = $"owner@{slug}.example";
        var landing = factory.ClientFor(null);
        (await landing.PostJsonAsync("/api/signup", Signup(slug, email))).StatusCode.Should().Be(HttpStatusCode.Accepted);
        var verify = await (await landing.PostJsonAsync("/api/signup/verify", new VerifyRequest(Token(factory.Emails.LinkFor(email, "/verify?token="))))).ReadAsync<VerifyResultDto>();
        verify.Slug.Should().Be(slug);

        var client = factory.ClientFor(slug);
        var login = await (await client.PostJsonAsync("/api/setup",
            new SetupRequest($"Org {slug}", "Ana Sol", email, Password, Token(factory.Emails.LinkFor(email, "/setup?token="))))).ReadAsync<LoginResponse>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.Token);
        return client;
    }

    private async Task<PayeeDto> CreatePayeeAsync(HttpClient owner, string name) =>
        await (await owner.PostJsonAsync("/api/payees", new PayeeInput(name, null, Category.Supplier, BaseUsdc, "0x1111111111111111111111111111111111111111", true, null))).ReadAsync<PayeeDto>();

    [Fact]
    public async Task The_landing_only_exposes_public_apis_and_unknown_subdomains_do_not_exist()
    {
        var landing = factory.ClientFor(null);
        var instance = await (await landing.GetAsync("/api/instance", Ct)).ReadAsync<InstanceDto>();
        instance.Kind.Should().Be("landing");
        instance.DemoUrl.Should().Be("http://demo.tesorero.test");
        instance.LandingUrl.Should().Be("http://tesorero.test");

        (await landing.GetAsync("/api/dashboard", Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await landing.PostJsonAsync("/api/auth/login", new LoginRequest("owner@tesorero.demo", "Demo!2026"))).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await factory.ClientFor("nobody-here").GetAsync("/api/instance", Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await factory.ClientFor("demo").GetAsync("/api/signup/slug?value=abc", Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound, "signup only lives on the landing");

        var demo = await (await factory.ClientFor("demo").GetAsync("/api/instance", Ct)).ReadAsync<InstanceDto>();
        demo.Kind.Should().Be("tenant");
        demo.Demo.Should().BeTrue();
        demo.TenantSlug.Should().Be("demo");
    }

    [Theory]
    [InlineData("demo", false, "reserved")]
    [InlineData("www", false, "reserved")]
    [InlineData("ab", false, "invalid")]
    [InlineData("-acme", false, "invalid")]
    [InlineData("acme cafe", false, "invalid")]
    [InlineData("Panaderia-Sol", true, null)]
    public async Task Subdomains_are_validated(string value, bool available, string? reason)
    {
        var check = await (await factory.ClientFor(null).GetAsync($"/api/signup/slug?value={Uri.EscapeDataString(value)}", Ct)).ReadAsync<SlugCheckDto>();
        check.Available.Should().Be(available);
        check.Reason.Should().Be(reason);
        check.Slug.Should().Be(value.Trim().ToLowerInvariant());
    }

    [Theory]
    [InlineData("cruzespejose.near", true, true)]
    [InlineData("missing-account.near", false, true)]
    [InlineData("Not An Account", false, false)]
    public async Task Near_accounts_are_checked_on_mainnet(string id, bool exists, bool valid)
    {
        var check = await (await factory.ClientFor(null).GetAsync($"/api/signup/near?accountId={Uri.EscapeDataString(id)}", Ct)).ReadAsync<NearCheckDto>();
        check.Exists.Should().Be(exists);
        check.Valid.Should().Be(valid);
    }

    [Fact]
    public async Task Signup_requires_an_existing_near_account_terms_and_a_free_subdomain()
    {
        var landing = factory.ClientFor(null);
        var missing = await landing.PostJsonAsync("/api/signup", Signup("valid-slug", "a@x.example", near: "missing-wallet.near"));
        missing.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await missing.Content.ReadAsStringAsync(Ct)).Should().Contain("nearAccountId").And.Contain("does not exist");

        (await landing.PostJsonAsync("/api/signup", Signup("demo", "a@x.example"))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await landing.PostJsonAsync("/api/signup", Signup("valid-slug", "a@x.example", terms: false))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await landing.PostJsonAsync("/api/signup", Signup("valid-slug", "not-an-email"))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Bots_filling_the_honeypot_get_a_success_answer_but_nothing_is_created_or_sent()
    {
        var before = factory.Emails.Sent.Count;
        var response = await factory.ClientFor(null).PostJsonAsync("/api/signup", Signup("bot-farm", "bot@spam.example", website: "http://spam.example"));
        response.StatusCode.Should().Be(HttpStatusCode.Accepted);
        factory.Emails.Sent.Count.Should().Be(before);
        (await factory.InScopeAsync(sp => sp.GetRequiredService<AppDbContext>().PendingSignups.CountAsync(p => p.Email == "bot@spam.example"))).Should().Be(0);
    }

    [Fact]
    public async Task Verified_signup_creates_the_tenant_with_an_encrypted_agent_key_and_a_one_time_setup_link()
    {
        const string slug = "panaderia-sol";
        const string email = "ana@panaderia.example";
        var landing = factory.ClientFor(null);
        (await landing.PostJsonAsync("/api/signup", Signup(slug, email) with { Language = "es" })).StatusCode.Should().Be(HttpStatusCode.Accepted);

        // Nothing exists until the e-mail is verified.
        (await factory.ClientFor(slug).GetAsync("/api/instance", Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound);
        factory.Emails.Sent.Last(m => m.To == email).Subject.Should().Contain("Confirma");
        var verifyToken = Token(factory.Emails.LinkFor(email, "/verify?token="));

        (await landing.PostJsonAsync("/api/signup/verify", new VerifyRequest("forged-token"))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var result = await (await landing.PostJsonAsync("/api/signup/verify", new VerifyRequest(verifyToken))).ReadAsync<VerifyResultDto>();
        result.TenantUrl.Should().Be("http://panaderia-sol.tesorero.test");
        (await landing.PostJsonAsync("/api/signup/verify", new VerifyRequest(verifyToken))).StatusCode.Should().Be(HttpStatusCode.Conflict);

        var tenant = await factory.InScopeAsync(sp => sp.GetRequiredService<AppDbContext>().Tenants.AsNoTracking().SingleAsync(t => t.Slug == slug));
        tenant.IsDemo.Should().BeFalse();
        tenant.NearAccountId.Should().Be("acme.near");
        tenant.AgentAccountId.Should().MatchRegex("^[0-9a-f]{64}$");
        tenant.AgentKeyCiphertext.Should().StartWith("v1.").And.NotContain("ed25519:");
        tenant.SetupTokenHash.Should().HaveLength(64);

        var client = factory.ClientFor(slug);
        var instance = await (await client.GetAsync("/api/instance", Ct)).ReadAsync<InstanceDto>();
        instance.Should().BeEquivalentTo(new { Kind = "tenant", Demo = false, NeedsSetup = true, SetupTokenRequired = true, OrganizationName = $"Org {slug}", TenantSlug = slug });

        var setupToken = Token(factory.Emails.LinkFor(email, "/setup?token="));
        (await client.PostJsonAsync("/api/setup", new SetupRequest("Panadería Sol", "Ana", email, Password, "wrong"))).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var wrongEmail = await client.PostJsonAsync("/api/setup", new SetupRequest("Panadería Sol", "Ana", "someone@else.example", Password, setupToken));
        wrongEmail.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await wrongEmail.Content.ReadAsStringAsync(Ct)).Should().Contain("verified");

        var login = await (await client.PostJsonAsync("/api/setup", new SetupRequest("Panadería Sol", "Ana", email, Password, setupToken))).ReadAsync<LoginResponse>();
        login.User.Role.Should().Be(Role.Owner);
        (await client.PostJsonAsync("/api/setup", new SetupRequest("X", "Y", email, Password, setupToken))).StatusCode.Should().Be(HttpStatusCode.Conflict);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.Token);
        (await (await client.GetAsync("/api/policy", Ct)).ReadAsync<PolicyDto>()).MaxPerPaymentUsd.Should().Be(500, "real organizations start with conservative limits");
        (await (await client.GetAsync("/api/settings", Ct)).ReadAsync<SettingsDto>()).Demo.Should().BeFalse();
        (await (await client.GetAsync("/api/instance", Ct)).ReadAsync<InstanceDto>()).OrganizationName.Should().Be("Panadería Sol");

        var slugCheck = await (await landing.GetAsync($"/api/signup/slug?value={slug}", Ct)).ReadAsync<SlugCheckDto>();
        slugCheck.Reason.Should().Be("taken");
    }

    [Fact]
    public async Task Expired_verification_links_and_subdomain_races_are_rejected()
    {
        var landing = factory.ClientFor(null);
        await landing.PostJsonAsync("/api/signup", Signup("race-slug", "first@race.example"));
        await landing.PostJsonAsync("/api/signup", Signup("race-slug", "second@race.example"));
        var first = Token(factory.Emails.LinkFor("first@race.example", "/verify?token="));
        var second = Token(factory.Emails.LinkFor("second@race.example", "/verify?token="));

        (await landing.PostJsonAsync("/api/signup/verify", new VerifyRequest(first))).StatusCode.Should().Be(HttpStatusCode.OK);
        var lost = await landing.PostJsonAsync("/api/signup/verify", new VerifyRequest(second));
        lost.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await lost.Content.ReadAsStringAsync(Ct)).Should().Contain("was taken");

        await landing.PostJsonAsync("/api/signup", Signup("late-slug", "late@x.example"));
        var late = Token(factory.Emails.LinkFor("late@x.example", "/verify?token="));
        await factory.InScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<AppDbContext>();
            return await db.PendingSignups.Where(p => p.Email == "late@x.example").ExecuteUpdateAsync(p => p.SetProperty(x => x.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        });
        (await landing.PostJsonAsync("/api/signup/verify", new VerifyRequest(late))).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Organizations_are_isolated_in_data_sessions_jobs_and_audit()
    {
        var a = await CreateTenantAsync("tenant-a");
        var b = await CreateTenantAsync("tenant-b");

        var payee = await CreatePayeeAsync(a, "Only In A");
        (await (await a.GetAsync("/api/payees", Ct)).ReadAsync<List<PayeeDto>>()).Select(p => p.Name).Should().Equal("Only In A");
        (await (await b.GetAsync("/api/payees", Ct)).ReadAsync<List<PayeeDto>>()).Should().BeEmpty("B never sees A's data, nor the demo's");
        (await b.GetAsync($"/api/bills/{Guid.NewGuid()}", Ct)).StatusCode.Should().Be(HttpStatusCode.NotFound);

        // A's session is useless on B's subdomain.
        var stolen = factory.ClientFor("tenant-b");
        stolen.DefaultRequestHeaders.Authorization = a.DefaultRequestHeaders.Authorization;
        (await stolen.GetAsync("/api/dashboard", Ct)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var stolenDemo = factory.ClientFor("demo");
        stolenDemo.DefaultRequestHeaders.Authorization = a.DefaultRequestHeaders.Authorization;
        (await stolenDemo.GetAsync("/api/payees", Ct)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // A's agent run only touches A.
        var bill = await (await a.PostJsonAsync("/api/bills", new BillInput(payee.Id, "A-1", "Flour", 40, DateOnly.FromDateTime(DateTime.UtcNow), Category.Supplier, null))).ReadAsync<BillDto>();
        factory.Llm.Enqueue(r => AgentFlowTests.PayEverything(r));
        (await a.PostJsonAsync("/api/agent/runs", new { })).StatusCode.Should().Be(HttpStatusCode.Accepted);
        await factory.DrainJobsAsync();
        await factory.DrainJobsAsync();
        factory.Llm.Requests[^1].UserPrompt.Should().Contain(bill.Id.ToString()).And.NotContain("ACR-2041");
        var paymentsA = await (await a.GetAsync("/api/payments", Ct)).ReadAsync<List<PaymentDto>>();
        paymentsA.Should().ContainSingle().Which.BillId.Should().Be(bill.Id);
        (await (await b.GetAsync("/api/payments", Ct)).ReadAsync<List<PaymentDto>>()).Should().BeEmpty();
        (await (await b.GetAsync("/api/agent/runs", Ct)).ReadAsync<List<AgentRunSummaryDto>>()).Should().BeEmpty();

        var auditA = await (await a.GetAsync("/api/audit?take=200", Ct)).ReadAsync<List<AuditEventDto>>();
        auditA.Should().Contain(e => e.Action == "tenant.created").And.Contain(e => e.Action == "payee.created");
        var auditB = await (await b.GetAsync("/api/audit?take=200", Ct)).ReadAsync<List<AuditEventDto>>();
        auditB.Should().NotContain(e => e.Summary.Contains("Only In A"));

        // The same e-mail can own users in different organizations independently.
        (await b.PostJsonAsync("/api/users", new CreateUserRequest("owner@tenant-a.example", "Shared", Role.Auditor, "another-long-pass"))).StatusCode.Should().Be(HttpStatusCode.Created);
    }
}
