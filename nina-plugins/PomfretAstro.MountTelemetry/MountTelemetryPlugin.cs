using NINA.Core.Utility;
using NINA.Plugin;
using NINA.Plugin.Interfaces;
using NINA.Equipment.Interfaces.Mediator;
using PomfretAstro.MountTelemetry.Properties;
using System;
using System.ComponentModel;
using System.ComponentModel.Composition;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using Settings = PomfretAstro.MountTelemetry.Properties.Settings;

namespace PomfretAstro.MountTelemetry {

    [Export(typeof(IPluginManifest))]
    public class MountTelemetryPlugin : PluginBase, INotifyPropertyChanged {

        private readonly MountTelemetryPublisher _publisher;

        [ImportingConstructor]
        public MountTelemetryPlugin(ITelescopeMediator telescopeMediator) {

            if (Settings.Default.UpdateSettings) {
                Settings.Default.Upgrade();
                Settings.Default.UpdateSettings = false;
                CoreUtil.SaveSettings(Settings.Default);
            }

            _publisher = new MountTelemetryPublisher(telescopeMediator);
        }

        public override Task Teardown() {
            _publisher.Dispose();
            return base.Teardown();
        }

        public string ApiEndpoint {
            get => Settings.Default.ApiEndpoint ?? string.Empty;
            set {
                Settings.Default.ApiEndpoint = value ?? string.Empty;
                CoreUtil.SaveSettings(Settings.Default);
                RaisePropertyChanged();
            }
        }

        public int PostIntervalMilliseconds {
            get => Settings.Default.PostIntervalMilliseconds;
            set {
                Settings.Default.PostIntervalMilliseconds = Math.Max(250, value);
                CoreUtil.SaveSettings(Settings.Default);
                RaisePropertyChanged();
            }
        }

        public string SharedSecret {
            get => Settings.Default.SharedSecret ?? string.Empty;
            set {
                Settings.Default.SharedSecret = value ?? string.Empty;
                CoreUtil.SaveSettings(Settings.Default);
                RaisePropertyChanged();
            }
        }

        public string StationId {
            get => Settings.Default.StationId ?? string.Empty;
            set {
                Settings.Default.StationId = value ?? string.Empty;
                CoreUtil.SaveSettings(Settings.Default);
                RaisePropertyChanged();
            }
        }

        public bool TelemetryEnabled {
            get => Settings.Default.TelemetryEnabled;
            set {
                Settings.Default.TelemetryEnabled = value;
                CoreUtil.SaveSettings(Settings.Default);
                RaisePropertyChanged();
            }
        }

        public event PropertyChangedEventHandler? PropertyChanged;

        protected void RaisePropertyChanged([CallerMemberName] string? propertyName = null) {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
    }
}
