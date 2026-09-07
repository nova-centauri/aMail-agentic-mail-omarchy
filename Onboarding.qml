import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// First-run wizard and settings, rendered inside the triage panel.
//
//   mode     → pick client (follow a server) or server (run aMail here)
//   client   → URL + access token, verified live before anything is saved
//   server   → one-click install: node check, secrets, systemd user unit
//   done     → what got connected, next steps
//   settings → badge, toasts (reachable from the gear once configured)
//
// The token travels to the CLI as an environment variable, never argv, and
// is written 0600 to ~/.config/amail/token by the CLI.
Item {
  id: root

  required property var widget
  property color foreground: Color.foreground
  property color accent: Color.accent
  property color urgent: Color.urgent
  property color dim: Qt.darker(foreground, 1.55)
  property string fontFamily: Style.font.family
  property bool canCancel: false

  property string step: "mode"
  property string url: ""
  property string token: ""
  property string error: ""
  property bool busy: false
  property var result: null
  property var logLines: []
  property string badge: "unread"
  property bool toasts: true

  readonly property bool editing: urlField.activeFocus || tokenField.activeFocus
  readonly property real rowSpacing: Style.space(10)

  signal finished()
  signal cancelled()

  function start(initialStep) {
    step = initialStep || (widget.configured ? "settings" : "mode")
    error = ""
    busy = false
    result = null
    logLines = []
    if (url === "" && widget.url !== "") url = widget.url
    if (step === "settings") loadSettings()
  }

  function alpha(c, a) { return Qt.rgba(c.r, c.g, c.b, a) }

  // ---------------------------------------------------------------- client
  Process {
    id: connectProc
    stdout: StdioCollector {
      onStreamFinished: {
        root.busy = false
        try {
          var d = JSON.parse(text.trim())
          if (d.ok === true) {
            root.result = d
            root.error = ""
            root.step = "done"
          } else {
            root.error = String(d.error || "connection failed")
          }
        } catch (e) {
          root.error = "unreadable reply from the plugin CLI"
        }
      }
    }
    onExited: function(code) { if (root.busy) { root.busy = false; if (root.error === "") root.error = "connect failed (exit " + code + ")" } }
  }

  function connect() {
    var u = String(url).trim()
    if (!/^https?:\/\//.test(u)) { error = "Enter the server URL with http:// or https://"; return }
    if (String(token).trim() === "") { error = "Enter the access token (AMAIL_ACCESS_TOKEN on the server)"; return }
    if (connectProc.running) return
    error = ""
    busy = true
    connectProc.environment = ({ AMAIL_ACCESS_TOKEN: String(token).trim(), AMAIL_PLUGIN_ID: widget.moduleName })
    connectProc.command = [widget.runner, "cli", "connect", u.replace(/\/+$/, ""), "--mode", "client"]
    connectProc.running = true
  }

  // ---------------------------------------------------------------- server
  Process {
    id: installProc
    command: [widget.pluginDir + "/bin/amail-plugin", "server", "install"]
    stdout: SplitParser { onRead: function(line) { root.appendLog(line) } }
    stderr: SplitParser { onRead: function(line) { root.appendLog(line) } }
    onExited: function(code) {
      root.busy = false
      if (code === 0) {
        root.result = { url: "http://127.0.0.1:3080", mode: "server", push: true, idle: true, accounts: 0, fresh: true }
        root.step = "done"
      } else {
        root.error = "install failed (exit " + code + "). See the log above."
      }
    }
  }

  function appendLog(line) {
    var next = logLines.slice()
    next.push(String(line).slice(0, 200))
    if (next.length > 60) next = next.slice(next.length - 60)
    logLines = next
  }

  function install() {
    if (installProc.running) return
    error = ""
    busy = true
    logLines = []
    installProc.running = true
  }

  // ---------------------------------------------------------------- settings
  Process {
    id: settingsProc
    command: [widget.runner, "cli", "config"]
    stdout: StdioCollector {
      onStreamFinished: {
        try {
          var d = JSON.parse(text.trim())
          if (d.ok && d.config) {
            root.badge = String(d.config.badge || "unread")
            root.toasts = d.config.toasts !== false
          }
        } catch (e) { /* keep defaults */ }
      }
    }
  }
  function loadSettings() { if (!settingsProc.running) settingsProc.running = true }

  Process { id: setProc }
  function setSetting(key, value) {
    setProc.command = [widget.runner, "cli", "set", key, String(value)]
    setProc.running = true
    // The daemon reads settings at start; ask it to come back with the new ones.
    Qt.callLater(function() { restartProc.running = true })
  }
  Process { id: restartProc; command: ["sh", "-c", "pid=$(cat \"$HOME/.local/state/amail/daemon.pid\" 2>/dev/null) && kill -TERM \"$pid\""] }

  // ---------------------------------------------------------------- ui
  Flickable {
    anchors.fill: parent
    contentWidth: width
    contentHeight: content.implicitHeight
    clip: true
    boundsBehavior: Flickable.StopAtBounds

    Column {
      id: content
      width: parent.width
      spacing: root.rowSpacing

      // ---------- mode ----------
      Column {
        visible: root.step === "mode"
        width: parent.width
        spacing: root.rowSpacing

        Text {
          width: parent.width
          text: "Welcome to aMail"
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.heading
          font.bold: true
        }
        Text {
          width: parent.width
          text: "Every mailbox you own in one hub, one endpoint for your agents, and an analyzed flag next to read/unread so nothing gets handled twice. Where should the hub live?"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.Wrap
        }

        OptionCard {
          width: parent.width
          icon: "󰅟"
          title: "Follow an aMail server"
          detail: "Client mode. You already run aMail somewhere (Docker, a VPS, a home box). This machine keeps a badge, a panel, and toasts; mail stays on the server."
          onClicked: { root.step = "client"; Qt.callLater(function() { urlField.forceActiveFocus() }) }
        }
        OptionCard {
          width: parent.width
          icon: "󰒋"
          title: "Run aMail on this machine"
          detail: "Server mode. Installs aMail as a systemd user service on 127.0.0.1:3080, generates the secrets, and follows it. Needs node ≥ 22. Add mailboxes in the web client afterwards."
          onClicked: root.step = "server"
        }
        Button {
          visible: root.canCancel
          text: "Cancel"
          foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall
          onClicked: root.cancelled()
        }
      }

      // ---------- client ----------
      Column {
        visible: root.step === "client"
        width: parent.width
        spacing: root.rowSpacing

        Text { text: "Follow an aMail server"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.title; font.bold: true }
        Text {
          width: parent.width
          text: "The token is AMAIL_ACCESS_TOKEN from the server's .env — the same one you unlock the web client with. Passkeys are a browser thing; the plugin always uses the token."
          color: root.dim; font.family: root.fontFamily; font.pixelSize: Style.font.caption; wrapMode: Text.Wrap
        }
        PanelSectionHeader { text: "Server URL"; foreground: root.foreground; fontFamily: root.fontFamily }
        TextField {
          id: urlField
          width: parent.width
          foreground: root.foreground; accent: root.accent
          placeholderText: "https://mail.example.com"
          text: root.url
          onTextChanged: root.url = text
          onAccepted: tokenField.forceActiveFocus()
        }
        PanelSectionHeader { text: "Access token"; foreground: root.foreground; fontFamily: root.fontFamily }
        TextField {
          id: tokenField
          width: parent.width
          foreground: root.foreground; accent: root.accent
          password: true
          placeholderText: "paste the access token"
          text: root.token
          onTextChanged: root.token = text
          onAccepted: root.connect()
        }
        Text {
          visible: root.error !== ""
          width: parent.width
          text: "✗ " + root.error
          color: root.urgent; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall; wrapMode: Text.Wrap
        }
        Row {
          spacing: Style.space(6)
          Button {
            text: root.busy ? "Connecting…" : "Connect"
            iconText: "󰌆"
            enabled: !root.busy
            foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.body
            onClicked: root.connect()
          }
          Button {
            text: "Back"
            foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall
            onClicked: { root.error = ""; root.step = "mode" }
          }
        }
      }

      // ---------- server ----------
      Column {
        visible: root.step === "server"
        width: parent.width
        spacing: root.rowSpacing

        Text { text: "Run aMail on this machine"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.title; font.bold: true }
        Text {
          width: parent.width
          text: "This copies aMail to ~/.local/share/amail/server, installs its dependencies, builds the web client, writes secrets to ~/.config/amail/server.env, and starts amail-server.service for your user. Mail is fetched by IMAP IDLE the moment it arrives. Takes a minute or two."
          color: root.dim; font.family: root.fontFamily; font.pixelSize: Style.font.caption; wrapMode: Text.Wrap
        }
        Rectangle {
          visible: root.logLines.length > 0
          width: parent.width
          height: Math.min(Style.space(220), logColumn.implicitHeight + Style.space(12))
          radius: Style.cornerRadius
          color: root.alpha(root.foreground, 0.05)
          clip: true
          Flickable {
            anchors.fill: parent
            anchors.margins: Style.space(6)
            contentHeight: logColumn.implicitHeight
            contentY: Math.max(0, contentHeight - height)
            Column {
              id: logColumn
              width: parent.width
              Repeater {
                model: root.logLines
                delegate: Text {
                  required property var modelData
                  width: logColumn.width
                  text: modelData
                  color: root.dim
                  font.family: "monospace"
                  font.pixelSize: Style.font.caption
                  wrapMode: Text.WrapAnywhere
                }
              }
            }
          }
        }
        Text {
          visible: root.error !== ""
          width: parent.width
          text: "✗ " + root.error
          color: root.urgent; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall; wrapMode: Text.Wrap
        }
        Row {
          spacing: Style.space(6)
          Button {
            text: root.busy ? "Installing…" : "Install and start"
            iconText: "󰒋"
            enabled: !root.busy
            foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.body
            onClicked: root.install()
          }
          Button {
            text: "Back"
            enabled: !root.busy
            foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall
            onClicked: { root.error = ""; root.step = "mode" }
          }
        }
      }

      // ---------- done ----------
      Column {
        visible: root.step === "done"
        width: parent.width
        spacing: root.rowSpacing

        Text { text: "󰄬  Connected"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.title; font.bold: true }
        Text {
          width: parent.width
          text: root.result ? (root.result.url + "\n"
            + (root.result.fresh ? "Fresh install — no mailboxes yet." : root.result.accounts + " mailbox" + (root.result.accounts === 1 ? "" : "es") + " connected.") + "\n"
            + (root.result.push
                ? "New mail is pushed" + (root.result.idle ? " (IMAP IDLE → events)" : " (events)") + "."
                : "This server predates push; the plugin polls like a focused tab. Deploy this fork there for instant new mail.")) : ""
          color: root.dim; font.family: root.fontFamily; font.pixelSize: Style.font.bodySmall; wrapMode: Text.Wrap
        }
        Text {
          width: parent.width
          text: "Your agents connect to " + (root.result ? root.result.url : "") + "/mcp with the same token. `amail-plugin mcp-config` prints the snippet."
          color: root.dim; font.family: root.fontFamily; font.pixelSize: Style.font.caption; wrapMode: Text.Wrap
        }
        Row {
          spacing: Style.space(6)
          Button {
            text: root.result && root.result.fresh ? "Open aMail to add mailboxes" : "Go to inbox"
            iconText: root.result && root.result.fresh ? "󰖟" : "󰇮"
            foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.body
            onClicked: { if (root.result && root.result.fresh) widget.openWeb(""); root.finished() }
          }
          Button {
            visible: !(root.result && root.result.fresh)
            text: "Open aMail"
            iconText: "󰖟"
            foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall
            onClicked: { widget.openWeb(""); root.finished() }
          }
        }
      }

      // ---------- settings ----------
      Column {
        visible: root.step === "settings"
        width: parent.width
        spacing: root.rowSpacing

        Text { text: "Settings"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.title; font.bold: true }
        Text {
          width: parent.width
          text: (widget.mode === "server" ? "Server mode · " : "Client mode · ") + widget.url
          color: root.dim; font.family: root.fontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight
        }
        PanelSectionHeader { text: "Bar badge"; foreground: root.foreground; fontFamily: root.fontFamily }
        Row {
          spacing: Style.space(6)
          Button { text: "Unread"; selected: root.badge === "unread"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: { root.badge = "unread"; root.setSetting("badge", "unread") } }
          Button { text: "Not analyzed"; selected: root.badge === "unanalyzed"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: { root.badge = "unanalyzed"; root.setSetting("badge", "unanalyzed") } }
          Button { text: "Both"; selected: root.badge === "both"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: { root.badge = "both"; root.setSetting("badge", "both") } }
        }
        Toggle {
          width: parent.width
          label: "Desktop toasts for new mail"
          description: "Sender, account, and subject. Bodies never go through the notification daemon."
          checked: root.toasts
          foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily
          onClicked: { root.toasts = !root.toasts; root.setSetting("toasts", root.toasts) }
        }
        PanelSeparator { width: parent.width; foreground: root.foreground }
        Row {
          spacing: Style.space(6)
          Button { text: "Change server or token"; iconText: "󰌆"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: { root.error = ""; root.step = "mode" } }
          Button { text: "Open aMail"; iconText: "󰖟"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: { widget.openWeb(""); root.finished() } }
          Button { text: "Done"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: root.finished() }
        }
      }
    }
  }

  // A tappable card with a glyph, a title, and a paragraph — the two mode
  // choices. Local component so the wizard stays one file.
  component OptionCard: Rectangle {
    id: card
    property string icon: ""
    property string title: ""
    property string detail: ""
    signal clicked()
    height: cardRow.implicitHeight + Style.space(20)
    radius: Style.cornerRadius
    color: cardMouse.containsMouse ? Style.hoverFillFor(root.foreground, root.accent) : root.alpha(root.foreground, 0.04)
    border.width: 1
    border.color: cardMouse.containsMouse ? root.alpha(root.accent, 0.6) : root.alpha(root.foreground, 0.12)
    Row {
      id: cardRow
      anchors.left: parent.left; anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
      anchors.margins: Style.space(10)
      spacing: Style.space(12)
      Text { text: card.icon; color: root.accent; font.family: root.fontFamily; font.pixelSize: Style.font.display; anchors.verticalCenter: parent.verticalCenter }
      Column {
        width: parent.width - Style.space(12) - Style.font.display - Style.space(8)
        spacing: Style.space(3)
        Text { width: parent.width; text: card.title; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.subtitle; font.bold: true; wrapMode: Text.Wrap }
        Text { width: parent.width; text: card.detail; color: root.dim; font.family: root.fontFamily; font.pixelSize: Style.font.caption; wrapMode: Text.Wrap }
      }
    }
    MouseArea { id: cardMouse; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: card.clicked() }
  }
}
