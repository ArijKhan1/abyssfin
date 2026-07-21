import QtQuick
import QtQuick.Controls
import QtQuick.Window
import Konvergo 1.0

Window {
  id: trayMenuWindow
  flags: Qt.Popup | Qt.FramelessWindowHint | Qt.NoDropShadowWindowHint | Qt.WindowStaysOnTopHint
  color: "transparent"
  visible: false

  property var hostWindow
  property var inputComponent
  property var playerComponent
  property var windowComponent
  property var systemComponent
  property var downloadComponent

  property int panelWidth: 300
  property int panelHeight: menuColumn.implicitHeight + 28
  property int screenX: 0
  property int screenY: 0
  property int screenWidth: 1920
  property int screenHeight: 1080
  property int panelX: 0
  property int panelY: 0

  width: visible ? screenWidth : panelWidth
  height: visible ? screenHeight : panelHeight
  x: visible ? screenX : panelX
  y: visible ? screenY : panelY

  function closeMenu() {
    visible = false
  }

  function openNearCursor() {
    if (!systemComponent)
      return

    const cursor = systemComponent.globalCursorPosition()
    screenX = cursor.screenX !== undefined ? cursor.screenX : 0
    screenY = cursor.screenY !== undefined ? cursor.screenY : 0
    screenWidth = cursor.screenWidth !== undefined ? cursor.screenWidth : Screen.width
    screenHeight = cursor.screenHeight !== undefined ? cursor.screenHeight : Screen.height

    let menuX = cursor.x - panelWidth / 2
    let menuY = cursor.y + 12

    const margin = 12
    const maxX = screenX + screenWidth - panelWidth - margin
    const maxY = screenY + screenHeight - panelHeight - margin

    if (menuY + panelHeight > screenY + screenHeight - margin)
      menuY = cursor.y - panelHeight - 12
    if (menuX < screenX + margin)
      menuX = screenX + margin
    if (menuX > maxX)
      menuX = maxX

    panelX = menuX
    panelY = Math.max(screenY + margin, menuY)
    visible = true
    requestActivate()
    focusScope.forceActiveFocus()
  }

  function toggleNearCursor() {
    if (visible)
      closeMenu()
    else
      openNearCursor()
  }

  function dispatchAction(action) {
    if (inputComponent)
      inputComponent.sendAction(action)
  }

  Shortcut {
    sequences: [StandardKey.Cancel]
    onActivated: trayMenuWindow.closeMenu()
  }

  FocusScope {
    id: focusScope
    anchors.fill: parent
    focus: true

    MouseArea {
      anchors.fill: parent
      z: 0
      onClicked: trayMenuWindow.closeMenu()
    }

    Rectangle {
      id: glassShell
      z: 1
      x: panelX - screenX
      y: panelY - screenY
      width: panelWidth
      height: panelHeight
      radius: 18
      color: "#00000000"

      MouseArea {
        anchors.fill: parent
        onClicked: function(mouse) { mouse.accepted = true }
      }

      Rectangle {
        anchors.fill: parent
        radius: 18
        color: "#161622"
        opacity: 0.92
        border.width: 1
        border.color: Qt.rgba(1, 1, 1, 0.16)

        Rectangle {
          anchors.left: parent.left
          anchors.right: parent.right
          anchors.top: parent.top
          height: parent.height * 0.45
          radius: 18
          gradient: Gradient {
            GradientStop { position: 0.0; color: Qt.rgba(1, 1, 1, 0.10) }
            GradientStop { position: 1.0; color: Qt.rgba(1, 1, 1, 0.0) }
          }
        }

        Rectangle {
          anchors.fill: parent
          radius: 18
          color: "#00000000"
          border.width: 1
          border.color: Qt.rgba(168, 93, 195, 0.22)
        }
      }

      Column {
        id: menuColumn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: 14
        spacing: 4

        Row {
          width: parent.width
          spacing: 10

          Image {
            width: 28
            height: 28
            source: "qrc:/images/icon.png"
            fillMode: Image.PreserveAspectFit
            smooth: true
          }

          Column {
            width: parent.width - 38
            spacing: 2

            Text {
              text: "Abyssfin"
              color: "#FFFFFF"
              font.pixelSize: 14
              font.weight: Font.DemiBold
            }

            Text {
              width: parent.width
              text: {
                if (!playerComponent)
                  return "Ready to play"
                const title = playerComponent.nowPlayingTitle
                if (title && title.length > 0)
                  return title
                return "Ready to play"
              }
              color: Qt.rgba(1, 1, 1, 0.62)
              font.pixelSize: 11
              elide: Text.ElideRight
              maximumLineCount: 2
              wrapMode: Text.Wrap
            }

            Text {
              visible: playerComponent && playerComponent.playbackState.length > 0
              text: playerComponent ? playerComponent.playbackState : ""
              color: "#A85DC3"
              font.pixelSize: 10
              font.weight: Font.Medium
            }
          }
        }

        Rectangle {
          width: parent.width
          height: 1
          color: Qt.rgba(1, 1, 1, 0.08)
        }

        TrayMenuButton {
          width: parent.width
          label: {
            const count = downloadComponent ? downloadComponent.completedDownloadCount : 0
            return count > 0 ? ("Offline Downloads (" + count + ")") : "Offline Downloads"
          }
          glyph: "⬇"
          accent: downloadComponent && downloadComponent.completedDownloadCount > 0
          onClicked: {
            trayMenuWindow.closeMenu()
            if (hostWindow)
              hostWindow.openOfflineLibrary()
          }
        }

        TrayMenuButton {
          width: parent.width
          label: "Show Window"
          glyph: "▢"
          onClicked: {
            trayMenuWindow.closeMenu()
            if (hostWindow)
              hostWindow.restoreWindow()
          }
        }

        TrayMenuButton {
          width: parent.width
          label: playerComponent && playerComponent.playbackState === "Playing" ? "Pause" : "Play"
          glyph: playerComponent && playerComponent.playbackState === "Playing" ? "❚❚" : "▶"
          accent: true
          onClicked: dispatchAction("play_pause")
        }

        TrayMenuButton {
          width: parent.width
          label: "Previous"
          glyph: "⏮"
          onClicked: dispatchAction("previous")
        }

        TrayMenuButton {
          width: parent.width
          label: "Next"
          glyph: "⏭"
          onClicked: dispatchAction("next")
        }

        TrayMenuButton {
          width: parent.width
          label: "Skip Intro"
          glyph: "⏩"
          onClicked: dispatchAction("skip_intro")
        }

        TrayMenuButton {
          width: parent.width
          label: {
            if (windowComponent && windowComponent.pipMode)
              return "Exit Picture in Picture"
            if (windowComponent && windowComponent.isWayland())
              return "Picture in Picture (unavailable)"
            return "Picture in Picture"
          }
          glyph: "◧"
          enabled: !windowComponent || !windowComponent.isWayland() || windowComponent.pipMode
          opacity: enabled ? 1.0 : 0.45
          onClicked: {
            trayMenuWindow.closeMenu()
            if (windowComponent)
              windowComponent.togglePiP()
          }
        }

        Rectangle {
          width: parent.width
          height: 1
          color: Qt.rgba(1, 1, 1, 0.08)
        }

        TrayMenuButton {
          width: parent.width
          label: "Quit Abyssfin"
          glyph: "✕"
          destructive: true
          onClicked: {
            trayMenuWindow.closeMenu()
            Qt.quit()
          }
        }
      }
    }
  }
}
