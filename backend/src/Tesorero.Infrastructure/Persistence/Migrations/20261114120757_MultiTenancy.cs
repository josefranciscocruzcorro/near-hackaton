using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tesorero.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MultiTenancy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_users_Email",
                table: "users");

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "users",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-00000000de30"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "treasury_snapshots",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-00000000de30"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "treasury_policy",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-00000000de30"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "payments",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-00000000de30"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "payees",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-00000000de30"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "organization_settings",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-00000000de30"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "bills",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-00000000de30"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "bill_extractions",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-00000000de30"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "audit_events",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-00000000de30"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "agent_runs",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-00000000de30"));

            migrationBuilder.CreateTable(
                name: "pending_signups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    OrganizationName = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Slug = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    OwnerName = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Email = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    NearAccountId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Language = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    VerifiedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pending_signups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "tenants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Slug = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    IsDemo = table.Column<bool>(type: "boolean", nullable: false),
                    OwnerEmail = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    NearAccountId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SetupTokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SetupTokenExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    AgentAccountId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    AgentKeyCiphertext = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tenants", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_users_TenantId",
                table: "users",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_users_TenantId_Email",
                table: "users",
                columns: new[] { "TenantId", "Email" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_treasury_snapshots_TenantId",
                table: "treasury_snapshots",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_treasury_policy_TenantId",
                table: "treasury_policy",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_payments_TenantId",
                table: "payments",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_payees_TenantId",
                table: "payees",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_organization_settings_TenantId",
                table: "organization_settings",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_bills_TenantId",
                table: "bills",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_bill_extractions_TenantId",
                table: "bill_extractions",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_audit_events_TenantId",
                table: "audit_events",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_agent_runs_TenantId",
                table: "agent_runs",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_pending_signups_Email",
                table: "pending_signups",
                column: "Email");

            migrationBuilder.CreateIndex(
                name: "IX_pending_signups_TokenHash",
                table: "pending_signups",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tenants_Slug",
                table: "tenants",
                column: "Slug",
                unique: true);
        
            // Existing single-organization data becomes the public demo tenant (ADR-0006).
            migrationBuilder.Sql("""
                INSERT INTO tenants ("Id", "Slug", "Name", "IsDemo", "CreatedAt")
                VALUES ('00000000-0000-0000-0000-00000000de30', 'demo',
                        COALESCE((SELECT "OrganizationName" FROM organization_settings LIMIT 1), 'Cafetería La Ceiba'), TRUE, now())
                ON CONFLICT DO NOTHING;
                ALTER TABLE users ALTER COLUMN "TenantId" DROP DEFAULT;
                ALTER TABLE payees ALTER COLUMN "TenantId" DROP DEFAULT;
                ALTER TABLE bills ALTER COLUMN "TenantId" DROP DEFAULT;
                ALTER TABLE bill_extractions ALTER COLUMN "TenantId" DROP DEFAULT;
                ALTER TABLE treasury_policy ALTER COLUMN "TenantId" DROP DEFAULT;
                ALTER TABLE organization_settings ALTER COLUMN "TenantId" DROP DEFAULT;
                ALTER TABLE treasury_snapshots ALTER COLUMN "TenantId" DROP DEFAULT;
                ALTER TABLE agent_runs ALTER COLUMN "TenantId" DROP DEFAULT;
                ALTER TABLE payments ALTER COLUMN "TenantId" DROP DEFAULT;
                ALTER TABLE audit_events ALTER COLUMN "TenantId" DROP DEFAULT;
                """);
        }

protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "pending_signups");

            migrationBuilder.DropTable(
                name: "tenants");

            migrationBuilder.DropIndex(
                name: "IX_users_TenantId",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_users_TenantId_Email",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_treasury_snapshots_TenantId",
                table: "treasury_snapshots");

            migrationBuilder.DropIndex(
                name: "IX_treasury_policy_TenantId",
                table: "treasury_policy");

            migrationBuilder.DropIndex(
                name: "IX_payments_TenantId",
                table: "payments");

            migrationBuilder.DropIndex(
                name: "IX_payees_TenantId",
                table: "payees");

            migrationBuilder.DropIndex(
                name: "IX_organization_settings_TenantId",
                table: "organization_settings");

            migrationBuilder.DropIndex(
                name: "IX_bills_TenantId",
                table: "bills");

            migrationBuilder.DropIndex(
                name: "IX_bill_extractions_TenantId",
                table: "bill_extractions");

            migrationBuilder.DropIndex(
                name: "IX_audit_events_TenantId",
                table: "audit_events");

            migrationBuilder.DropIndex(
                name: "IX_agent_runs_TenantId",
                table: "agent_runs");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "users");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "treasury_snapshots");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "treasury_policy");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "payments");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "payees");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "organization_settings");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "bills");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "bill_extractions");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "audit_events");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "agent_runs");

            migrationBuilder.CreateIndex(
                name: "IX_users_Email",
                table: "users",
                column: "Email",
                unique: true);
        }
    }
}
