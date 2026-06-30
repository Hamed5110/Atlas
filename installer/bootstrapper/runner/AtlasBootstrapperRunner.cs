using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Data.SqlClient;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.AccessControl;
using System.ServiceProcess;
using System.Text;
using System.Windows.Forms;

namespace AtlasBootstrapperRunner
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                var exeName = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]) ?? "atlas-runner";
                var mode = "Preflight";
                if (exeName.IndexOf("configure", StringComparison.OrdinalIgnoreCase) >= 0) mode = "Install";
                if (exeName.IndexOf("troubleshoot", StringComparison.OrdinalIgnoreCase) >= 0) mode = "Troubleshoot";
                if (args.Length > 0 && IsMode(args[0]))
                {
                    mode = args[0];
                    args = args.Skip(1).ToArray();
                }

                var options = ParseArgs(args);
                if (mode.Equals("Preflight", StringComparison.OrdinalIgnoreCase))
                {
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    return RunPreflight(options);
                }

                return RunPowerShell(mode, args);
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.Message, "ATLAS setup error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static int RunPreflight(Dictionary<string, string> options)
        {
            var defaultPort = GetIntOption(options, "Port", 3355);
            var dataRoot = GetOption(options, "DataRoot", @"C:\ProgramData\ATLAS Airfare Allowance");
            Directory.CreateDirectory(dataRoot);

            using (var form = new PreflightForm(defaultPort, dataRoot))
            {
                return form.ShowDialog() == DialogResult.OK ? 0 : 1602;
            }
        }

        private static int RunPowerShell(string mode, string[] args)
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var script = Directory.GetFiles(baseDir, "*.ps1", SearchOption.TopDirectoryOnly).FirstOrDefault();
            if (script == null)
            {
                script = Directory.GetFiles(baseDir, "*.ps1", SearchOption.AllDirectories).FirstOrDefault();
            }
            if (script == null)
            {
                Console.Error.WriteLine("deploy.ps1 payload was not found next to the ATLAS runner.");
                return 2;
            }

            var ps = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            if (!File.Exists(ps))
            {
                ps = Path.Combine(Environment.GetEnvironmentVariable("SystemRoot") ?? @"C:\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            }
            if (!File.Exists(ps))
            {
                Console.Error.WriteLine("Windows PowerShell was not found on this computer.");
                return 3;
            }

            var arguments = "-NoProfile -ExecutionPolicy Bypass -File " + Quote(script) + " -Mode " + mode;
            if (args.Length > 0)
            {
                arguments += " " + string.Join(" ", args.Select(Quote));
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = ps,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = baseDir
            };
            using (var process = Process.Start(startInfo))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }

        private static Dictionary<string, string> ParseArgs(string[] args)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < args.Length; i++)
            {
                var key = args[i].TrimStart('-', '/');
                if (string.IsNullOrWhiteSpace(key)) continue;
                var value = "1";
                if (i + 1 < args.Length && !args[i + 1].StartsWith("-") && !args[i + 1].StartsWith("/"))
                {
                    value = args[++i];
                }
                result[key] = value;
            }
            return result;
        }

        private static string GetOption(Dictionary<string, string> options, string name, string fallback)
        {
            string value;
            return options.TryGetValue(name, out value) && !string.IsNullOrWhiteSpace(value) ? value : fallback;
        }

        private static int GetIntOption(Dictionary<string, string> options, string name, int fallback)
        {
            string value;
            int parsed;
            return options.TryGetValue(name, out value) && int.TryParse(value, out parsed) ? parsed : fallback;
        }

        private static string Quote(string value)
        {
            if (value == null) return "\"\"";
            return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        private static bool IsMode(string value)
        {
            return string.Equals(value, "Preflight", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "Install", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "Repair", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "Troubleshoot", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "Backup", StringComparison.OrdinalIgnoreCase);
        }
    }

    internal sealed class PreflightForm : Form
    {
        private readonly TextBox portBox = new TextBox();
        private readonly TextBox sqlPortBox = new TextBox();
        private readonly ComboBox instanceBox = new ComboBox();
        private readonly TextBox passwordBox = new TextBox();
        private readonly Label statusLabel = new Label();
        private readonly string dataRoot;
        private readonly List<string> instances;

        public PreflightForm(int defaultPort, string dataRoot)
        {
            this.dataRoot = dataRoot;
            instances = GetInstalledSqlInstances();
            Text = "ATLAS setup configuration";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(520, 340);
            Font = new Font("Segoe UI", 9F);
            TopMost = true;

            var title = new Label { Text = "ATLAS Airfare Allowance", Font = new Font(Font.FontFamily, 16F, FontStyle.Bold), Left = 18, Top = 14, Width = 470, Height = 35 };
            var intro = new Label { Text = "Confirm the application port and MSSQL sa login before installation continues.", Left = 20, Top = 56, Width = 470, Height = 22 };

            AddLabel("ATLAS application port", 20, 92);
            portBox.Left = 190;
            portBox.Top = 88;
            portBox.Width = 280;
            portBox.Text = defaultPort.ToString();

            AddLabel("MSSQL TCP port", 20, 126);
            sqlPortBox.Left = 190;
            sqlPortBox.Top = 122;
            sqlPortBox.Width = 280;
            sqlPortBox.Text = "1433";

            AddLabel("MSSQL instance", 20, 160);
            instanceBox.Left = 190;
            instanceBox.Top = 156;
            instanceBox.Width = 280;
            instanceBox.DropDownStyle = ComboBoxStyle.DropDown;
            foreach (var instance in instances) instanceBox.Items.Add(instance);
            instanceBox.Text = instances.Count > 0 ? PreferInstance(instances) : "ATLAS";

            AddLabel("MSSQL sa password", 20, 194);
            passwordBox.Left = 190;
            passwordBox.Top = 190;
            passwordBox.Width = 280;
            passwordBox.PasswordChar = '*';

            var sqlInfo = instances.Count > 0
                ? "Existing SQL Server detected. SQL Express will be skipped."
                : "No local SQL Server detected. Bundled SQL Express will be installed.";
            var infoLabel = new Label { Text = sqlInfo, Left = 20, Top = 228, Width = 470, Height = 22 };

            statusLabel.Left = 20;
            statusLabel.Top = 254;
            statusLabel.Width = 470;
            statusLabel.Height = 35;
            statusLabel.ForeColor = Color.DimGray;
            statusLabel.Text = "Waiting for confirmation.";

            var ok = new Button { Text = "Verify and Continue", Left = 302, Top = 300, Width = 130, Height = 28 };
            ok.Click += VerifyAndContinue;
            var cancel = new Button { Text = "Cancel", Left = 440, Top = 300, Width = 70, Height = 28 };
            cancel.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };

            Controls.Add(title);
            Controls.Add(intro);
            Controls.Add(portBox);
            Controls.Add(sqlPortBox);
            Controls.Add(instanceBox);
            Controls.Add(passwordBox);
            Controls.Add(infoLabel);
            Controls.Add(statusLabel);
            Controls.Add(ok);
            Controls.Add(cancel);
            AcceptButton = ok;
            CancelButton = cancel;
        }

        private void AddLabel(string text, int left, int top)
        {
            Controls.Add(new Label { Text = text, Left = left, Top = top, Width = 160, Height = 22 });
        }

        private void VerifyAndContinue(object sender, EventArgs e)
        {
            int port;
            if (!int.TryParse(portBox.Text.Trim(), out port) || port < 1 || port > 65535)
            {
                Fail("Enter a valid TCP port number from 1 to 65535.");
                return;
            }
            if (IsPortInUse(port))
            {
                Fail("Port " + port + " is already in use. Enter a different port.");
                return;
            }

            int sqlPort;
            if (!int.TryParse(sqlPortBox.Text.Trim(), out sqlPort) || sqlPort < 1 || sqlPort > 65535)
            {
                Fail("Enter a valid MSSQL TCP port number from 1 to 65535.");
                return;
            }
            if (sqlPort == port)
            {
                Fail("MSSQL TCP port must be different from the ATLAS application port.");
                return;
            }

            var instance = (instanceBox.Text ?? "").Trim();
            if (string.IsNullOrWhiteSpace(instance)) instance = "ATLAS";
            var password = passwordBox.Text ?? "";
            if (string.IsNullOrEmpty(password))
            {
                Fail("Enter the MSSQL sa password.");
                return;
            }

            if (instances.Count > 0)
            {
                string error;
                if (!TestSqlLogin(instance, password, out error))
                {
                    Fail("MSSQL sa login failed: " + error);
                    return;
                }
                statusLabel.ForeColor = Color.Green;
                statusLabel.Text = "ATLAS port and MSSQL sa login confirmed. SQL TCP port will be enforced.";
            }
            else
            {
                if (!IsStrongPassword(password))
                {
                    Fail("For new SQL Express, password must be at least 8 chars with upper, lower, number, and symbol.");
                    return;
                }
                statusLabel.ForeColor = Color.Green;
                statusLabel.Text = "Port confirmed. SQL Express will be installed with this sa password.";
            }

            WriteConfig(port, sqlPort, instance, password);
            DialogResult = DialogResult.OK;
            Close();
        }

        private void Fail(string message)
        {
            statusLabel.ForeColor = Color.DarkRed;
            statusLabel.Text = message;
            MessageBox.Show(this, message, "ATLAS setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        private void WriteConfig(int port, int sqlPort, string instance, string password)
        {
            Directory.CreateDirectory(dataRoot);
            var path = Path.Combine(dataRoot, "bootstrapper-config.json");
            var json = "{\r\n" +
                "  \"Port\": " + port + ",\r\n" +
                "  \"SqlPort\": " + sqlPort + ",\r\n" +
                "  \"SqlInstance\": \"" + EscapeJson(instance) + "\",\r\n" +
                "  \"SqlSaPassword\": \"" + EscapeJson(password) + "\",\r\n" +
                "  \"CreatedAt\": \"" + DateTime.UtcNow.ToString("o") + "\"\r\n" +
                "}\r\n";
            File.WriteAllText(path, json, Encoding.UTF8);
            try
            {
                var security = new FileSecurity();
                security.AddAccessRule(new FileSystemAccessRule("BUILTIN\\Administrators", FileSystemRights.FullControl, AccessControlType.Allow));
                security.AddAccessRule(new FileSystemAccessRule("NT AUTHORITY\\SYSTEM", FileSystemRights.FullControl, AccessControlType.Allow));
                security.SetAccessRuleProtection(true, false);
                File.SetAccessControl(path, security);
            }
            catch
            {
            }
        }

        private static string EscapeJson(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static string PreferInstance(List<string> items)
        {
            if (items.Any(x => x.Equals("MSSQLSERVER", StringComparison.OrdinalIgnoreCase))) return "MSSQLSERVER";
            if (items.Any(x => x.Equals("SQLEXPRESS", StringComparison.OrdinalIgnoreCase))) return "SQLEXPRESS";
            return items[0];
        }

        private static bool IsStrongPassword(string value)
        {
            return value.Length >= 8 &&
                value.Any(char.IsUpper) &&
                value.Any(char.IsLower) &&
                value.Any(char.IsDigit) &&
                value.Any(ch => !char.IsLetterOrDigit(ch));
        }

        private static bool IsPortInUse(int port)
        {
            var ip = IPGlobalProperties.GetIPGlobalProperties();
            return ip.GetActiveTcpListeners().Any(x => x.Port == port);
        }

        private static List<string> GetInstalledSqlInstances()
        {
            var set = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using (var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
                    using (var key = root.OpenSubKey(@"SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"))
                    {
                        if (key == null) continue;
                        foreach (var name in key.GetValueNames()) set.Add(name);
                    }
                }
                catch
                {
                }
            }

            try
            {
                foreach (var service in ServiceController.GetServices().Where(s => s.ServiceName == "MSSQLSERVER" || s.ServiceName.StartsWith("MSSQL$", StringComparison.OrdinalIgnoreCase)))
                {
                    set.Add(service.ServiceName == "MSSQLSERVER" ? "MSSQLSERVER" : service.ServiceName.Substring(6));
                }
            }
            catch
            {
            }
            return set.ToList();
        }

        private static string ServerName(string instance)
        {
            return instance.Equals("MSSQLSERVER", StringComparison.OrdinalIgnoreCase) ? "localhost" : "localhost\\" + instance;
        }

        private static bool TestSqlLogin(string instance, string password, out string error)
        {
            error = "";
            try
            {
                var cs = "Server=" + ServerName(instance) + ";Database=master;User ID=sa;Password=" + password + ";Encrypt=False;TrustServerCertificate=True;Connection Timeout=10;";
                using (var connection = new SqlConnection(cs))
                {
                    connection.Open();
                    using (var command = connection.CreateCommand())
                    {
                        command.CommandText = "SELECT 1";
                        command.ExecuteScalar();
                    }
                }
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }
    }
}
