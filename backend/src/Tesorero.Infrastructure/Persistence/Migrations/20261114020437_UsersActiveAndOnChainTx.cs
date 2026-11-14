using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Tesorero.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UsersActiveAndOnChainTx : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "users",
                type: "boolean",
                nullable: false,
                // Existing users must stay able to sign in after the upgrade.
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "OnChainTxHash",
                table: "payments",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "users");

            migrationBuilder.DropColumn(
                name: "OnChainTxHash",
                table: "payments");
        }
    }
}
