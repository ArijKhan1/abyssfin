import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window

Item {
  id: root

  property var downloadComponent
  property var playerComponent
  property var hostWindow
  property string currentWebUrl: ""
  property bool panelOpen: false
  property bool streamPlaybackActive: false
  property var downloadItems: []

  readonly property bool onOfflineLibraryPage: currentWebUrl.indexOf("offline-library") >= 0
  readonly property bool offlinePlaybackActive: downloadComponent ? downloadComponent.offlinePlaybackActive : false
  readonly property bool hubVisible: hostWindow && hostWindow.webDesktopMode && !onOfflineLibraryPage
                                   && !streamPlaybackActive && !offlinePlaybackActive
  readonly property bool panelVisible: panelOpen && hubVisible
  readonly property int activeCount: downloadComponent ? downloadComponent.activeDownloadCount : 0
  readonly property int readyCount: downloadComponent ? downloadComponent.completedDownloadCount : 0
  readonly property int panelWidth: 360
  readonly property int panelHeight: {
    const activeHeight = activeItems.length > 0 ? Math.min(192, activeItems.length * 96) + 24 : 0
    const readyHeight = readyItems.length > 0 ? Math.min(288, readyItems.length * 96) + 24 : 0
    const emptyHeight = downloadItems.length === 0 ? 72 : 0
    return 150 + activeHeight + readyHeight + emptyHeight
  }
  readonly property int panelX: {
    const margin = 20
    const maxX = Math.max(margin, root.width - panelWidth - margin)
    return Math.max(margin, Math.min(hubButton.x, maxX))
  }
  readonly property int panelY: {
    const margin = 20
    const preferred = hubButton.y - panelHeight - 10
    const maxY = Math.max(margin, root.height - panelHeight - margin)
    return Math.max(margin, Math.min(preferred, maxY))
  }
  readonly property var activeItems: {
    const items = []
    for (let i = 0; i < downloadItems.length; i++) {
      if (downloadItems[i].status === "downloading")
        items.push(downloadItems[i])
    }
    return items
  }
  readonly property var readyItems: {
    const items = []
    for (let i = 0; i < downloadItems.length; i++) {
      if (downloadItems[i].status === "complete")
        items.push(downloadItems[i])
    }
    return items
  }

  anchors.fill: parent
  visible: hubVisible
  z: 100000
  layer.enabled: true
  layer.smooth: true

  onHubVisibleChanged: {
    if (!hubVisible)
      panelOpen = false
  }

  function markStreamPlaybackActive(active) {
    if (offlinePlaybackActive)
      return
    if (streamPlaybackActive === active)
      return
    streamPlaybackActive = active
    if (active)
      panelOpen = false
  }

  Connections {
    target: playerComponent
    function onPlaying() { root.markStreamPlaybackActive(true) }
    function onBuffering() { root.markStreamPlaybackActive(true) }
    function onPaused() {
      if (root.streamPlaybackActive)
        root.panelOpen = false
    }
    function onStopped() { root.markStreamPlaybackActive(false) }
    function onFinished() { root.markStreamPlaybackActive(false) }
    function onCanceled() { root.markStreamPlaybackActive(false) }
    function onError() { root.markStreamPlaybackActive(false) }
  }

  Connections {
    target: downloadComponent
    function onOfflinePlaybackActiveChanged() {
      if (root.offlinePlaybackActive)
        root.panelOpen = false
    }
  }

  onCurrentWebUrlChanged: {
    if (onOfflineLibraryPage)
      panelOpen = false
  }

  function refreshDownloads() {
    if (!downloadComponent)
      return
    downloadItems = downloadComponent.listDownloads()
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0
    if (value < 1024 * 1024)
      return Math.max(1, Math.round(value / 1024)) + " KB"
    if (value < 1024 * 1024 * 1024)
      return (value / (1024 * 1024)).toFixed(1) + " MB"
    return (value / (1024 * 1024 * 1024)).toFixed(2) + " GB"
  }

  function openLibrary() {
    panelOpen = false
    if (hostWindow)
      hostWindow.openOfflineLibrary()
  }

  Component.onCompleted: refreshDownloads()

  onPanelOpenChanged: if (panelOpen) refreshDownloads()

  Connections {
    target: hostWindow
    function onVisibilityChanged() {
      if (hostWindow.visibility === Window.Hidden || hostWindow.visibility === Window.Minimized)
        panelOpen = false
    }
  }

  Connections {
    target: downloadComponent
    function onDownloadsChanged() { root.refreshDownloads() }
    function onDownloadProgress() {
      if (!progressRefreshTimer.running)
        progressRefreshTimer.start()
    }
  }

  Timer {
    id: progressRefreshTimer
    interval: 500
    repeat: false
    onTriggered: root.refreshDownloads()
  }

  Shortcut {
    sequences: [StandardKey.Cancel]
    enabled: panelVisible
    onActivated: panelOpen = false
  }

  Rectangle {
    anchors.fill: parent
    visible: panelVisible
    color: "#99000000"
    z: 1

    MouseArea {
      anchors.fill: parent
      onClicked: panelOpen = false
    }
  }

  Rectangle {
    id: panelShell
    visible: panelVisible
    z: 2
    x: panelX
    y: panelY
    width: panelWidth
    height: panelHeight
    radius: 16
    color: "#161622"
    border.width: 1
    border.color: "#2A2A3A"
    clip: true

    Column {
      anchors.fill: parent
      anchors.margins: 14
      spacing: 10

      RowLayout {
        width: parent.width
        spacing: 8

        Text {
          text: "Download queue"
          color: "#FFFFFF"
          font.pixelSize: 16
          font.weight: Font.DemiBold
          Layout.fillWidth: true
        }

        Text {
          text: readyCount + " ready"
          color: "#8BE0AE"
          font.pixelSize: 11
          font.weight: Font.Medium
          visible: readyCount > 0
        }

        Text {
          visible: activeCount > 0
          text: activeCount + " active"
          color: "#D8A8F0"
          font.pixelSize: 11
          font.weight: Font.Medium
        }
      }

      Rectangle {
        width: parent.width
        height: 1
        color: "#2A2A3A"
      }

      Text {
        width: parent.width
        visible: activeItems.length > 0
        text: "Downloading"
        color: "#D8A8F0"
        font.pixelSize: 11
        font.weight: Font.Bold
      }

      ListView {
        id: activeList
        width: parent.width
        height: activeItems.length > 0 ? Math.min(192, activeItems.length * 96) : 0
        visible: activeItems.length > 0
        clip: true
        spacing: 8
        model: activeItems
        delegate: downloadRowDelegate
      }

      Text {
        width: parent.width
        visible: readyItems.length > 0
        text: "Ready to watch"
        color: "#8BE0AE"
        font.pixelSize: 11
        font.weight: Font.Bold
      }

      ListView {
        id: readyList
        width: parent.width
        height: readyItems.length > 0 ? Math.min(288, readyItems.length * 96) : 0
        visible: readyItems.length > 0
        clip: true
        spacing: 8
        model: readyItems
        delegate: downloadRowDelegate
      }

      Text {
        width: parent.width
        visible: downloadItems.length === 0
        text: "No downloads yet.\nPlay a movie or episode and tap Download for offline."
        color: "#A8A8B8"
        font.pixelSize: 12
        wrapMode: Text.WordWrap
        horizontalAlignment: Text.AlignHCenter
      }

      RowLayout {
        width: parent.width
        spacing: 8

        Rectangle {
          Layout.fillWidth: true
          height: 36
          radius: 18
          color: openLibraryMouse.pressed ? "#8F4FAE" :
                 openLibraryMouse.containsMouse ? "#9E58BF" : "#A85DC3"

          Text {
            anchors.centerIn: parent
            text: readyCount > 0 ? ("Open library (" + readyCount + ")") : "Open library"
            color: "#FFFFFF"
            font.pixelSize: 12
            font.weight: Font.DemiBold
          }

          MouseArea {
            id: openLibraryMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.openLibrary()
          }
        }

        Rectangle {
          width: 72
          height: 36
          radius: 18
          color: closePanelMouse.pressed ? "#3A3A4A" :
                 closePanelMouse.containsMouse ? "#2E2E3E" : "#242434"
          border.width: 1
          border.color: "#3A3A4A"

          Text {
            anchors.centerIn: parent
            text: "Close"
            color: "#FFFFFF"
            font.pixelSize: 12
          }

          MouseArea {
            id: closePanelMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: panelOpen = false
          }
        }
      }
    }
  }

  Component {
    id: downloadRowDelegate

    Rectangle {
      width: ListView.view ? ListView.view.width : 332
      height: 96
      radius: 14
      color: "#1E1E2C"
      border.width: 1
      border.color: modelData.status === "downloading" ? "#7A4594" : "#343448"

      Column {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 6

        RowLayout {
          width: parent.width
          spacing: 8

          Text {
            text: modelData.title || "Download"
            color: "#FFFFFF"
            font.pixelSize: 13
            font.weight: Font.Medium
            elide: Text.ElideRight
            Layout.fillWidth: true
          }

          Text {
            visible: modelData.status === "downloading"
            text: "Downloading"
            color: "#D8A8F0"
            font.pixelSize: 10
            font.weight: Font.Bold
          }

          Text {
            visible: modelData.status === "complete"
            text: "Ready"
            color: "#8BE0AE"
            font.pixelSize: 10
            font.weight: Font.Bold
          }
        }

        Rectangle {
          visible: modelData.status === "downloading"
          width: parent.width
          height: 6
          radius: 3
          color: "#343448"

          Rectangle {
            width: parent.width * Math.max(0, Math.min(1, (modelData.progress || 0) / 100))
            height: parent.height
            radius: 3
            color: "#A85DC3"
          }
        }

        Text {
          width: parent.width
          color: "#B8B8C8"
          font.pixelSize: 11
          text: {
            if (modelData.status === "downloading") {
              const progress = modelData.progress || 0
              const total = modelData.bytesTotal || 0
              if (total > 0)
                return progress + "% · " + root.formatBytes(modelData.bytesReceived) + " / " + root.formatBytes(total)
              return root.formatBytes(modelData.bytesReceived) + " received"
            }
            if (modelData.status === "complete")
              return root.formatBytes(modelData.fileSize) + " saved on this device"
            return ""
          }
        }

        RowLayout {
          width: parent.width
          spacing: 8
          visible: modelData.status === "downloading" || modelData.status === "complete"

          Rectangle {
            visible: modelData.status === "downloading"
            Layout.preferredWidth: 64
            Layout.preferredHeight: 24
            radius: 12
            color: cancelMouse.pressed ? "#5A3040" :
                   cancelMouse.containsMouse ? "#4A2838" : "#3A2030"
            border.width: 1
            border.color: "#6A4060"

            Text {
              anchors.centerIn: parent
              text: "Cancel"
              color: "#FFB0B0"
              font.pixelSize: 10
              font.weight: Font.Medium
            }

            MouseArea {
              id: cancelMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: {
                if (downloadComponent && modelData.itemId)
                  downloadComponent.cancelDownload(modelData.itemId)
              }
            }
          }

          Rectangle {
            visible: modelData.status === "complete"
            Layout.preferredWidth: 56
            Layout.preferredHeight: 24
            radius: 12
            color: playMouse.pressed ? "#3A8058" :
                   playMouse.containsMouse ? "#449868" : "#48B478"

            Text {
              anchors.centerIn: parent
              text: "Play"
              color: "#FFFFFF"
              font.pixelSize: 10
              font.weight: Font.DemiBold
            }

            MouseArea {
              id: playMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: {
                root.panelOpen = false
                if (hostWindow && modelData.itemId)
                  hostWindow.playOfflineItem(modelData.itemId)
              }
            }
          }
        }
      }
    }
  }

  Rectangle {
    id: hubButton
    z: 3
    anchors.left: parent.left
    anchors.bottom: parent.bottom
    anchors.margins: 20
    width: hubRow.implicitWidth + 28
    height: 44
    radius: 22
    color: hubMouse.pressed ? "#7A4594" :
           hubMouse.containsMouse ? "#5E3470" : "#161622"
    border.width: 1
    border.color: activeCount > 0 ? "#A85DC3" : "#3A3A4A"

    Row {
      id: hubRow
      anchors.centerIn: parent
      spacing: 8

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: activeCount > 0 ? "⬇" : "📥"
        font.pixelSize: 14
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: activeCount > 0 ? ("Downloading (" + activeCount + ")") :
              (readyCount > 0 ? ("Offline (" + readyCount + ")") : "Downloads")
        color: "#FFFFFF"
        font.pixelSize: 12
        font.weight: Font.DemiBold
      }

      Rectangle {
        visible: activeCount > 0
        anchors.verticalCenter: parent.verticalCenter
        width: 8
        height: 8
        radius: 4
        color: "#D8A8F0"

        SequentialAnimation on opacity {
          running: activeCount > 0
          loops: Animation.Infinite
          NumberAnimation { to: 0.35; duration: 700 }
          NumberAnimation { to: 1.0; duration: 700 }
        }
      }
    }

    MouseArea {
      id: hubMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: {
        refreshDownloads()
        if (hubMouse.modifiers & Qt.ControlModifier) {
          openLibrary()
          return
        }
        panelOpen = !panelOpen
      }
    }

    ToolTip.visible: hubMouse.containsMouse && !panelOpen
    ToolTip.text: activeCount > 0
                  ? "Show download progress (Ctrl+click opens library)"
                  : "Downloads and offline library (Ctrl+click opens library)"
    ToolTip.delay: 500
  }
}
