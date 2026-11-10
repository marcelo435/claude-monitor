using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Input;
using System.Windows.Controls.Primitives;
using Ellipse = System.Windows.Shapes.Ellipse;
using System.Windows.Threading;

internal static class Program {
    [STAThread] public static void Main(string[] args) {
        try {
            var app = new Application();
            new MonitorWindow(args).Run(app);
        } catch (Exception e) {
            MessageBox.Show("Não foi possível abrir o Claude Monitor.\n" + e.Message, "Claude Monitor", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }
}
internal sealed class MonitorWindow {
    private Window window;
    private Window widget;
    private Process collector;
    private string root = AppDomain.CurrentDomain.BaseDirectory;
    private string snapshotFile;
    private bool testing, filling;
    private bool closing, widgetPlaced, iconOnly;
    private Dictionary<string, object> latest;
    private string selected = "";
    private System.Windows.Forms.NotifyIcon tray;
    private static readonly CultureInfo Pt = CultureInfo.GetCultureInfo("pt-BR");
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
    private readonly string[] args;
    public MonitorWindow(string[] args) { this.args = args; }
    private T C<T>(string name) where T : class { return window.FindName(name) as T; }
    private T W<T>(string name) where T : class { return widget.FindName(name) as T; }
    private static Dictionary<string, object> D(object o) { return o as Dictionary<string, object> ?? new Dictionary<string, object>(); }
    private static object V(Dictionary<string, object> d, string key) { object v; return d.TryGetValue(key, out v) ? v : null; }
    private static string S(Dictionary<string, object> d, string key) { return Convert.ToString(V(d,key), CultureInfo.InvariantCulture) ?? ""; }
    private static double N(Dictionary<string, object> d, string key) { double n; return double.TryParse(S(d,key),NumberStyles.Any,CultureInfo.InvariantCulture,out n) ? n : 0; }
    private static bool B(Dictionary<string, object> d, string key) { return V(d,key) is bool && (bool)V(d,key); }
    private static object[] A(Dictionary<string, object> d, string key) { return V(d,key) as object[] ?? new object[0]; }
    private static string Num(object n) { return n == null ? "—" : Convert.ToDouble(n, CultureInfo.InvariantCulture).ToString("N0",Pt); }
    private static string Percent(double n) { return n.ToString("0.#",Pt)+"%"; }
    private static Brush Color(string s) { return new SolidColorBrush((System.Windows.Media.Color)ColorConverter.ConvertFromString(s)); }
    private void Text(string id, string text) { C<TextBlock>(id).Text = text; }
    private static string LocalTime(string iso) {
        DateTimeOffset t; return DateTimeOffset.TryParse(iso,out t) ? t.LocalDateTime.ToString("dd/MM HH:mm",Pt) : "não informado";
    }
    private Window LoadWindow(string fileName) {
        var fileNameFull=System.IO.Path.Combine(root,fileName);
        using(var file=File.OpenRead(fileNameFull)) return (Window)XamlReader.Load(file,new ParserContext {BaseUri=new Uri(fileNameFull,UriKind.Absolute)});
    }
    public void Run(Application app) {
        window=LoadWindow("desktop.xaml");
        widget=LoadWindow("widget.xaml");
        app.MainWindow=window;
        window.Height=Math.Min(window.Height,SystemParameters.WorkArea.Height-24);
        var arg = Array.IndexOf(args,"--snapshot");
        testing = arg >= 0 && arg + 1 < args.Length;
        snapshotFile = testing ? Path.GetFullPath(args[arg+1]) : Path.Combine(root,".runtime","snapshot-"+Process.GetCurrentProcess().Id+".json");
        if (args.Contains("--demo")) window.Title += " · DEMONSTRAÇÃO";
        if (args.Contains("--demo")) widget.Title += " · DEMONSTRAÇÃO";
        try { window.Icon=System.Windows.Media.Imaging.BitmapFrame.Create(new Uri(System.IO.Path.Combine(root,"claude.ico"),UriKind.Absolute)); } catch {}
        widget.Icon=window.Icon;
        C<Button>("Minimize").Click+=(s,e)=>window.WindowState=WindowState.Minimized;
        C<Button>("Close").Click+=(s,e)=>window.Close();
        C<Grid>("TitleDrag").MouseLeftButtonDown+=(s,e)=>{
            DependencyObject target=e.OriginalSource as DependencyObject;
            while(target!=null) {if(target is ButtonBase)return;target=target is Visual?VisualTreeHelper.GetParent(target):LogicalTreeHelper.GetParent(target);}
            try {window.DragMove();} catch(InvalidOperationException){}
        };
        C<Button>("TabOverview").Click+=(s,e)=>SelectTab(false);
        C<Button>("TabActivity").Click+=(s,e)=>SelectTab(true);
        C<CheckBox>("Pin").Checked += (s,e) => window.Topmost = true;
        C<CheckBox>("Pin").Unchecked += (s,e) => window.Topmost = false;
        C<ComboBox>("Sessions").SelectionChanged += (s,e) => {
            if(filling) return;
            var item = C<ComboBox>("Sessions").SelectedItem as ComboBoxItem;
            if(item!=null) { selected = (string)item.Tag; Render(); }
        };
        C<Button>("Help").Click += (s,e) => Process.Start(new ProcessStartInfo(Path.Combine(root,"README.md")) { UseShellExecute = true });
        tray = new System.Windows.Forms.NotifyIcon();
        try {tray.Icon=new System.Drawing.Icon(System.IO.Path.Combine(root,"claude.ico"));} catch {tray.Icon = System.Drawing.SystemIcons.Application;}
        tray.Text = "Claude Monitor";
        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Items.Add("Abrir monitor",null,(s,e)=>Restore());
        menu.Items.Add("Mostrar widget",null,(s,e)=>ShowWidget());
        menu.Items.Add("Fechar monitor",null,(s,e)=>window.Close());
        tray.ContextMenuStrip = menu; tray.DoubleClick += (s,e)=>Restore(); tray.Visible = true;
        window.StateChanged += (s,e) => { if(window.WindowState==WindowState.Minimized&&!closing) ShowWidget(); };
        SetupWidget();
        var tick = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        tick.Tick += (s,e) => Read();
        window.Closed += (s,e) => {
            closing=true; SaveWidgetPosition(); widget.Close();
            tick.Stop(); tray.Visible = false; tray.Dispose();
            if(collector!=null) { try { if(!collector.HasExited) collector.Kill(); } catch {} collector.Dispose(); }
            if(!testing) { try { File.Delete(snapshotFile); File.Delete(snapshotFile+".tmp"); } catch {} }
        };
        if(!testing) StartCollector();
        tick.Start(); Read();
        if(args.Contains("--widget"))window.Loaded+=(s,e)=>ShowWidget();
        app.Run(window);
    }
    private void SelectTab(bool activity) {
        C<StackPanel>("Overview").Visibility=activity?Visibility.Collapsed:Visibility.Visible;
        C<StackPanel>("ActivityPage").Visibility=activity?Visibility.Visible:Visibility.Collapsed;
        C<Button>("TabOverview").Background=Color(activity?"#191815":"#4C362A");
        C<Button>("TabOverview").Foreground=Color(activity?"#A59F93":"#F1BC9F");
        C<Button>("TabActivity").Background=Color(activity?"#4C362A":"#191815");
        C<Button>("TabActivity").Foreground=Color(activity?"#F1BC9F":"#A59F93");
    }
    private void Restore() { widget.Hide(); window.Show(); window.WindowState=WindowState.Normal; window.Activate(); }
    private void SetupWidget() {
        var context=new ContextMenu();
        var open=new MenuItem {Header="Abrir painel"};open.Click+=(s,e)=>Restore();context.Items.Add(open);
        var compact=new MenuItem {Header="Mostrar só o símbolo"};
        compact.Click+=(s,e)=>{iconOnly=!iconOnly;ApplyWidgetSize();KeepWidgetOnScreen();SaveWidgetPosition();compact.Header=iconOnly?"Mostrar informações":"Mostrar só o símbolo";};
        context.Items.Add(compact);
        var hide=new MenuItem {Header="Ocultar na bandeja"};hide.Click+=(s,e)=>widget.Hide();context.Items.Add(hide);
        context.Items.Add(new Separator());
        var quit=new MenuItem {Header="Fechar monitor"};quit.Click+=(s,e)=>window.Close();context.Items.Add(quit);
        widget.ContextMenu=context;
        W<Border>("WidgetBody").MouseLeftButtonDown+=(s,e)=>{
            double left=widget.Left,top=widget.Top;
            try {widget.DragMove();} catch(InvalidOperationException){return;}
            if(Math.Abs(widget.Left-left)<4&&Math.Abs(widget.Top-top)<4)Restore();
            else {KeepWidgetOnScreen();SaveWidgetPosition();}
            e.Handled=true;
        };
        widget.Closing+=(s,e)=>{if(!closing){e.Cancel=true;window.Dispatcher.BeginInvoke(new Action(()=>window.Close()));}};
        try {
            var saved=D(json.DeserializeObject(File.ReadAllText(System.IO.Path.Combine(root,".runtime","widget-position.json"))));
            if(V(saved,"left")!=null&&V(saved,"top")!=null){widget.Left=N(saved,"left");widget.Top=N(saved,"top");widgetPlaced=true;}
            iconOnly=B(saved,"iconOnly");
        } catch {}
        compact.Header=iconOnly?"Mostrar informações":"Mostrar só o símbolo";
        ApplyWidgetSize();
    }
    private void ApplyWidgetSize() {
        widget.Width=iconOnly?82:268;widget.Height=iconOnly?82:96;
        W<StackPanel>("WidgetDetails").Visibility=iconOnly?Visibility.Collapsed:Visibility.Visible;
    }
    private void ShowWidget() {
        if(closing)return;
        if(!widgetPlaced){var area=SystemParameters.WorkArea;widget.Left=area.Right-widget.Width-18;widget.Top=area.Bottom-widget.Height-18;widgetPlaced=true;}
        KeepWidgetOnScreen();window.Hide();widget.Show();widget.Topmost=true;
    }
    private void KeepWidgetOnScreen() {
        if(!widgetPlaced)return;
        double minX=SystemParameters.VirtualScreenLeft,minY=SystemParameters.VirtualScreenTop;
        widget.Left=Math.Max(minX,Math.Min(widget.Left,minX+SystemParameters.VirtualScreenWidth-widget.Width));
        widget.Top=Math.Max(minY,Math.Min(widget.Top,minY+SystemParameters.VirtualScreenHeight-widget.Height));
    }
    private void SaveWidgetPosition() {
        if(testing||!widgetPlaced)return;
        try {var dir=System.IO.Path.Combine(root,".runtime");Directory.CreateDirectory(dir);File.WriteAllText(System.IO.Path.Combine(dir,"widget-position.json"),json.Serialize(new {left=widget.Left,top=widget.Top,iconOnly=iconOnly}));} catch {}
    }
    private void StartCollector() {
        var paths = new List<string> { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"nodejs","node.exe"), Path.Combine(root,"node.exe") };
        foreach(var p in (Environment.GetEnvironmentVariable("PATH")??"").Split(';')) if(!string.IsNullOrWhiteSpace(p)) paths.Add(Path.Combine(p.Trim('"'),"node.exe"));
        var node = paths.FirstOrDefault(File.Exists);
        if(node==null) throw new Exception("O Node.js não foi encontrado. Instale o Node.js 22 ou superior para executar o coletor local.");
        collector = Process.Start(new ProcessStartInfo(node,"\""+Path.Combine(root,"desktop.js")+"\" --snapshot \""+snapshotFile+"\" --parent "+Process.GetCurrentProcess().Id) {
            WorkingDirectory=root, UseShellExecute=false, CreateNoWindow=true, WindowStyle=ProcessWindowStyle.Hidden,
            RedirectStandardError=true,StandardErrorEncoding=Encoding.UTF8
        });
        collector.ErrorDataReceived += (s,e) => { if(!string.IsNullOrWhiteSpace(e.Data)) window.Dispatcher.BeginInvoke(new Action(()=>Text("Connection",e.Data))); };
        collector.BeginErrorReadLine();
    }
    private void Read() {
        try {
            if(!File.Exists(snapshotFile)) { if(collector!=null && collector.HasExited) Text("Connection","O coletor não iniciou. Confira o Node.js e a pasta do aplicativo."); return; }
            // Allow the collector to replace the file atomically while the window reads.
            string text;
            using(var file=new FileStream(snapshotFile,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
            using(var reader=new StreamReader(file,Encoding.UTF8)) text=reader.ReadToEnd();
            latest=D(json.DeserializeObject(text));
            Render();
        } catch { Text("Updated","Aguardando a próxima atualização local…"); }
    }
    private void Render() {
        if(latest==null) return;
        var sessions=A(latest,"sessions").Select(D).ToList();
        var combo=C<ComboBox>("Sessions");
        var active=sessions.FirstOrDefault(s=>S(s,"id")==selected)??sessions.FirstOrDefault();
        bool noSession=active==null;
        if(noSession)active=new Dictionary<string,object> {{"id",""},{"cwd",""},{"model","Aguardando conversa"}};
        selected=S(active,"id");
        var options=sessions.Select(s=> S(s,"id")+"|"+S(s,"cwd")+"|"+S(s,"model")).ToArray();
        string signature=string.Join("\n",options);
        if(!Equals(combo.Tag,signature)) {
            filling=true; combo.Items.Clear();
            foreach(var s in sessions) {
                var folder=Path.GetFileName(S(s,"cwd").TrimEnd('\\','/'));
                var item=new ComboBoxItem {Content=(folder.Length>0?folder:"Conversa")+" · "+S(s,"id").Substring(0,Math.Min(8,S(s,"id").Length)),Tag=S(s,"id"),ToolTip=S(s,"cwd")};
                combo.Items.Add(item); if(S(s,"id")==selected) combo.SelectedItem=item;
            }
            combo.Tag=signature; filling=false;
        }
        var live=D(V(active,"live"));
        var plan=D(V(latest,"plan"));
        bool hasLive=live.Count>0,online=B(live,"online");
        DateTimeOffset stamp;
        bool collectorStale=!DateTimeOffset.TryParse(S(latest,"updatedAt"),out stamp)||(DateTimeOffset.UtcNow-stamp).TotalSeconds>20;
        if(collectorStale)online=false;
        bool hasPlan=A(plan,"windows").Length>0;
        Text("Connection",online?"● Conectado ao Claude · atualização automática":hasPlan?"● Uso do plano conectado · agentes aguardam uma sessão com o plugin":hasLive?"○ Claude sem sinal recente · mostrando os últimos dados":"○ Consultando o plano pelo Claude Code…");
        C<TextBlock>("Connection").Foreground=Color(online?"#9CBBA1":"#A59F93");
        Text("LiveBadge",online?"AO VIVO":"LOCAL");
        var limits=(hasPlan?A(plan,"windows"):A(live,"rateLimits")).Select(D).ToList();
        bool stalePlan=hasPlan?B(plan,"stale")||collectorStale:!online;
        DrawLimit("Five",limits.FirstOrDefault(w=>S(w,"kind")=="five_hour"),stalePlan);
        DrawLimit("Week",limits.FirstOrDefault(w=>S(w,"kind")=="seven_day"),stalePlan);
        Text("OtherLimits",string.Join(" · ",limits.Where(w=>S(w,"kind")!="five_hour"&&S(w,"kind")!="seven_day").Select(w=>S(w,"label")+": "+(B(w,"expired")?"aguardando nova leitura":Percent(N(w,"percentUsed"))))));
        C<TextBlock>("OtherLimits").Visibility=C<TextBlock>("OtherLimits").Text.Length>0?Visibility.Visible:Visibility.Collapsed;
        Text("QuotaNote",hasPlan?(stalePlan?"Últimos dados · "+S(plan,"message"):"Consultado pelo Claude em "+LocalTime(S(plan,"checkedAt"))+" · atualização automática a cada 5 min."):limits.Count>0 ? (online?"Limites reais informados pelo Claude. Atualizam com o uso.":"Última leitura do Claude em "+LocalTime(S(live,"publishedAt"))+". Os valores podem estar desatualizados.") : S(plan,"message").Length>0?S(plan,"message"):"A primeira consulta ao Claude pode levar alguns segundos.");
        Text("Model",S(active,"model").Length>0?S(active,"model"):"Modelo ainda não registrado");
        Text("Phase",!hasLive?"Histórico local":!online?"Último estado conhecido":S(live,"phase")=="working"?"Trabalhando na conversa":S(live,"phase")=="idle"?"Aguardando sua próxima mensagem":"Conectado");
        var ctx=D(V(live,"context"));
        Text("ContextText",V(ctx,"percent")!=null?Percent(N(ctx,"percent"))+" · "+Num(V(ctx,"tokens"))+" / "+Num(V(ctx,"window")):"Aguardando resposta");
        C<ProgressBar>("ContextBar").Value=Math.Min(100,N(ctx,"percent"));
        Text("TotalTokens",Num(V(active,"total")));Text("AllTokens",Num(V(active,"allTokens")));
        var tokens=D(V(active,"tokens"));
        Text("TokenDetails",tokens.Count>0?"Entrada "+Num(V(tokens,"input"))+" · Saída "+Num(V(tokens,"output"))+"\nCache lido "+Num(V(tokens,"cacheRead"))+" · Cache criado "+Num(V(tokens,"cacheWrite"))+(B(active,"partial")?"\nHistórico em carregamento; contagens parciais.":""):"Aguardando os registros de tokens desta conversa.");
        Text("Project",S(active,"cwd"));
        var agents=C<StackPanel>("Agents"); agents.Children.Clear();
        var list=A(live,"agents").Select(D).ToList();
        Text("AgentsTitle","AGENTES · "+(hasLive?list.Count:A(active,"logAgents").Length)+(hasLive?"":" · HISTÓRICO"));
        foreach(var a in list) AddLine(agents,S(a,"name"),S(a,"statusLabel")+(online?"":" · último estado"),S(a,"status")=="running"&&online?"#9CBBA1":"#A59F93");
        if(!hasLive) foreach(var a in A(active,"logAgents").Take(6).Select(D)) AddLine(agents,S(a,"id"),"Histórico · "+Num(V(a,"tokens"))+" tokens","#A59F93");
        if(agents.Children.Count==0) AddLine(agents,online?"Nenhum subagente nesta conversa.":"Agentes em tempo real após conectar a conversa.","","#A59F93");
        var activity=C<StackPanel>("Activity");activity.Children.Clear();
        var events=A(live,"activity").Length>0?A(live,"activity"):A(active,"logActivity");
        foreach(var a in events.Take(18).Select(D)) AddLine(activity,S(a,"name")+(S(a,"detail").Length>0?" · "+S(a,"detail"):""),S(a,"statusLabel")+((!online&&S(a,"status")=="running")?" · último estado":""),"#A59F93");
        if(activity.Children.Count==0) AddLine(activity,"As próximas ações aparecem aqui.","","#9AA6B7");
        Text("Notice",collectorStale?"O coletor está sem atualização. Feche e reabra o monitor.":S(latest,"warning"));
        Text("Updated","Atualizado "+LocalTime(S(latest,"updatedAt"))+" · minimizar abre o widget");
        RenderWidget(limits,stalePlan,list,online,S(live,"phase"),S(active,"cwd"));
    }
    private void RenderWidget(List<Dictionary<string,object>> limits,bool stale,List<Dictionary<string,object>> agents,bool online,string phase,string project) {
        DrawMiniLimit("MiniFive",limits.FirstOrDefault(w=>S(w,"kind")=="five_hour"),stale);
        DrawMiniLimit("MiniWeek",limits.FirstOrDefault(w=>S(w,"kind")=="seven_day"),stale);
        int working=online?agents.Count(a=>S(a,"status")=="running"):0;
        string status=!online?"Agentes sem sinal ao vivo":working>0?working+(working==1?" agente trabalhando":" agentes trabalhando"):phase=="working"?"Claude trabalhando":"Claude aguardando";
        if(stale)status="Uso: última leitura · "+status;
        W<TextBlock>("MiniState").Text=status;
        W<Ellipse>("WidgetDot").Fill=Color(online?"#9CBBA1":"#A59F93");
        string tooltip="Clique para abrir · arraste para mover\n"+status;
        foreach(var w in limits.Where(w=>S(w,"kind")=="five_hour"||S(w,"kind")=="seven_day"))tooltip+="\n"+S(w,"label")+": "+(B(w,"expired")?"aguardando nova leitura":Percent(N(w,"percentUsed")))+" · renova "+LocalTime(S(w,"resetsAt"));
        if(project.Length>0)tooltip+="\n"+project;
        W<Border>("WidgetBody").ToolTip=tooltip;
        string trayText="Claude · 5h "+W<TextBlock>("MiniFive").Text+" · semana "+W<TextBlock>("MiniWeek").Text;
        tray.Text=trayText.Substring(0,Math.Min(63,trayText.Length));
    }
    private void DrawMiniLimit(string name,Dictionary<string,object> limit,bool stale) {
        bool available=limit!=null&&!B(limit,"expired");
        W<TextBlock>(name).Text=available?Percent(N(limit,"percentUsed")):"—";
        var bar=W<ProgressBar>(name+"Bar");bar.Value=available?Math.Min(100,N(limit,"percentUsed")):0;
        bar.Opacity=stale?0.45:1;bar.Foreground=Color(available&&N(limit,"percentUsed")>=90?"#E88787":name=="MiniFive"?"#DB997B":"#9CBBA1");
    }
    private void DrawLimit(string prefix,Dictionary<string,object> limit,bool stale) {
        var bar=C<ProgressBar>(prefix+"Bar");
        if(limit==null) {Text(prefix+"Text","—");Text(prefix+"Reset","Aguardando dados do Claude");bar.Value=0;return;}
        bool expired=B(limit,"expired");
        Text(prefix+"Text",expired?"—":Percent(N(limit,"percentUsed")));
        bar.Value=expired?0:Math.Min(100,N(limit,"percentUsed"));bar.Opacity=stale?0.5:1;
        if(N(limit,"percentUsed")>=90)bar.Foreground=Color("#E88787");else bar.Foreground=Color(prefix=="Five"?"#DB997B":"#9CBBA1");
        Text(prefix+"Reset",expired?"Janela encerrada · aguardando nova leitura":"Renova em "+LocalTime(S(limit,"resetsAt"))+(stale?" · última leitura":""));
    }
    private static void AddLine(StackPanel panel,string title,string detail,string color) {
        var line=new StackPanel {Margin=new Thickness(0,0,0,10)};
        line.Children.Add(new TextBlock {Text=title,FontSize=12,Foreground=Color("#F1EEE6"),TextWrapping=TextWrapping.Wrap});
        if(detail.Length>0)line.Children.Add(new TextBlock {Text=detail,FontSize=11,Foreground=Color(color),Margin=new Thickness(0,3,0,0),TextWrapping=TextWrapping.Wrap});
        panel.Children.Add(line);
    }
}
