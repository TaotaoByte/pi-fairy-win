// Windows desktop Fairy for pi-fairy.
// Port of native/Fairy.swift (AppKit/AVFoundation) to .NET Framework 4.x + WPF.
// Compiled with the .NET Framework csc.exe (C# 5). No SDK or Visual Studio needed.
//
// Invoked by modules/animation/src/desktop/client.ts (Windows build path) with:
//   Fairy.exe <directory> <assets> [--headless] [--intro-saved] [--rest-reminder]
//        [--lifecycle-sounds <dir>] [--intro-sfx <path>] [--welcome-setting [full|simple]]
//
// Lease/lifecycle protocol is served over a named pipe. The pipe name is written
// to <directory>/pipe so the Node client can connect.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Media;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace PiFairy
{
    /// <summary>
    /// Physical screen cursor position. Used for dragging instead of
    /// MouseEventArgs.GetPosition, whose coordinates are relative to the
    /// captured element: moving the window while it captures the mouse feeds
    /// each move delta back into the next GetPosition call and makes the pet
    /// jitter. Screen coordinates do not depend on the window position.
    /// </summary>
    internal static class Cursor
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int X; public int Y; }

        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT point);

        public static Point Position()
        {
            POINT p;
            if (GetCursorPos(out p)) return new Point(p.X, p.Y);
            return new Point(0, 0);
        }
    }

    internal static class Program
    {
        internal static string Directory;
        internal static string Assets;
        internal static bool Headless;
        internal static bool SavedIntro;
        internal static bool RestReminder;
        internal static string LifecycleSounds;
        internal static string IntroSfx;
        internal static string[] WelcomeSetting; // null = none

        internal static DesktopHost Desktop;

        [STAThread]
        static int Main(string[] args)
        {
            List<string> list = new List<string>(args);
            Headless = list.Contains("--headless");
            SavedIntro = list.Contains("--intro-saved");
            RestReminder = list.Contains("--rest-reminder");

            LifecycleSounds = Option(list, "--lifecycle-sounds");
            IntroSfx = Option(list, "--intro-sfx");

            if (list.Contains("--self-test")) return RunSelfTest();

            int wc = list.IndexOf("--welcome-setting");
            if (wc >= 0)
            {
                if (wc + 1 < list.Count && !list[wc + 1].StartsWith("--"))
                    WelcomeSetting = new string[] { list[wc + 1] };
                else
                    WelcomeSetting = new string[] { "" };
            }

            // Positional args: <directory> <assets>. Skip values that follow options.
            List<string> positional = new List<string>();
            for (int i = 0; i < list.Count; i++)
            {
                string a = list[i];
                if (a.StartsWith("--"))
                {
                    if (a == "--lifecycle-sounds" || a == "--intro-sfx") i++; // skip value
                    if (a == "--welcome-setting" && i + 1 < list.Count && !list[i + 1].StartsWith("--")) i++;
                    continue;
                }
                positional.Add(a);
            }

            if (positional.Count < 2) Fail("usage: Fairy private-directory assets-directory [options]");
            Directory = positional[0];
            Assets = positional[1];

            if (WelcomeSetting != null) return RunWelcomeSetting();

            if (Headless)
            {
                RunHeadless();
                return 0;
            }

            Application app = new Application();
            app.DispatcherUnhandledException += delegate(object s, DispatcherUnhandledExceptionEventArgs e)
            {
                Log("unhandled: " + e.Exception.Message);
                e.Handled = true; // Keep the pet alive across transient UI faults.
            };
            Desktop = new DesktopHost(Directory, Assets, SavedIntro, RestReminder, LifecycleSounds, IntroSfx);
            try { Desktop.Start(); }
            catch (Exception e) { Fail("desktop start: " + e.Message); }
            app.Run();
            return 0;
        }

        /// <summary>
        /// Deterministic checks for the pointer-independent drag math and the
        /// ripple visibility window. Runs without creating any window, so it is
        /// safe in CI and does not need a desktop session.
        /// </summary>
        static int RunSelfTest()
        {
            int failures = 0;
            Action<bool, string> check = delegate(bool ok, string name)
            {
                Console.WriteLine((ok ? "PASS " : "FAIL ") + name);
                if (!ok) failures++;
            };

            // Drag from a fixed screen anchor must map 1:1 to window movement,
            // regardless of the window's current position (the old bug re-read
            // GetPosition against the moving window and oscillated).
            double startLeft = 500, startTop = 300;
            Point origin = new Point(1000, 800);
            bool exact = true, monotonic = true;
            double prevL = startLeft, prevT = startTop;
            for (int step = 1; step <= 40; step++)
            {
                Point now = new Point(1000 + step * 7, 800 + step * 3);
                double left = startLeft + (now.X - origin.X);
                double top = startTop + (now.Y - origin.Y);
                if (left != startLeft + step * 7 || top != startTop + step * 3) exact = false;
                if (left < prevL || top < prevT) monotonic = false;
                prevL = left; prevT = top;
            }
            check(exact, "drag tracks the screen cursor 1:1");
            check(monotonic, "drag is monotonic (no oscillation)");

            // Ripple visibility window must cover roughly the first third of the cycle.
            int visibleTicks = 0, total = 1280;
            for (int i = 0; i < total; i++)
            {
                double value = i * 0.05;
                double age = (value - 1) % 6.4;
                bool visible = false;
                for (int r = 0; r < 3; r++)
                {
                    double p = (age - r * 0.26) / 1.8;
                    if (p > 0 && p < 1) { visible = true; break; }
                }
                if (visible) visibleTicks++;
            }
            double ratio = (double)visibleTicks / total;
            check(ratio > 0.3 && ratio < 0.55, "ripple repaint window is bounded (ratio " + ratio.ToString("0.00") + ")");

            // Preferences round-trip and malformed input fall back to defaults.
            // Use the process temp dir; a restricted sandbox may deny writes
            // there, in which case the check is skipped rather than failed.
            string dir = Path.Combine(Path.GetTempPath(), "fairy-selftest-" + Guid.NewGuid().ToString("N"));
            try
            {
                System.IO.Directory.CreateDirectory(dir);
                Prefs prefs = new Prefs(dir);
                check(prefs.Size() == FairySize.standard && prefs.Welcome == "full", "settings default to standard/full");
                prefs.SaveSize(FairySize.xlarge);
                prefs.SaveWelcome("simple");
                prefs.SavePosition(new SavedPosition { Display = "primary", X = 0.25, Y = 0.75 });
                Prefs reread = new Prefs(dir);
                check(reread.Size() == FairySize.xlarge && reread.Welcome == "simple", "settings round-trip");
                SavedPosition p = reread.Read().Position;
                check(p != null && Math.Abs(p.X - 0.25) < 1e-9 && Math.Abs(p.Y - 0.75) < 1e-9, "position round-trip");
            }
            catch (UnauthorizedAccessException) { Console.WriteLine("SKIP preferences round-trip (temp dir not writable in this sandbox)"); }
            catch (IOException) { Console.WriteLine("SKIP preferences round-trip (temp dir not writable in this sandbox)"); }
            finally { try { System.IO.Directory.Delete(dir, true); } catch { } }

            Console.WriteLine(failures == 0 ? "SELFTEST PASS" : "SELFTEST FAIL " + failures);
            return failures == 0 ? 0 : 1;
        }

        static string Option(List<string> list, string name)
        {
            int i = list.IndexOf(name);
            if (i < 0) return null;
            if (i + 1 < list.Count) return list[i + 1];
            Fail(name + " requires an absolute path");
            return null;
        }

        internal static void Fail(string text)
        {
            Console.Error.WriteLine("Fairy: " + text);
            Environment.Exit(1);
        }

        internal static void Log(string text)
        {
            Console.Error.WriteLine("Fairy: " + text);
        }

        /// <summary>Best-effort diagnostic log next to the settings file.</summary>
        internal static void DebugFile(string text)
        {
            if (string.IsNullOrEmpty(Directory)) return;
            try
            {
                string path = Path.Combine(Directory, "debug.log");
                FileInfo info = new FileInfo(path);
                if (info.Exists && info.Length > 64 * 1024) File.Delete(path); // keep it bounded
                File.AppendAllText(path,
                    DateTime.Now.ToString("HH:mm:ss.fff") + " " + text + Environment.NewLine);
            }
            catch { }
        }

        static int RunWelcomeSetting()
        {
            Prefs prefs = new Prefs(Directory);
            try
            {
                if (WelcomeSetting.Length > 0 && WelcomeSetting[0].Length > 0)
                {
                    string mode = WelcomeSetting[0];
                    if (mode != "full" && mode != "simple") Fail("invalid welcome mode");
                    prefs.SaveWelcome(mode);
                }
                Console.WriteLine(prefs.Welcome);
                return 0;
            }
            catch (Exception e)
            {
                Fail("welcome NOT SAVED: " + e.Message);
                return 1;
            }
        }

        static void RunHeadless()
        {
            // Headless: serve the pipe protocol but show no windows. Kept alive by
            // the parent client; useful for diagnostics.
            LeaseServer server = new LeaseServer(Directory, null);
            server.Start();
            while (true) Thread.Sleep(1000);
        }
    }

    // ------------------------------------------------------------ preferences
    internal enum FairySize { xsmall, small, standard, large, xlarge }

    internal static class SizeExt
    {
        public static double Multiplier(this FairySize s)
        {
            switch (s)
            {
                case FairySize.xsmall: return 0.70;
                case FairySize.small: return 0.85;
                case FairySize.standard: return 1.0;
                case FairySize.large: return 1.20;
                case FairySize.xlarge: return 1.45;
            }
            return 1.0;
        }
        public static double Points(this FairySize s) { return 238 * Multiplier(s); }
    }

    internal class SavedPosition
    {
        public string Display;
        public double X;
        public double Y;
        public bool Valid
        {
            get
            {
                return !string.IsNullOrEmpty(Display) && IsFinite(X) && IsFinite(Y)
                    && X >= 0 && X <= 1 && Y >= 0 && Y <= 1;
            }
        }

        static bool IsFinite(double v) { return !double.IsNaN(v) && !double.IsInfinity(v); }
    }

    internal class SizeSettings
    {
        public int Version = 2;
        public string Size = "standard";
        public string Welcome = "full";
        public SavedPosition Position;
    }

    internal class Prefs
    {
        readonly string _dir;
        public Prefs(string dir) { _dir = dir; }
        string FilePath { get { return Path.Combine(_dir, "settings.json"); } }

        public SizeSettings Read()
        {
            SizeSettings s = new SizeSettings();
            try
            {
                if (!File.Exists(FilePath)) return s;
                string data = File.ReadAllText(FilePath);
                if (data.Length > 4096) return s;
                Dictionary<string, object> settings = Json.Parse(data) as Dictionary<string, object>;
                if (settings == null) return s;
                object v;
                if (settings.TryGetValue("version", out v))
                {
                    int ver = Convert.ToInt32(v);
                    if (ver != 1 && ver != 2) return s;
                }
                if (settings.TryGetValue("size", out v) && v is string) s.Size = (string)v;
                if (settings.TryGetValue("welcome", out v) && v is string) s.Welcome = (string)v;
                if (settings.TryGetValue("position", out v) && v is Dictionary<string, object>)
                {
                    Dictionary<string, object> p = (Dictionary<string, object>)v;
                    SavedPosition pos = new SavedPosition();
                    if (p.TryGetValue("display", out v)) pos.Display = v as string;
                    if (p.TryGetValue("x", out v)) pos.X = Convert.ToDouble(v);
                    if (p.TryGetValue("y", out v)) pos.Y = Convert.ToDouble(v);
                    if (pos.Valid) s.Position = pos;
                }
            }
            catch { return new SizeSettings(); }
            return s;
        }

        public FairySize Size()
        {
            string s = Read().Size;
            foreach (FairySize v in Enum.GetValues(typeof(FairySize)))
                if (v.ToString() == s) return v;
            return FairySize.standard;
        }

        public string Welcome { get { return Read().Welcome; } }

        void Write(SizeSettings s)
        {
            try
            {
                System.IO.Directory.CreateDirectory(_dir);
                StringBuilder sb = new StringBuilder();
                sb.Append("{");
                sb.Append("\"version\":" + s.Version + ",");
                sb.Append("\"size\":\"" + s.Size + "\",");
                sb.Append("\"welcome\":\"" + s.Welcome + "\"");
                if (s.Position != null)
                {
                    sb.Append(",\"position\":{\"display\":\"" + s.Position.Display + "\",");
                    sb.Append("\"x\":" + s.Position.X.ToString(System.Globalization.CultureInfo.InvariantCulture));
                    sb.Append(",\"y\":" + s.Position.Y.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}");
                }
                sb.Append("}");
                File.WriteAllText(FilePath, sb.ToString());
            }
            catch (Exception e)
            {
                // Preferences are best-effort; a read-only or locked file must not
                // take down the desktop. The next save retries.
                Program.Log("preferences not saved: " + e.Message);
            }
        }

        public void SaveSize(FairySize size) { SizeSettings s = Read(); s.Size = size.ToString(); Write(s); }
        public void SaveWelcome(string mode) { SizeSettings s = Read(); s.Welcome = (mode == "simple" ? "simple" : "full"); Write(s); }
        public void SavePosition(SavedPosition pos) { SizeSettings s = Read(); s.Position = pos; Write(s); }
    }

    // ------------------------------------------------------------ minimal JSON
    internal static class Json
    {
        public static object Parse(string text)
        {
            int i = 0;
            return ParseValue(text, ref i);
        }

        static object ParseValue(string t, ref int i)
        {
            SkipWs(t, ref i);
            if (i >= t.Length) return null;
            char c = t[i];
            if (c == '{') return ParseObject(t, ref i);
            if (c == '[') return ParseArray(t, ref i);
            if (c == '"') return ParseString(t, ref i);
            if (c == 't') { i += 4; return true; }
            if (c == 'f') { i += 5; return false; }
            if (c == 'n') { i += 4; return null; }
            return ParseNumber(t, ref i);
        }

        static Dictionary<string, object> ParseObject(string t, ref int i)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            i++; // {
            SkipWs(t, ref i);
            if (i < t.Length && t[i] == '}') { i++; return result; }
            while (true)
            {
                SkipWs(t, ref i);
                string key = ParseString(t, ref i);
                SkipWs(t, ref i);
                i++; // :
                object value = ParseValue(t, ref i);
                result[key] = value;
                SkipWs(t, ref i);
                if (i < t.Length && t[i] == ',') { i++; continue; }
                if (i < t.Length && t[i] == '}') { i++; break; }
                break;
            }
            return result;
        }

        static List<object> ParseArray(string t, ref int i)
        {
            List<object> result = new List<object>();
            i++; // [
            SkipWs(t, ref i);
            if (i < t.Length && t[i] == ']') { i++; return result; }
            while (true)
            {
                result.Add(ParseValue(t, ref i));
                SkipWs(t, ref i);
                if (i < t.Length && t[i] == ',') { i++; continue; }
                if (i < t.Length && t[i] == ']') { i++; break; }
                break;
            }
            return result;
        }

        static string ParseString(string t, ref int i)
        {
            i++; // "
            StringBuilder sb = new StringBuilder();
            while (i < t.Length)
            {
                char c = t[i];
                if (c == '"') { i++; return sb.ToString(); }
                if (c == '\\' && i + 1 < t.Length) { i++; sb.Append(t[i]); i++; continue; }
                sb.Append(c); i++;
            }
            return sb.ToString();
        }

        static object ParseNumber(string t, ref int i)
        {
            int start = i;
            while (i < t.Length && (char.IsDigit(t[i]) || t[i] == '-' || t[i] == '.' || t[i] == 'e' || t[i] == 'E' || t[i] == '+'))
                i++;
            string s = t.Substring(start, i - start);
            double d;
            if (double.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out d))
                return d;
            return 0.0;
        }

        static void SkipWs(string t, ref int i)
        {
            while (i < t.Length && char.IsWhiteSpace(t[i])) i++;
        }
    }

    // ------------------------------------------------------------ named-pipe lease server
    internal class LeaseServer
    {
        readonly string _directory;
        readonly DesktopHost _host;
        volatile bool _stopped;
        Mutex _instance;
        static Mutex _held;
        int _leases;
        readonly object _leaseLock = new object();

        /// <summary>Seconds with no lease before the shared owner retires.</summary>
        const int GraceSeconds = 3;

        public string PipeName { get; private set; }

        public LeaseServer(string directory, DesktopHost host)
        {
            _directory = directory;
            _host = host;
            string user = Environment.UserName;
            if (string.IsNullOrEmpty(user)) user = "pi";
            PipeName = "pi-fairy-" + user;
        }

        public void Start()
        {
            System.IO.Directory.CreateDirectory(_directory);
            // Single owner, the Windows equivalent of the macOS flock: a named
            // mutex is user-scoped and released by the OS if the process dies, so
            // a stale helper can never block a new one. A second live helper that
            // cannot own the mutex exits instead of showing a duplicate pet.
            bool createdNew;
            _instance = new Mutex(true, "Local\\" + PipeName, out createdNew);
            if (!createdNew)
            {
                // Another owner exists; let it serve and step aside.
                Program.Log("another Fairy owner is running; exiting");
                Environment.Exit(0);
            }
            _held = _instance;
            try { File.WriteAllText(Path.Combine(_directory, "pipe"), PipeName); }
            catch (Exception e) { Program.Log("pipe file FAILED: " + e.Message); }
            Thread thread = new Thread(AcceptLoop);
            thread.IsBackground = true;
            thread.Start();
        }

        void AcceptLoop()
        {
            while (!_stopped)
            {
                NamedPipeServerStream server = null;
                try
                {
                    server = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 64,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536);
                    server.WaitForConnection();
                    NamedPipeServerStream client = server;
                    server = null;
                    Thread t = new Thread(delegate() { Handle(client); });
                    t.IsBackground = true;
                    t.Start();
                }
                catch (Exception)
                {
                    if (server != null) { try { server.Close(); } catch { } }
                    if (!_stopped) Thread.Sleep(200);
                }
            }
        }

        bool SendLine(NamedPipeServerStream s, string line)
        {
            try
            {
                byte[] bytes = Encoding.UTF8.GetBytes(line + "\n");
                s.Write(bytes, 0, bytes.Length);
                s.Flush();
                return true;
            }
            catch { return false; }
        }

        void Handle(NamedPipeServerStream s)
        {
            StringBuilder input = new StringBuilder();
            byte[] buffer = new byte[256];
            bool leased = false;
            try
            {
                while (true)
                {
                    int n = s.Read(buffer, 0, buffer.Length);
                    if (n <= 0) break;
                    input.Append(Encoding.UTF8.GetString(buffer, 0, n));
                    if (input.Length > 256) break;
                    int nl;
                    while ((nl = input.ToString().IndexOf('\n')) >= 0)
                    {
                        string line = input.ToString(0, nl).TrimEnd('\r');
                        input.Remove(0, nl + 1);
                        if (line == "lease FAIRY2")
                        {
                            if (!SendLine(s, "FAIRY2 " + Process.GetCurrentProcess().Id))
                            { s.Close(); return; }
                            leased = true;
                            lock (_leaseLock) _leases++;
                            Program.DebugFile("lease acquired; active=" + LeaseCount);
                            if (_host != null) _host.OnLeaseAcquired();
                        }
                        else if (line == "welcome FAIRY2" || line == "welcome FAIRY2 full" || line == "welcome FAIRY2 simple")
                        {
                            Prefs prefs = new Prefs(_directory);
                            if (line.EndsWith(" full")) prefs.SaveWelcome("full");
                            else if (line.EndsWith(" simple")) prefs.SaveWelcome("simple");
                            SendLine(s, "FAIRY2 welcome " + prefs.Welcome);
                            s.Close(); return;
                        }
                        else if (line == "theme auto" || line == "theme light" || line == "theme dark")
                        {
                            if (_host != null) _host.SetTheme(line.Substring(6));
                        }
                        else if (line.StartsWith("prelude FAIRY2 ") || line.StartsWith("claim "))
                        {
                            // Startup prelude is a macOS/zsh-only feature; ignored on Windows.
                        }
                        else
                        {
                            s.Close(); return;
                        }
                    }
                }
            }
            catch (Exception) { }
            finally
            {
                try { s.Close(); } catch { }
                if (leased)
                {
                    lock (_leaseLock) _leases--;
                    Program.DebugFile("lease released; active=" + LeaseCount);
                    // The last lease closing starts the shared goodbye; the host
                    // clamps and then exits, so a stale pet never outlives Pi.
                    if (LeaseCount == 0 && _host != null) _host.OnAllLeasesClosed();
                }
            }
        }

        public int LeaseCount { get { lock (_leaseLock) return _leases; } }

        public void Stop()
        {
            _stopped = true;
            try
            {
                string pipeFile = Path.Combine(_directory, "pipe");
                if (File.Exists(pipeFile)) File.Delete(pipeFile);
            }
            catch { }
        }
    }

    // ------------------------------------------------------------ desktop host
    internal class DesktopHost
    {
        readonly Prefs _prefs;
        readonly string _assets;
        readonly string _lifecycleSounds;
        readonly bool _savedIntro;
        readonly bool _restReminder;

        Window _pet;
        Image _petImage;
        Window _effectPanel;
        RippleCanvas _ripple;
        Window _menu;
        Window _restPrompt;
        bool _dragging;
        Point _dragOrigin;   // screen cursor position at drag start
        double _dragLeft;    // window Left/Top at drag start
        double _dragTop;
        bool _leaseSeen;

        string _theme = "auto";
        Dictionary<string, BitmapImage[]> _frames = new Dictionary<string, BitmapImage[]>();
        FairySize _size;
        SoundPlayer _player;
        bool _restPending;
        DateTime _restDue = DateTime.MinValue;
        readonly DateTime _started = DateTime.Now;

        public DesktopHost(string directory, string assets, bool savedIntro, bool restReminder, string lifecycleSounds, string introSfx)
        {
            _prefs = new Prefs(directory);
            _assets = assets;
            _savedIntro = savedIntro;
            _restReminder = restReminder;
            _lifecycleSounds = lifecycleSounds;
            _size = _prefs.Size();
        }

        public void SetTheme(string t) { _theme = t; _themeResolved = null; }

        // Registry/DWM reads are not free; the 50ms animation timer must not poll
        // them. Cache the resolved appearance and refresh at most twice a second.
        bool? _themeResolved;
        int _themeTicks;

        bool Dark()
        {
            if (_theme == "dark") return true;
            if (_theme == "light") return false;
            if (_themeResolved.HasValue && _themeTicks < 10) { _themeTicks++; return _themeResolved.Value; }
            _themeTicks = 0;
            bool dark = false;
            try
            {
                Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
                if (key != null)
                {
                    using (key)
                    {
                        object v = key.GetValue("AppsUseLightTheme");
                        if (v != null && Convert.ToInt32(v) == 0) dark = true;
                    }
                }
            }
            catch { }
            _themeResolved = dark;
            return dark;
        }

        void LoadFrames()
        {
            foreach (string theme in new string[] { "dark", "light" })
            {
                BitmapImage[] frames = new BitmapImage[120];
                for (int i = 0; i < 120; i++)
                {
                    string p = Path.Combine(Path.Combine(Path.Combine(_assets, "frames"), theme), i.ToString("D3") + ".png");
                    if (!File.Exists(p)) throw new Exception("missing frame " + theme + "/" + i);
                    BitmapImage bmp = new BitmapImage();
                    bmp.BeginInit();
                    bmp.UriSource = new Uri(p);
                    bmp.CacheOption = BitmapCacheOption.OnLoad;
                    bmp.EndInit();
                    bmp.Freeze();
                    frames[i] = bmp;
                }
                _frames[theme] = frames;
            }
        }

        public void Start()
        {
            LoadFrames();

            double side = Math.Min(_size.Points(), Math.Min(
                SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight));

            double ix = SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth * 0.8 - side / 2;
            double iy = SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight / 3 - side / 2;

            SavedPosition sp = _prefs.Read().Position;
            if (sp != null && sp.Valid)
            {
                ix = SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth * sp.X - side / 2;
                iy = SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight * sp.Y - side / 2;
            }

            _pet = CreateWindow(side, side, ix, iy);
            _petImage = new Image();
            _petImage.Stretch = Stretch.Uniform;
            _petImage.Width = side;
            _petImage.Height = side;
            _pet.Content = _petImage;
            AttachDrag(_pet);
            _pet.Show();
            ClampPetToScreen();

            double es = side * 1.8;
            _effectPanel = CreateWindow(es, es, ix - side * 0.4, iy - side * 0.4);
            _ripple = new RippleCanvas();
            _ripple.Width = es;
            _ripple.Height = es;
            _effectPanel.Content = _ripple;
            _effectPanel.IsHitTestVisible = false;
            // Own the effect window so it always stays below the pet and never
            // becomes active. A sibling topmost window would sit above the pet
            // and swallow drag/right-click input meant for it.
            _effectPanel.Owner = _pet;
            _effectPanel.Show();
            ClickThrough(_effectPanel);
            _pet.Activate();
            _pet.Topmost = true;

            LeaseServer server = new LeaseServer(Program.Directory, this);
            server.Start();

            if (_restReminder) _restDue = _started + TimeSpan.FromHours(1);

            DispatcherTimer timer = new DispatcherTimer();
            timer.Interval = TimeSpan.FromMilliseconds(50);
            int frameIndex = 0;
            timer.Tick += delegate(object s, EventArgs e)
            {
                double elapsed = (DateTime.Now - _started).TotalSeconds;
                BitmapImage[] frames = _frames[Dark() ? "dark" : "light"];
                _petImage.Source = frames[frameIndex % 120];
                frameIndex++;
                _ripple.Time = elapsed;

                if (_restReminder && !_restPending && _restDue != DateTime.MinValue && DateTime.Now >= _restDue)
                {
                    _restPending = true;
                    ShowRestPrompt();
                }
            };
            timer.Start();
        }

        Window CreateWindow(double w, double h, double left, double top)
        {
            Window win = new Window();
            win.Width = w;
            win.Height = h;
            win.Left = left;
            win.Top = top;
            win.WindowStyle = WindowStyle.None;
            win.AllowsTransparency = true;
            win.Background = Brushes.Transparent;
            win.ShowInTaskbar = false;
            win.ShowActivated = false;
            win.ResizeMode = ResizeMode.NoResize;
            win.Topmost = true;
            win.Focusable = false;
            return win;
        }

        void AlignEffects()
        {
            if (_effectPanel == null || _pet == null) return;
            double w = _pet.Width * 1.8;
            double h = _pet.Height * 1.8;
            _effectPanel.Left = _pet.Left - _pet.Width * 0.4;
            _effectPanel.Top = _pet.Top - _pet.Height * 0.4;
            _effectPanel.Width = w;
            _effectPanel.Height = h;
            if (_ripple != null) { _ripple.Width = w; _ripple.Height = h; }
        }

        /// <summary>
        /// Make a window transparent to mouse input at the OS level with
        /// WS_EX_TRANSPARENT, so clicks pass through to the pet beneath it.
        /// WPF's IsHitTestVisible only affects WPF-internal hit testing.
        /// </summary>
        void ClickThrough(Window win)
        {
            try
            {
                IntPtr hwnd = new System.Windows.Interop.WindowInteropHelper(win).Handle;
                int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
                SetWindowLong(hwnd, GWL_EXSTYLE, ex | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE);
            }
            catch (Exception) { }
        }

        const int GWL_EXSTYLE = -20;
        const int WS_EX_TRANSPARENT = 0x20;
        const int WS_EX_NOACTIVATE = 0x08000000;
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        void AttachDrag(Window win)
        {
            win.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e)
            {
                if (e.ChangedButton != MouseButton.Left) return;
                _dragging = true;
                // Anchor on an absolute screen point + the window origin at drag
                // start. Every move re-derives the frame from those two fixed
                // values, so it can never feed back on itself (unlike GetPosition).
                _dragOrigin = Cursor.Position();
                _dragLeft = win.Left;
                _dragTop = win.Top;
                win.CaptureMouse();
                e.Handled = true;
            };
            win.MouseMove += delegate(object s, MouseEventArgs e)
            {
                if (!_dragging) return;
                Point now = Cursor.Position();
                double left = _dragLeft + (now.X - _dragOrigin.X);
                double top = _dragTop + (now.Y - _dragOrigin.Y);
                // Skip no-op frames so a stationary pointer does not repaint.
                if (left == win.Left && top == win.Top) return;
                win.Left = left;
                win.Top = top;
                AlignEffects();
                RepositionMenu();
                e.Handled = true;
            };
            win.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e)
            {
                if (!_dragging) return;
                _dragging = false;
                win.ReleaseMouseCapture();
                ClampPetToScreen();
                AlignEffects();
                RepositionMenu();
                SavePosition();
                e.Handled = true;
            };
            win.MouseRightButtonDown += delegate(object s, MouseButtonEventArgs e) { ToggleMenu(); };
        }

        /// <summary>Keep the size menu anchored above the pet while it moves.</summary>
        void RepositionMenu()
        {
            if (_menu == null) return;
            _menu.Left = Math.Max(0, _pet.Left);
            _menu.Top = Math.Max(0, _pet.Top - _menu.Height);
        }

        /// <summary>Keep the pet fully on the virtual desktop after a drag.</summary>
        void ClampPetToScreen()
        {
            double minLeft = SystemParameters.VirtualScreenLeft;
            double minTop = SystemParameters.VirtualScreenTop;
            double maxLeft = minLeft + SystemParameters.VirtualScreenWidth - _pet.Width;
            double maxTop = minTop + SystemParameters.VirtualScreenHeight - _pet.Height;
            _pet.Left = Math.Min(Math.Max(_pet.Left, minLeft), Math.Max(minLeft, maxLeft));
            _pet.Top = Math.Min(Math.Max(_pet.Top, minTop), Math.Max(minTop, maxTop));
        }

        void SavePosition()
        {
            // Use the virtual desktop so a pet parked on a secondary monitor keeps
            // a stable ratio; ClampPetToScreen keeps it inside the same bounds.
            double w = SystemParameters.VirtualScreenWidth;
            double h = SystemParameters.VirtualScreenHeight;
            if (w <= 0 || h <= 0) return;
            double x = (_pet.Left + _pet.Width / 2 - SystemParameters.VirtualScreenLeft) / w;
            double y = (_pet.Top + _pet.Height / 2 - SystemParameters.VirtualScreenTop) / h;
            x = Math.Min(Math.Max(x, 0), 1);
            y = Math.Min(Math.Max(y, 0), 1);
            _prefs.SavePosition(new SavedPosition { Display = "primary", X = x, Y = y });
        }

        void ToggleMenu()
        {
            if (_menu != null) { _menu.Close(); _menu = null; return; }
            double w = 274, h = 270;
            Window menu = CreateWindow(w, h, _pet.Left, Math.Max(0, _pet.Top - h));
            StackPanel panel = new StackPanel();
            panel.Background = new SolidColorBrush(Color.FromRgb(17, 22, 27));
            panel.Width = w;
            panel.Height = h;
            TextBlock label = new TextBlock();
            label.Text = "FAIRY / SIZE";
            label.Foreground = new SolidColorBrush(Color.FromRgb(168, 199, 217));
            label.FontSize = 13;
            label.Margin = new Thickness(18, 12, 0, 6);
            panel.Children.Add(label);
            foreach (FairySize size in Enum.GetValues(typeof(FairySize)))
            {
                FairySize captured = size;
                Button b = new Button();
                b.Content = captured.ToString().ToUpper() + "   " + SizeExt.Multiplier(captured).ToString("0.00") + "x";
                b.Height = 32;
                b.Margin = new Thickness(12, 2, 12, 2);
                b.Foreground = new SolidColorBrush(Color.FromRgb(222, 230, 237));
                b.Background = captured == _size
                    ? new SolidColorBrush(Color.FromRgb(59, 83, 99))
                    : new SolidColorBrush(Color.FromRgb(27, 34, 42));
                b.Click += delegate(object s, RoutedEventArgs e)
                {
                    _size = captured;
                    _prefs.SaveSize(_size);
                    ResizePet();
                    if (_menu != null) { _menu.Close(); _menu = null; }
                };
                panel.Children.Add(b);
            }
            TextBlock hint = new TextBlock();
            hint.Text = "GLOBAL / AUTO-SAVE";
            hint.Foreground = new SolidColorBrush(Color.FromRgb(158, 173, 186));
            hint.FontSize = 11;
            hint.Margin = new Thickness(18, 10, 0, 0);
            panel.Children.Add(hint);
            menu.Content = panel;
            _menu = menu;
            menu.Owner = _pet;
            menu.Show();
            menu.Activate();
        }

        void ResizePet()
        {
            double pts = _size.Points();
            double cx = _pet.Left + _pet.Width / 2;
            double cy = _pet.Top + _pet.Height / 2;
            _pet.Width = pts;
            _pet.Height = pts;
            _petImage.Width = pts;
            _petImage.Height = pts;
            _pet.Left = cx - pts / 2;
            _pet.Top = cy - pts / 2;
            ClampPetToScreen();
            AlignEffects();
            RepositionMenu();
            SavePosition();
        }

        void ShowRestPrompt()
        {
            double w = 300, h = 164;
            Window win = CreateWindow(w, h, _pet.Left, _pet.Top - h - 8);
            StackPanel panel = new StackPanel();
            panel.Background = new SolidColorBrush(Color.FromRgb(17, 22, 27));
            panel.Width = w;
            panel.Height = h;
            TextBlock title = new TextBlock();
            title.Text = "FAIRY / REST";
            title.Foreground = new SolidColorBrush(Color.FromRgb(168, 199, 217));
            title.FontSize = 12;
            title.Margin = new Thickness(14, 12, 0, 4);
            panel.Children.Add(title);
            TextBlock body = new TextBlock();
            body.Text = "主人，该起来活动一下了。";
            body.Foreground = new SolidColorBrush(Color.FromRgb(222, 230, 237));
            body.FontSize = 14;
            body.Margin = new Thickness(14, 2, 0, 8);
            panel.Children.Add(body);

            Button later = new Button();
            later.Content = "稍后 · 5 分钟";
            later.Margin = new Thickness(14, 3, 14, 2);
            later.Click += delegate(object s, RoutedEventArgs e)
            {
                win.Close();
                _restPending = false;
                _restDue = DateTime.Now + TimeSpan.FromMinutes(5);
            };
            Button rest = new Button();
            rest.Content = "去休息 · 1 小时";
            rest.Margin = new Thickness(14, 3, 14, 2);
            rest.Click += delegate(object s, RoutedEventArgs e)
            {
                win.Close();
                _restPending = false;
                _restDue = DateTime.Now + TimeSpan.FromHours(1);
            };
            panel.Children.Add(later);
            panel.Children.Add(rest);
            win.Content = panel;
            _restPrompt = win;
            win.Owner = _pet;
            win.Closed += delegate(object s, EventArgs e) { _restPending = false; };
            win.Show();
            win.Activate();
            PlayLifecycle("activity");
        }

        void PlayLifecycle(string cue)
        {
            if (_lifecycleSounds == null) return;
            string path = null;
            if (cue == "activity") path = Path.Combine(_lifecycleSounds, "activity-1.wav");
            else if (cue == "welcome") path = Path.Combine(_lifecycleSounds, _prefs.Welcome == "full" ? "welcome-7.wav" : "welcome-1.wav");
            else if (cue == "goodbye") path = Path.Combine(_lifecycleSounds, "goodbye-1.wav");
            if (path == null || !File.Exists(path)) return;
            try
            {
                if (_player != null) _player.Stop();
                _player = new SoundPlayer(path);
                _player.Play();
            }
            catch (Exception) { }
        }

        public void OnLeaseAcquired()
        {
            Application app = Application.Current;
            if (app == null) return;
            app.Dispatcher.BeginInvoke((Action)delegate()
            {
                _retiring = false;
                if (_retireTimer != null) { _retireTimer.Stop(); _retireTimer = null; }
                if (_leaseSeen) return;
                _leaseSeen = true;
                if (_savedIntro) PlayLifecycle("welcome");
            });
        }

        bool _retiring;
        DispatcherTimer _retireTimer;

        /// <summary>
        /// The last Pi lease closed. Keep the pet for a short grace so a reload or
        /// a second Pi reconnecting does not flicker it, then play the shared
        /// goodbye and exit. Without this the helper would show a pet forever.
        /// </summary>
        public void OnAllLeasesClosed()
        {
            // Called from a pipe handler thread; DispatcherTimer must be created on
            // the UI thread or its Tick never fires.
            Application app = Application.Current;
            if (app == null) return;
            app.Dispatcher.BeginInvoke((Action)delegate() { StartRetireTimer(); });
        }

        void StartRetireTimer()
        {
            if (_retiring) return;
            _retiring = true;
            if (_retireTimer != null) { _retireTimer.Stop(); _retireTimer = null; }
            _retireTimer = new DispatcherTimer();
            _retireTimer.Interval = TimeSpan.FromSeconds(3);
            _retireTimer.Tick += delegate(object s, EventArgs e)
            {
                _retireTimer.Stop();
                _retireTimer = null;
                if (!_retiring) return; // a lease returned during the grace
                PlayLifecycle("goodbye");
                try
                {
                    if (_menu != null) { _menu.Close(); _menu = null; }
                    if (_restPrompt != null) { _restPrompt.Close(); _restPrompt = null; }
                    if (_pet != null) _pet.Close();
                }
                catch { }
                // Let the goodbye clip start before the process goes away.
                DispatcherTimer exit = new DispatcherTimer();
                exit.Interval = TimeSpan.FromMilliseconds(1200);
                exit.Tick += delegate(object s2, EventArgs e2)
                {
                    exit.Stop();
                    if (_retiring) Environment.Exit(0); // a late lease keeps the pet alive
                };
                exit.Start();
            };
            _retireTimer.Start();
        }
    }

    // ------------------------------------------------------------ ripple canvas
    internal class RippleCanvas : Canvas
    {
        double _time;
        bool _wasVisible;
        public double Time
        {
            get { return _time; }
            set
            {
                _time = value;
                // The rings are visible only during roughly a third of the 6.4s
                // cycle; skip repaints while they are absent, but force one final
                // repaint when they disappear so stale rings are erased.
                double age = (value - 1) % 6.4;
                bool visible = false;
                for (int i = 0; i < 3; i++)
                {
                    double p = (age - i * 0.26) / 1.8;
                    if (p > 0 && p < 1) { visible = true; break; }
                }
                if (visible || _wasVisible) InvalidateVisual();
                _wasVisible = visible;
            }
        }

        protected override void OnRender(DrawingContext dc)
        {
            base.OnRender(dc);
            double side = ActualWidth / 1.8;
            double cx = ActualWidth / 2;
            double cy = ActualHeight / 2;
            double age = (_time - 1) % 6.4;
            for (int i = 0; i < 3; i++)
            {
                double p = (age - i * 0.26) / 1.8;
                if (p <= 0 || p >= 1) continue;
                double radius = (0.32 + 0.42 * p) * side;
                double alpha = 0.20 * Math.Min(1, p / 0.12) * Math.Pow(1 - p, 1.3);
                if (alpha <= 0) continue;
                SolidColorBrush brush = new SolidColorBrush(Color.FromArgb((byte)(alpha * 255), 224, 242, 255));
                Pen pen = new Pen(brush, Math.Max(1, 0.065 * side));
                dc.DrawEllipse(null, pen, new Point(cx, cy), radius, radius);
            }
        }
    }
}
