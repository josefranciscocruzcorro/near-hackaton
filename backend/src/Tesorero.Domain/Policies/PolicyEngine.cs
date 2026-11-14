using System.Globalization;

namespace Tesorero.Domain.Policies;

/// <summary>Everything the engine needs to judge one proposed payment. Pure data, no I/O.</summary>
public sealed record PolicyContext(
    TreasuryPolicy Policy,
    ExecutionMode Mode,
    decimal AmountUsd,
    Category Category,
    bool PayeeAllowlisted,
    bool PayeeArchived,
    DateTimeOffset PayeeTrustedSince,
    IReadOnlyCollection<BillFlag> BillFlags,
    decimal CommittedToday,
    decimal CommittedThisMonth,
    decimal CommittedCategoryThisMonth,
    decimal? TreasuryUsdcBalance,
    DateTimeOffset Now,
    string Language = "en");

public sealed record PolicyEvaluation(PolicyOutcome Outcome, IReadOnlyList<PolicyReason> Reasons);

/// <summary>
/// Deterministic guardrails. The AI only proposes; this engine decides.
/// Hard limits block, soft signals require a human, otherwise the payment is allowed.
/// </summary>
public static class PolicyEngine
{
    public const string Info = "info";
    public const string Warn = "warn";
    public const string BlockSeverity = "block";

    public static PolicyEvaluation Evaluate(PolicyContext ctx)
    {
        ArgumentNullException.ThrowIfNull(ctx);
        var p = ctx.Policy;
        var es = ctx.Language == "es";
        string Usd(decimal value) => Money(value, es);
        var reasons = new List<PolicyReason>();

        void Block(string code, string message) => reasons.Add(new PolicyReason(code, message, BlockSeverity));
        void Review(string code, string message) => reasons.Add(new PolicyReason(code, message, Warn));

        if (!p.AgentEnabled)
        {
            Block("AgentDisabled", es ? "Los pagos están detenidos: ningún pago puede programarse." : "The agent kill switch is on: no payment can be scheduled automatically.");
        }

        if (ctx.AmountUsd <= 0)
        {
            Block("InvalidAmount", es ? "El monto debe ser mayor que cero." : "The amount must be greater than zero.");
        }

        if (ctx.PayeeArchived)
        {
            Block("PayeeArchived", es ? "El beneficiario está archivado." : "The payee has been archived.");
        }

        if (p.RequireAllowlistedPayee && !ctx.PayeeAllowlisted)
        {
            Block("PayeeNotAllowlisted", es ? "Este beneficiario no tiene activados los pagos automáticos." : "The payee is not on the allowlist.");
        }

        if (ctx.BillFlags.Contains(BillFlag.SuspiciousInstructions))
        {
            Block("SuspiciousInstructions", es ? "La factura contiene instrucciones dirigidas al agente o presión para cambiar los datos de pago (posible inyección de instrucciones)." : "The invoice contains instructions aimed at the agent or pressure to change payment details (possible prompt injection).");
        }

        if (ctx.AmountUsd > p.MaxPerPaymentUsd)
        {
            Block("ExceedsMaxPerPayment", es ? $"{Usd(ctx.AmountUsd)} supera el máximo por pago de {Usd(p.MaxPerPaymentUsd)}." : $"{Usd(ctx.AmountUsd)} is above the per-payment maximum of {Usd(p.MaxPerPaymentUsd)}.");
        }

        if (ctx.CommittedToday + ctx.AmountUsd > p.DailyLimitUsd)
        {
            Block("ExceedsDailyLimit", es ? $"El gasto de hoy llegaría a {Usd(ctx.CommittedToday + ctx.AmountUsd)}, por encima del límite diario de {Usd(p.DailyLimitUsd)}." : $"Would bring today's spend to {Usd(ctx.CommittedToday + ctx.AmountUsd)}, above the daily limit of {Usd(p.DailyLimitUsd)}.");
        }

        if (ctx.CommittedThisMonth + ctx.AmountUsd > p.MonthlyLimitUsd)
        {
            Block("ExceedsMonthlyLimit", es ? $"El gasto del mes llegaría a {Usd(ctx.CommittedThisMonth + ctx.AmountUsd)}, por encima del límite mensual de {Usd(p.MonthlyLimitUsd)}." : $"Would bring this month's spend to {Usd(ctx.CommittedThisMonth + ctx.AmountUsd)}, above the monthly limit of {Usd(p.MonthlyLimitUsd)}.");
        }

        if (ctx.TreasuryUsdcBalance is { } balance)
        {
            if (balance - ctx.AmountUsd < p.MinReserveUsd)
            {
                Block("BelowReserve", es ? $"Pagar dejaría {Usd(balance - ctx.AmountUsd)} en la tesorería, por debajo de la reserva mínima de {Usd(p.MinReserveUsd)}." : $"Paying would leave {Usd(balance - ctx.AmountUsd)} in the treasury, below the minimum reserve of {Usd(p.MinReserveUsd)}.");
            }
        }
        else if (ctx.Mode == ExecutionMode.Live)
        {
            Review("TreasuryBalanceUnknown", es ? "No se pudo leer el saldo de la tesorería, así que no se comprobó la reserva." : "The treasury balance could not be read, so the reserve could not be checked.");
        }

        if (ctx.BillFlags.Contains(BillFlag.PaymentDetailsMismatch))
        {
            Review("PaymentDetailsMismatch", es ? "La factura pide pagar a una dirección distinta de la registrada. Una persona debe confirmarlo con el beneficiario." : "The invoice asks to pay a different address than the one on file. A human must confirm with the payee.");
        }

        if (p.CategoryBudgets.TryGetValue(ctx.Category, out var budget)
            && ctx.CommittedCategoryThisMonth + ctx.AmountUsd > budget)
        {
            Review("ExceedsCategoryBudget", es ? $"El gasto en {CategoryEs(ctx.Category)} llegaría a {Usd(ctx.CommittedCategoryThisMonth + ctx.AmountUsd)}, por encima de su presupuesto mensual de {Usd(budget)}." : $"{ctx.Category} spend would reach {Usd(ctx.CommittedCategoryThisMonth + ctx.AmountUsd)}, above its monthly budget of {Usd(budget)}.");
        }

        var trustedFor = ctx.Now - ctx.PayeeTrustedSince;
        if (trustedFor < TimeSpan.FromHours(p.NewPayeeCooldownHours))
        {
            Review("NewPayeeCooldown", es ? $"El beneficiario o su dirección de pago es nuevo (cambió hace {FormatAge(trustedFor)}; espera de {p.NewPayeeCooldownHours} h)." : $"The payee or its payment address is new (changed {FormatAge(trustedFor)} ago; cool-down is {p.NewPayeeCooldownHours} h).");
        }

        if (ctx.AmountUsd > p.ApprovalThresholdUsd)
        {
            Review("AboveApprovalThreshold", es ? $"{Usd(ctx.AmountUsd)} supera el umbral de aprobación automática de {Usd(p.ApprovalThresholdUsd)}." : $"{Usd(ctx.AmountUsd)} is above the {Usd(p.ApprovalThresholdUsd)} auto-approval threshold.");
        }

        PolicyOutcome outcome;
        if (reasons.Exists(r => r.Severity == BlockSeverity))
        {
            outcome = PolicyOutcome.Block;
        }
        else if (reasons.Exists(r => r.Severity == Warn))
        {
            outcome = PolicyOutcome.RequireApproval;
        }
        else
        {
            outcome = PolicyOutcome.Allow;
            reasons.Add(new PolicyReason("WithinPolicy", es ? "Dentro de todos los límites, presupuestos y reglas de confianza." : "Within every limit, budget and trust rule.", Info));
        }

        return new PolicyEvaluation(outcome, reasons);
    }

    // The server runs in globalization-invariant mode (no ICU cultures): build the Spanish number format by hand.
    private static readonly NumberFormatInfo Spanish = new() { NumberDecimalSeparator = ",", NumberGroupSeparator = "." };

    private static string Money(decimal value, bool es) => value.ToString("$#,##0.00", es ? Spanish : CultureInfo.InvariantCulture);

    private static string CategoryEs(Category c) => c switch
    {
        Category.Supplier => "proveedores",
        Category.Contractor => "contratistas",
        Category.Payroll => "nómina",
        Category.Software => "software",
        Category.Operations => "operaciones",
        Category.Marketing => "marketing",
        _ => c.ToString(),
    };

    private static string FormatAge(TimeSpan age) =>
        age.TotalHours < 1 ? $"{Math.Max(0, (int)age.TotalMinutes)} min" : $"{(int)age.TotalHours} h";
}
