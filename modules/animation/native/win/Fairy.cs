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
            finally { try { s.Close(); } catch { } }
        }

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
        Point _dragOffset;
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

        public void SetTheme(string t) { _theme = t; }

        bool Dark()
        {
            if (_theme == "dark") return true;
            if (_theme == "light") return false;
            try
            {
                Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
                if (key != null)
                {
                    using (key)
                    {
                        object v = key.GetValue("AppsUseLightTheme");
                        if (v != null && Convert.ToInt32(v) == 0) return true;
                    }
                }
            }
            catch { }
            return false;
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

            Rect screen = new Rect(0, 0, SystemParameters.PrimaryScreenWidth, SystemParameters.PrimaryScreenHeight);
            double side = Math.Min(_size.Points(), Math.Min(screen.Width, screen.Height));

            double ix = screen.Left + screen.Width * 0.8 - side / 2;
            double iy = screen.Bottom - screen.Height / 3 - side / 2;

            SavedPosition sp = _prefs.Read().Position;
            if (sp != null && sp.Valid)
            {
                ix = screen.Left + screen.Width * sp.X - side / 2;
                iy = screen.Top + screen.Height * sp.Y - side / 2;
            }

            _pet = CreateWindow(side, side, ix, iy);
            _petImage = new Image();
            _petImage.Stretch = Stretch.Uniform;
            _petImage.Width = side;
            _petImage.Height = side;
            _pet.Content = _petImage;
            AttachDrag(_pet);
            _pet.Show();

            double es = side * 1.8;
            _effectPanel = CreateWindow(es, es, ix - side * 0.4, iy - side * 0.4);
            _ripple = new RippleCanvas();
            _ripple.Width = es;
            _ripple.Height = es;
            _effectPanel.Content = _ripple;
            _effectPanel.IsHitTestVisible = false;
            _effectPanel.Show();

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

        void AttachDrag(Window win)
        {
            win.MouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e)
            {
                _dragging = true;
                _dragOffset = e.GetPosition(win);
                if (e.Source is UIElement) ((UIElement)e.Source).CaptureMouse();
            };
            win.MouseMove += delegate(object s, MouseEventArgs e)
            {
                if (!_dragging) return;
                Point pos = e.GetPosition(null);
                win.Left = pos.X - _dragOffset.X;
                win.Top = pos.Y - _dragOffset.Y;
                AlignEffects();
            };
            win.MouseLeftButtonUp += delegate(object s, MouseButtonEventArgs e)
            {
                if (!_dragging) return;
                _dragging = false;
                if (e.Source is UIElement) ((UIElement)e.Source).ReleaseMouseCapture();
                SavePosition();
            };
            win.MouseRightButtonDown += delegate(object s, MouseButtonEventArgs e) { ToggleMenu(); };
        }

        void SavePosition()
        {
            Rect screen = new Rect(0, 0, SystemParameters.PrimaryScreenWidth, SystemParameters.PrimaryScreenHeight);
            double x = (_pet.Left + _pet.Width / 2 - screen.Left) / screen.Width;
            double y = (_pet.Top + _pet.Height / 2 - screen.Top) / screen.Height;
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
            menu.Show();
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
            AlignEffects();
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
            win.Closed += delegate(object s, EventArgs e) { _restPending = false; };
            win.Show();
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
            if (_leaseSeen) return;
            _leaseSeen = true;
            if (_savedIntro) PlayLifecycle("welcome");
        }
    }

    // ------------------------------------------------------------ ripple canvas
    internal class RippleCanvas : Canvas
    {
        double _time;
        public double Time
        {
            get { return _time; }
            set { _time = value; InvalidateVisual(); }
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
