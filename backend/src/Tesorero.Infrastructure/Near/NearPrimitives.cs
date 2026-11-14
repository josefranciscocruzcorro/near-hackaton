using System.Buffers.Binary;
using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace Tesorero.Infrastructure.Near;

/// <summary>Bitcoin-alphabet Base58, as used by NEAR for keys and hashes.</summary>
public static class Base58
{
    private const string Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

    public static string Encode(ReadOnlySpan<byte> data)
    {
        var value = new BigInteger(data, isUnsigned: true, isBigEndian: true);
        var sb = new StringBuilder();
        while (value > 0)
        {
            value = BigInteger.DivRem(value, 58, out var rem);
            sb.Insert(0, Alphabet[(int)rem]);
        }

        foreach (var b in data)
        {
            if (b != 0)
            {
                break;
            }

            sb.Insert(0, '1');
        }

        return sb.ToString();
    }

    public static byte[] Decode(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        BigInteger value = 0;
        foreach (var c in text)
        {
            var digit = Alphabet.IndexOf(c, StringComparison.Ordinal);
            if (digit < 0)
            {
                throw new FormatException($"Invalid base58 character '{c}'.");
            }

            value = (value * 58) + digit;
        }

        var bytes = value.IsZero ? [] : value.ToByteArray(isUnsigned: true, isBigEndian: true);
        var leadingZeros = text.TakeWhile(c => c == '1').Count();
        return [.. new byte[leadingZeros], .. bytes];
    }
}

/// <summary>An ed25519 key pair in NEAR's text format (<c>ed25519:&lt;base58&gt;</c>).</summary>
public sealed class NearKeyPair
{
    private const string Prefix = "ed25519:";
    private readonly Ed25519PrivateKeyParameters _private;

    private NearKeyPair(Ed25519PrivateKeyParameters privateKey)
    {
        _private = privateKey;
        PublicKey = privateKey.GeneratePublicKey().GetEncoded();
    }

    public byte[] PublicKey { get; }

    /// <summary>Implicit account id: lowercase hex of the public key.</summary>
    public string ImplicitAccountId => Convert.ToHexStringLower(PublicKey);

    public string PublicKeyText => Prefix + Base58.Encode(PublicKey);

    /// <summary>NEAR secret key format: base58 of seed (32) + public key (32).</summary>
    public string SecretKeyText => Prefix + Base58.Encode([.. _private.GetEncoded(), .. PublicKey]);

    public static NearKeyPair Generate()
    {
        var seed = RandomNumberGenerator.GetBytes(32);
        return new NearKeyPair(new Ed25519PrivateKeyParameters(seed, 0));
    }

    public static NearKeyPair Parse(string secretKey)
    {
        ArgumentNullException.ThrowIfNull(secretKey);
        var text = secretKey.Trim();
        if (!text.StartsWith(Prefix, StringComparison.Ordinal))
        {
            throw new FormatException("Only ed25519 NEAR keys are supported.");
        }

        var raw = Base58.Decode(text[Prefix.Length..]);
        if (raw.Length is not (32 or 64))
        {
            throw new FormatException("A NEAR ed25519 secret key must decode to 32 or 64 bytes.");
        }

        var pair = new NearKeyPair(new Ed25519PrivateKeyParameters(raw, 0));
        if (raw.Length == 64 && !raw.AsSpan(32).SequenceEqual(pair.PublicKey))
        {
            throw new FormatException("The secret key does not match its embedded public key.");
        }

        return pair;
    }

    public byte[] Sign(byte[] message)
    {
        var signer = new Ed25519Signer();
        signer.Init(true, _private);
        signer.BlockUpdate(message, 0, message.Length);
        return signer.GenerateSignature();
    }
}

/// <summary>Minimal Borsh writer for NEAR transactions (little-endian, u32 length prefixes).</summary>
public sealed class BorshWriter
{
    private readonly MemoryStream _buffer = new();

    public BorshWriter U8(byte value)
    {
        _buffer.WriteByte(value);
        return this;
    }

    public BorshWriter U32(uint value)
    {
        Span<byte> b = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32LittleEndian(b, value);
        _buffer.Write(b);
        return this;
    }

    public BorshWriter U64(ulong value)
    {
        Span<byte> b = stackalloc byte[8];
        BinaryPrimitives.WriteUInt64LittleEndian(b, value);
        _buffer.Write(b);
        return this;
    }

    public BorshWriter U128(UInt128 value)
    {
        Span<byte> b = stackalloc byte[16];
        BinaryPrimitives.WriteUInt128LittleEndian(b, value);
        _buffer.Write(b);
        return this;
    }

    public BorshWriter Fixed(ReadOnlySpan<byte> bytes)
    {
        _buffer.Write(bytes);
        return this;
    }

    public BorshWriter Bytes(ReadOnlySpan<byte> bytes) => U32((uint)bytes.Length).Fixed(bytes);

    public BorshWriter String(string value) => Bytes(Encoding.UTF8.GetBytes(value));

    public byte[] ToArray() => _buffer.ToArray();
}

/// <summary>A NEAR transaction action (borsh enum: CreateAccount 0, DeployContract 1, FunctionCall 2, Transfer 3, …, DeleteKey 6).</summary>
public abstract record NearAction;

public sealed record FunctionCallAction(string MethodName, byte[] Args, ulong Gas, UInt128 Deposit) : NearAction;

public sealed record DeployContractAction(byte[] Code) : NearAction;

public sealed record TransferAction(UInt128 Deposit) : NearAction;

/// <summary>Removes an ed25519 access key (32-byte public key) from the signer's account.</summary>
public sealed record DeleteKeyAction(byte[] PublicKey) : NearAction;

/// <summary>Builds and signs a NEAR transaction.</summary>
public static class NearTransaction
{
    private const byte Ed25519KeyType = 0;
    private const byte DeployContractActionIndex = 1;
    private const byte FunctionCallActionIndex = 2;
    private const byte TransferActionIndex = 3;
    private const byte DeleteKeyActionIndex = 6;

    public static byte[] Serialize(string signerId, byte[] publicKey, ulong nonce, string receiverId, byte[] blockHash, IReadOnlyList<NearAction> actions)
    {
        ArgumentNullException.ThrowIfNull(actions);
        var w = new BorshWriter()
            .String(signerId)
            .U8(Ed25519KeyType).Fixed(publicKey)
            .U64(nonce)
            .String(receiverId)
            .Fixed(blockHash)
            .U32((uint)actions.Count);
        foreach (var action in actions)
        {
            switch (action)
            {
                case FunctionCallAction a:
                    w.U8(FunctionCallActionIndex).String(a.MethodName).Bytes(a.Args).U64(a.Gas).U128(a.Deposit);
                    break;
                case DeployContractAction a:
                    w.U8(DeployContractActionIndex).Bytes(a.Code);
                    break;
                case TransferAction a:
                    w.U8(TransferActionIndex).U128(a.Deposit);
                    break;
                case DeleteKeyAction a:
                    w.U8(DeleteKeyActionIndex).U8(Ed25519KeyType).Fixed(a.PublicKey);
                    break;
                default:
                    throw new ArgumentException($"Unsupported NEAR action {action.GetType().Name}.", nameof(actions));
            }
        }

        return w.ToArray();
    }

    /// <summary>Returns (base58 tx hash, base64 signed transaction ready for <c>send_tx</c>).</summary>
    public static (string Hash, string SignedBase64) Sign(byte[] serializedTransaction, NearKeyPair key)
    {
        ArgumentNullException.ThrowIfNull(key);
        var hash = SHA256.HashData(serializedTransaction);
        var signature = key.Sign(hash);
        var signed = new BorshWriter().Fixed(serializedTransaction).U8(Ed25519KeyType).Fixed(signature).ToArray();
        return (Base58.Encode(hash), Convert.ToBase64String(signed));
    }
}

/// <summary>NEAR amount conversions that do not overflow <see cref="decimal"/> (yoctoNEAR can exceed 7.9e28).</summary>
public static class NearAmount
{
    private static readonly UInt128 YoctoPerMicroNear = UInt128.Parse("1000000000000000000", CultureInfo.InvariantCulture);

    /// <summary>yoctoNEAR string → NEAR with 6 decimals (truncated), or null if it is not a number.</summary>
    public static decimal? FromYocto(string? yocto) =>
        UInt128.TryParse(yocto, NumberStyles.None, CultureInfo.InvariantCulture, out var value)
            ? (decimal)(value / YoctoPerMicroNear) / 1_000_000m
            : null;
}
