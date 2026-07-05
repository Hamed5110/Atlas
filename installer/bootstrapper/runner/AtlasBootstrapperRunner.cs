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
                args = NormalizeBurnArgs(args);
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

                return RunPowerShell(mode, args, options);
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
            var dataRoot = GetPathOption(options, "DataRoot", @"C:\ProgramData\ATLAS Airfare Allowance");
            Directory.CreateDirectory(dataRoot);

            using (var form = new PreflightForm(defaultPort, dataRoot))
            {
                return form.ShowDialog() == DialogResult.OK ? 0 : 1602;
            }
        }

        private static int RunPowerShell(string mode, string[] args, Dictionary<string, string> options)
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
                try
                {
                    ShowCompletionMessage(mode, process.ExitCode, options);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("ATLAS completion message failed: " + ex.Message);
                }
                return process.ExitCode;
            }
        }

        private static void ShowCompletionMessage(string mode, int exitCode, Dictionary<string, string> options)
        {
            if (!ShouldShowCompletionMessage(mode)) return;

            var dataRoot = GetPathOption(options, "DataRoot", @"C:\ProgramData\ATLAS Airfare Allowance");
            var logFolder = Path.Combine(dataRoot, "logs");
            var latestLog = FindLatestLog(logFolder);
            var title = exitCode == 0 ? "ATLAS patch completed" : "ATLAS patch failed";
            var icon = exitCode == 0 ? MessageBoxIcon.Information : MessageBoxIcon.Error;
            var message = exitCode == 0
                ? "ATLAS Airfare Allowance update patch completed successfully.\r\n\r\nFiles were updated, the service was restarted, and health checks passed."
                : "ATLAS Airfare Allowance update patch failed.\r\n\r\nReview the error details and send the log file for support.";
            if (!string.IsNullOrWhiteSpace(latestLog))
            {
                message += "\r\n\r\nLatest log:\r\n" + latestLog;
            }
            else
            {
                message += "\r\n\r\nLog folder:\r\n" + logFolder;
            }
            MessageBox.Show(message, title, MessageBoxButtons.OK, icon);
        }

        private static bool ShouldShowCompletionMessage(string mode)
        {
            return string.Equals(mode, "UpdateOnlyFinalize", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(mode, "Install", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(mode, "Repair", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(mode, "Troubleshoot", StringComparison.OrdinalIgnoreCase);
        }

        private static string FindLatestLog(string logFolder)
        {
            try
            {
                if (!Directory.Exists(logFolder)) return null;
                return Directory.GetFiles(logFolder, "*.*", SearchOption.TopDirectoryOnly)
                    .Where(path => path.EndsWith(".log", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".txt", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(File.GetLastWriteTimeUtc)
                    .FirstOrDefault();
            }
            catch
            {
                return null;
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

        private static string GetPathOption(Dictionary<string, string> options, string name, string fallback)
        {
            return CleanPathValue(GetOption(options, name, fallback), fallback);
        }

        private static string CleanPathValue(string value, string fallback)
        {
            var cleaned = NormalizeBurnArg(value ?? string.Empty)
                .Replace("&amp;quot;", string.Empty)
                .Replace("&quot;", string.Empty)
                .Replace("\"", string.Empty)
                .Trim();
            if (string.IsNullOrWhiteSpace(cleaned)) cleaned = fallback;

            foreach (var invalid in Path.GetInvalidPathChars())
            {
                cleaned = cleaned.Replace(invalid.ToString(), string.Empty);
            }
            return cleaned.TrimEnd('\\', '/');
        }

        private static int GetIntOption(Dictionary<string, string> options, string name, int fallback)
        {
            string value;
            int parsed;
            return options.TryGetValue(name, out value) && int.TryParse(value, out parsed) ? parsed : fallback;
        }

        private static string[] NormalizeBurnArgs(string[] args)
        {
            return args.Select(NormalizeBurnArg).ToArray();
        }

        private static string NormalizeBurnArg(string value)
        {
            if (value == null) return string.Empty;
            var normalized = value
                .Replace("&amp;quot;", "\"")
                .Replace("&quot;", "\"")
                .Replace("&#34;", "\"")
                .Trim();
            if (normalized.Length >= 2 && normalized[0] == '"' && normalized[normalized.Length - 1] == '"')
            {
                normalized = normalized.Substring(1, normalized.Length - 2);
            }
            return normalized;
        }

        private static string Quote(string value)
        {
            if (value == null) return "\"\"";
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private static bool IsMode(string value)
        {
            return string.Equals(value, "Preflight", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "Install", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "Repair", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "Troubleshoot", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "UpdateOnlyPrepare", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "UpdateOnlyFinalize", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(value, "Backup", StringComparison.OrdinalIgnoreCase);
        }
    }

    internal sealed class PreflightForm : Form
    {
        private readonly TextBox portBox = new TextBox();
        private readonly TextBox sqlPortBox = new TextBox();
        private readonly ComboBox instanceBox = new ComboBox();
        private readonly TextBox passwordBox = new TextBox();
        private readonly TextBox companyCodeBox = new TextBox();
        private readonly TextBox companyNameBox = new TextBox();
        private readonly TextBox adminUserBox = new TextBox();
        private readonly TextBox adminPasswordBox = new TextBox();
        private readonly RadioButton installRadio = new RadioButton();
        private readonly RadioButton updateRadio = new RadioButton();
        private readonly RadioButton repairRadio = new RadioButton();
        private readonly RadioButton troubleshootRadio = new RadioButton();
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
            ClientSize = new Size(600, 585);
            Font = new Font("Segoe UI", 9F);
            TopMost = true;

            var title = new Label { Text = "ATLAS Airfare Allowance", Font = new Font(Font.FontFamily, 16F, FontStyle.Bold), Left = 18, Top = 14, Width = 550, Height = 35 };
            var intro = new Label { Text = "Choose an action, then confirm ATLAS, MSSQL, company, and app admin settings.", Left = 20, Top = 56, Width = 560, Height = 22 };

            AddLabel("Setup action", 20, 92);
            installRadio.Text = "Install / New";
            installRadio.Left = 190;
            installRadio.Top = 88;
            installRadio.Width = 110;
            installRadio.Checked = true;
            updateRadio.Text = "Update";
            updateRadio.Left = 305;
            updateRadio.Top = 88;
            updateRadio.Width = 75;
            repairRadio.Text = "Repair";
            repairRadio.Left = 385;
            repairRadio.Top = 88;
            repairRadio.Width = 75;
            troubleshootRadio.Text = "Troubleshoot";
            troubleshootRadio.Left = 465;
            troubleshootRadio.Top = 88;
            troubleshootRadio.Width = 105;

            AddLabel("ATLAS application port", 20, 126);
            portBox.Left = 190;
            portBox.Top = 122;
            portBox.Width = 360;
            portBox.Text = defaultPort.ToString();

            AddLabel("MSSQL TCP port", 20, 160);
            sqlPortBox.Left = 190;
            sqlPortBox.Top = 156;
            sqlPortBox.Width = 360;
            sqlPortBox.Text = "1433";

            AddLabel("MSSQL instance", 20, 194);
            instanceBox.Left = 190;
            instanceBox.Top = 190;
            instanceBox.Width = 360;
            instanceBox.DropDownStyle = ComboBoxStyle.DropDown;
            foreach (var instance in instances) instanceBox.Items.Add(instance);
            instanceBox.Text = instances.Count > 0 ? PreferInstance(instances) : "ATLAS";

            AddLabel("MSSQL sa password", 20, 228);
            passwordBox.Left = 190;
            passwordBox.Top = 224;
            passwordBox.Width = 360;
            passwordBox.PasswordChar = '*';

            AddLabel("Company code", 20, 262);
            companyCodeBox.Left = 190;
            companyCodeBox.Top = 258;
            companyCodeBox.Width = 360;
            companyCodeBox.Text = "ATLAS";

            AddLabel("Company name", 20, 296);
            companyNameBox.Left = 190;
            companyNameBox.Top = 292;
            companyNameBox.Width = 360;
            companyNameBox.Text = "ATLAS Airfare HCM";

            AddLabel("App admin login", 20, 330);
            adminUserBox.Left = 190;
            adminUserBox.Top = 326;
            adminUserBox.Width = 360;
            adminUserBox.Text = "admin";

            AddLabel("App admin password", 20, 364);
            adminPasswordBox.Left = 190;
            adminPasswordBox.Top = 360;
            adminPasswordBox.Width = 360;
            adminPasswordBox.PasswordChar = '*';

            var sqlInfo = instances.Count > 0
                ? "Existing SQL Server detected. SQL Express will be skipped."
                : "No local SQL Server detected. Bundled SQL Express will be installed.";
            var infoLabel = new Label { Text = sqlInfo, Left = 20, Top = 400, Width = 560, Height = 22 };

            statusLabel.Left = 20;
            statusLabel.Top = 430;
            statusLabel.Width = 560;
            statusLabel.Height = 55;
            statusLabel.ForeColor = Color.DimGray;
            statusLabel.Text = "Install/New creates a fresh setup. Update keeps data and refreshes files. Repair fixes services, database configuration, and app admin lockout. Troubleshoot writes a diagnostic report.";

            var ok = new Button { Text = "Verify and Continue", Left = 362, Top = 540, Width = 140, Height = 28 };
            ok.Click += VerifyAndContinue;
            var cancel = new Button { Text = "Cancel", Left = 510, Top = 540, Width = 70, Height = 28 };
            cancel.Click += delegate { DialogResult = DialogResult.Cancel; Close(); };

            Controls.Add(title);
            Controls.Add(intro);
            Controls.Add(installRadio);
            Controls.Add(updateRadio);
            Controls.Add(repairRadio);
            Controls.Add(troubleshootRadio);
            Controls.Add(portBox);
            Controls.Add(sqlPortBox);
            Controls.Add(instanceBox);
            Controls.Add(passwordBox);
            Controls.Add(companyCodeBox);
            Controls.Add(companyNameBox);
            Controls.Add(adminUserBox);
            Controls.Add(adminPasswordBox);
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
            var setupAction = SelectedSetupAction();
            if (setupAction.Equals("Install", StringComparison.OrdinalIgnoreCase) && IsPortInUse(port))
            {
                Fail("Port " + port + " is already in use. For a new install, enter a different port. For an existing ATLAS installation, choose Update or Repair.");
                return;
            }

            int sqlPort;
            if (!int.TryParse(sqlPortBox.Text.Trim(), out sqlPort) || sqlPort < 0 || sqlPort > 65535)
            {
                Fail("Enter 1433, another TCP port from 1 to 65535, or 0 to use SQL Server's default/current port.");
                return;
            }
            if (sqlPort != 0 && sqlPort == port)
            {
                Fail("MSSQL TCP port must be different from the ATLAS application port.");
                return;
            }

            var instance = (instanceBox.Text ?? "").Trim();
            if (string.IsNullOrWhiteSpace(instance)) instance = "ATLAS";
            var password = passwordBox.Text ?? "";
            if (!setupAction.Equals("Troubleshoot", StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(password))
            {
                Fail("Enter the MSSQL sa password.");
                return;
            }
            var companyCode = (companyCodeBox.Text ?? "").Trim();
            if (string.IsNullOrWhiteSpace(companyCode))
            {
                Fail("Enter the company code.");
                return;
            }
            var companyName = (companyNameBox.Text ?? "").Trim();
            if (string.IsNullOrWhiteSpace(companyName))
            {
                Fail("Enter the company name.");
                return;
            }
            var adminUser = (adminUserBox.Text ?? "").Trim();
            if (string.IsNullOrWhiteSpace(adminUser))
            {
                Fail("Enter the application admin login.");
                return;
            }
            var adminPassword = adminPasswordBox.Text ?? "";
            if (!setupAction.Equals("Troubleshoot", StringComparison.OrdinalIgnoreCase) && adminPassword.Length < 8)
            {
                Fail("Enter an application admin password with at least 8 characters.");
                return;
            }

            if (!setupAction.Equals("Troubleshoot", StringComparison.OrdinalIgnoreCase) && instances.Count > 0)
            {
                string error;
                if (!TestSqlLogin(instance, password, out error))
                {
                    Fail("MSSQL sa login failed: " + error);
                    return;
                }
                statusLabel.ForeColor = Color.Green;
                statusLabel.Text = setupAction + " confirmed. MSSQL sa login is valid. The app admin will be created or unlocked.";
            }
            else if (!setupAction.Equals("Troubleshoot", StringComparison.OrdinalIgnoreCase))
            {
                if (!IsStrongPassword(password))
                {
                    Fail("For new SQL Express, password must be at least 8 chars with upper, lower, number, and symbol.");
                    return;
                }
                statusLabel.ForeColor = Color.Green;
                statusLabel.Text = setupAction + " confirmed. SQL Express will be installed and the app admin will be created.";
            }
            else
            {
                statusLabel.ForeColor = Color.Green;
                statusLabel.Text = "Troubleshooter confirmed. A diagnostic report will be generated.";
            }

            WriteConfig(port, sqlPort, instance, password, companyCode, companyName, adminUser, adminPassword, setupAction);
            DialogResult = DialogResult.OK;
            Close();
        }

        private void Fail(string message)
        {
            statusLabel.ForeColor = Color.DarkRed;
            statusLabel.Text = message;
            MessageBox.Show(this, message, "ATLAS setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        private string SelectedSetupAction()
        {
            if (updateRadio.Checked) return "Update";
            if (repairRadio.Checked) return "Repair";
            if (troubleshootRadio.Checked) return "Troubleshoot";
            return "Install";
        }

        private void WriteConfig(int port, int sqlPort, string instance, string password, string companyCode, string companyName, string adminUser, string adminPassword, string setupAction)
        {
            Directory.CreateDirectory(dataRoot);
            var path = Path.Combine(dataRoot, "bootstrapper-config.json");
            var json = "{\r\n" +
                "  \"Port\": " + port + ",\r\n" +
                "  \"SqlPort\": " + sqlPort + ",\r\n" +
                "  \"SqlInstance\": \"" + EscapeJson(instance) + "\",\r\n" +
                "  \"SqlSaPassword\": \"" + EscapeJson(password) + "\",\r\n" +
                "  \"CompanyCode\": \"" + EscapeJson(companyCode) + "\",\r\n" +
                "  \"CompanyName\": \"" + EscapeJson(companyName) + "\",\r\n" +
                "  \"AdminUsername\": \"" + EscapeJson(adminUser) + "\",\r\n" +
                "  \"AdminPassword\": \"" + EscapeJson(adminPassword) + "\",\r\n" +
                "  \"SetupAction\": \"" + EscapeJson(setupAction) + "\",\r\n" +
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
