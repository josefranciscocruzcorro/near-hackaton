using System.Text;
using System.Text.Json;
using Tesorero.Infrastructure.Near;

namespace Tesorero.UnitTests;

/// <summary>
/// Byte-for-byte compatibility with the official near-api-js 7.5.3 serializer and signer.
/// Vectors were generated with a throwaway key that controls no account.
/// </summary>
public sealed class NearSigningTests
{
    private const string SecretKey = "ed25519:64PgY3f6ktURchm6spNeXqr9ULCvs6usQssFsdWW3WLEYKE6m5tTTF4cJ8T9yojSfDRbUtRwa7E3PZ5bk5mjCVeK";
    private const string PublicKey = "ed25519:A4G9A1LMAcTvWuPoyYKFPgyiRkcfgezUqzpotzP773Ru";
    private const string BlockHash = "8ATvpw9Bn3vM6qgw3sAUZbCrBVY6DsGiJZqQfyCMyT2E";

    private const string ExpectedTxHex =
        "0f0000006167656e742e746573742e6e65617200868f0b578ba39559f5e91e7973a91b21722c52bf1868003b5889e0f66e5f8abc2a00000000000000120000007465736f7265726f2e746573742e6e6561726a6e7bc0204331815058e2ced3869ee6462b20370e17b39682afe774e58b7dcf010000000203000000706179800000007b227061796d656e745f6964223a22705f313233222c226465706f7369745f61646472657373223a2261616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c22616d6f756e74223a22343830303030303030227d00407a10f35a000000000000000000000000000000000000";

    private const string ExpectedHash = "G4uzMPv7JPPTKdRoirTv5GmL8VqonHy8nnuQL4qmhPem";

    private const string ExpectedSignedBase64 =
        "DwAAAGFnZW50LnRlc3QubmVhcgCGjwtXi6OVWfXpHnlzqRshcixSvxhoADtYieD2bl+KvCoAAAAAAAAAEgAAAHRlc29yZXJvLnRlc3QubmVhcmpue8AgQzGBUFjiztOGnuZGKyA3DhezloKv53Tli33PAQAAAAIDAAAAcGF5gAAAAHsicGF5bWVudF9pZCI6InBfMTIzIiwiZGVwb3NpdF9hZGRyZXNzIjoiYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsImFtb3VudCI6IjQ4MDAwMDAwMCJ9AEB6EPNaAAAAAAAAAAAAAAAAAAAAAAAAAJmE+UyGZtZBO07GOJFa+FTNd/VsEKJ8QvVo7r1x62fWV7G6XpZjj1APv+mayGmjr4InR/AMLYBaZyNGV9TglwQ=";

    private static byte[] Serialize(NearKeyPair key)
    {
        var args = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { payment_id = "p_123", deposit_address = new string('a', 64), amount = "480000000" }));
        return NearTransaction.Serialize("agent.test.near", key.PublicKey, 42, "tesorero.test.near", Base58.Decode(BlockHash),
            [new FunctionCallAction("pay", args, 100_000_000_000_000UL, UInt128.Zero)]);
    }

    [Fact]
    public void Parses_near_secret_keys_and_derives_the_public_key_and_implicit_account()
    {
        var key = NearKeyPair.Parse(SecretKey);

        key.PublicKeyText.Should().Be(PublicKey);
        key.SecretKeyText.Should().Be(SecretKey);
        key.ImplicitAccountId.Should().HaveLength(64).And.MatchRegex("^[0-9a-f]+$");
        Base58.Decode(PublicKey["ed25519:".Length..]).Should().Equal(key.PublicKey);
    }

    [Fact]
    public void Serializes_a_function_call_transaction_exactly_like_near_api_js() =>
        Convert.ToHexStringLower(Serialize(NearKeyPair.Parse(SecretKey))).Should().Be(ExpectedTxHex);

    [Fact]
    public void Signs_exactly_like_near_api_js()
    {
        var (hash, signed) = NearTransaction.Sign(Serialize(NearKeyPair.Parse(SecretKey)), NearKeyPair.Parse(SecretKey));

        hash.Should().Be(ExpectedHash);
        signed.Should().Be(ExpectedSignedBase64);
    }

    [Fact]
    public void Generated_keys_round_trip_and_sign_verifiably()
    {
        var key = NearKeyPair.Generate();
        var parsed = NearKeyPair.Parse(key.SecretKeyText);

        parsed.PublicKey.Should().Equal(key.PublicKey);
        parsed.Sign([1, 2, 3]).Should().Equal(key.Sign([1, 2, 3]), "ed25519 signatures are deterministic");
        key.ImplicitAccountId.Should().Be(Convert.ToHexStringLower(key.PublicKey));
    }

    [Theory]
    [InlineData("secp256k1:abc")]
    [InlineData("ed25519:111")]
    [InlineData("ed25519:0OIl")]
    public void Rejects_malformed_or_unsupported_keys(string text) =>
        FluentActions.Invoking(() => NearKeyPair.Parse(text)).Should().Throw<FormatException>();

    [Fact]
    public void Rejects_a_secret_key_whose_embedded_public_key_does_not_match()
    {
        var a = NearKeyPair.Generate();
        var b = NearKeyPair.Generate();
        var raw = Base58.Decode(a.SecretKeyText["ed25519:".Length..]);
        var tampered = "ed25519:" + Base58.Encode([.. raw.AsSpan(0, 32), .. b.PublicKey]);

        FluentActions.Invoking(() => NearKeyPair.Parse(tampered)).Should().Throw<FormatException>();
    }

    [Theory]
    [InlineData(new byte[] { }, "")]
    [InlineData(new byte[] { 0, 0, 1 }, "112")]
    [InlineData(new byte[] { 255 }, "5Q")]
    public void Base58_round_trips_including_leading_zeros(byte[] data, string text)
    {
        Base58.Encode(data).Should().Be(text);
        Base58.Decode(text).Should().Equal(data);
    }

    [Fact]
    public void Finds_contract_panics_inside_receipts_and_makes_them_readable()
    {
        using var ok = JsonDocument.Parse("""{"status":{"SuccessValue":""},"receipts_outcome":[{"outcome":{"status":{"SuccessValue":"dHJ1ZQ=="}}}]}""");
        TreasuryChainClient.FindFailure(ok.RootElement).Should().BeNull();

        using var limit = JsonDocument.Parse("""{"status":{"Failure":{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: ERR_OVER_DAILY_LIMIT"}}}}}}""");
        TreasuryChainClient.FindFailure(limit.RootElement).Should().Contain("daily limit");

        using var receipt = JsonDocument.Parse("""{"status":{"SuccessValue":""},"receipts_outcome":[{"outcome":{"status":{"Failure":{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: The account doesn't have enough balance"}}}}}}}]}""");
        TreasuryChainClient.FindFailure(receipt.RootElement).Should().Contain("enough balance");
    }
}
