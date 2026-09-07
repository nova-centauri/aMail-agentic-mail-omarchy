import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// aMail — agentic mail in the Omarchy bar.
//
// This widget owns the plugin daemon (plugin/daemon.mjs) and renders what it
// writes to ~/.local/state/amail/state.json. Omarchy builds one bar per
// screen, so only the widget on the first screen runs the daemon; every
// instance watches the same state file, so the badge agrees everywhere.
//
// Left-click = triage panel · middle-click = refresh · right-click = open the
// aMail web client.
BarWidget {
  id: root
  moduleName: "io.github.nova-centauri.amail"

  readonly property string home: Quickshell.env("HOME")
  readonly property string pluginDir: decodeURIComponent(Qt.resolvedUrl(".").toString().replace(/^file:\/\//, "").replace(/\/$/, ""))
  readonly property string runner: pluginDir + "/bin/amail-run"
  readonly property string stateFile: home + "/.local/state/amail/state.json"

  readonly property var ownScreen: QsWindow.window ? QsWindow.window.screen : null
  readonly property bool leader: !ownScreen || Quickshell.screens.length === 0
    || String(ownScreen.name) === String(Quickshell.screens[0].name)

  // ---- state mirrored from the daemon
  property bool online: false
  property bool configured: true
  property string transport: ""
  property string mode: ""
  property string url: ""
  property string lastError: ""
  property string lastEventAt: ""
  property string lastRefreshAt: ""
  property int unread: 0
  property int unanalyzed: 0
  property int inboxTotal: 0
  property var accounts: []
  property var conversations: []
  property string conversationsJson: ""
  property var idle: null
  property string daemonLog: ""

  readonly property string badgeMode: String(setting("badge", "unread"))
  readonly property bool showZero: setting("showZero", false) === true
  readonly property int badgeCount: badgeMode === "unanalyzed" ? unanalyzed : unread
  readonly property string badgeText: badgeMode === "both"
    ? (unread + "·" + unanalyzed)
    : String(badgeCount)
  readonly property bool hasWork: badgeMode === "both" ? (unread > 0 || unanalyzed > 0) : badgeCount > 0

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function applyState(text) {
    var d
    try { d = JSON.parse(text) } catch (e) { return }
    if (!d || typeof d !== "object") return
    root.online = d.online === true
    root.transport = String(d.transport || "")
    root.configured = root.transport !== "unconfigured"
    root.mode = String(d.mode || "")
    root.url = String(d.url || "")
    root.lastError = String(d.error || "")
    root.lastEventAt = String(d.lastEventAt || "")
    root.lastRefreshAt = String(d.lastRefreshAt || "")
    root.unread = Number(d.unread) || 0
    root.unanalyzed = Number(d.unanalyzed) || 0
    root.inboxTotal = Number(d.inboxTotal) || 0
    root.idle = d.idle || null
    var accounts = Array.isArray(d.accounts) ? d.accounts : []
    if (JSON.stringify(accounts) !== JSON.stringify(root.accounts)) root.accounts = accounts
    var list = Array.isArray(d.conversations) ? d.conversations : []
    var j = JSON.stringify(list)
    // Reassigning the list rebuilds the panel's ListView; skip identical snapshots.
    if (j !== root.conversationsJson) {
      root.conversationsJson = j
      root.conversations = list
    }
  }

  FileView {
    id: stateView
    path: root.stateFile
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.applyState(text())
  }

  // Followers (other screens) only see inotify events; poll gently as a
  // fallback so a missed rename never leaves a stale badge.
  Timer {
    interval: root.leader ? 30000 : 5000
    running: true
    repeat: true
    onTriggered: stateView.reload()
  }

  // ---- the daemon (leader only). It exits 75 when setup completes so it can
  // come back with the new configuration; anything else is a crash we retry.
  Process {
    id: daemon
    running: root.leader
    command: [root.runner, "daemon"]
    environment: ({ AMAIL_PLUGIN_ID: root.moduleName })
    // Each state line means the file was just rewritten. Reloading here covers
    // the first write (FileView cannot watch a file that does not exist yet)
    // and makes the leader's badge move the instant the daemon does.
    stdout: SplitParser { onRead: function(line) { stateView.reload() } }
    stderr: SplitParser {
      onRead: function(line) {
        root.daemonLog = String(line).slice(0, 400)
        if (line.indexOf("no JavaScript runtime") >= 0) {
          root.online = false
          root.lastError = "install node (sudo pacman -S nodejs) or bun, then restart the shell"
        }
      }
    }
    onExited: function(code, status) {
      if (!root.leader) return
      restartTimer.interval = code === 75 ? 500 : 4000
      restartTimer.restart()
    }
  }
  Timer {
    id: restartTimer
    repeat: false
    onTriggered: if (root.leader && !daemon.running) daemon.running = true
  }
  onLeaderChanged: {
    if (root.leader && !daemon.running) daemon.running = true
    if (!root.leader && daemon.running) daemon.running = false
  }

  Process {
    id: refreshProc
    command: [root.runner, "cli", "refresh"]
  }
  function refresh() { if (!refreshProc.running) refreshProc.running = true }

  function openWeb(path) {
    if (root.url === "") return
    Quickshell.execDetached(["sh", "-c",
      'u="$1"; if command -v omarchy-launch-webapp >/dev/null 2>&1; then exec omarchy-launch-webapp "$u"; else exec xdg-open "$u"; fi',
      "amail", root.url + (path || "")])
  }

  function open() { panel.open() }
  function close() { panel.close() }
  function toggle() { panel.toggle() }
  function showConversation(id) { panel.showConversation(String(id)) }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰇮" + ((root.hasWork || root.showZero) ? " " + root.badgeText : "")
    active: root.unread > 0
    dimmed: !root.online
    tooltipText: !root.configured ? "aMail: click to set up"
      : !root.online ? "aMail: offline" + (root.lastError !== "" ? " — " + root.lastError : "")
      : root.unread + " unread · " + root.unanalyzed + " not yet analyzed · " + (root.transport === "push" ? "push" : root.transport)
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) root.openWeb("")
      else if (buttonCode === Qt.MiddleButton) root.refresh()
      else root.toggle()
    }
  }

  TriagePanel {
    id: panel
    bar: root.bar
    widget: root
    anchorItem: button
    moduleName: root.moduleName
  }

  IpcHandler {
    target: root.moduleName
    enabled: root.leader
    function status(): string {
      return "online=" + root.online + " transport=" + root.transport + " unread=" + root.unread
        + " unanalyzed=" + root.unanalyzed + " accounts=" + root.accounts.length
        + " conversations=" + root.conversations.length
        + (root.lastError !== "" ? " error=" + root.lastError : "")
    }
    function open(): void { root.open() }
    function close(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { root.refresh(); return "ok" }
    function goto(id: string): string { root.showConversation(id); return "shown" }
    function web(): string { root.openWeb(""); return "ok" }
    function debug(): string { return panel.debugInfo() }
    function counts(): string { return JSON.stringify({ unread: root.unread, unanalyzed: root.unanalyzed, online: root.online, transport: root.transport }) }
  }
}
