using Tesorero.Domain;
using Tesorero.Domain.Policies;

namespace Tesorero.UnitTests;

public sealed class PolicyEngineTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 12, 0, 0, TimeSpan.Zero);

    private static TreasuryPolicy Policy() => new()
    {
        AgentEnabled = true,
        MaxPerPaymentUsd = 2500,
        ApprovalThresholdUsd = 1000,
        DailyLimitUsd = 5000,
        MonthlyLimitUsd = 20000,
        MinReserveUsd = 1000,
        RequireAllowlistedPayee = true,
        NewPayeeCooldownHours = 48,
        PlanningHorizonDays = 7,
        CategoryBudgets = new() { [Category.Supplier] = 4000, [Category.Software] = 800 },
    };

    private static PolicyContext Ctx(
        decimal amount = 500,
        TreasuryPolicy? policy = null,
        ExecutionMode mode = ExecutionMode.Simulation,
        Category category = Category.Supplier,
        bool allowlisted = true,
        bool archived = false,
        TimeSpan? trustedFor = null,
        BillFlag[]? flags = null,
        decimal today = 0,
        decimal month = 0,
        decimal categoryMonth = 0,
        decimal? balance = 50_000) =>
        new(policy ?? Policy(), mode, amount, category, allowlisted, archived, Now - (trustedFor ?? TimeSpan.FromDays(90)),
            flags ?? [], today, month, categoryMonth, balance, Now);

    private static IEnumerable<string> Codes(PolicyEvaluation e) => e.Reasons.Select(r => r.Code);

    [Fact]
    public void Reasons_are_written_in_the_language_of_the_run_with_local_number_format()
    {
        // Default test policy: minimum reserve $1,000.
        var es = PolicyEngine.Evaluate(Ctx(amount: 1250, balance: 1300) with { Language = "es" });
        es.Reasons.Single(r => r.Code == "BelowReserve").Message.Should().Be("Pagar dejaría $50,00 en la tesorería, por debajo de la reserva mínima de $1.000,00.");

        var en = PolicyEngine.Evaluate(Ctx(amount: 1250, balance: 1300));
        en.Reasons.Single(r => r.Code == "BelowReserve").Message.Should().Be("Paying would leave $50.00 in the treasury, below the minimum reserve of $1,000.00.");
        Codes(es).Should().Equal(Codes(en), "the decision never depends on the language");
    }

    [Fact]
    public void Allows_a_routine_payment_within_every_rule()
    {
        var result = PolicyEngine.Evaluate(Ctx());

        result.Outcome.Should().Be(PolicyOutcome.Allow);
        Codes(result).Should().ContainSingle().Which.Should().Be("WithinPolicy");
        result.Reasons.Single().Severity.Should().Be(PolicyEngine.Info);
    }

    [Fact]
    public void Kill_switch_blocks_everything()
    {
        var policy = Policy();
        policy.AgentEnabled = false;

        var result = PolicyEngine.Evaluate(Ctx(policy: policy));

        result.Outcome.Should().Be(PolicyOutcome.Block);
        Codes(result).Should().Contain("AgentDisabled");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void Non_positive_amounts_are_blocked(decimal amount) =>
        Codes(PolicyEngine.Evaluate(Ctx(amount: amount))).Should().Contain("InvalidAmount");

    [Fact]
    public void Archived_payee_is_blocked() =>
        PolicyEngine.Evaluate(Ctx(archived: true)).Outcome.Should().Be(PolicyOutcome.Block);

    [Fact]
    public void Payee_off_the_allowlist_is_blocked_when_required()
    {
        var result = PolicyEngine.Evaluate(Ctx(allowlisted: false));

        result.Outcome.Should().Be(PolicyOutcome.Block);
        Codes(result).Should().Contain("PayeeNotAllowlisted");
    }

    [Fact]
    public void Payee_off_the_allowlist_is_fine_when_not_required()
    {
        var policy = Policy();
        policy.RequireAllowlistedPayee = false;

        PolicyEngine.Evaluate(Ctx(policy: policy, allowlisted: false)).Outcome.Should().Be(PolicyOutcome.Allow);
    }

    [Fact]
    public void Suspicious_instructions_are_always_blocked_even_for_small_amounts()
    {
        var result = PolicyEngine.Evaluate(Ctx(amount: 10, flags: [BillFlag.SuspiciousInstructions]));

        result.Outcome.Should().Be(PolicyOutcome.Block);
        Codes(result).Should().Contain("SuspiciousInstructions");
    }

    [Fact]
    public void Amount_above_the_per_payment_maximum_is_blocked()
    {
        var result = PolicyEngine.Evaluate(Ctx(amount: 2500.01m));

        result.Outcome.Should().Be(PolicyOutcome.Block);
        Codes(result).Should().Contain("ExceedsMaxPerPayment");
    }

    [Fact]
    public void Amount_exactly_at_the_maximum_is_not_blocked_by_that_rule() =>
        Codes(PolicyEngine.Evaluate(Ctx(amount: 2500))).Should().NotContain("ExceedsMaxPerPayment");

    [Fact]
    public void Daily_limit_counts_what_is_already_committed_today()
    {
        var result = PolicyEngine.Evaluate(Ctx(amount: 600, today: 4500));

        result.Outcome.Should().Be(PolicyOutcome.Block);
        Codes(result).Should().Contain("ExceedsDailyLimit");
    }

    [Fact]
    public void Monthly_limit_counts_what_is_already_committed_this_month() =>
        Codes(PolicyEngine.Evaluate(Ctx(amount: 600, month: 19_500))).Should().Contain("ExceedsMonthlyLimit");

    [Fact]
    public void Paying_below_the_reserve_is_blocked()
    {
        var result = PolicyEngine.Evaluate(Ctx(amount: 600, balance: 1500));

        result.Outcome.Should().Be(PolicyOutcome.Block);
        Codes(result).Should().Contain("BelowReserve");
    }

    [Fact]
    public void Unknown_balance_is_tolerated_in_simulation() =>
        PolicyEngine.Evaluate(Ctx(balance: null)).Outcome.Should().Be(PolicyOutcome.Allow);

    [Fact]
    public void Unknown_balance_needs_a_human_in_live_mode()
    {
        var result = PolicyEngine.Evaluate(Ctx(balance: null, mode: ExecutionMode.Live));

        result.Outcome.Should().Be(PolicyOutcome.RequireApproval);
        Codes(result).Should().Contain("TreasuryBalanceUnknown");
    }

    [Fact]
    public void Changed_payment_details_need_a_human()
    {
        var result = PolicyEngine.Evaluate(Ctx(flags: [BillFlag.PaymentDetailsMismatch]));

        result.Outcome.Should().Be(PolicyOutcome.RequireApproval);
        Codes(result).Should().Contain("PaymentDetailsMismatch");
    }

    [Fact]
    public void Category_budget_overrun_needs_a_human()
    {
        var result = PolicyEngine.Evaluate(Ctx(amount: 300, category: Category.Software, categoryMonth: 600));

        result.Outcome.Should().Be(PolicyOutcome.RequireApproval);
        Codes(result).Should().Contain("ExceedsCategoryBudget");
    }

    [Fact]
    public void Categories_without_a_budget_are_not_limited() =>
        PolicyEngine.Evaluate(Ctx(category: Category.Marketing, categoryMonth: 1_000_000, month: 0)).Outcome.Should().Be(PolicyOutcome.Allow);

    [Theory]
    [InlineData(1)]
    [InlineData(47)]
    public void New_or_changed_payee_is_in_cool_down(int hours)
    {
        var result = PolicyEngine.Evaluate(Ctx(trustedFor: TimeSpan.FromHours(hours)));

        result.Outcome.Should().Be(PolicyOutcome.RequireApproval);
        Codes(result).Should().Contain("NewPayeeCooldown");
    }

    [Fact]
    public void Cool_down_ends_after_the_configured_hours() =>
        PolicyEngine.Evaluate(Ctx(trustedFor: TimeSpan.FromHours(48))).Outcome.Should().Be(PolicyOutcome.Allow);

    [Fact]
    public void Cool_down_message_reports_minutes_for_very_recent_changes() =>
        PolicyEngine.Evaluate(Ctx(trustedFor: TimeSpan.FromMinutes(20))).Reasons
            .Single(r => r.Code == "NewPayeeCooldown").Message.Should().Contain("20 min");

    [Fact]
    public void Amount_above_the_auto_approval_threshold_needs_a_human()
    {
        var result = PolicyEngine.Evaluate(Ctx(amount: 1000.01m));

        result.Outcome.Should().Be(PolicyOutcome.RequireApproval);
        Codes(result).Should().Contain("AboveApprovalThreshold");
    }

    [Fact]
    public void Block_wins_over_review_and_every_reason_is_reported()
    {
        var result = PolicyEngine.Evaluate(Ctx(amount: 4900, allowlisted: true,
            flags: [BillFlag.SuspiciousInstructions, BillFlag.PaymentDetailsMismatch], trustedFor: TimeSpan.FromHours(1)));

        result.Outcome.Should().Be(PolicyOutcome.Block);
        Codes(result).Should().Contain(["SuspiciousInstructions", "ExceedsMaxPerPayment", "PaymentDetailsMismatch", "NewPayeeCooldown", "AboveApprovalThreshold"]);
        Codes(result).Should().NotContain("WithinPolicy");
    }

    [Fact]
    public void Messages_are_human_readable_with_money_formatting() =>
        PolicyEngine.Evaluate(Ctx(amount: 3000)).Reasons.Single(r => r.Code == "ExceedsMaxPerPayment").Message
            .Should().Be("$3,000.00 is above the per-payment maximum of $2,500.00.");

    [Fact]
    public void Null_context_is_rejected() =>
        FluentActions.Invoking(() => PolicyEngine.Evaluate(null!)).Should().Throw<ArgumentNullException>();
}
