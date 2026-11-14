using Tesorero.Infrastructure.Near;

namespace Tesorero.UnitTests;

public sealed class NearAmountTests
{
    [Theory]
    [InlineData("2500000000000000000000000", "2.5")]
    [InlineData("4041632610306927800000000", "4.041632")]
    [InlineData("0", "0")]
    [InlineData("1000000000000000000000000000000000000", "1000000000000")] // 1e12 NEAR: overflows decimal if divided naively
    public void Converts_yocto_to_near_without_overflow(string yocto, string near) =>
        NearAmount.FromYocto(yocto).Should().Be(decimal.Parse(near, System.Globalization.CultureInfo.InvariantCulture));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("-1")]
    [InlineData("12.5")]
    public void Returns_null_for_anything_that_is_not_a_yocto_amount(string? yocto) =>
        NearAmount.FromYocto(yocto).Should().BeNull();
}
