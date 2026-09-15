import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// In-panel compose. The full HTML editor, attachments, and signatures live
// in the aMail web app; this is the keyboard-fast path so the plugin can
// send mail without leaving the bar, and so compose works against a server
// whose web client does not yet honour ?compose=1.
Item {
  id: root

  required property var widget
  property color foreground: Color.foreground
  property color accent: Color.accent
  property color urgent: Color.urgent
  property color dim: Qt.darker(foreground, 1.55)
  property string fontFamily: Style.font.family

  property string mode: "new"   // new | reply | reply-all | forward
  property string toText: ""
  property string ccText: ""
  property string subjectText: ""
  property string bodyText: ""
  property string accountId: ""
  property string threadId: ""
  property string replyToMessageId: ""
  property bool showCc: false
  property bool busy: false
  property string error: ""

  readonly property bool editing: toField.activeFocus || ccField.activeFocus || subjectField.activeFocus || bodyArea.activeFocus
  readonly property string titleText: mode === "reply" || mode === "reply-all" ? "Reply" : mode === "forward" ? "Forward" : "New message"

  signal sendRequested(var payload)
  signal cancelled()
  signal openFullEditor()

  function start(initial) {
    var init = initial || {}
    mode = String(init.mode || "new")
    toText = String(init.to || "")
    ccText = String(init.cc || "")
    subjectText = String(init.subject || "")
    bodyText = String(init.body || "")
    threadId = String(init.threadId || "")
    replyToMessageId = String(init.replyToMessageId || "")
    showCc = ccText !== ""
    error = ""
    busy = false
    var accounts = widget.accounts || []
    accountId = String(init.accountId || (accounts.length ? accounts[0].id : ""))
    Qt.callLater(function() { toField.forceActiveFocus() })
  }

  function payload() {
    return {
      to: toText,
      cc: ccText,
      subject: subjectText,
      textBody: bodyText,
      accountId: accountId,
      threadId: threadId,
      replyToMessageId: replyToMessageId
    }
  }

  function send() {
    if (busy) return
    if (String(toText).trim() === "" && String(ccText).trim() === "") {
      error = "Add at least one recipient."
      return
    }
    error = ""
    busy = true
    sendRequested(payload())
  }

  function fail(message) {
    busy = false
    error = String(message || "Could not send")
  }

  function sent() {
    busy = false
    error = ""
  }

  Keys.onPressed: function(event) {
    if (event.key === Qt.Key_Escape) { cancelled(); event.accepted = true; return }
    if ((event.modifiers & Qt.ControlModifier) && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) {
      send(); event.accepted = true
    }
  }

  Column {
    id: column
    anchors.fill: parent
    spacing: Style.space(8)

    Row {
      width: parent.width
      spacing: Style.space(6)
      Text {
        text: root.titleText
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.subtitle
        font.bold: true
        anchors.verticalCenter: parent.verticalCenter
      }
      Item { width: Style.space(8); height: 1 }
      Text {
        visible: widget.accounts && widget.accounts.length > 0
        text: "From"
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        anchors.verticalCenter: parent.verticalCenter
      }
    }

    Flow {
      width: parent.width
      spacing: Style.space(4)
      visible: widget.accounts && widget.accounts.length > 0
      Repeater {
        model: widget.accounts
        delegate: Button {
          required property var modelData
          text: modelData.displayName || modelData.email
          selected: root.accountId === modelData.id
          foreground: root.foreground
          accent: root.accent
          fontFamily: root.fontFamily
          fontSize: Style.font.caption
          onClicked: root.accountId = modelData.id
        }
      }
    }

    PanelSectionHeader { text: "To"; foreground: root.foreground; fontFamily: root.fontFamily }
    TextField {
      id: toField
      width: parent.width
      foreground: root.foreground; accent: root.accent
      placeholderText: "name@example.com"
      text: root.toText
      onTextChanged: root.toText = text
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape) { root.cancelled(); event.accepted = true }
        if ((event.modifiers & Qt.ControlModifier) && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) {
          root.send(); event.accepted = true
        }
      }
    }

    Row {
      spacing: Style.space(6)
      Button {
        text: root.showCc ? "Hide Cc" : "Cc"
        foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.caption
        onClicked: root.showCc = !root.showCc
      }
    }

    TextField {
      id: ccField
      visible: root.showCc
      width: parent.width
      foreground: root.foreground; accent: root.accent
      placeholderText: "Cc"
      text: root.ccText
      onTextChanged: root.ccText = text
    }

    PanelSectionHeader { text: "Subject"; foreground: root.foreground; fontFamily: root.fontFamily }
    TextField {
      id: subjectField
      width: parent.width
      foreground: root.foreground; accent: root.accent
      placeholderText: "Subject"
      text: root.subjectText
      onTextChanged: root.subjectText = text
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape) { root.cancelled(); event.accepted = true }
        if ((event.modifiers & Qt.ControlModifier) && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) {
          root.send(); event.accepted = true
        }
      }
    }

    PanelSectionHeader { text: "Message"; foreground: root.foreground; fontFamily: root.fontFamily }
    TextArea {
      id: bodyArea
      width: parent.width
      height: Math.max(Style.space(140), column.height - y - sendRow.height - column.spacing * 2)
      wrapMode: TextEdit.Wrap
      text: root.bodyText
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      placeholderText: "Write a message. Ctrl+Enter sends."
      onTextChanged: root.bodyText = text
      background: Rectangle {
        radius: Style.cornerRadius
        color: Style.controlFill(bodyArea.activeFocus, false, root.foreground, root.accent)
        border.width: 1
        border.color: bodyArea.activeFocus ? root.accent : root.dim
        opacity: 0.9
      }
      Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Escape) { root.cancelled(); event.accepted = true }
        if ((event.modifiers & Qt.ControlModifier) && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) {
          root.send(); event.accepted = true
        }
      }
    }

    Text {
      visible: root.error !== ""
      width: parent.width
      text: "✗ " + root.error
      color: root.urgent
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
      wrapMode: Text.Wrap
    }

    Row {
      id: sendRow
      spacing: Style.space(6)
      Button {
        text: root.busy ? "Sending…" : "Send"
        iconText: "󰒊"
        enabled: !root.busy
        foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.body
        onClicked: root.send()
      }
      Button {
        text: "Full editor"
        iconText: "󰖟"
        enabled: !root.busy
        foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall
        onClicked: root.openFullEditor()
      }
      Button {
        text: "Cancel"
        enabled: !root.busy
        foreground: root.foreground; accent: root.accent; fontFamily: root.fontFamily; fontSize: Style.font.bodySmall
        onClicked: root.cancelled()
      }
    }
  }
}
