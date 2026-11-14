using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tesorero.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LanguagePerTenantAndRun : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Language",
                table: "tenants",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Language",
                table: "agent_runs",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Language",
                table: "tenants");

            migrationBuilder.DropColumn(
                name: "Language",
                table: "agent_runs");
        }
    }
}
