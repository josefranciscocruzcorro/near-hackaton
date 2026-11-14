#:project ../../backend/src/Tesorero.Infrastructure/Tesorero.Infrastructure.csproj
#:property TreatWarningsAsErrors=false
#:property PublishAot=false
#:property JsonSerializerIsReflectionEnabledByDefault=true
#:package Newtonsoft.Json@13.0.4
#:property NoWarn=CA1303;CA1031;CA1062;CA2007;IDE0005;CA1305;CA1307;CA1310;CA1849;CA5394
// Local NEAR sandbox helper for testing the in-app treasury creation (ADR-0007) with the server's own NEAR code.
// Usage: dotnet run tool.cs -- <rpc> <command> ...
//   deploy-usdc <signerId> <signerSecret> <wasmPath>       → prints the mock USDC implicit account and its secret
//   send-near   <signerId> <signerSecret> <to> <near>
//   ft-transfer <usdcId> <usdcSecret> <to> <amountBaseUnits>
//   inspect     <accountId> <usdcId>
using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Infrastructure.Near;

var rpc = args[0];
var command = args[1];
var options = new NearOptions { RpcUrl = rpc, UsdcContract = command == "inspect" ? args[3] : "unused" };
var http = new HttpClient { BaseAddress = new Uri(rpc), Timeout = TimeSpan.FromSeconds(120) };
var accounts = new NearAccountsClient(http, Options.Create(options), NullLogger<NearAccountsClient>.Instance);
var yocto = UInt128.Parse("1000000000000000000000000", CultureInfo.InvariantCulture);

switch (command)
{
    case "deploy-usdc":
    {
        var key = NearKeyPair.Generate();
        await accounts.SendAsync(args[2], args[3], key.ImplicitAccountId, [new ChainTransfer(10 * yocto)], default);
        var wasm = await File.ReadAllBytesAsync(args[4]);
        var init = JsonSerializer.Serialize(new { owner_id = key.ImplicitAccountId, total_supply = "1000000000000" });
        var hash = await accounts.SendAsync(key.ImplicitAccountId, key.SecretKeyText, key.ImplicitAccountId,
            [new ChainDeploy(wasm), new ChainCall("new", init, 30_000_000_000_000UL, UInt128.Zero)], default);
        Console.WriteLine($"USDC_ID={key.ImplicitAccountId}");
        Console.WriteLine($"USDC_SECRET={key.SecretKeyText}");
        Console.WriteLine($"DEPLOY_TX={hash}");
        break;
    }

    case "send-near":
    {
        var amount = (UInt128)(decimal.Parse(args[5], CultureInfo.InvariantCulture) * 1_000_000m) * (yocto / 1_000_000UL);
        Console.WriteLine("TX=" + await accounts.SendAsync(args[2], args[3], args[4], [new ChainTransfer(amount)], default));
        break;
    }

    case "ft-transfer":
    {
        var transfer = JsonSerializer.Serialize(new { receiver_id = args[4], amount = args[5] });
        Console.WriteLine("TX=" + await accounts.SendAsync(args[2], args[3], args[2], [new ChainCall("ft_transfer", transfer, 30_000_000_000_000UL, UInt128.One)], default));
        break;
    }

    case "inspect":
    {
        var state = await accounts.GetAsync(args[2], default);
        Console.WriteLine($"exists={state is not null} near={state?.NearBalance} codeHash={state?.CodeHash} keys={state?.AccessKeys} usdcRegistered={await accounts.IsUsdcRegisteredAsync(args[2], default)}");
        break;
    }
}
