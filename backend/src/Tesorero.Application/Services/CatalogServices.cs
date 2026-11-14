using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Application.Contracts;
using Tesorero.Domain;

namespace Tesorero.Application.Services;

public sealed class AuthService(IAppDbContext db, IPasswordHasher<User> hasher)
{
    public async Task<User?> ValidateAsync(string email, string password, CancellationToken ct)
    {
        var normalized = email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalized, ct);
        if (user is null)
        {
            return null;
        }

        if (!user.IsActive)
        {
            return null;
        }

        var result = hasher.VerifyHashedPassword(user, user.PasswordHash, password);
        return result == PasswordVerificationResult.Failed ? null : user;
    }
}

public sealed class TokenCatalogService(IAppDbContext db, IIntentsClient intents, TimeProvider clock)
{
    public async Task<IReadOnlyList<TokenDto>> ListAsync(CancellationToken ct)
    {
        if (!await db.Tokens.AnyAsync(ct))
        {
            await RefreshAsync(ct);
        }

        return await db.Tokens
            .OrderBy(t => t.Blockchain).ThenBy(t => t.Symbol)
            .Select(t => new TokenDto(t.AssetId, t.Symbol, t.Blockchain, t.Decimals, t.PriceUsd))
            .ToListAsync(ct);
    }

    public async Task<int> RefreshAsync(CancellationToken ct)
    {
        var tokens = await intents.GetTokensAsync(ct);
        var now = clock.GetUtcNow();
        var existing = await db.Tokens.ToDictionaryAsync(t => t.AssetId, ct);
        foreach (var t in tokens)
        {
            if (existing.TryGetValue(t.AssetId, out var row))
            {
                row.Symbol = t.Symbol;
                row.Blockchain = t.Blockchain;
                row.Decimals = t.Decimals;
                row.PriceUsd = t.PriceUsd;
                row.UpdatedAt = now;
            }
            else
            {
                db.Tokens.Add(new TokenInfo
                {
                    AssetId = t.AssetId, Symbol = t.Symbol, Blockchain = t.Blockchain,
                    Decimals = t.Decimals, PriceUsd = t.PriceUsd, UpdatedAt = now,
                });
            }
        }

        await db.SaveChangesAsync(ct);
        return tokens.Count;
    }

    public async Task<TokenInfo> RequireAsync(string assetId, CancellationToken ct)
    {
        var token = await db.Tokens.FirstOrDefaultAsync(t => t.AssetId == assetId, ct);
        if (token is null && !await db.Tokens.AnyAsync(ct))
        {
            await RefreshAsync(ct);
            token = await db.Tokens.FirstOrDefaultAsync(t => t.AssetId == assetId, ct);
        }

        return token ?? throw ValidationFailedException.For("destinationAssetId", "Unknown destination token. Pick one from the NEAR Intents catalog.");
    }
}

public sealed class PayeeService(IAppDbContext db, TokenCatalogService tokens, IIntentsClient intents, IOptions<IntentsOptions> intentsOptions, TimeProvider clock)
{
    public async Task<IReadOnlyList<PayeeDto>> ListAsync(CancellationToken ct) =>
        (await db.Payees.Where(p => !p.IsArchived).OrderBy(p => p.Name).ToListAsync(ct)).Select(p => p.ToDto()).ToList();

    public async Task<PayeeDto> CreateAsync(PayeeInput input, Actor actor, CancellationToken ct)
    {
        var token = await ValidateAsync(input, ct);
        await VerifyWithIntentsAsync(token, input.RecipientAddress.Trim(), ct);
        var now = clock.GetUtcNow();
        var payee = new Payee
        {
            Name = input.Name.Trim(),
            Email = string.IsNullOrWhiteSpace(input.Email) ? null : input.Email.Trim(),
            Category = input.Category,
            DestinationAssetId = token.AssetId,
            DestinationSymbol = token.Symbol,
            DestinationChain = token.Blockchain,
            RecipientAddress = input.RecipientAddress.Trim(),
            IsAllowlisted = input.IsAllowlisted,
            Notes = input.Notes?.Trim(),
            CreatedAt = now,
        };
        db.Payees.Add(payee);
        db.Record(clock, actor, "payee.created", "Payee", payee.Id,
            $"Added payee {payee.Name} ({token.Symbol} on {token.Blockchain}){(payee.IsAllowlisted ? ", allowlisted" : string.Empty)}.");
        await db.SaveChangesAsync(ct);
        return payee.ToDto();
    }

    public async Task<PayeeDto> UpdateAsync(Guid id, PayeeInput input, Actor actor, CancellationToken ct)
    {
        var payee = await db.Payees.FirstOrDefaultAsync(p => p.Id == id && !p.IsArchived, ct) ?? throw new NotFoundException("Payee", id);
        var token = await ValidateAsync(input, ct);
        if (token.AssetId != payee.DestinationAssetId || input.RecipientAddress.Trim() != payee.RecipientAddress)
        {
            await VerifyWithIntentsAsync(token, input.RecipientAddress.Trim(), ct);
        }

        var oldAddress = payee.RecipientAddress;
        payee.Name = input.Name.Trim();
        payee.Email = string.IsNullOrWhiteSpace(input.Email) ? null : input.Email.Trim();
        payee.Category = input.Category;
        payee.IsAllowlisted = input.IsAllowlisted;
        payee.Notes = input.Notes?.Trim();
        payee.SetDestination(token.AssetId, token.Symbol, token.Blockchain, input.RecipientAddress.Trim(), clock.GetUtcNow());
        var summary = oldAddress == payee.RecipientAddress
            ? $"Updated payee {payee.Name}."
            : $"Changed payment address of {payee.Name}; cool-down restarted.";
        db.Record(clock, actor, "payee.updated", "Payee", payee.Id, summary);
        await db.SaveChangesAsync(ct);
        return payee.ToDto();
    }

    public async Task ArchiveAsync(Guid id, Actor actor, CancellationToken ct)
    {
        var payee = await db.Payees.FirstOrDefaultAsync(p => p.Id == id && !p.IsArchived, ct) ?? throw new NotFoundException("Payee", id);
        payee.IsArchived = true;
        db.Record(clock, actor, "payee.archived", "Payee", payee.Id, $"Archived payee {payee.Name}.");
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Asks NEAR Intents for a dry quote to this exact destination. If 1Click cannot route there, the payee
    /// is rejected now, before any real payment is attempted.
    /// </summary>
    private async Task VerifyWithIntentsAsync(TokenInfo token, string address, CancellationToken ct)
    {
        var o = intentsOptions.Value;
        try
        {
            await intents.QuoteAsync(new IntentsQuoteRequest(true, o.OriginAssetId, token.AssetId, "10000000", address,
                o.DefaultRefundAccount, clock.GetUtcNow().AddMinutes(10)), ct);
        }
        catch (ExternalServiceException ex)
        {
            throw ValidationFailedException.For("recipientAddress",
                $"NEAR Intents could not route {token.Symbol} on {token.Blockchain} to this address ({ex.Message}). Check the address and the network.");
        }
    }

    private async Task<TokenInfo> ValidateAsync(PayeeInput input, CancellationToken ct)
    {
        new Validator()
            .Require(!string.IsNullOrWhiteSpace(input.Name) && input.Name.Trim().Length <= 120, "name", "Name is required (max 120 characters).")
            .Require(input.Email is null || input.Email.Length <= 160, "email", "Email is too long.")
            .Require(!string.IsNullOrWhiteSpace(input.DestinationAssetId), "destinationAssetId", "Destination token is required.")
            .Require(!string.IsNullOrWhiteSpace(input.RecipientAddress), "recipientAddress", "Recipient address is required.")
            .Require(input.Notes is null || input.Notes.Length <= 500, "notes", "Notes are too long (max 500).")
            .Require(Enum.IsDefined(input.Category), "category", "Unknown category.")
            .ThrowIfInvalid();

        var token = await tokens.RequireAsync(input.DestinationAssetId, ct);
        if (!AddressRules.IsValid(token.Blockchain, input.RecipientAddress.Trim()))
        {
            throw ValidationFailedException.For("recipientAddress", $"This is not a valid {token.Blockchain} address.");
        }

        return token;
    }
}

public sealed class PolicyService(IAppDbContext db, TimeProvider clock)
{
    public async Task<TreasuryPolicy> GetEntityAsync(CancellationToken ct) =>
        await db.Policies.SingleOrDefaultAsync(ct) ?? throw new InvalidOperationException("Treasury policy has not been seeded.");

    public async Task<PolicyDto> GetAsync(CancellationToken ct) => (await GetEntityAsync(ct)).ToDto();

    public async Task<PolicyDto> UpdateAsync(PolicyInput input, Actor actor, CancellationToken ct)
    {
        new Validator()
            .Require(input.MaxPerPaymentUsd > 0, "maxPerPaymentUsd", "Must be greater than zero.")
            .Require(input.ApprovalThresholdUsd >= 0, "approvalThresholdUsd", "Cannot be negative.")
            .Require(input.ApprovalThresholdUsd <= input.MaxPerPaymentUsd, "approvalThresholdUsd", "Cannot exceed the per-payment maximum.")
            .Require(input.DailyLimitUsd >= input.MaxPerPaymentUsd, "dailyLimitUsd", "Must be at least the per-payment maximum.")
            .Require(input.MonthlyLimitUsd >= input.DailyLimitUsd, "monthlyLimitUsd", "Must be at least the daily limit.")
            .Require(input.MinReserveUsd >= 0, "minReserveUsd", "Cannot be negative.")
            .Require(input.NewPayeeCooldownHours is >= 0 and <= 720, "newPayeeCooldownHours", "Must be between 0 and 720 hours.")
            .Require(input.PlanningHorizonDays is >= 1 and <= 60, "planningHorizonDays", "Must be between 1 and 60 days.")
            .Require(input.CategoryBudgets.Values.All(v => v >= 0), "categoryBudgets", "Budgets cannot be negative.")
            .ThrowIfInvalid();

        var p = await GetEntityAsync(ct);
        var killSwitchChanged = p.AgentEnabled != input.AgentEnabled;
        p.AgentEnabled = input.AgentEnabled;
        p.MaxPerPaymentUsd = input.MaxPerPaymentUsd;
        p.ApprovalThresholdUsd = input.ApprovalThresholdUsd;
        p.DailyLimitUsd = input.DailyLimitUsd;
        p.MonthlyLimitUsd = input.MonthlyLimitUsd;
        p.MinReserveUsd = input.MinReserveUsd;
        p.RequireAllowlistedPayee = input.RequireAllowlistedPayee;
        p.NewPayeeCooldownHours = input.NewPayeeCooldownHours;
        p.PlanningHorizonDays = input.PlanningHorizonDays;
        p.CategoryBudgets = new Dictionary<Category, decimal>(input.CategoryBudgets);
        p.Version++;
        p.UpdatedAt = clock.GetUtcNow();
        p.UpdatedBy = actor.Name;
        var summary = killSwitchChanged
            ? $"Policy v{p.Version}: agent {(p.AgentEnabled ? "enabled" : "DISABLED (kill switch)")}."
            : $"Policy updated to v{p.Version}.";
        db.Record(clock, actor, "policy.updated", "Policy", p.Id, summary);

        await db.SaveChangesAsync(ct);
        return p.ToDto();
    }

    /// <summary>Stop or resume every payment at once (the agent switch). Takes effect before any queued payment is sent.</summary>
    public async Task<PolicyDto> SetPaymentsEnabledAsync(bool enabled, Actor actor, CancellationToken ct)
    {
        var p = await GetEntityAsync(ct);
        if (p.AgentEnabled != enabled)
        {
            p.AgentEnabled = enabled;
            p.Version++;
            p.UpdatedAt = clock.GetUtcNow();
            p.UpdatedBy = actor.Name;
            db.Record(clock, actor, enabled ? "payments.resumed" : "payments.stopped", "Policy", p.Id,
                enabled ? $"Payments resumed (policy v{p.Version})." : $"All payments stopped (policy v{p.Version}). Nothing leaves the treasury until they are resumed.");
            await db.SaveChangesAsync(ct);
        }

        return p.ToDto();
    }
}

public sealed class SettingsService(IAppDbContext db, ITreasuryChain chain, ITenantContext tenant, INearRpcClient rpc, TreasuryService treasury, TimeProvider clock)
{
    public async Task<OrganizationSettings> GetEntityAsync(CancellationToken ct) =>
        await db.Settings.SingleOrDefaultAsync(ct) ?? throw new InvalidOperationException("Settings have not been seeded.");

    public async Task<SettingsDto> GetAsync(CancellationToken ct)
    {
        var s = await GetEntityAsync(ct);
        TreasuryBalanceDto? balance = null;
        if (s.TreasuryAccountId is { } account)
        {
            balance = await db.TreasurySnapshots.Where(x => x.AccountId == account)
                .OrderByDescending(x => x.CapturedAt)
                .Select(x => new TreasuryBalanceDto(x.UsdcBalance, x.NearBalance, x.CapturedAt))
                .FirstOrDefaultAsync(ct);
        }

        return new SettingsDto(s.OrganizationName, s.TreasuryAccountId, s.ExecutionMode, "mainnet", tenant.IsDemo, chain.AgentAccountId, balance);
    }

    public async Task<SettingsDto> UpdateAsync(SettingsInput input, Actor actor, CancellationToken ct)
    {
        var account = string.IsNullOrWhiteSpace(input.TreasuryAccountId) ? null : input.TreasuryAccountId.Trim();
        new Validator()
            .Require(!string.IsNullOrWhiteSpace(input.OrganizationName) && input.OrganizationName.Length <= 80, "organizationName", "Organization name is required (max 80).")
            .Require(account is null || (account.Length is >= 2 and <= 64 && AddressRules.NearAccount().IsMatch(account)), "treasuryAccountId", "Must be a valid NEAR account id (e.g. company.near).")
            .Require(input.ExecutionMode != ExecutionMode.Live || account is not null, "executionMode", "Live mode needs a treasury NEAR account.")
            .Require(input.ExecutionMode != ExecutionMode.Live || !tenant.IsDemo, "executionMode", "Live mode is disabled on the public demo: real money never moves here.")
            .ThrowIfInvalid();

        var s = await GetEntityAsync(ct);
        if (account is not null && account != s.TreasuryAccountId)
        {
            // Only a definite "does not exist" blocks the save; if the RPC is unreachable the account is kept as typed.
            var exists = true;
            try
            {
                exists = await rpc.AccountExistsAsync(account, ct);
            }
            catch (ExternalServiceException)
            {
                // Checked again by the balance refresh below and every 10 minutes.
            }

            new Validator().Require(exists, "treasuryAccountId", "This account does not exist on NEAR mainnet.").ThrowIfInvalid();
        }

        // Live with an agent pays through the treasury contract: refuse anything that is not this organization's verified treasury.
        if (input.ExecutionMode == ExecutionMode.Live && account is not null && chain.AgentAccountId is { } agent)
        {
            string? problem = null;
            try
            {
                var config = await chain.GetConfigAsync(account, ct);
                if (config is null || config.AgentId != agent)
                {
                    problem = "This account is not a Tesorero treasury for this organization. Create it in Treasury.";
                }
            }
            catch (ExternalServiceException)
            {
                problem = "Could not verify the treasury on NEAR right now. Try again.";
            }

            new Validator().Require(problem is null, "executionMode", problem ?? string.Empty).ThrowIfInvalid();
        }

        var modeChanged = s.ExecutionMode != input.ExecutionMode;
        s.OrganizationName = input.OrganizationName.Trim();
        s.TreasuryAccountId = account;
        s.ExecutionMode = input.ExecutionMode;
        db.Record(clock, actor, "settings.updated", "Settings", s.Id,
            modeChanged ? $"Execution mode switched to {s.ExecutionMode}." : "Organization settings updated.");
        await db.SaveChangesAsync(ct);

        // Read the balances right away instead of waiting for the 10-minute refresh job.
        if (account is not null)
        {
            await treasury.RefreshAsync(ct);
        }

        return await GetAsync(ct);
    }
}

public sealed class AuditService(IAppDbContext db)
{
    public async Task<IReadOnlyList<AuditEventDto>> ListAsync(int take, CancellationToken ct)
    {
        take = Math.Clamp(take, 1, 500);
        return (await db.AuditEvents.OrderByDescending(e => e.At).Take(take).ToListAsync(ct)).Select(e => e.ToDto()).ToList();
    }
}
