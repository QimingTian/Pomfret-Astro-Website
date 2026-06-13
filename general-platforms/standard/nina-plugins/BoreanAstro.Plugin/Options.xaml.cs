using System.ComponentModel.Composition;
using System.Windows;

namespace BoreanAstro.Plugin {

    [Export(typeof(ResourceDictionary))]
    partial class Options : ResourceDictionary {

        public Options() {
            InitializeComponent();
        }
    }
}
