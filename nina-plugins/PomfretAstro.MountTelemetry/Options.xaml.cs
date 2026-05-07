using System.ComponentModel.Composition;
using System.Windows;

namespace PomfretAstro.MountTelemetry {

    [Export(typeof(ResourceDictionary))]
    partial class Options : ResourceDictionary {

        public Options() {
            InitializeComponent();
        }
    }
}
