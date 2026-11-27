using NINA.Core.Utility;
using NINA.Equipment.Equipment.MySafetyMonitor;
using NINA.Equipment.Equipment.MyTelescope;
using NINA.Equipment.Interfaces.Mediator;
using PomfretAstro.MountTelemetry.Properties;
using System;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace PomfretAstro.MountTelemetry {

    /// <summary>
    /// Subscribes to telescope + safety-monitor mediators.
    /// Mount POSTs to the configured URL; when the safety monitor is (or was just)
    /// connected, its status is piggybacked on the same mount JSON — no extra HTTP call.
    /// </summary>
    public sealed class MountTelemetryPublisher : ITelescopeConsumer, ISafetyMonitorConsumer {
        private static readonly HttpClient Http = CreateHttpClient();

        private readonly ITelescopeMediator _telescopeMediator;
        private readonly ISafetyMonitorMediator _safetyMonitorMediator;
        private readonly object _mountPostSync = new object();
        private readonly object _safetySync = new object();
        private DateTime _lastMountPostUtc = DateTime.MinValue;
        private SafetyMonitorInfo? _latestSafety;
        private bool _safetyWasConnected;
        private bool _pendingSafetyDisconnectReport;
        private volatile bool _disposed;

        private static HttpClient CreateHttpClient() {
            var c = new HttpClient {
                Timeout = TimeSpan.FromSeconds(15),
            };
            return c;
        }

        public MountTelemetryPublisher(
            ITelescopeMediator telescopeMediator,
            ISafetyMonitorMediator safetyMonitorMediator
        ) {
            _telescopeMediator = telescopeMediator ?? throw new ArgumentNullException(nameof(telescopeMediator));
            _safetyMonitorMediator = safetyMonitorMediator ?? throw new ArgumentNullException(nameof(safetyMonitorMediator));
            _telescopeMediator.RegisterConsumer(this);
            _safetyMonitorMediator.RegisterConsumer(this);
        }

        public void UpdateDeviceInfo(TelescopeInfo deviceInfo) {
            if (_disposed || deviceInfo == null) return;
            if (!Settings.Default.TelemetryEnabled) return;

            var url = (Settings.Default.ApiEndpoint ?? string.Empty).Trim();
            if (url.Length == 0) return;

            var interval = Math.Max(2000, Settings.Default.PostIntervalMilliseconds);
            var now = DateTime.UtcNow;
            lock (_mountPostSync) {
                if ((now - _lastMountPostUtc).TotalMilliseconds < interval) return;
                _lastMountPostUtc = now;
            }

            _ = PostMountAsync(deviceInfo, url);
        }

        public void UpdateDeviceInfo(SafetyMonitorInfo deviceInfo) {
            if (_disposed || deviceInfo == null) return;

            lock (_safetySync) {
                var connected = deviceInfo.Connected;
                if (_safetyWasConnected && !connected) {
                    _pendingSafetyDisconnectReport = true;
                }
                _safetyWasConnected = connected;
                _latestSafety = deviceInfo;
            }
        }

        private async Task PostMountAsync(TelescopeInfo info, string url) {
            try {
                var payload = BuildMountPayload(info);
                await SendJsonAsync(url, payload).ConfigureAwait(false);
            } catch (Exception ex) {
                Logger.Error(ex);
            }
        }

        private static async Task SendJsonAsync(string url, object payload) {
            var json = JsonSerializer.Serialize(payload, SerializerOptions);
            using var req = new HttpRequestMessage(HttpMethod.Post, url) {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
            var secret = Settings.Default.SharedSecret?.Trim() ?? string.Empty;
            if (secret.Length > 0) {
                req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + secret);
                req.Headers.TryAddWithoutValidation("x-nina-mount-telemetry-secret", secret);
            }

            using var resp = await Http.SendAsync(req).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) {
                Logger.Warning($"Pomfret Astro Network POST failed ({url}): {(int)resp.StatusCode} {resp.ReasonPhrase}");
            }
        }

        private static readonly JsonSerializerOptions SerializerOptions = new JsonSerializerOptions {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        };

        private static string? PluginVersionString() {
            var v = Assembly.GetExecutingAssembly().GetName().Version;
            return v == null ? null : $"{v.Major}.{v.Minor}.{v.Build}";
        }

        private static string? StationIdOrNull() {
            var station = Settings.Default.StationId?.Trim() ?? string.Empty;
            return station.Length > 0 ? station : null;
        }

        private MountTelemetryDto BuildMountPayload(TelescopeInfo info) {
            return new MountTelemetryDto {
                Source = "pomfret-mount-telemetry",
                PluginVersion = PluginVersionString(),
                StationId = StationIdOrNull(),
                Connected = info.Connected,
                RaHours = Fin(info.RightAscension),
                DecDeg = Fin(info.Declination),
                SiderealTimeHours = Fin(info.SiderealTime),
                SiteLatitudeDeg = Fin(info.SiteLatitude),
                AltitudeDeg = Fin(info.Altitude),
                AzimuthDeg = Fin(info.Azimuth),
                Slewing = info.Slewing,
                AtPark = info.AtPark,
                TrackingEnabled = info.TrackingEnabled,
                SideOfPier = info.SideOfPier.ToString(),
                Epoch = info.EquatorialSystem.ToString(),
                ClientUtc = DateTime.UtcNow.ToString("o"),
                SafetyMonitor = TakeSafetyMonitorForMountPost(),
            };
        }

        /// <summary>
        /// Include safety when connected, or once after disconnect so the site is not left on a stale Safe.
        /// </summary>
        private SafetyTelemetryDto? TakeSafetyMonitorForMountPost() {
            SafetyMonitorInfo? info;
            bool pendingDisconnect;
            lock (_safetySync) {
                info = _latestSafety;
                pendingDisconnect = _pendingSafetyDisconnectReport;
                if (pendingDisconnect) _pendingSafetyDisconnectReport = false;
            }
            if (info == null) return null;

            if (info.Connected) {
                return BuildSafetyNested(info, forceDisconnected: false);
            }
            if (pendingDisconnect) {
                return BuildSafetyNested(info, forceDisconnected: true);
            }
            return null;
        }

        private static SafetyTelemetryDto BuildSafetyNested(SafetyMonitorInfo info, bool forceDisconnected) {
            var connected = forceDisconnected ? false : info.Connected;
            return new SafetyTelemetryDto {
                Source = "pomfret-safety-monitor",
                Connected = connected,
                IsSafe = connected ? info.IsSafe : (bool?)null,
                Name = string.IsNullOrWhiteSpace(info.Name) ? null : info.Name,
                DisplayName = string.IsNullOrWhiteSpace(info.DisplayName) ? null : info.DisplayName,
                DeviceId = string.IsNullOrWhiteSpace(info.DeviceId) ? null : info.DeviceId,
            };
        }

        private static double? Fin(double value) {
            if (double.IsNaN(value) || double.IsInfinity(value)) return null;
            return value;
        }

        private sealed class MountTelemetryDto {
            public string? Source { get; set; }
            public string? PluginVersion { get; set; }
            public string? StationId { get; set; }
            public bool Connected { get; set; }
            public double? RaHours { get; set; }
            public double? DecDeg { get; set; }
            public double? SiderealTimeHours { get; set; }
            public double? SiteLatitudeDeg { get; set; }
            public double? AltitudeDeg { get; set; }
            public double? AzimuthDeg { get; set; }
            public bool Slewing { get; set; }
            public bool AtPark { get; set; }
            public bool TrackingEnabled { get; set; }
            public string? SideOfPier { get; set; }
            public string? Epoch { get; set; }
            public string? ClientUtc { get; set; }
            public SafetyTelemetryDto? SafetyMonitor { get; set; }
        }

        private sealed class SafetyTelemetryDto {
            public string? Source { get; set; }
            public bool Connected { get; set; }
            public bool? IsSafe { get; set; }
            public string? Name { get; set; }
            public string? DisplayName { get; set; }
            public string? DeviceId { get; set; }
        }

        public void Dispose() {
            if (_disposed) return;
            _disposed = true;
            try {
                _telescopeMediator.RemoveConsumer(this);
            } catch (Exception ex) {
                Logger.Error(ex);
            }
            try {
                _safetyMonitorMediator.RemoveConsumer(this);
            } catch (Exception ex) {
                Logger.Error(ex);
            }
        }
    }
}
