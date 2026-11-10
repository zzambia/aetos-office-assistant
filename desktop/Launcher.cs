using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyVersion("0.2.8.0")]
[assembly: AssemblyFileVersion("0.2.8.0")]
[assembly: AssemblyProduct("AETOS Office Assistant")]

namespace Aetos {
  static class Program {
    public const string Title = "AETOS Office Assistant";
    public const string Id = "25c14ce2-eefd-49e1-b038-30215c41d834";
    public const int Port = 38473;
    public const string DeveloperKey = @"Software\Microsoft\Office\16.0\WEF\Developer";
    public static readonly string Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AETOS Office Assistant", "OfficeAssistant");
    public static readonly string InstalledExe = Path.Combine(Home, "AETOS-Office-Assistant.exe");
    public static readonly string Manifest = Path.Combine(Home, "manifest.xml");
    public static readonly string Shortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "AETOS Office Assistant.lnk");
    static Mutex mutex;

    [STAThread] static int Main(string[] args) {
      if (args.Length == 2 && args[0] == "--self-test") return SelfTest(args[1]);
      if (args.Length == 2 && args[0] == "--self-test-routes") return SelfTest(args[1], true);
      Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
      bool acquired; mutex = new Mutex(true, @"Local\AETOSOfficeAssistant-" + Environment.UserName, out acquired);
      if (!acquired) { if (Array.IndexOf(args, "--background") < 0) MessageBox.Show("AETOS Office Assistant is already running. Use its tray icon beside the clock, or open Word.", Title); mutex.Dispose(); return 0; }
      try {
        Dictionary<string, byte[]> assets = LoadAssets();
        bool background = Array.IndexOf(args, "--background") >= 0;
        if (!File.Exists(Path.Combine(Home, "installed.txt"))) {
          if (background) return 1;
          using (Setup form = new Setup()) {
            if (form.ShowDialog() != DialogResult.OK) return 0;
            Install(assets, form.AutoStart);
          }
        }
        X509Certificate2 certificate = LoadCertificate();
        if (certificate.NotAfter < DateTime.Now.AddDays(7) || !IsTrusted(certificate)) {
          certificate.Dispose();
          if (MessageBox.Show("The AETOS Office Assistant localhost certificate needs renewal or trust repair. Create and trust a new certificate for this Windows account?", Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 1;
          certificate = SaveNewCertificate();
        }
        // Update our own manifest/assets on a newer launch without changing other add-ins.
        File.WriteAllBytes(Manifest, assets["/manifest.xml"]);
        if (!String.Equals(Application.ExecutablePath, InstalledExe, StringComparison.OrdinalIgnoreCase)) File.Copy(Application.ExecutablePath, InstalledExe, true);
        using (certificate)
        using (LocalServer server = new LocalServer(certificate, assets, Port)) {
          server.Start();
          Application.Run(new Tray(server, !background));
        }
        return 0;
      } catch (Exception error) {
        string message = error is SocketException ? "The AETOS Office Assistant local port is already in use. Close the other AETOS Office Assistant instance or restart Windows." : "AETOS Office Assistant could not finish setup or start. Your Windows or Office policy may block certificate trust or add-in registration. Check file access and contact your administrator if needed.";
        MessageBox.Show(message + "\n\nError category: " + error.GetType().Name, Title, MessageBoxButtons.OK, MessageBoxIcon.Error); return 1;
      } finally { mutex.ReleaseMutex(); mutex.Dispose(); }
    }

    public static Dictionary<string, byte[]> LoadAssets() {
      Dictionary<string, byte[]> assets = new Dictionary<string, byte[]>(StringComparer.Ordinal);
      using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("aetos-web.zip"))
      using (ZipArchive zip = new ZipArchive(input, ZipArchiveMode.Read)) {
        foreach (ZipArchiveEntry entry in zip.Entries) {
          string name = "/" + entry.FullName.Replace('\\', '/'); if (name.EndsWith("/")) continue;
          using (Stream stream = entry.Open()) using (MemoryStream bytes = new MemoryStream()) { stream.CopyTo(bytes); assets.Add(name, bytes.ToArray()); }
        }
      }
      assets["/manifest.xml"] = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(assets["/manifest.xml"]).Replace("https://localhost:3000", "https://localhost:" + Port));
      assets["/health"] = Encoding.UTF8.GetBytes("AETOS Office Assistant ready");
      return assets;
    }

    static X509Certificate2 CreateCertificate() {
      using (RSA rsa = RSA.Create(2048)) {
        CertificateRequest request = new CertificateRequest("CN=AETOS Office Assistant localhost", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        SubjectAlternativeNameBuilder names = new SubjectAlternativeNameBuilder(); names.AddDnsName("localhost"); names.AddIpAddress(IPAddress.Loopback); names.AddIpAddress(IPAddress.IPv6Loopback);
        request.CertificateExtensions.Add(names.Build());
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        OidCollection usages = new OidCollection(); usages.Add(new Oid("1.3.6.1.5.5.7.3.1")); request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(usages, true));
        using (X509Certificate2 made = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1))) {
          return new X509Certificate2(made.Export(X509ContentType.Pfx, ""), "", X509KeyStorageFlags.Exportable | X509KeyStorageFlags.UserKeySet);
        }
      }
    }
    static X509Certificate2 SaveNewCertificate() {
      X509Certificate2 cert = CreateCertificate();
      byte[] pfx = cert.Export(X509ContentType.Pfx, "");
      byte[] secured = ProtectedData.Protect(pfx, null, DataProtectionScope.CurrentUser); Array.Clear(pfx, 0, pfx.Length);
      // Stage the private material before committing trust so a failed write cannot orphan trust.
      string staged = Path.Combine(Home, "localhost.pending"); File.WriteAllBytes(staged, secured);
      try {
        using (X509Store store = new X509Store(StoreName.Root, StoreLocation.CurrentUser)) { store.Open(OpenFlags.ReadWrite); store.Add(new X509Certificate2(cert.Export(X509ContentType.Cert))); }
        File.Copy(staged, Path.Combine(Home, "localhost.dpapi"), true);
        string old = File.Exists(Path.Combine(Home, "certificate-thumbprint.txt")) ? File.ReadAllText(Path.Combine(Home, "certificate-thumbprint.txt")) : "";
        File.WriteAllText(Path.Combine(Home, "certificate-thumbprint.txt"), cert.Thumbprint);
        if (old.Length > 0 && old != cert.Thumbprint) RemoveTrust(old);
        return cert;
      } catch { RemoveTrust(cert.Thumbprint); cert.Dispose(); throw; }
      finally { if (File.Exists(staged)) File.Delete(staged); }
    }
    static X509Certificate2 LoadCertificate() {
      byte[] plain = ProtectedData.Unprotect(File.ReadAllBytes(Path.Combine(Home, "localhost.dpapi")), null, DataProtectionScope.CurrentUser);
      try { return new X509Certificate2(plain, "", X509KeyStorageFlags.UserKeySet); } finally { Array.Clear(plain, 0, plain.Length); }
    }
    static bool IsTrusted(X509Certificate2 certificate) {
      using (X509Store store = new X509Store(StoreName.Root, StoreLocation.CurrentUser)) { store.Open(OpenFlags.ReadOnly); return store.Certificates.Find(X509FindType.FindByThumbprint, certificate.Thumbprint, false).Count > 0; }
    }
    static void RemoveTrust(string thumbprint) {
      using (X509Store store = new X509Store(StoreName.Root, StoreLocation.CurrentUser)) {
        store.Open(OpenFlags.ReadWrite);
        foreach (X509Certificate2 cert in store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint.Trim(), false)) if (cert.Subject == "CN=AETOS Office Assistant localhost") store.Remove(cert);
      }
    }
    static void Install(Dictionary<string, byte[]> assets, bool autoStart) {
      Directory.CreateDirectory(Home);
      if (!String.Equals(Application.ExecutablePath, InstalledExe, StringComparison.OrdinalIgnoreCase)) File.Copy(Application.ExecutablePath, InstalledExe, true);
      File.WriteAllBytes(Manifest, assets["/manifest.xml"]);
      using (X509Certificate2 certificate = SaveNewCertificate()) { }
      // Same per-user XML sideload registration mechanism as Office development tooling.
      using (RegistryKey key = Registry.CurrentUser.CreateSubKey(DeveloperKey)) { key.SetValue(Id, Manifest, RegistryValueKind.String); }
      SetAutoStart(autoStart);
      dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
      dynamic shortcut = shell.CreateShortcut(Shortcut);
      shortcut.TargetPath = InstalledExe; shortcut.WorkingDirectory = Home; shortcut.Description = Title; shortcut.Save();
      System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut); System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
      File.WriteAllText(Path.Combine(Home, "installed.txt"), "AETOS Office Assistant desktop 0.2.0");
    }
    public static void SetAutoStart(bool enabled) {
      using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) {
        if (enabled) key.SetValue("AETOS Office Assistant", "\"" + InstalledExe + "\" --background"); else key.DeleteValue("AETOS Office Assistant", false);
      }
    }
    public static bool AutoStartEnabled() {
      using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run")) { return key != null && key.GetValue("AETOS Office Assistant") != null; }
    }
    public static void RemoveSetup() {
      SetAutoStart(false);
      using (RegistryKey key = Registry.CurrentUser.OpenSubKey(DeveloperKey, true)) {
        if (key != null && String.Equals(key.GetValue(Id) as string, Manifest, StringComparison.OrdinalIgnoreCase)) key.DeleteValue(Id, false);
      }
      string thumb = Path.Combine(Home, "certificate-thumbprint.txt"); if (File.Exists(thumb)) RemoveTrust(File.ReadAllText(thumb));
      foreach (string name in new[] { "localhost.dpapi", "certificate-thumbprint.txt", "installed.txt", "manifest.xml" }) { string path = Path.Combine(Home, name); if (File.Exists(path)) File.Delete(path); }
      if (File.Exists(Shortcut)) File.Delete(Shortcut);
      // Keep the running executable and user browser settings; no delayed scripts or recursive deletes.
    }
    public static void OpenWord() { try { Process.Start(new ProcessStartInfo("winword.exe") { UseShellExecute = true }); } catch { MessageBox.Show("Open Microsoft Word from the Start menu, then choose AETOS Office Assistant from My Add-ins / Developer Add-ins.", Title); } }
    static int SelfTest(string report, bool routesOnly = false) {
      List<string> lines = new List<string>();
      try {
        Dictionary<string, byte[]> assets = LoadAssets();
        if (!Encoding.UTF8.GetString(assets["/manifest.xml"]).Contains("https://localhost:" + Port)) throw new Exception("manifest"); lines.Add("PASS embedded web files and rewritten manifest");
        using (X509Certificate2 certificate = CreateCertificate())
        using (LocalServer server = new LocalServer(certificate, assets, 0)) {
          if (!certificate.HasPrivateKey || certificate.Subject != "CN=AETOS Office Assistant localhost") throw new Exception("certificate"); lines.Add("PASS ephemeral localhost certificate generation (NOT trusted/installed)");
          if (!routesOnly) server.Start();
          foreach (string path in new[] { "/health", "/index.html", "/src/app.js", "/assets/icon-32.png", "/manifest.xml" }) {
            using (MemoryStream response = new MemoryStream()) {
              server.Respond("GET " + path + " HTTP/1.1\r\nHost: localhost:" + server.BoundPort + "\r\n\r\n", response);
              string output = Encoding.UTF8.GetString(response.ToArray());
              if (!output.StartsWith("HTTP/1.1 200") || !output.Contains("Content-Security-Policy:")) throw new Exception("route");
            }
          }
          foreach (string[] scenario in new[] { new[] { "GET /../localhost.dpapi", "localhost:" + server.BoundPort, "404" }, new[] { "POST /index.html", "localhost:" + server.BoundPort, "405" }, new[] { "GET /index.html", "elsewhere.example", "400" } }) {
            using (MemoryStream response = new MemoryStream()) { server.Respond(scenario[0] + " HTTP/1.1\r\nHost: " + scenario[1] + "\r\n\r\n", response); if (!Encoding.UTF8.GetString(response.ToArray()).StartsWith("HTTP/1.1 " + scenario[2])) throw new Exception("route guard"); }
          }
          lines.Add("PASS in-memory HTTP routes, security headers, traversal, write-method and foreign-host refusal");
          foreach (string[] scenario in new[] {
            new[] { "/index.html?_host_Info=Word$Win32$16.01$en-US$$$$0", "/index.html" },
            new[] { "/?_host_Info=Word$Win32$16.01$en-US$$$$0", "/index.html" },
            new[] { "/index.html?_host_Info=Word%24Win32&other=1", "/index.html" },
            new[] { "/src/app.js?v=123", "/src/app.js" },
            new[] { "/assets/icon-32.png?cache=1", "/assets/icon-32.png" },
            new[] { "/index.html?next=/../localhost.dpapi", "/index.html" }
          }) {
            foreach (string method in new[] { "GET", "HEAD" }) {
              byte[] baseline, queried;
              using (MemoryStream response = new MemoryStream()) { server.Respond(method + " " + scenario[1] + " HTTP/1.1\r\nHost: localhost:" + server.BoundPort + "\r\n\r\n", response); baseline = response.ToArray(); }
              using (MemoryStream response = new MemoryStream()) { server.Respond(method + " " + scenario[0] + " HTTP/1.1\r\nHost: localhost:" + server.BoundPort + "\r\n\r\n", response); queried = response.ToArray(); }
              if (Convert.ToBase64String(baseline) != Convert.ToBase64String(queried)) throw new Exception("query-string routing regression: " + method + " " + scenario[0]);
            }
          }
          using (MemoryStream response = new MemoryStream()) { server.Respond("GET /missing.html?_host_Info=Word HTTP/1.1\r\nHost: localhost:" + server.BoundPort + "\r\n\r\n", response); if (!Encoding.UTF8.GetString(response.ToArray()).StartsWith("HTTP/1.1 404")) throw new Exception("missing asset query guard"); }
          lines.Add("PASS 12 GET/HEAD query-string equivalence checks, including the exact Word host-info URL; missing assets still return 404");
          if (routesOnly) { lines.Add("Route-only run: no certificate trust, registry changes, network connection or Word installation performed."); File.WriteAllLines(report, lines); return 0; }
          foreach (string path in new[] { "/health", "/index.html", "/src/app.js", "/assets/icon-32.png", "/manifest.xml" }) {
            string response = Probe(server.BoundPort, certificate, "GET " + path + " HTTP/1.1\r\nHost: localhost:" + server.BoundPort + "\r\n\r\n");
            if (!response.StartsWith("HTTP/1.1 200") || !response.Contains("Content-Security-Policy:")) throw new Exception("TLS route");
          }
          lines.Add("PASS TLS static routes, headers and manifest");
          if (!Probe(server.BoundPort, certificate, "GET /../localhost.dpapi HTTP/1.1\r\nHost: localhost:" + server.BoundPort + "\r\n\r\n").StartsWith("HTTP/1.1 404")) throw new Exception("path traversal");
          if (!Probe(server.BoundPort, certificate, "POST /index.html HTTP/1.1\r\nHost: localhost:" + server.BoundPort + "\r\n\r\n").StartsWith("HTTP/1.1 405")) throw new Exception("method");
          if (!Probe(server.BoundPort, certificate, "GET /index.html HTTP/1.1\r\nHost: elsewhere.example\r\n\r\n").StartsWith("HTTP/1.1 400")) throw new Exception("host");
          lines.Add("PASS traversal, write-method and foreign-host refusal");
        }
        lines.Add("NOT RUN: real Word sideload UI, certificate trust, sign-in startup, Undo/protection/Track Changes");
        File.WriteAllLines(report, lines); return 0;
      } catch (SocketException e) { lines.Add("BLOCKED: live loopback TLS test; operating system socket policy: " + e.SocketErrorCode); lines.Add("NOT RUN: real Word sideload UI, certificate trust, sign-in startup, Undo/protection/Track Changes"); File.WriteAllLines(report, lines); return 2; }
      catch (Exception e) { lines.Add("FAIL " + e.ToString()); File.WriteAllLines(report, lines); return 1; }
    }
    static string Probe(int port, X509Certificate2 cert, string request) {
      using (TcpClient client = new TcpClient("127.0.0.1", port))
      using (SslStream tls = new SslStream(client.GetStream(), false, (s,c,ch,err) => c != null && c.GetCertHashString() == cert.Thumbprint)) {
        tls.AuthenticateAsClient("localhost", null, SslProtocols.Tls12, false); byte[] data = Encoding.ASCII.GetBytes(request); tls.Write(data); tls.Flush(); using (StreamReader reader = new StreamReader(tls)) return reader.ReadToEnd();
      }
    }
  }

  class Setup : Form {
    CheckBox start;
    public bool AutoStart { get { return start.Checked; } }
    public Setup() {
      Text = Program.Title; ClientSize = new Size(490, 310); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterScreen;
      Font = new Font("Segoe UI", 10); BackColor = Color.White;
      Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
      using (MemoryStream logo = new MemoryStream(Program.LoadAssets()["/assets/icon-80.png"]))
      using (Bitmap decoded = new Bitmap(logo)) {
        Controls.Add(new PictureBox { Image = new Bitmap(decoded), SizeMode = PictureBoxSizeMode.Zoom, Location = new Point(24, 18), Size = new Size(48, 48) });
      }
      Label title = new Label { Text = "AETOS Office Assistant", Font = new Font("Segoe UI", 17, FontStyle.Bold), Location = new Point(82, 24), Size = new Size(390, 40) }; Controls.Add(title);
      Controls.Add(new Label { Text = "One setup. No terminal windows.\n\nThis installs AETOS Office Assistant for your Windows account, registers its Word add-in, and trusts a certificate used only by its local HTTPS server. Windows may ask you to approve that certificate.", Location = new Point(26, 76), Size = new Size(435, 116) });
      start = new CheckBox { Text = "Start automatically when I sign in to Windows", Checked = true, Location = new Point(26, 203), Size = new Size(440, 30) }; Controls.Add(start);
      Button install = new Button { Text = "Set up AETOS Office Assistant", DialogResult = DialogResult.OK, Location = new Point(200, 256), Size = new Size(260, 36) }; Controls.Add(install); AcceptButton = install;
      Button cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Location = new Point(90, 256), Size = new Size(100, 36) }; Controls.Add(cancel); CancelButton = cancel;
    }
  }
  class Tray : ApplicationContext {
    NotifyIcon icon;
    public Tray(LocalServer server, bool showWelcome) {
      ContextMenuStrip menu = new ContextMenuStrip();
      menu.Items.Add("Open Microsoft Word", null, (s,e) => Program.OpenWord());
      menu.Items.Add("How to open AETOS Office Assistant in Word", null, (s,e) => Instructions());
      ToolStripMenuItem startup = new ToolStripMenuItem("Start with Windows") { Checked = Program.AutoStartEnabled(), CheckOnClick = true };
      startup.Click += (s,e) => { try { Program.SetAutoStart(startup.Checked); } catch { startup.Checked = !startup.Checked; MessageBox.Show("Windows did not allow this startup setting.", Program.Title); } }; menu.Items.Add(startup);
      menu.Items.Add(new ToolStripSeparator());
      menu.Items.Add("Remove AETOS Office Assistant setup", null, (s,e) => {
        if (MessageBox.Show("Remove AETOS Office Assistant startup, its Word registration and its local certificate? Saved model connections stay in Word's browser storage. The executable remains so you can delete or reinstall it.", Program.Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        try { Program.RemoveSetup(); ExitThread(); } catch { MessageBox.Show("Some setup entries could not be removed. Contact your administrator.", Program.Title); }
      });
      menu.Items.Add("Quit AETOS Office Assistant", null, (s,e) => ExitThread());
      icon = new NotifyIcon { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath), Text = Program.Title, Visible = true, ContextMenuStrip = menu };
      icon.DoubleClick += (s,e) => Program.OpenWord();
      if (showWelcome) { Instructions(); Program.OpenWord(); }
    }
    static void Instructions() { MessageBox.Show("AETOS Office Assistant is running in the tray beside your clock.\n\nRestart Word if it was open during setup. In Word, open Add-ins / My Add-ins and select AETOS Office Assistant under Developer Add-ins (sometimes shown in My Add-ins).\n\nThen choose Model connection and save your endpoint, model and optional key. No server terminal or npm command is needed.\n\nIf your organization blocks developer add-ins, ask its administrator to deploy the included manifest. This is still a preview release.", Program.Title); }
    protected override void ExitThreadCore() { icon.Visible = false; icon.Dispose(); base.ExitThreadCore(); }
  }
  class LocalServer : IDisposable {
    readonly X509Certificate2 certificate; readonly Dictionary<string, byte[]> assets; readonly TcpListener listener; readonly SemaphoreSlim slots = new SemaphoreSlim(24); volatile bool stopped;
    public int BoundPort { get { return listener.Server.IsBound ? ((IPEndPoint)listener.LocalEndpoint).Port : Program.Port; } }
    public LocalServer(X509Certificate2 cert, Dictionary<string, byte[]> files, int port) { certificate = cert; assets = files; listener = new TcpListener(IPAddress.Loopback, port); }
    public void Start() { listener.Start(); Task.Run((Func<Task>)Accept); }
    async Task Accept() {
      while (!stopped) {
        TcpClient client; try { client = await listener.AcceptTcpClientAsync(); } catch { if (stopped) return; continue; }
        if (!slots.Wait(0)) { client.Close(); continue; }
        ThreadPool.QueueUserWorkItem(o => { try { Serve(client); } finally { slots.Release(); } });
      }
    }
    void Serve(TcpClient client) {
      using (client) {
        client.ReceiveTimeout = 10000; client.SendTimeout = 10000;
        try {
          using (SslStream tls = new SslStream(client.GetStream(), false)) {
            tls.ReadTimeout = 10000; tls.WriteTimeout = 10000; tls.AuthenticateAsServer(certificate, false, SslProtocols.Tls12, false);
            StringBuilder raw = new StringBuilder(); int b;
            while (raw.Length < 16384 && (b = tls.ReadByte()) >= 0) { raw.Append((char)b); int n = raw.Length; if (n >= 4 && raw[n-4] == '\r' && raw[n-3] == '\n' && raw[n-2] == '\r' && raw[n-1] == '\n') break; }
            Respond(raw.ToString(), tls);
          }
        } catch { /* Do not record document content, request headers or credentials. */ }
      }
    }
    public void Respond(string raw, Stream tls) {
            string[] lines = raw.Split(new[] { "\r\n" }, StringSplitOptions.None); string[] first = lines[0].Split(' '); string host = "";
            foreach (string line in lines) if (line.StartsWith("Host:", StringComparison.OrdinalIgnoreCase)) host = line.Substring(5).Trim();
            if (first.Length != 3 || raw.Length >= 16384 || !raw.EndsWith("\r\n\r\n") || !(host == "localhost:" + BoundPort || host == "127.0.0.1:" + BoundPort)) { Reply(tls, 400, "text/plain", Encoding.UTF8.GetBytes("Bad request"), false); return; }
            if (first[0] != "GET" && first[0] != "HEAD") { Reply(tls, 405, "text/plain", new byte[0], false); return; }
            // Word appends _host_Info and other bootstrap parameters. Route by the
            // pathname only; do not redirect or change the URL that Office.js reads.
            string target = first[1]; int query = target.IndexOf('?');
            string path = query >= 0 ? target.Substring(0, query) : target;
            if (path == "/") path = "/index.html"; byte[] data;
            if (!assets.TryGetValue(path, out data)) { Reply(tls, 404, "text/plain", new byte[0], false); return; }
            string ext = Path.GetExtension(path); string type = ext == ".html" ? "text/html; charset=utf-8" : ext == ".js" ? "text/javascript; charset=utf-8" : ext == ".css" ? "text/css; charset=utf-8" : ext == ".png" ? "image/png" : ext == ".xml" ? "application/xml" : "text/plain";
            Reply(tls, 200, type, data, first[0] == "HEAD");
    }
    static void Reply(Stream stream, int status, string type, byte[] data, bool head) {
      string headers = "HTTP/1.1 " + status + (status == 200 ? " OK" : " Error") + "\r\nContent-Type: " + type + "\r\nContent-Length: " + data.Length + "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; script-src 'self' https://appsforoffice.microsoft.com; style-src 'self'; img-src 'self'; connect-src https: http://localhost:* http://127.0.0.1:* http://[::1]:*; object-src 'none'; base-uri 'none'\r\n\r\n";
      byte[] encoded = Encoding.ASCII.GetBytes(headers); stream.Write(encoded, 0, encoded.Length); if (!head) stream.Write(data, 0, data.Length); stream.Flush();
    }
    public void Dispose() { stopped = true; listener.Stop(); }
  }
}
