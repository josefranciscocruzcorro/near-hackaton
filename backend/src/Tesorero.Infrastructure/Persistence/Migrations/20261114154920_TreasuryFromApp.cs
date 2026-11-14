using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tesorero.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TreasuryFromApp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "treasury_fundings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OriginAssetId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Symbol = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Chain = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    AmountIn = table.Column<decimal>(type: "numeric(38,18)", precision: 38, scale: 18, nullable: false),
                    ExpectedUsdc = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    DepositAddress = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DepositMemo = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Deadline = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RefundAddress = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    TreasuryAccountId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    DestinationTxHash = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CheckedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_treasury_fundings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "treasury_setups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerAccountId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    MaxPerPaymentUsd = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    DailyLimitUsd = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    AccountId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    DeployKeyCiphertext = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    DeployTxHash = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    RegisterTxHash = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    AgentGasTxHash = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    LockTxHash = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    LastError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_treasury_setups", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_treasury_fundings_CreatedAt",
                table: "treasury_fundings",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_treasury_fundings_DepositAddress",
                table: "treasury_fundings",
                column: "DepositAddress");

            migrationBuilder.CreateIndex(
                name: "IX_treasury_fundings_TenantId",
                table: "treasury_fundings",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_treasury_setups_CreatedAt",
                table: "treasury_setups",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_treasury_setups_TenantId",
                table: "treasury_setups",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "treasury_fundings");

            migrationBuilder.DropTable(
                name: "treasury_setups");
        }
    }
}
