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
using System.Text.RegularExpressions;
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
            var defaultPort = GetIntOption(options, "Port", 3356);
            var dataRoot = GetPathOption(options, "DataRoot", @"C:\ProgramData\ATLAS Airfare Allowance");
            var installRoot = GetPathOption(options, "InstallRoot", @"C:\Program Files\ATLAS Airfare Allowance");
            Directory.CreateDirectory(dataRoot);
            var logFolder = Path.Combine(dataRoot, "logs");
            Directory.CreateDirectory(logFolder);
            var preflightLog = Path.Combine(logFolder, "bootstrapper-preflight-" + DateTime.Now.ToString("yyyyMMddHHmmss") + ".log");
            File.AppendAllText(preflightLog,
                "ATLAS setup preflight\r\n" +
                "Started: " + DateTime.Now.ToString("o") + "\r\n" +
                "Mode: Preflight\r\n" +
                "InstallRoot: " + installRoot + "\r\n" +
                "DataRoot: " + dataRoot + "\r\n" +
                "DefaultPort: " + defaultPort + "\r\n\r\n",
                Encoding.UTF8);

            using (var form = new PreflightForm(defaultPort, dataRoot, installRoot, preflightLog))
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

            var canonicalArgs = BuildPowerShellArgs(mode, args, options);
            var arguments = "-NoProfile -ExecutionPolicy Bypass -File " + Quote(script) + " -Mode " + Quote(mode);
            if (canonicalArgs.Count > 0)
            {
                arguments += " " + string.Join(" ", canonicalArgs.Select(Quote));
            }

            var dataRoot = GetPathOption(options, "DataRoot", @"C:\ProgramData\ATLAS Airfare Allowance");
            var logFolder = Path.Combine(dataRoot, "logs");
            Directory.CreateDirectory(logFolder);
            var runnerLog = Path.Combine(logFolder, "bootstrapper-runner-" + mode + "-" + DateTime.Now.ToString("yyyyMMddHHmmss") + ".log");
            File.AppendAllText(runnerLog,
                "ATLAS bootstrapper runner\r\n" +
                "Started: " + DateTime.Now.ToString("o") + "\r\n" +
                "Mode: " + mode + "\r\n" +
                "Script: " + script + "\r\n" +
                "WorkingDirectory: " + baseDir + "\r\n" +
                "Arguments: " + Redact(arguments) + "\r\n\r\n",
                Encoding.UTF8);

            var startInfo = new ProcessStartInfo
            {
                FileName = ps,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = baseDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(startInfo))
            {
                var output = process.StandardOutput.ReadToEnd();
                var error = process.StandardError.ReadToEnd();
                process.WaitForExit();
                File.AppendAllText(runnerLog,
                    output +
                    (string.IsNullOrWhiteSpace(error) ? "" : "\r\n--- STDERR ---\r\n" + error) +
                    "\r\nExitCode: " + process.ExitCode + "\r\nFinished: " + DateTime.Now.ToString("o") + "\r\n",
                    Encoding.UTF8);
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

        private static string Redact(string value)
        {
            if (string.IsNullOrEmpty(value)) return value;
            return Regex.Replace(value, @"(?i)(-SqlSaPassword\s+)(?:""[^""]*""|\S+)", "$1\"*****\"");
        }

        private static List<string> BuildPowerShellArgs(string mode, string[] originalArgs, Dictionary<string, string> options)
        {
            var result = new List<string>();
            AddOption(result, options, "Port", false);
            AddOption(result, options, "DbServer", false);
            AddOption(result, options, "SqlPort", false);
            AddOption(result, options, "SqlInstance", false);
            AddOption(result, options, "SqlSaPassword", false);
            AddOption(result, options, "CompanyCode", false);
            AddOption(result, options, "CompanyName", false);
            AddOption(result, options, "AdminUsername", false);
            AddOption(result, options, "AdminPassword", false);
            AddOption(result, options, "SetupAction", false);
            AddOption(result, options, "InstallRoot", true);
            AddOption(result, options, "DataRoot", true);
            AddOption(result, options, "UpdateManifest", true);
            AddOption(result, options, "ConfigPath", true);

            if (result.Count == 0 && originalArgs != null)
            {
                result.AddRange(originalArgs.Select(NormalizeBurnArg));
            }
            return result;
        }

        private static void AddOption(List<string> args, Dictionary<string, string> options, string name, bool isPath)
        {
            string value;
            if (!options.TryGetValue(name, out value)) return;
            args.Add("-" + name);
            args.Add(isPath ? CleanPathValue(value, value) : NormalizeBurnArg(value));
        }

        private static void ShowCompletionMessage(string mode, int exitCode, Dictionary<string, string> options)
        {
            if (!ShouldShowCompletionMessage(mode)) return;

            var dataRoot = GetPathOption(options, "DataRoot", @"C:\ProgramData\ATLAS Airfare Allowance");
            var logFolder = Path.Combine(dataRoot, "logs");
            var latestLog = FindLatestLog(logFolder);
            var latestStatus = ReadPatchStatus(latestLog);
            var warningStatus = exitCode == 0 && string.Equals(latestStatus, "WARNING", StringComparison.OrdinalIgnoreCase);
            var title = exitCode == 0 ? (warningStatus ? "ATLAS patch completed with warnings" : "ATLAS patch completed") : "ATLAS patch failed";
            var icon = exitCode == 0 ? (warningStatus ? MessageBoxIcon.Warning : MessageBoxIcon.Information) : MessageBoxIcon.Error;
            var message = exitCode == 0
                ? (warningStatus
                    ? "ATLAS Airfare Allowance files were updated, and existing configuration was preserved.\r\n\r\nSome verification checks need review. Open the latest log shown below."
                    : "ATLAS Airfare Allowance update patch completed successfully.\r\n\r\nFiles were updated, the service was restarted, and health checks passed.")
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

        private static string ReadPatchStatus(string logPath)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(logPath) || !File.Exists(logPath)) return "";
                var text = File.ReadAllText(logPath);
                if (text.IndexOf("PatchStatus=WARNING", StringComparison.OrdinalIgnoreCase) >= 0) return "WARNING";
                if (text.IndexOf("PatchStatus=FAILED", StringComparison.OrdinalIgnoreCase) >= 0) return "FAILED";
                if (text.IndexOf("PatchStatus=SUCCESS", StringComparison.OrdinalIgnoreCase) >= 0) return "SUCCESS";
            }
            catch
            {
            }
            return "";
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
            var decoded = args.Select(DecodeBurnArg).ToArray();
            var combined = new List<string>();
            var pending = new StringBuilder();
            var inQuotedValue = false;

            foreach (var arg in decoded)
            {
                if (!inQuotedValue)
                {
                    if (StartsOpenQuote(arg))
                    {
                        pending.Clear();
                        pending.Append(arg);
                        inQuotedValue = !EndsCloseQuote(arg);
                        if (!inQuotedValue)
                        {
                            combined.Add(StripOuterQuotes(pending.ToString()));
                        }
                    }
                    else
                    {
                        combined.Add(StripOuterQuotes(arg));
                    }
                    continue;
                }

                pending.Append(" ");
                pending.Append(arg);
                if (EndsCloseQuote(arg))
                {
                    combined.Add(StripOuterQuotes(pending.ToString()));
                    pending.Clear();
                    inQuotedValue = false;
                }
            }

            if (inQuotedValue)
            {
                combined.Add(StripOuterQuotes(pending.ToString()));
            }

            return combined.ToArray();
        }

        private static string NormalizeBurnArg(string value)
        {
            return StripOuterQuotes(DecodeBurnArg(value));
        }

        private static string DecodeBurnArg(string value)
        {
            if (value == null) return string.Empty;
            return value
                .Replace("&amp;quot;", "\"")
                .Replace("&quot;", "\"")
                .Replace("&#34;", "\"")
                .Trim();
        }

        private static string StripOuterQuotes(string value)
        {
            var normalized = value ?? string.Empty;
            if (normalized.Length >= 2 && normalized[0] == '"' && normalized[normalized.Length - 1] == '"')
            {
                normalized = normalized.Substring(1, normalized.Length - 2);
            }
            return normalized;
        }

        private static bool StartsOpenQuote(string value)
        {
            return !string.IsNullOrEmpty(value) && value[0] == '"' && !EndsCloseQuote(value);
        }

        private static bool EndsCloseQuote(string value)
        {
            return !string.IsNullOrEmpty(value) && value.Length > 1 && value[value.Length - 1] == '"';
        }

        private static string Quote(string value)
        {
            if (value == null) return "\"\"";
            var quoted = new StringBuilder();
            quoted.Append('"');
            var backslashes = 0;
            foreach (var ch in value)
            {
                if (ch == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (ch == '"')
                {
                    quoted.Append('\\', backslashes * 2 + 1);
                    quoted.Append('"');
                    backslashes = 0;
                    continue;
                }
                if (backslashes > 0)
                {
                    quoted.Append('\\', backslashes);
                    backslashes = 0;
                }
                quoted.Append(ch);
            }
            if (backslashes > 0)
            {
                quoted.Append('\\', backslashes * 2);
            }
            quoted.Append('"');
            return quoted.ToString();
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
        private readonly TextBox dbServerBox = new TextBox();
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
        private readonly string installRoot;
        private readonly string preflightLog;
        private readonly string existingDbServer;
        private readonly bool existingInstallFootprint;
        private readonly bool existingSqlPortWasConfigured;
        private readonly List<string> instances;

        public PreflightForm(int defaultPort, string dataRoot, string installRoot, string preflightLog)
        {
            this.dataRoot = dataRoot;
            this.installRoot = installRoot;
            this.preflightLog = preflightLog;
            instances = GetInstalledSqlInstances();
            var existing = ReadExistingConfig(installRoot);
            existingInstallFootprint = HasAtlasInstallFootprint(installRoot) || existing.ContainsKey("PORT") || existing.ContainsKey("DB_PORT");
            existingSqlPortWasConfigured = existing.ContainsKey("DB_PORT");
            existingDbServer = existing.ContainsKey("DB_SERVER") ? existing["DB_SERVER"] : "";
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
            installRadio.Checked = !existingInstallFootprint;
            updateRadio.Text = "Update";
            updateRadio.Left = 305;
            updateRadio.Top = 88;
            updateRadio.Width = 75;
            updateRadio.Checked = existingInstallFootprint;
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
            portBox.Text = existing.ContainsKey("PORT") ? existing["PORT"] : defaultPort.ToString();

            AddLabel("MSSQL server / host", 20, 160);
            dbServerBox.Left = 190;
            dbServerBox.Top = 156;
            dbServerBox.Width = 360;
            dbServerBox.Text = existing.ContainsKey("DB_SERVER") ? existing["DB_SERVER"] : (string.IsNullOrWhiteSpace(existingDbServer) ? "127.0.0.1" : existingDbServer);

            AddLabel("MSSQL TCP port", 20, 194);
            sqlPortBox.Left = 190;
            sqlPortBox.Top = 190;
            sqlPortBox.Width = 360;
            var preferredInstance = existing.ContainsKey("DB_INSTANCE") ? existing["DB_INSTANCE"] : (instances.Count > 0 ? PreferInstance(instances) : "ATLAS");
            sqlPortBox.Text = existing.ContainsKey("DB_PORT") ? existing["DB_PORT"] : DetectSqlTcpPort(preferredInstance).ToString();

            AddLabel("MSSQL instance", 20, 228);
            instanceBox.Left = 190;
            instanceBox.Top = 224;
            instanceBox.Width = 360;
            instanceBox.DropDownStyle = ComboBoxStyle.DropDown;
            foreach (var instance in instances) instanceBox.Items.Add(instance);
            instanceBox.Text = preferredInstance;
            instanceBox.TextChanged += delegate
            {
                if (!existingSqlPortWasConfigured)
                {
                    sqlPortBox.Text = DetectSqlTcpPort(instanceBox.Text).ToString();
                }
            };

            AddLabel("MSSQL sa password", 20, 262);
            passwordBox.Left = 190;
            passwordBox.Top = 258;
            passwordBox.Width = 360;
            passwordBox.PasswordChar = '*';
            if (existing.ContainsKey("DB_PASSWORD")) passwordBox.Text = existing["DB_PASSWORD"];

            AddLabel("Company code", 20, 296);
            companyCodeBox.Left = 190;
            companyCodeBox.Top = 292;
            companyCodeBox.Width = 360;
            companyCodeBox.Text = "ATLAS";

            AddLabel("Company name", 20, 330);
            companyNameBox.Left = 190;
            companyNameBox.Top = 326;
            companyNameBox.Width = 360;
            companyNameBox.Text = "ATLAS Airfare HCM";

            AddLabel("App admin login", 20, 364);
            adminUserBox.Left = 190;
            adminUserBox.Top = 360;
            adminUserBox.Width = 360;
            adminUserBox.Text = "admin";

            AddLabel("App admin password", 20, 398);
            adminPasswordBox.Left = 190;
            adminPasswordBox.Top = 394;
            adminPasswordBox.Width = 360;
            adminPasswordBox.PasswordChar = '*';

            var sqlInfo = instances.Count > 0
                ? "Existing SQL Server detected. SQL Express will be skipped."
                : "No local SQL Server detected. SQL Express will be downloaded from Microsoft if needed.";
            var infoLabel = new Label { Text = sqlInfo, Left = 20, Top = 434, Width = 560, Height = 22 };

            statusLabel.Left = 20;
            statusLabel.Top = 464;
            statusLabel.Width = 560;
            statusLabel.Height = 55;
            statusLabel.ForeColor = Color.DimGray;
            statusLabel.Text = existingInstallFootprint
                ? "Existing ATLAS installation detected. Update is selected automatically and will keep data while refreshing files, SQL objects, service, and runtime configuration."
                : "Install/New creates a fresh setup. Update keeps data and refreshes files. Repair fixes services, database configuration, and app admin lockout. Troubleshoot writes a diagnostic report.";
            AppendPreflightLog("Wizard opened. ExistingInstall=" + existingInstallFootprint + "; ExistingDbServer=" + existingDbServer + "; SqlInstances=" + string.Join(",", instances.ToArray()));

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
            Controls.Add(dbServerBox);
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
            AppendPreflightLog("Verify clicked.");
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
            var freshInstallReplace = false;
            var backupDatabaseBeforeFresh = false;
            if (setupAction.Equals("Install", StringComparison.OrdinalIgnoreCase) && HasAtlasInstallFootprint(installRoot))
            {
                var choice = MessageBox.Show(
                    this,
                    "Existing ATLAS application files were found in the install folder.\r\n\r\nChoose Yes to create a file backup, attempt a database backup after SQL validation, remove the old app files, and continue with a fresh install.\r\n\r\nChoose No to stop setup and select Update or Repair instead.",
                    "ATLAS fresh install confirmation",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (choice != DialogResult.Yes)
                {
                    Fail("Fresh install cancelled because an existing ATLAS installation footprint was found. Choose Update/Repair, or confirm backup and replacement.");
                    return;
                }
                freshInstallReplace = true;
                backupDatabaseBeforeFresh = true;
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
            var dbServer = (dbServerBox.Text ?? "").Trim();
            if (string.IsNullOrWhiteSpace(dbServer)) dbServer = "127.0.0.1";
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
            if ((setupAction.Equals("Install", StringComparison.OrdinalIgnoreCase) || setupAction.Equals("Repair", StringComparison.OrdinalIgnoreCase)) && adminPassword.Length < 8)
            {
                Fail("Enter an application admin password with at least 8 characters.");
                return;
            }

            if (!setupAction.Equals("Troubleshoot", StringComparison.OrdinalIgnoreCase) && instances.Count > 0)
            {
                string error;
                if (!TestSqlLogin(dbServer, instance, sqlPort, password, out error))
                {
                    AppendPreflightLog("SQL validation failed for " + dbServer + ":" + sqlPort + " instance=" + instance + ". Error=" + error);
                    Fail("MSSQL sa login failed: " + error);
                    return;
                }
                statusLabel.ForeColor = Color.Green;
                statusLabel.Text = setupAction + " confirmed. MSSQL sa login is valid on " + dbServer + ":" + sqlPort + ".";
            }
            else if (!setupAction.Equals("Troubleshoot", StringComparison.OrdinalIgnoreCase))
            {
                if (!IsStrongPassword(password))
                {
                    Fail("For new SQL Express, password must be at least 8 chars with upper, lower, number, and symbol.");
                    return;
                }
                statusLabel.ForeColor = Color.Green;
                statusLabel.Text = setupAction + " confirmed. SQL Express will be downloaded from Microsoft if needed and the app admin will be created.";
            }
            else
            {
                statusLabel.ForeColor = Color.Green;
                statusLabel.Text = "Troubleshooter confirmed. A diagnostic report will be generated.";
            }

            WriteConfig(port, sqlPort, dbServer, instance, password, companyCode, companyName, adminUser, adminPassword, setupAction, freshInstallReplace, backupDatabaseBeforeFresh);
            AppendPreflightLog("Preflight success. Action=" + setupAction + "; AppPort=" + port + "; DbServer=" + dbServer + "; SqlPort=" + sqlPort + "; Config=" + Path.Combine(dataRoot, "bootstrapper-config.json"));
            DialogResult = DialogResult.OK;
            Close();
        }

        private void Fail(string message)
        {
            statusLabel.ForeColor = Color.DarkRed;
            statusLabel.Text = message;
            AppendPreflightLog("Preflight warning/failure: " + message);
            MessageBox.Show(this, message, "ATLAS setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        private void AppendPreflightLog(string message)
        {
            try
            {
                File.AppendAllText(preflightLog, "[" + DateTime.Now.ToString("o") + "] " + message + "\r\n", Encoding.UTF8);
            }
            catch
            {
            }
        }

        private string SelectedSetupAction()
        {
            if (updateRadio.Checked) return "Update";
            if (repairRadio.Checked) return "Repair";
            if (troubleshootRadio.Checked) return "Troubleshoot";
            return "Install";
        }

        private void WriteConfig(int port, int sqlPort, string dbServer, string instance, string password, string companyCode, string companyName, string adminUser, string adminPassword, string setupAction, bool freshInstallReplace, bool backupDatabaseBeforeFresh)
        {
            Directory.CreateDirectory(dataRoot);
            var path = Path.Combine(dataRoot, "bootstrapper-config.json");
            var json = "{\r\n" +
                "  \"Port\": " + port + ",\r\n" +
                "  \"SqlPort\": " + sqlPort + ",\r\n" +
                "  \"DbServer\": \"" + EscapeJson(dbServer) + "\",\r\n" +
                "  \"DB_SERVER\": \"" + EscapeJson(dbServer) + "\",\r\n" +
                "  \"SqlInstance\": \"" + EscapeJson(instance) + "\",\r\n" +
                "  \"SqlSaPassword\": \"" + EscapeJson(password) + "\",\r\n" +
                "  \"CompanyCode\": \"" + EscapeJson(companyCode) + "\",\r\n" +
                "  \"CompanyName\": \"" + EscapeJson(companyName) + "\",\r\n" +
                "  \"AdminUsername\": \"" + EscapeJson(adminUser) + "\",\r\n" +
                "  \"AdminPassword\": \"" + EscapeJson(adminPassword) + "\",\r\n" +
                "  \"SetupAction\": \"" + EscapeJson(setupAction) + "\",\r\n" +
                "  \"FreshInstallReplaceConfirmed\": " + (freshInstallReplace ? "true" : "false") + ",\r\n" +
                "  \"BackupDatabaseBeforeFresh\": " + (backupDatabaseBeforeFresh ? "true" : "false") + ",\r\n" +
                "  \"CreatedAt\": \"" + DateTime.UtcNow.ToString("o") + "\"\r\n" +
                "}\r\n";
            File.WriteAllText(path, json, Encoding.UTF8);
            AppendPreflightLog("Wrote protected setup config: " + path);
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

        private static bool HasAtlasInstallFootprint(string installRoot)
        {
            try
            {
                foreach (var root in new[] { installRoot, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "ATLAS Airfare Allowance") }.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase))
                {
                    if (!Directory.Exists(root)) continue;
                    foreach (var file in new[] { ".env", "server.js", "package.json", "Start-ATLAS.bat", "Start-ATLAS-Bundled.ps1", "atlas-payload-manifest.json" })
                    {
                        if (File.Exists(Path.Combine(root, file))) return true;
                    }
                }
            }
            catch
            {
            }

            try
            {
                using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\ATLAS Airfare Allowance"))
                {
                    if (key != null) return true;
                }
            }
            catch
            {
            }
            return false;
        }

        private static int DetectSqlTcpPort(string instance)
        {
            var configured = GetSqlConfiguredTcpPort(instance);
            return configured > 0 ? configured : 1433;
        }

        private static string GetSqlInstanceRegistryId(string instance)
        {
            if (string.IsNullOrWhiteSpace(instance)) return "";
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using (var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
                    using (var key = root.OpenSubKey(@"SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"))
                    {
                        var value = key == null ? null : key.GetValue(instance) as string;
                        if (!string.IsNullOrWhiteSpace(value)) return value;
                    }
                }
                catch
                {
                }
            }
            return "";
        }

        private static int GetSqlConfiguredTcpPort(string instance)
        {
            var instanceId = GetSqlInstanceRegistryId(instance);
            if (string.IsNullOrWhiteSpace(instanceId)) return 0;

            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using (var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
                    using (var ipAll = root.OpenSubKey(@"SOFTWARE\Microsoft\Microsoft SQL Server\" + instanceId + @"\MSSQLServer\SuperSocketNetLib\Tcp\IPAll"))
                    {
                        if (ipAll == null) continue;
                        foreach (var name in new[] { "TcpPort", "TcpDynamicPorts" })
                        {
                            var raw = Convert.ToString(ipAll.GetValue(name) ?? "").Trim();
                            int port;
                            if (!string.IsNullOrWhiteSpace(raw) && int.TryParse(raw.Split(',')[0].Trim(), out port) && port > 0 && port <= 65535)
                            {
                                return port;
                            }
                        }
                    }
                }
                catch
                {
                }
            }
            return 0;
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

        private static string TcpServerName(string dbServer, string instance, int sqlPort)
        {
            if (sqlPort > 0)
            {
                var host = string.IsNullOrWhiteSpace(dbServer) ? "127.0.0.1" : dbServer.Trim();
                if (host.StartsWith("tcp:", StringComparison.OrdinalIgnoreCase)) host = host.Substring(4);
                if (host.Contains(",")) host = host.Split(',')[0].Trim();
                if (host.Contains("\\")) host = host.Split('\\')[0].Trim();
                if (string.IsNullOrWhiteSpace(host) || host == "." || host.Equals("(local)", StringComparison.OrdinalIgnoreCase) || host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) host = "127.0.0.1";
                return "tcp:" + host + "," + sqlPort;
            }
            return ServerName(instance);
        }

        private static Dictionary<string, string> ReadExistingConfig(string installRoot)
        {
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var envPath = Path.Combine(installRoot, ".env");
                if (File.Exists(envPath))
                {
                    foreach (var line in File.ReadAllLines(envPath))
                    {
                        var index = line.IndexOf('=');
                        if (index <= 0) continue;
                        var key = line.Substring(0, index).Trim();
                        var value = line.Substring(index + 1).Trim();
                        if (key.Length > 0 && value.Length > 0) values[key] = value;
                    }
                }
            }
            catch
            {
            }

            try
            {
                using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\ATLAS Airfare Allowance"))
                {
                    if (key != null)
                    {
                        foreach (var name in new[] { "ATLASPORT", "DB_SERVER", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD" })
                        {
                            var raw = key.GetValue(name) as string;
                            if (!string.IsNullOrWhiteSpace(raw) && !values.ContainsKey(name)) values[name] = raw;
                        }
                    }
                }
            }
            catch
            {
            }
            if (values.ContainsKey("ATLASPORT") && !values.ContainsKey("PORT")) values["PORT"] = values["ATLASPORT"];
            return values;
        }

        private static bool TestSqlLogin(string dbServer, string instance, int sqlPort, string password, out string error)
        {
            error = "";
            try
            {
                var cs = "Server=" + TcpServerName(dbServer, instance, sqlPort) + ";Database=master;User ID=sa;Password=" + password + ";Encrypt=False;TrustServerCertificate=True;Connection Timeout=10;";
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
