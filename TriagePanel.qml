import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// The triage popup. Renders the daemon's conversation list, reads one thread
// on demand through the one-shot CLI, and fires actions the same way. Every
// action is applied optimistically to the local list so the panel feels
// instant; the daemon's next state write (pushed from the server) is the
// source of truth.
Panel {
  id: root
  manageIpc: false

  required property var widget
  required property Item anchorItem

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color accent: Color.accent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property color faint: Qt.darker(foreground, 2.2)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property string runner: widget.runner

  // "unread" | "unanalyzed" | "all"
  property string filter: "unread"
  property int cursor: 0
  property string openId: ""
  property var thread: null
  property string threadError: ""
  property bool threadLoading: false
  property string toast: ""
  property var pending: ({})   // id -> local overrides until the daemon confirms
  property double nowMs: Date.now()
  property bool setupOpen: false
  readonly property bool showSetup: !widget.configured || setupOpen

  readonly property var items: filtered(widget.conversations, filter, pending)
  readonly property var current: items.length > 0 ? items[Math.min(cursor, items.length - 1)] : null

  function alpha(c, a) { return Qt.rgba(c.r, c.g, c.b, a) }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

  function filtered(list, which, overrides) {
    var out = []
    for (var i = 0; i < list.length; i++) {
      var c = Object.assign({}, list[i], overrides[list[i].id] || {})
      if (c._gone) continue
      if (which === "unread" && c.isRead) continue
      if (which === "unanalyzed" && c.isAnalyzed) continue
      out.push(c)
    }
    return out
  }

  function timeLabel(iso) {
    var t = Date.parse(iso || "")
    if (!isFinite(t)) return ""
    var diff = nowMs - t
    if (diff < 60000) return "now"
    if (diff < 3600000) return Math.floor(diff / 60000) + "m"
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h"
    var d = new Date(t)
    if (diff < 6 * 86400000) return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + d.getDate()
  }

  function fullTime(iso) {
    var t = Date.parse(iso || "")
    if (!isFinite(t)) return ""
    var d = new Date(t)
    return d.toLocaleDateString(Qt.locale(), Locale.ShortFormat) + " " + d.toLocaleTimeString(Qt.locale(), Locale.ShortFormat)
  }

  function personLabel(p) {
    if (!p) return ""
    return p.name && p.name !== "" ? p.name : (p.email || "")
  }

  function statusLine() {
    if (!widget.configured) return "Not configured — run: amail-plugin connect <url>"
    if (!widget.online) return "Offline" + (widget.lastError !== "" ? " · " + widget.lastError : "")
    var t = widget.transport === "push" ? "push" : widget.transport === "poll" ? "polling" : widget.transport
    var idle = widget.idle && widget.idle.enabled ? " · IDLE " + widget.idle.connected + "/" + widget.idle.total : ""
    return widget.unread + " unread · " + widget.unanalyzed + " to analyze · " + widget.accounts.length + " accounts · " + t + idle
  }

  // ---------------------------------------------------------------- actions
  Process {
    id: threadProc
    property string forId: ""
    stdout: StdioCollector {
      onStreamFinished: {
        root.threadLoading = false
        try {
          var d = JSON.parse(text.trim())
          if (d.ok !== true) { root.threadError = String(d.error || "could not load"); return }
          if (threadProc.forId !== root.openId) return
          root.thread = d
          root.threadError = ""
          if (widget.online && d.messages && d.messages.some(function(m) { return !m.isRead })) root.override(root.openId, { isRead: true, unreadCount: 0 })
        } catch (e) {
          root.threadError = "unreadable reply from the CLI"
        }
      }
    }
    onExited: function(code) { if (code !== 0 && root.threadError === "") root.threadError = "thread load failed (" + code + ")" }
  }

  function showConversation(id) {
    root.openId = String(id)
    root.thread = null
    root.threadError = ""
    root.threadLoading = true
    threadProc.forId = root.openId
    threadProc.command = [root.runner, "cli", "thread", root.openId]
    if (threadProc.running) threadProc.running = false
    threadProc.running = true
    var idx = -1
    for (var i = 0; i < items.length; i++) if (items[i].id === root.openId) idx = i
    if (idx >= 0) root.cursor = idx
    root.open()
    Qt.callLater(function() { detailFlick.contentY = 0 })
  }

  function backToList() {
    root.openId = ""
    root.thread = null
    root.threadError = ""
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function override(id, patch) {
    var next = Object.assign({}, pending)
    next[id] = Object.assign({}, next[id] || {}, patch)
    root.pending = next
    // Drop the override once the daemon has had a chance to confirm.
    overrideTtl.restart()
  }
  Timer { id: overrideTtl; interval: 8000; onTriggered: root.pending = ({}) }

  Process {
    id: actionProc
    property var queue: []
    stdout: StdioCollector {
      onStreamFinished: {
        try {
          var d = JSON.parse(text.trim())
          if (d.ok !== true) root.flash("✗ " + String(d.error || "action failed"))
        } catch (e) { /* ignore */ }
      }
    }
    onExited: function() {
      if (actionProc.queue.length > 0) {
        var q = actionProc.queue.slice()
        var next = q.shift()
        actionProc.queue = q
        actionProc.command = next
        Qt.callLater(function() { actionProc.running = true })
      }
    }
  }

  function act(id, action) {
    if (!id) return
    var cmd = [root.runner, "cli", "action", String(id), action]
    if (actionProc.running) { var q = actionProc.queue.slice(); q.push(cmd); actionProc.queue = q; return }
    actionProc.command = cmd
    actionProc.running = true
  }

  function flash(text) {
    root.toast = text
    toastTimer.restart()
  }
  Timer { id: toastTimer; interval: 2200; onTriggered: root.toast = "" }

  function target() { return openId !== "" ? openId : (current ? current.id : "") }

  function markAnalyzed() {
    var id = target(); if (!id) return
    override(id, { isAnalyzed: true, unanalyzedCount: 0 })
    act(id, "analyzed"); flash("Marked analyzed")
    if (openId !== "" && filter === "unanalyzed") backToList()
  }
  function markUnanalyzed() {
    var id = target(); if (!id) return
    override(id, { isAnalyzed: false, unanalyzedCount: 1 })
    act(id, "unanalyzed"); flash("Marked not analyzed")
  }
  function toggleRead() {
    var id = target(); if (!id) return
    var c = conversationById(id); if (!c) return
    var read = !c.isRead
    override(id, { isRead: read, unreadCount: read ? 0 : 1 })
    act(id, read ? "read" : "unread"); flash(read ? "Marked read" : "Marked unread")
  }
  function toggleStar() {
    var id = target(); if (!id) return
    var c = conversationById(id); if (!c) return
    override(id, { isStarred: !c.isStarred })
    act(id, c.isStarred ? "unstar" : "star"); flash(c.isStarred ? "Unstarred" : "Starred")
  }
  function archive() {
    var id = target(); if (!id) return
    override(id, { _gone: true })
    act(id, "archive"); flash("Archived")
    if (openId !== "") backToList()
  }
  function trash() {
    var id = target(); if (!id) return
    override(id, { _gone: true })
    act(id, "trash"); flash("Moved to trash")
    if (openId !== "") backToList()
  }
  function conversationById(id) {
    var list = widget.conversations
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return Object.assign({}, list[i], pending[id] || {})
    return null
  }
  function openInWeb() { widget.openWeb(""); root.close() }
  function compose() { widget.openWeb("/?compose=1"); root.close() }
  function refreshNow() { widget.refresh(); flash("Refreshing…") }
  function openSetup(step) {
    root.setupOpen = true
    onboarding.start(step)
  }
  function closeSetup() {
    root.setupOpen = false
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }
  function setFilter(f) { root.filter = f; root.cursor = 0; listView.positionViewAtBeginning() }

  onOpenedChanged: if (opened) {
    nowMs = Date.now()
    widget.refresh()
    if (!widget.configured) openSetup("mode")
    else if (root.setupOpen) onboarding.start()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  } else {
    root.pending = ({})
  }

  Timer { interval: 30000; running: root.opened; repeat: true; onTriggered: root.nowMs = Date.now() }

  onItemsChanged: root.cursor = clamp(root.cursor, 0, Math.max(0, items.length - 1))

  KeyboardPanel {
    id: panelWindow
    anchorItem: root.anchorItem
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panelWindow.fittedContentWidth(Style.space(460))
    contentHeight: panelWindow.fittedContentHeight(Style.space(640), Style.space(720))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      // Text fields in the wizard must receive typing; the catcher would
      // otherwise eat every key as a shortcut.
      blocked: root.showSetup && onboarding.editing

      onMoveRequested: function(dx, dy) {
        if (root.showSetup) return
        if (root.openId !== "") {
          if (dy !== 0) detailFlick.contentY = root.clamp(detailFlick.contentY + dy * Style.space(64), 0, Math.max(0, detailFlick.contentHeight - detailFlick.height))
          if (dx !== 0) root.stepConversation(dx)
          return
        }
        if (dy !== 0) {
          root.cursor = root.clamp(root.cursor + dy, 0, Math.max(0, root.items.length - 1))
          listView.positionViewAtIndex(root.cursor, ListView.Contain)
        }
        if (dx !== 0) root.cycleFilter(dx)
      }
      onActivateRequested: {
        if (root.showSetup) return
        if (root.openId !== "") return
        if (root.current) root.showConversation(root.current.id)
      }
      onReturnRequested: if (root.showSetup) { if (widget.configured) root.closeSetup(); else root.close() } else if (root.openId !== "") root.backToList(); else root.close()
      onCloseRequested: if (root.showSetup) { if (widget.configured) root.closeSetup(); else root.close() } else if (root.openId !== "") root.backToList(); else root.close()
      onDeleteRequested: if (!root.showSetup) root.trash()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (root.showSetup) return
        switch (t) {
          case "j": keyCatcher.moveRequested(0, 1); break
          case "k": keyCatcher.moveRequested(0, -1); break
          case "a": root.markAnalyzed(); break
          case "A": root.markUnanalyzed(); break
          case "e": root.archive(); break
          case "#": root.trash(); break
          case "r": root.toggleRead(); break
          case "s": root.toggleStar(); break
          case "o": root.openInWeb(); break
          case "c": root.compose(); break
          case "R": root.refreshNow(); break
          case "u": if (root.openId !== "") root.backToList(); break
          case "1": root.setFilter("unread"); break
          case "2": root.setFilter("unanalyzed"); break
          case "3": root.setFilter("all"); break
          case "?": root.flash("j/k move · Enter open · a analyzed · e archive · r read · s star · # trash · o web · c compose · 1/2/3 filter"); break
        }
      }

      Column {
        id: column
        anchors.fill: parent
        spacing: Style.space(8)

        // ---------- hero ----------
        PanelHero {
          width: parent.width
          title: "aMail"
          meta: root.statusLine()
          foreground: root.foreground
          fontFamily: root.fontFamily
          iconComponent: Component {
            Text {
              text: "󰇮"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }
          }
          trailingControl: Component {
            Row {
              spacing: Style.space(4)
              PanelActionButton { iconText: "󰑐"; tooltipText: "Refresh (R)"; foreground: root.foreground; fontFamily: root.fontFamily; onClicked: root.refreshNow() }
              PanelActionButton { iconText: "󱞁"; tooltipText: "Compose in aMail (c)"; foreground: root.foreground; fontFamily: root.fontFamily; onClicked: root.compose() }
              PanelActionButton { iconText: "󰖟"; tooltipText: "Open aMail (o)"; foreground: root.foreground; fontFamily: root.fontFamily; onClicked: root.openInWeb() }
              PanelActionButton { iconText: "󰒓"; tooltipText: "Settings"; foreground: root.foreground; fontFamily: root.fontFamily; onClicked: root.showSetup ? root.closeSetup() : root.openSetup() }
            }
          }
        }

        // ---------- filter chips (list mode) ----------
        Row {
          visible: root.openId === "" && !root.showSetup
          width: parent.width
          spacing: Style.space(6)
          Button { text: "Unread"; selected: root.filter === "unread"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: root.setFilter("unread") }
          Button { text: "Not analyzed"; selected: root.filter === "unanalyzed"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: root.setFilter("unanalyzed") }
          Button { text: "Inbox"; selected: root.filter === "all"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: root.setFilter("all") }
          Item { width: Style.space(8); height: 1 }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: root.items.length + (root.filter === "all" ? " of " + widget.inboxTotal : "")
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }

        // ---------- detail header (thread mode) ----------
        Row {
          visible: root.openId !== "" && !root.showSetup
          width: parent.width
          spacing: Style.space(6)
          Button { iconText: "󰁍"; text: "Back"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: root.backToList() }
          Button { iconText: "󰄬"; text: "Analyzed"; tooltipText: "Mark analyzed (a)"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: root.markAnalyzed() }
          Button { iconText: "󰇰"; text: "Archive"; tooltipText: "Archive (e)"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: root.archive() }
          Button { iconText: "󰓎"; tooltipText: "Star (s)"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: root.toggleStar() }
          Button { iconText: "󰇯"; tooltipText: "Toggle read (r)"; foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: root.toggleRead() }
          Button { iconText: "󰩹"; tooltipText: "Trash (#)"; foreground: root.foreground; accent: root.urgent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall; onClicked: root.trash() }
        }

        PanelSeparator { width: parent.width; foreground: root.foreground }

        // ---------- body ----------
        Item {
          id: body
          width: parent.width
          height: column.height - y - footer.height - column.spacing * 2

          Onboarding {
            id: onboarding
            visible: root.showSetup
            anchors.fill: parent
            widget: root.widget
            foreground: root.foreground
            accent: root.accent
            urgent: root.urgent
            fontFamily: root.fontFamily
            canCancel: widget.configured
            onFinished: root.closeSetup()
            onCancelled: root.closeSetup()
          }

          // list
          ListView {
            id: listView
            visible: root.openId === "" && !root.showSetup
            anchors.fill: parent
            clip: true
            model: root.items
            spacing: Style.space(2)
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }
            currentIndex: root.cursor

            delegate: Rectangle {
              id: row
              required property var modelData
              required property int index
              readonly property bool hot: index === root.cursor
              width: listView.width
              height: rowColumn.implicitHeight + Style.space(12)
              radius: Style.cornerRadius
              color: hot ? Style.selectedFillFor(root.foreground, root.accent) : (rowMouse.containsMouse ? Style.hoverFillFor(root.foreground, root.accent) : "transparent")

              Rectangle {
                width: Style.space(3)
                height: parent.height - Style.space(8)
                anchors.left: parent.left
                anchors.leftMargin: Style.space(4)
                anchors.verticalCenter: parent.verticalCenter
                radius: width / 2
                color: modelData.accountColor || root.accent
                opacity: 0.9
              }

              Column {
                id: rowColumn
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.leftMargin: Style.space(14)
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)

                Row {
                  width: parent.width
                  spacing: Style.space(6)
                  Rectangle {
                    anchors.verticalCenter: parent.verticalCenter
                    width: Style.space(7); height: width; radius: width / 2
                    color: root.urgent
                    visible: !modelData.isRead
                  }
                  Text {
                    id: fromText
                    width: parent.width - timeText.width - analyzedMark.width - (modelData.isRead ? 0 : Style.space(13)) - Style.space(12)
                    text: root.personLabel(modelData.from)
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    font.bold: !modelData.isRead
                    elide: Text.ElideRight
                    textFormat: Text.PlainText
                  }
                  Text {
                    id: analyzedMark
                    text: modelData.isAnalyzed ? "" : "󰚩"
                    color: root.accent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    visible: !modelData.isAnalyzed
                    width: visible ? implicitWidth : 0
                  }
                  Text {
                    id: timeText
                    text: root.timeLabel(modelData.latestAt)
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                  }
                }
                Text {
                  width: parent.width
                  text: (modelData.isStarred ? "󰓎 " : "") + (modelData.hasAttachments ? "󰁦 " : "") + modelData.subject
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.bold: !modelData.isRead
                  elide: Text.ElideRight
                  textFormat: Text.PlainText
                }
                Text {
                  width: parent.width
                  text: modelData.accountName + (modelData.snippet !== "" ? "  ·  " + modelData.snippet : "")
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  elide: Text.ElideRight
                  textFormat: Text.PlainText
                }
              }

              MouseArea {
                id: rowMouse
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.LeftButton | Qt.MiddleButton | Qt.RightButton
                onEntered: root.cursor = row.index
                onClicked: function(mouse) {
                  root.cursor = row.index
                  if (mouse.button === Qt.MiddleButton) root.markAnalyzed()
                  else if (mouse.button === Qt.RightButton) root.archive()
                  else root.showConversation(row.modelData.id)
                }
              }
            }

            Text {
              anchors.centerIn: parent
              visible: root.items.length === 0
              width: parent.width - Style.space(32)
              horizontalAlignment: Text.AlignHCenter
              wrapMode: Text.Wrap
              text: !widget.configured ? "Run  amail-plugin connect <url>  to follow your aMail server, or  amail-plugin server install  to run one here."
                : !widget.online ? "aMail is unreachable." + (widget.lastError !== "" ? "\n" + widget.lastError : "")
                : root.filter === "unread" ? "Inbox zero. Nothing unread."
                : root.filter === "unanalyzed" ? "Every message has been analyzed."
                : "The inbox is empty."
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
            }
          }

          // thread detail
          Flickable {
            id: detailFlick
            visible: root.openId !== "" && !root.showSetup
            anchors.fill: parent
            clip: true
            contentWidth: width
            contentHeight: detailColumn.implicitHeight
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

            Column {
              id: detailColumn
              width: detailFlick.width
              spacing: Style.space(10)

              Text {
                width: parent.width
                text: root.thread ? root.thread.thread.subject : (root.current ? root.current.subject : "")
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.subtitle
                font.bold: true
                wrapMode: Text.Wrap
                textFormat: Text.PlainText
              }
              Text {
                visible: root.threadLoading || root.threadError !== ""
                text: root.threadError !== "" ? "✗ " + root.threadError : "Loading…"
                color: root.threadError !== "" ? root.urgent : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
              }

              Repeater {
                model: root.thread ? root.thread.messages : []
                delegate: Column {
                  required property var modelData
                  width: detailColumn.width
                  spacing: Style.space(4)

                  PanelSeparator { width: parent.width; foreground: root.foreground }
                  Row {
                    width: parent.width
                    spacing: Style.space(6)
                    Text {
                      width: parent.width - stamp.width - Style.space(6)
                      text: root.personLabel(modelData.from) + (modelData.from && modelData.from.email && modelData.from.name ? "  <" + modelData.from.email + ">" : "")
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                      font.bold: true
                      elide: Text.ElideRight
                      textFormat: Text.PlainText
                    }
                    Text { id: stamp; text: root.fullTime(modelData.sentAt); color: root.dim; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
                  }
                  Text {
                    width: parent.width
                    visible: text !== ""
                    text: (modelData.to && modelData.to.length ? "to " + modelData.to.map(root.personLabel).join(", ") : "")
                      + (modelData.analyzedBy ? "   · analyzed by " + modelData.analyzedBy : (modelData.isAnalyzed ? "   · analyzed" : "   · not yet analyzed"))
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                    textFormat: Text.PlainText
                  }
                  Text {
                    width: parent.width
                    text: modelData.text !== "" ? modelData.text : "(no text body — open in aMail to view)"
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    wrapMode: Text.Wrap
                    textFormat: Text.PlainText
                  }
                  Text {
                    visible: modelData.attachments && modelData.attachments.length > 0
                    width: parent.width
                    text: modelData.attachments ? "󰁦 " + modelData.attachments.map(function(a) { return a.filename }).join(", ") : ""
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                    textFormat: Text.PlainText
                  }
                }
              }
            }
          }
        }

        // ---------- footer ----------
        Item {
          id: footer
          width: parent.width
          height: Style.space(20)
          Text {
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width
            text: root.toast !== "" ? root.toast
              : root.showSetup ? (widget.configured ? "Esc closes settings" : "aMail setup · Esc closes")
              : (root.openId !== "" ? "u back · a analyzed · e archive · r read · s star · # trash · ←/→ next"
                                   : "j/k move · Enter open · a analyzed · e archive · r read · o web · ? help")
            color: root.toast !== "" ? root.foreground : root.faint
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }
        }
      }
    }
  }

  function debugInfo() {
    return JSON.stringify({
      opened: root.opened, windowOpen: panelWindow.open, windowVisible: panelWindow.visible,
      screen: panelWindow.screen ? panelWindow.screen.name : null,
      contentWidth: panelWindow.contentWidth, contentHeight: panelWindow.contentHeight,
      cardOrigin: [panelWindow.cardOrigin.x, panelWindow.cardOrigin.y],
      anchor: [panelWindow.anchorScreenPos.x, panelWindow.anchorScreenPos.y, panelWindow.anchorW, panelWindow.anchorH],
      barPos: panelWindow.barPos, hasBar: !!root.bar, items: root.items.length,
      columnH: column.height, bodyH: body.height, listVisible: listView.visible
    })
  }

  function stepConversation(dx) {
    if (items.length === 0) return
    var next = clamp(cursor + dx, 0, items.length - 1)
    if (next === cursor && items[next].id === openId) return
    cursor = next
    showConversation(items[next].id)
  }

  function cycleFilter(dx) {
    var order = ["unread", "unanalyzed", "all"]
    var i = order.indexOf(filter)
    setFilter(order[((i + dx) % order.length + order.length) % order.length])
  }
}
