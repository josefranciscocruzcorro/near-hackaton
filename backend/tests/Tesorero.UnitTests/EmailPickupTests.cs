using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Infrastructure.Tenancy;

namespace Tesorero.UnitTests;

public sealed class EmailPickupTests
{
    private static readonly EmailMessage Message = new("ana@panaderia.example", "Confirm your e-mail", "<p>Hi <b>Ana</b></p>", "Hi Ana");

    [Fact]
    public async Task Without_smtp_the_email_is_saved_with_its_html_when_a_pickup_folder_is_set()
    {
        var folder = Path.Combine(Path.GetTempPath(), "tesorero-pickup-" + Guid.NewGuid().ToString("N"));
        try
        {
            var sender = new LogEmailSender(NullLogger<LogEmailSender>.Instance, Options.Create(new EmailOptions { PickupDirectory = folder }), TimeProvider.System);
            await sender.SendAsync(Message, TestContext.Current.CancellationToken);

            var file = Directory.GetFiles(folder, "*.json").Should().ContainSingle().Subject;
            Path.GetFileName(file).Should().EndWith("-ana@panaderia.example.json");
            using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(file, TestContext.Current.CancellationToken));
            doc.RootElement.GetProperty("Subject").GetString().Should().Be("Confirm your e-mail");
            doc.RootElement.GetProperty("Html").GetString().Should().Be("<p>Hi <b>Ana</b></p>");
            doc.RootElement.GetProperty("To").GetString().Should().Be("ana@panaderia.example");
        }
        finally
        {
            if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true);
        }
    }

    [Fact]
    public async Task Without_a_pickup_folder_nothing_is_written()
    {
        var sender = new LogEmailSender(NullLogger<LogEmailSender>.Instance, Options.Create(new EmailOptions()), TimeProvider.System);
        await sender.Invoking(s => s.SendAsync(Message, TestContext.Current.CancellationToken)).Should().NotThrowAsync();
    }
}

public sealed class QueuedEmailTests
{
    private static readonly EmailMessage Message = new("ana@panaderia.example", "Confirm your e-mail", "<p>Hi</p>", "Hi");

    private sealed class CapturingJobs : Hangfire.IBackgroundJobClient
    {
        public List<Hangfire.Common.Job> Created { get; } = [];

        public string Create(Hangfire.Common.Job job, Hangfire.States.IState state)
        {
            Created.Add(job);
            return "1";
        }

        public bool ChangeState(string jobId, Hangfire.States.IState state, string expectedState) => true;
    }

    private sealed class RecordingSender : IEmailSender
    {
        public List<EmailMessage> Sent { get; } = [];

        public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
        {
            Sent.Add(message);
            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task A_request_only_queues_the_email_so_a_down_mail_server_never_blocks_it()
    {
        var jobs = new CapturingJobs();
        await new QueuedEmailSender(jobs).SendAsync(Message, TestContext.Current.CancellationToken);

        var job = jobs.Created.Should().ContainSingle().Subject;
        job.Type.Should().Be<EmailJob>();
        job.Method.Name.Should().Be(nameof(EmailJob.SendAsync));
        job.Args[0].Should().Be(Message);
    }

    [Fact]
    public void The_queued_message_survives_hangfire_serialization()
    {
        var json = Hangfire.Common.SerializationHelper.Serialize(Message, Hangfire.Common.SerializationOption.User);
        Hangfire.Common.SerializationHelper.Deserialize<EmailMessage>(json, Hangfire.Common.SerializationOption.User).Should().Be(Message);
    }

    [Fact]
    public async Task The_job_delivers_through_the_real_transport()
    {
        var sender = new RecordingSender();
        await new EmailJob(new EmailTransport(sender)).SendAsync(Message, TestContext.Current.CancellationToken);
        sender.Sent.Should().ContainSingle().Which.Should().Be(Message);
    }
}
