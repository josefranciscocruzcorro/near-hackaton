using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tesorero.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "agent_runs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Trigger = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Model = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Summary = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    PromptTokens = table.Column<int>(type: "integer", nullable: false),
                    CompletionTokens = table.Column<int>(type: "integer", nullable: false),
                    Error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Decisions = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_runs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "audit_events",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Actor = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    ActorType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Action = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    EntityType = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    EntityId = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Summary = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_events", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "bill_extractions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceText = table.Column<string>(type: "character varying(12000)", maxLength: 12000, nullable: false),
                    ResultJson = table.Column<string>(type: "jsonb", maxLength: 500, nullable: false),
                    Flags = table.Column<string>(type: "jsonb", nullable: false),
                    MatchedPayeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    Model = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bill_extractions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "organization_settings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganizationName = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    TreasuryAccountId = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ExecutionMode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_organization_settings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "payees",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Email = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DestinationAssetId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DestinationSymbol = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    DestinationChain = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    RecipientAddress = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    IsAllowlisted = table.Column<bool>(type: "boolean", nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AddressChangedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payees", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "tokens",
                columns: table => new
                {
                    AssetId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Symbol = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Blockchain = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Decimals = table.Column<int>(type: "integer", nullable: false),
                    PriceUsd = table.Column<decimal>(type: "numeric(28,10)", precision: 28, scale: 10, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tokens", x => x.AssetId);
                });

            migrationBuilder.CreateTable(
                name: "treasury_policy",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    MaxPerPaymentUsd = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    ApprovalThresholdUsd = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    DailyLimitUsd = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    MonthlyLimitUsd = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    MinReserveUsd = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    RequireAllowlistedPayee = table.Column<bool>(type: "boolean", nullable: false),
                    NewPayeeCooldownHours = table.Column<int>(type: "integer", nullable: false),
                    PlanningHorizonDays = table.Column<int>(type: "integer", nullable: false),
                    CategoryBudgets = table.Column<string>(type: "jsonb", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_treasury_policy", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "treasury_snapshots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    UsdcBalance = table.Column<decimal>(type: "numeric(28,6)", precision: 28, scale: 6, nullable: true),
                    NearBalance = table.Column<decimal>(type: "numeric(38,8)", precision: 38, scale: 8, nullable: true),
                    CapturedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_treasury_snapshots", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Name = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    PasswordHash = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "bills",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PayeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Reference = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    AmountUsd = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Source = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Flags = table.Column<string>(type: "jsonb", nullable: false),
                    ExtractionId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bills", x => x.Id);
                    table.ForeignKey(
                        name: "FK_bills_payees_PayeeId",
                        column: x => x.PayeeId,
                        principalTable: "payees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BillId = table.Column<Guid>(type: "uuid", nullable: false),
                    PayeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentRunId = table.Column<Guid>(type: "uuid", nullable: true),
                    AmountUsd = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    OriginAssetId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DestinationAssetId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DestinationSymbol = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    DestinationChain = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Recipient = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    PolicyOutcome = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    PolicyReasons = table.Column<string>(type: "jsonb", nullable: false),
                    AiReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Simulation = table.Column<bool>(type: "boolean", nullable: false),
                    Quote = table.Column<string>(type: "jsonb", nullable: true),
                    DepositTxHash = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IntentStatus = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    DecidedBy = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    DecidedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DecisionNote = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    LastError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SettledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_payments_bills_BillId",
                        column: x => x.BillId,
                        principalTable: "bills",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_payments_payees_PayeeId",
                        column: x => x.PayeeId,
                        principalTable: "payees",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_agent_runs_StartedAt",
                table: "agent_runs",
                column: "StartedAt");

            migrationBuilder.CreateIndex(
                name: "IX_audit_events_At",
                table: "audit_events",
                column: "At");

            migrationBuilder.CreateIndex(
                name: "IX_bills_PayeeId",
                table: "bills",
                column: "PayeeId");

            migrationBuilder.CreateIndex(
                name: "IX_bills_Status_DueDate",
                table: "bills",
                columns: new[] { "Status", "DueDate" });

            migrationBuilder.CreateIndex(
                name: "IX_payments_BillId",
                table: "payments",
                column: "BillId");

            migrationBuilder.CreateIndex(
                name: "IX_payments_CreatedAt",
                table: "payments",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_payments_PayeeId",
                table: "payments",
                column: "PayeeId");

            migrationBuilder.CreateIndex(
                name: "IX_payments_Status",
                table: "payments",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_treasury_snapshots_AccountId_CapturedAt",
                table: "treasury_snapshots",
                columns: new[] { "AccountId", "CapturedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_users_Email",
                table: "users",
                column: "Email",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_runs");

            migrationBuilder.DropTable(
                name: "audit_events");

            migrationBuilder.DropTable(
                name: "bill_extractions");

            migrationBuilder.DropTable(
                name: "organization_settings");

            migrationBuilder.DropTable(
                name: "payments");

            migrationBuilder.DropTable(
                name: "tokens");

            migrationBuilder.DropTable(
                name: "treasury_policy");

            migrationBuilder.DropTable(
                name: "treasury_snapshots");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropTable(
                name: "bills");

            migrationBuilder.DropTable(
                name: "payees");
        }
    }
}
