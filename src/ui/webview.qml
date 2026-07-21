import QtQuick
import Konvergo 1.0
import QtWebEngine
import QtWebChannel
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import Qt.labs.platform as Labs

Window
{
  id: mainWindow
  title: "Abyssfin"
  objectName: "mainWindow"
  width: 1280
  height: 720
  minimumWidth: 213
  minimumHeight: 120
  visible: true
  color: "#000000"

  // Properties previously from KonvergoWindow
  property bool webDesktopMode: true
  property bool showDebugLayer: false
  property string debugInfo: ""
  property string videoInfo: ""
  property string webUrl: ""
  property string currentWebUrl: web.url

  property bool showSystemTrayIcon: webDesktopMode && components.settings.trayIcon
  property string trayTooltip: {
    const title = components.player.nowPlayingTitle
    return title && title.length > 0 ? ("Abyssfin — " + title) : "Abyssfin"
  }


  function dispatchAction(action) {
    if (components && components.input)
      components.input.sendAction(action)
  }

  signal reloadWebClient()

  Component.onCompleted: {
    if (components && components.settings) {
      webUrl = components.settings.getWebClientUrl(webDesktopMode)
    }
  }

  onClosing: function(close) {
    if (showSystemTrayIcon) {
      // Minimize to tray on close.
      close.accepted = false
      mainWindow.hide()
    }
  }

  function toggleFullscreen() {
    visibility = (visibility === Window.FullScreen) ? Window.Windowed : Window.FullScreen
  }

  function toggleDebug() {
    showDebugLayer = !showDebugLayer
  }

  function setFullScreen(enable) {
    visibility = enable ? Window.FullScreen : Window.Windowed
  }

  function minimizeWindow() {
    if (visibility !== Window.FullScreen)
      visibility = Window.Minimized
  }

  function restoreWindow() {
    mainWindow.show()
    mainWindow.raise()
    mainWindow.requestActivate()
  }

  function openOfflineLibrary() {
    web.url = components.download.offlineLibraryUrl()
    restoreWindow()
  }

  function beginWebClientPlayback(itemId) {
    if (!itemId)
      return
    components.download.setPendingPlayItemId(itemId)
    web.url = components.settings.getWebClientUrl(mainWindow.webDesktopMode)
    restoreWindow()
    pendingPlayRetryTimer.startRetry()
  }

  function playOfflineItem(itemId) {
    offlineHub.panelOpen = false
    if (!itemId)
      return false
    const started = components.download.playLocal(itemId)
    if (!started) {
      web.runJavaScript("window.abyssfinOffline && window.abyssfinOffline.showPlaybackFailed && window.abyssfinOffline.showPlaybackFailed()")
    }
    return started
  }

  function runWebAction(action)
  {
    if (mainWindow.webDesktopMode)
      web.triggerWebAction(action)
  }

  Action
  {
    enabled: mainWindow.webDesktopMode
    shortcut:
    {
      if (components.system.isMacos) return "Ctrl+Meta+F"
      return "F11"
    }
    onTriggered: mainWindow.toggleFullscreen()
  }

  Action
  {
    shortcut: "Alt+Return"
    enabled:
    {
      if (mainWindow.webDesktopMode && components.system.isWindows)
        return true;
      return false;
    }
    onTriggered: mainWindow.toggleFullscreen()
  }

  Action
  {
    enabled: mainWindow.webDesktopMode
    shortcut: StandardKey.Close
    onTriggered: mainWindow.close()
  }

  Action
  {
    enabled: mainWindow.webDesktopMode
    shortcut: {
      if (components.system.isMacos) return "Ctrl+M";
      return "Meta+Down";
    }
    onTriggered: mainWindow.minimizeWindow()
  }

  Action
  {
    enabled: mainWindow.webDesktopMode
    shortcut: components.system.isWindows ? "Ctrl+Q" : StandardKey.Quit
    onTriggered: Qt.quit()
  }

  Action
  {
    shortcut: "Ctrl+Shift+D"
    enabled: mainWindow.webDesktopMode
    onTriggered: mainWindow.toggleDebug()
  }

  Action
  {
    shortcut: StandardKey.Copy
    onTriggered: runWebAction(WebEngineView.Copy)
    id: action_copy
  }

  Action
  {
    shortcut: StandardKey.Cut
    onTriggered: runWebAction(WebEngineView.Cut)
    id: action_cut
  }

  Action
  {
    shortcut: StandardKey.Paste
    onTriggered: runWebAction(WebEngineView.Paste)
    id: action_paste
  }

  Action
  {
    shortcut: StandardKey.SelectAll
    onTriggered: runWebAction(WebEngineView.SelectAll)
    id: action_selectall
  }

  Action
  {
    shortcut: StandardKey.Undo
    onTriggered: runWebAction(WebEngineView.Undo)
    id: action_undo
  }

  Action
  {
    shortcut: StandardKey.Redo
    onTriggered: runWebAction(WebEngineView.Redo)
    id: action_redo
  }

  Action
  {
    shortcut: StandardKey.Back
    onTriggered: runWebAction(WebEngineView.Back)
    id: action_back
  }

  Action
  {
    shortcut: StandardKey.Forward
    onTriggered: runWebAction(WebEngineView.Forward)
    id: action_forward
  }

  Action
  {
    enabled: mainWindow.webDesktopMode
    shortcut: "Ctrl+0"
    onTriggered: web.zoomFactor = 1.0
  }

  WebChannel
  {
    id: webChannelObject
  }

  Timer
  {
    id: pendingPlayRetryTimer
    interval: 800
    repeat: true
    property int attempts: 0

    function startRetry() {
      attempts = 0
      restart()
    }

    function stopRetry() {
      stop()
      attempts = 0
    }

    onTriggered: {
      if (components.download.pendingPlayItemId().length === 0) {
        stopRetry()
        return
      }

      attempts++
      if (attempts > 60) {
        stopRetry()
        web.runJavaScript("window.abyssfinPlayback && window.abyssfinPlayback.releaseScrollLock && window.abyssfinPlayback.releaseScrollLock()")
        return
      }

      web.runJavaScript("window.abyssfinOffline && window.abyssfinOffline.tryPlayPending && window.abyssfinOffline.tryPlayPending()")
    }
  }

  Binding
  {
    target: web
    property: "zoomFactor"
    value: 1.0
    when: !components.settings.allowBrowserZoom()
  }

  MpvVideoItem
  {
    id: video
    objectName: "video"
    enabled: true

    width: mainWindow.contentItem.width
    height: mainWindow.contentItem.height
    anchors.left: mainWindow.contentItem.left
    anchors.right: mainWindow.contentItem.right
    anchors.top: mainWindow.contentItem.top
  }

  Item {
    id: offlinePlaybackChrome
    z: 100001
    anchors.fill: parent
    visible: components.download.offlinePlaybackActive
    enabled: visible

    property bool playerPaused: false
    property bool controlsVisible: true
    property bool seeking: false
    property real seekValue: 0
    property int positionMs: 0
    property int durationMs: 0
    property int volumeLevel: 100
    property var audioTracks: []
    property var subtitleTracks: []
    property bool trackMenuOpen: false
    property string trackMenuKind: ""

    readonly property color accentColor: "#A85DC3"
    readonly property color accentHover: "#C07AD6"
    readonly property color accentPressed: "#7A4594"
    readonly property color panelBg: "#161622"
    readonly property color mutedText: "#B8B8C8"

    Connections {
      target: components.player
      function onPlaying() { offlinePlaybackChrome.playerPaused = false }
      function onPaused() { offlinePlaybackChrome.playerPaused = true }
      function onStopped() { offlinePlaybackChrome.playerPaused = false }
      function onMediaTracksChanged() { offlinePlaybackChrome.refreshTracks() }
    }

    function refreshTracks() {
      audioTracks = components.player.listAudioTracks()
      subtitleTracks = components.player.listSubtitleTracks()
    }

    function openTrackMenu(kind) {
      refreshTracks()
      trackMenuKind = kind
      trackMenuOpen = true
      revealControls()
    }

    function closeTrackMenu() {
      trackMenuOpen = false
      trackMenuKind = ""
    }

    function selectTrackEntry(entry) {
      if (!entry)
        return
      if (trackMenuKind === "audio")
        components.player.selectAudioTrack(entry.id)
      else if (entry.external && entry.path)
        components.player.selectExternalSubtitle(entry.path)
      else
        components.player.selectSubtitleTrack(entry.id)
      closeTrackMenu()
      refreshTracks()
      revealControls()
    }

    function revealControls() {
      controlsVisible = true
      hideControlsTimer.restart()
    }

    function togglePlayback() {
      if (playerPaused)
        components.player.play()
      else
        components.player.pause()
      revealControls()
    }

    function seekBy(ms) {
      const pos = components.player.getPosition()
      const dur = components.player.getDuration()
      let next = pos + ms
      if (next < 0)
        next = 0
      if (dur > 0 && next > dur)
        next = dur
      components.player.seekTo(next)
      revealControls()
    }

    function seekToFraction(fraction) {
      const dur = components.player.getDuration()
      if (dur <= 0)
        return
      const clamped = Math.max(0, Math.min(1, fraction))
      components.player.seekTo(Math.floor(dur * clamped))
      positionMs = Math.floor(dur * clamped)
      seekValue = clamped
    }

    function formatTime(ms) {
      const totalSeconds = Math.max(0, Math.floor(ms / 1000))
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      return minutes + ":" + (seconds < 10 ? "0" : "") + seconds
    }

    function setVolumeLevel(level) {
      const clamped = Math.max(0, Math.min(100, Math.round(level)))
      volumeLevel = clamped
      components.player.setVolume(clamped)
      revealControls()
    }

    Component.onCompleted: {
      const current = components.player.volume()
      volumeLevel = current >= 0 ? current : 100
    }

    onVisibleChanged: {
      if (visible) {
        const current = components.player.volume()
        volumeLevel = current >= 0 ? current : 100
        refreshTracks()
      } else {
        closeTrackMenu()
      }
    }

    Timer {
      id: hideControlsTimer
      interval: 4000
      running: offlinePlaybackChrome.visible && !offlinePlaybackChrome.playerPaused
      onTriggered: offlinePlaybackChrome.controlsVisible = false
    }

    Timer {
      interval: 250
      running: offlinePlaybackChrome.visible
      repeat: true
      onTriggered: {
        const pos = components.player.getPosition()
        const dur = components.player.getDuration()
        offlinePlaybackChrome.positionMs = pos
        offlinePlaybackChrome.durationMs = dur
        if (!offlinePlaybackChrome.seeking && dur > 0)
          offlinePlaybackChrome.seekValue = pos / dur
        if (offlinePlaybackChrome.audioTracks.length === 0
            && offlinePlaybackChrome.subtitleTracks.length === 0)
          offlinePlaybackChrome.refreshTracks()
      }
    }

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      propagateComposedEvents: true
      onPositionChanged: offlinePlaybackChrome.revealControls()
      onClicked: function(mouse) {
        offlinePlaybackChrome.revealControls()
        if (mouse.y < offlinePlaybackChrome.height - 160)
          offlinePlaybackChrome.togglePlayback()
      }
    }

    Item {
      id: topChrome
      anchors.top: parent.top
      anchors.left: parent.left
      anchors.right: parent.right
      height: 96
      opacity: offlinePlaybackChrome.controlsVisible ? 1 : 0
      visible: opacity > 0.01

      Behavior on opacity { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }

      Rectangle {
        anchors.fill: parent
        gradient: Gradient {
          GradientStop { position: 0.0; color: "#E6000000" }
          GradientStop { position: 0.55; color: "#80000000" }
          GradientStop { position: 1.0; color: "#00000000" }
        }
      }

      Item {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 20
        height: 38

        Rectangle {
          id: backButton
          width: backRow.implicitWidth + 24
          height: 38
          radius: 19
          color: backMouse.pressed ? offlinePlaybackChrome.accentPressed :
                 backMouse.containsMouse ? "#2A2A3A" : "#CC161622"
          border.width: 1
          border.color: backMouse.containsMouse ? "#A85DC3" : "#343448"

          Row {
            id: backRow
            anchors.centerIn: parent
            spacing: 8

            Text {
              text: "←"
              color: "#FFFFFF"
              font.pixelSize: 14
              font.weight: Font.DemiBold
              anchors.verticalCenter: parent.verticalCenter
            }

            Text {
              text: "Downloads"
              color: "#FFFFFF"
              font.pixelSize: 13
              font.weight: Font.Medium
              anchors.verticalCenter: parent.verticalCenter
            }
          }

          MouseArea {
            id: backMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: components.download.stopLocalPlayback()
          }
        }

        Text {
          anchors.left: backButton.right
          anchors.leftMargin: 14
          anchors.right: fullscreenButton.left
          anchors.rightMargin: 14
          anchors.verticalCenter: backButton.verticalCenter
          horizontalAlignment: Text.AlignHCenter
          verticalAlignment: Text.AlignVCenter
          elide: Text.ElideRight
          maximumLineCount: 2
          wrapMode: Text.WordWrap
          color: "#FFFFFF"
          font.pixelSize: 14
          font.weight: Font.Medium
          text: components.player.nowPlayingTitle
        }

        Rectangle {
          id: fullscreenButton
          anchors.right: parent.right
          anchors.verticalCenter: backButton.verticalCenter
          width: 38
          height: 38
          radius: 19
          color: fullscreenMouse.pressed ? offlinePlaybackChrome.accentPressed :
                 fullscreenMouse.containsMouse ? "#2A2A3A" : "#CC161622"
          border.width: 1
          border.color: fullscreenMouse.containsMouse ? "#A85DC3" : "#343448"

          Text {
            anchors.centerIn: parent
            text: mainWindow.visibility === Window.FullScreen ? "Exit" : "Full"
            color: "#FFFFFF"
            font.pixelSize: 11
            font.weight: Font.Bold
          }

          MouseArea {
            id: fullscreenMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: {
              mainWindow.toggleFullscreen()
              offlinePlaybackChrome.revealControls()
            }
          }
        }
      }
    }

    Item {
      id: bottomChrome
      anchors.bottom: parent.bottom
      anchors.left: parent.left
      anchors.right: parent.right
      height: 196
      opacity: offlinePlaybackChrome.controlsVisible || offlinePlaybackChrome.trackMenuOpen ? 1 : 0
      visible: opacity > 0.01

      Behavior on opacity { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }

      Rectangle {
        anchors.fill: parent
        gradient: Gradient {
          GradientStop { position: 0.0; color: "#00000000" }
          GradientStop { position: 0.35; color: "#80000000" }
          GradientStop { position: 1.0; color: "#E6000000" }
        }
      }

      Column {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: 22
        spacing: 14

        Item {
          width: parent.width
          height: 22

          Rectangle {
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width
            height: 5
            radius: 2.5
            color: "#33FFFFFF"
          }

          Rectangle {
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width * offlinePlaybackChrome.seekValue
            height: 5
            radius: 2.5
            color: offlinePlaybackChrome.accentColor
          }

          Rectangle {
            x: Math.max(0, Math.min(parent.width - width, parent.width * offlinePlaybackChrome.seekValue - width / 2))
            anchors.verticalCenter: parent.verticalCenter
            width: seekMouse.pressed || seekMouse.containsMouse ? 16 : 12
            height: width
            radius: width / 2
            color: "#FFFFFF"
            border.width: 2
            border.color: offlinePlaybackChrome.accentColor

            Behavior on width { NumberAnimation { duration: 120 } }
          }

          MouseArea {
            id: seekMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onPressed: function(mouse) {
              offlinePlaybackChrome.seeking = true
              offlinePlaybackChrome.revealControls()
              offlinePlaybackChrome.seekToFraction(mouse.x / width)
            }
            onPositionChanged: function(mouse) {
              if (pressed)
                offlinePlaybackChrome.seekToFraction(mouse.x / width)
            }
            onReleased: offlinePlaybackChrome.seeking = false
          }
        }

        RowLayout {
          width: parent.width
          spacing: 16

          Text {
            text: offlinePlaybackChrome.formatTime(offlinePlaybackChrome.positionMs)
            color: offlinePlaybackChrome.mutedText
            font.pixelSize: 12
            font.weight: Font.Medium
            Layout.preferredWidth: 48
          }

          Item { Layout.fillWidth: true }

          Row {
            spacing: 12
            Layout.alignment: Qt.AlignHCenter

            Rectangle {
              visible: components.download.offlineHasPrevious
              width: 42
              height: 42
              radius: 21
              opacity: visible ? 1 : 0
              color: prevEpisodeMouse.pressed ? offlinePlaybackChrome.accentPressed :
                     prevEpisodeMouse.containsMouse ? "#2A2A3A" : "#CC161622"
              border.width: 1
              border.color: "#343448"

              Text {
                anchors.centerIn: parent
                text: "⏮"
                color: "#FFFFFF"
                font.pixelSize: 14
              }

              MouseArea {
                id: prevEpisodeMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: components.download.playOfflinePrevious()
              }
            }

            Rectangle {
              width: 42
              height: 42
              radius: 21
              color: seekBackMouse.pressed ? offlinePlaybackChrome.accentPressed :
                     seekBackMouse.containsMouse ? "#2A2A3A" : "#CC161622"
              border.width: 1
              border.color: "#343448"

              Text {
                anchors.centerIn: parent
                text: "−10"
                color: "#FFFFFF"
                font.pixelSize: 11
                font.weight: Font.Bold
              }

              MouseArea {
                id: seekBackMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: offlinePlaybackChrome.seekBy(-10000)
              }
            }

            Rectangle {
              width: 58
              height: 58
              radius: 29
              color: playMouse.pressed ? offlinePlaybackChrome.accentPressed :
                     playMouse.containsMouse ? offlinePlaybackChrome.accentHover : offlinePlaybackChrome.accentColor
              border.width: 1
              border.color: "#D8A8F0"

              Text {
                anchors.centerIn: parent
                anchors.horizontalCenterOffset: offlinePlaybackChrome.playerPaused ? 2 : 0
                text: offlinePlaybackChrome.playerPaused ? "▶" : "❚❚"
                color: "#FFFFFF"
                font.pixelSize: offlinePlaybackChrome.playerPaused ? 20 : 16
                font.weight: Font.Bold
              }

              MouseArea {
                id: playMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: offlinePlaybackChrome.togglePlayback()
              }
            }

            Rectangle {
              width: 42
              height: 42
              radius: 21
              color: seekForwardMouse.pressed ? offlinePlaybackChrome.accentPressed :
                     seekForwardMouse.containsMouse ? "#2A2A3A" : "#CC161622"
              border.width: 1
              border.color: "#343448"

              Text {
                anchors.centerIn: parent
                text: "+10"
                color: "#FFFFFF"
                font.pixelSize: 11
                font.weight: Font.Bold
              }

              MouseArea {
                id: seekForwardMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: offlinePlaybackChrome.seekBy(10000)
              }
            }

            Rectangle {
              visible: components.download.offlineHasNext
              width: 42
              height: 42
              radius: 21
              opacity: visible ? 1 : 0
              color: nextEpisodeMouse.pressed ? offlinePlaybackChrome.accentPressed :
                     nextEpisodeMouse.containsMouse ? "#2A2A3A" : "#CC161622"
              border.width: 1
              border.color: "#343448"

              Text {
                anchors.centerIn: parent
                text: "⏭"
                color: "#FFFFFF"
                font.pixelSize: 14
              }

              MouseArea {
                id: nextEpisodeMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: components.download.playOfflineNext()
              }
            }
          }

          Item { Layout.fillWidth: true }

          Text {
            text: offlinePlaybackChrome.formatTime(offlinePlaybackChrome.durationMs)
            color: offlinePlaybackChrome.mutedText
            font.pixelSize: 12
            font.weight: Font.Medium
            horizontalAlignment: Text.AlignRight
            Layout.preferredWidth: 48
          }
        }

        RowLayout {
          width: parent.width
          spacing: 10

          Rectangle {
            Layout.preferredWidth: 42
            Layout.preferredHeight: 28
            radius: 14
            color: ccMouse.pressed ? offlinePlaybackChrome.accentPressed :
                   ccMouse.containsMouse ? "#2A2A3A" : "#CC161622"
            border.width: 1
            border.color: offlinePlaybackChrome.trackMenuKind === "subtitle"
                          ? offlinePlaybackChrome.accentColor : "#343448"

            Text {
              anchors.centerIn: parent
              text: "CC"
              color: "#FFFFFF"
              font.pixelSize: 11
              font.weight: Font.Bold
            }

            MouseArea {
              id: ccMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: {
                if (offlinePlaybackChrome.trackMenuOpen
                    && offlinePlaybackChrome.trackMenuKind === "subtitle")
                  offlinePlaybackChrome.closeTrackMenu()
                else
                  offlinePlaybackChrome.openTrackMenu("subtitle")
              }
            }
          }

          Rectangle {
            Layout.preferredWidth: 54
            Layout.preferredHeight: 28
            radius: 14
            color: audioMouse.pressed ? offlinePlaybackChrome.accentPressed :
                   audioMouse.containsMouse ? "#2A2A3A" : "#CC161622"
            border.width: 1
            border.color: offlinePlaybackChrome.trackMenuKind === "audio"
                          ? offlinePlaybackChrome.accentColor : "#343448"

            Text {
              anchors.centerIn: parent
              text: "Audio"
              color: "#FFFFFF"
              font.pixelSize: 11
              font.weight: Font.Bold
            }

            MouseArea {
              id: audioMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: {
                if (offlinePlaybackChrome.trackMenuOpen
                    && offlinePlaybackChrome.trackMenuKind === "audio")
                  offlinePlaybackChrome.closeTrackMenu()
                else
                  offlinePlaybackChrome.openTrackMenu("audio")
              }
            }
          }

          Text {
            text: "Vol"
            color: offlinePlaybackChrome.mutedText
            font.pixelSize: 11
            font.weight: Font.Bold
            Layout.preferredWidth: 24
          }

          Item {
            Layout.fillWidth: true
            height: 18

            Rectangle {
              anchors.verticalCenter: parent.verticalCenter
              width: parent.width
              height: 4
              radius: 2
              color: "#33FFFFFF"
            }

            Rectangle {
              anchors.verticalCenter: parent.verticalCenter
              width: parent.width * (offlinePlaybackChrome.volumeLevel / 100)
              height: 4
              radius: 2
              color: offlinePlaybackChrome.accentColor
            }

            Rectangle {
              x: Math.max(0, Math.min(parent.width - width, parent.width * (offlinePlaybackChrome.volumeLevel / 100) - width / 2))
              anchors.verticalCenter: parent.verticalCenter
              width: volumeMouse.pressed || volumeMouse.containsMouse ? 14 : 10
              height: width
              radius: width / 2
              color: "#FFFFFF"
              border.width: 2
              border.color: offlinePlaybackChrome.accentColor
            }

            MouseArea {
              id: volumeMouse
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onPressed: function(mouse) {
                offlinePlaybackChrome.revealControls()
                offlinePlaybackChrome.setVolumeLevel((mouse.x / width) * 100)
              }
              onPositionChanged: function(mouse) {
                if (pressed)
                  offlinePlaybackChrome.setVolumeLevel((mouse.x / width) * 100)
              }
            }
          }

          Text {
            text: offlinePlaybackChrome.volumeLevel + "%"
            color: offlinePlaybackChrome.mutedText
            font.pixelSize: 11
            Layout.preferredWidth: 36
            horizontalAlignment: Text.AlignRight
          }
        }
      }
    }

    Rectangle {
      anchors.fill: parent
      color: "#66000000"
      visible: offlinePlaybackChrome.trackMenuOpen
      z: 20

      MouseArea {
        anchors.fill: parent
        onClicked: offlinePlaybackChrome.closeTrackMenu()
      }

      Rectangle {
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: bottomChrome.top
        anchors.bottomMargin: 10
        width: Math.min(360, parent.width - 48)
        radius: 16
        color: "#161622"
        border.width: 1
        border.color: "#343448"

        Column {
          width: parent.width
          spacing: 0

          Text {
            width: parent.width - 32
            anchors.horizontalCenter: parent.horizontalCenter
            topPadding: 14
            bottomPadding: 10
            horizontalAlignment: Text.AlignHCenter
            color: "#FFFFFF"
            font.pixelSize: 13
            font.weight: Font.DemiBold
            text: offlinePlaybackChrome.trackMenuKind === "audio" ? "Audio track" : "Captions"
          }

          ListView {
            id: trackList
            width: parent.width
            height: Math.min(240, Math.max(40, count * 42))
            clip: true
            model: offlinePlaybackChrome.trackMenuKind === "audio"
                   ? offlinePlaybackChrome.audioTracks
                   : offlinePlaybackChrome.subtitleTracks

            delegate: Rectangle {
              width: trackList.width
              height: 42
              color: modelData.selected ? "#2A2040"
                    : (trackRowMouse.containsMouse ? "#242434" : "transparent")

              Text {
                anchors.left: parent.left
                anchors.leftMargin: 16
                anchors.right: parent.right
                anchors.rightMargin: 16
                anchors.verticalCenter: parent.verticalCenter
                elide: Text.ElideRight
                color: modelData.selected ? "#FFFFFF" : "#D8D8E8"
                font.pixelSize: 12
                font.weight: modelData.selected ? Font.DemiBold : Font.Normal
                text: modelData.title || ("Track " + modelData.id)
              }

              MouseArea {
                id: trackRowMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: offlinePlaybackChrome.selectTrackEntry(modelData)
              }
            }
          }

          Item { width: 1; height: 10 }
        }
      }
    }
  }

  Action {
    enabled: components.download.offlinePlaybackActive && components.download.offlineHasPrevious
    shortcut: "Shift+Left"
    onTriggered: components.download.playOfflinePrevious()
  }

  Action {
    enabled: components.download.offlinePlaybackActive && components.download.offlineHasNext
    shortcut: "Shift+Right"
    onTriggered: components.download.playOfflineNext()
  }

  Action {
    enabled: components.download.offlinePlaybackActive
    shortcut: StandardKey.FullScreen
    onTriggered: mainWindow.toggleFullscreen()
  }

  Action {
    enabled: components.download.offlinePlaybackActive
    shortcut: StandardKey.Cancel
    onTriggered: components.download.stopLocalPlayback()
  }

  Action {
    enabled: components.download.offlinePlaybackActive
    shortcut: "Escape"
    onTriggered: components.download.stopLocalPlayback()
  }

  Action {
    enabled: components.download.offlinePlaybackActive
    shortcut: "Space"
    onTriggered: offlinePlaybackChrome.togglePlayback()
  }

  Action {
    enabled: components.download.offlinePlaybackActive
    shortcut: "Left"
    onTriggered: offlinePlaybackChrome.seekBy(-10000)
  }

  Action {
    enabled: components.download.offlinePlaybackActive
    shortcut: "Right"
    onTriggered: offlinePlaybackChrome.seekBy(10000)
  }

  WebEngineProfile
  {
    id: webProfile
    httpUserAgent: components.system.getUserAgent()
    httpCacheType: WebEngineProfile.DiskHttpCache
    persistentCookiesPolicy: WebEngineProfile.AllowPersistentCookies
    offTheRecord: false
    storageName: "AbyssfinStorage"

    onDownloadRequested: function(download) {
      const url = download.url.toString()
      const suggestedName = download.suggestedFileName || ""
      console.log("Intercepting browser download:", url, suggestedName)

      if (url.indexOf("/Items/") < 0 || url.indexOf("/Download") < 0)
        return

      web.runJavaScript("window.abyssfinOffline && window.abyssfinOffline.downloadFromUrl("
        + JSON.stringify(url) + "," + JSON.stringify(suggestedName) + ")")
    }
  }

  WebEngineView
  {
    id: web
    objectName: "web"
    width: mainWindow.width
    height: mainWindow.height
    z: 100
    enabled: !offlineHub.panelOpen
    backgroundColor: "transparent"

    // this is needed to prevent intermittent(?) black screens when unminizing
    // or resumsing from suspend (linux/{x11/wayland}, possibly others).
    layer.enabled: true

    webChannel: webChannelObject
    profile: webProfile
    settings.errorPageEnabled: false
    settings.localContentCanAccessRemoteUrls: true
    settings.localContentCanAccessFileUrls: true
    settings.allowRunningInsecureContent: true
    settings.playbackRequiresUserGesture: false
    url: mainWindow.webUrl
    focus: true
    property string currentHoveredUrl: ""
    onLinkHovered: function(hoveredUrl)
    {
      web.currentHoveredUrl = hoveredUrl;
    }

    Component.onCompleted:
    {
      console.log("WebEngineView size:", width, "x", height, "backgroundColor:", backgroundColor)
      forceActiveFocus()
      mainWindow.reloadWebClient.connect(reload)

      // Handle CSP workaround from C++
      components.system.pageContentReady.connect(function(html, finalUrl, hadCSP) {
        if (hadCSP) {
          console.log("CSP workaround: navigating to", finalUrl);
          web.url = finalUrl;
        }
      })

      components.download.webClientPlaybackRequested.connect(function(itemId) {
        mainWindow.beginWebClientPlayback(itemId)
      })

      var nativeshell =
      {
        sourceCode: components.system.getNativeShellScript(),
        injectionPoint: WebEngineScript.DocumentCreation,
        worldId: WebEngineScript.MainWorld
      }

      web.userScripts.collection = [ nativeshell ];
    }

    onLoadingChanged: function(loadingInfo)
    {
      // we use a timer here to switch to the webview since
      // it take a few moments for the webview to render
      // after it has loaded.
      //
      if (loadingInfo.status == WebEngineView.LoadStartedStatus)
      {
        console.log("WebEngineLoadRequest starting: " + loadingInfo.url);
      }
      else if (loadingInfo.status == WebEngineView.LoadSucceededStatus)
      {
        console.log("WebEngineLoadRequest success: " + loadingInfo.url);
        const loadedUrl = loadingInfo.url.toString()
        if (!loadedUrl.includes("offline-library.html")
            && components.download.pendingPlayItemId().length > 0) {
          pendingPlayRetryTimer.startRetry()
        }
      }
      else if (loadingInfo.status == WebEngineView.LoadFailedStatus)
      {
        console.log("WebEngineLoadRequest failure: " + loadingInfo.url + " error code: " + loadingInfo.errorCode);
        const failedUrl = loadingInfo.url || ""
        if (failedUrl.startsWith("http") && components.download.hasDownloads()) {
          console.log("Redirecting to offline library after remote load failure")
          web.url = components.download.offlineLibraryUrl()
          return
        }
        errorLabel.visible = true
        errorLabel.text = "Error loading client, this is bad and should not happen<br>" +
                          "You can try to <a href='reload'>reload</a> or head to our <a href='http://jellyfin.org'>support page</a><br><br>Actual Error: <pre>" +
                          loadingInfo.errorString + " [" + loadingInfo.errorCode + "]</pre><br><br>" +
                          "Provide the <a target='_blank' href='file://"+ components.system.logFilePath + "'>logfile</a> as well."
      }
    }

    onNewWindowRequested:
    {
      if (request.userInitiated)
      {
        console.log("Opening external URL: " + web.currentHoveredUrl)
        components.system.openExternalUrl(web.currentHoveredUrl)
      }
    }

    onFullScreenRequested:
    {
      console.log("Request fullscreen: " + request.toggleOn)
      mainWindow.setFullScreen(request.toggleOn)
      request.accept()
    }

    onJavaScriptConsoleMessage: function(level, message, lineNumber, sourceID)
    {
      components.system.jsLog(level, sourceID + ":" + lineNumber + " " + message);
    }

    onCertificateError: function(error)
    {
      console.log(error.url + " :" + error.description + error.error)
      if (components.settings.ignoreSSLErrors()) {
        error.acceptCertificate()
      }
    }
  }

  Text
  {
    id: errorLabel
    z: 5
    anchors.centerIn: parent
    color: "#999999"
    linkColor: "#a85dc3"
    text: "Generic error"
    font.pixelSize: 32
    font.bold: true
    visible: false
    verticalAlignment: Text.AlignVCenter
    textFormat: Text.StyledText
    onLinkActivated:
    {
      if (url == "reload")
      {
        errorLabel.visible = false
        web.reload()
      }
      else
      {
        Qt.openUrlExternally(url)
      }
    }
  }


  Rectangle
  {
    id: debug
    color: "black"
    z: 10
    anchors.centerIn: parent
    width: parent.width
    height: parent.height
    opacity: 0.7
    visible: mainWindow.showDebugLayer

    Text
    {
      id: debugLabel
      width: (parent.width - 50) / 2
      height: parent.height - 25
      anchors.left: parent.left
      anchors.leftMargin: 64
      anchors.top: parent.top
      anchors.topMargin: 54
      anchors.bottomMargin: 54
      color: "white"
      font.pixelSize: Math.round(height / 65)
      wrapMode: Text.WrapAnywhere

      function windowDebug()
      {
        var dbg = mainWindow.debugInfo + "Window and web\n";
        dbg += "  Window size: " + parent.width + "x" + parent.height + " - " + web.width + "x" + web.height + "\n";
        dbg += "  DevicePixel ratio: " + Screen.devicePixelRatio + "\n";

        return dbg;
      }

      text: windowDebug()
    }

    Text
    {
      id: videoLabel
      width: (parent.width - 50) / 2
      height: parent.height - 25
      anchors.right: parent.right
      anchors.left: debugLabel.right
      anchors.rightMargin: 64
      anchors.top: parent.top
      anchors.topMargin: 54
      anchors.bottomMargin: 54
      color: "white"
      font.pixelSize: Math.round(height / 65)
      wrapMode: Text.WrapAnywhere

      text: mainWindow.videoInfo
    }
  }

  property QtObject webChannel: web.webChannel

  TrayMenu {
    id: trayMenu
    hostWindow: mainWindow
    inputComponent: components.input
    playerComponent: components.player
    windowComponent: components.window
    systemComponent: components.system
    downloadComponent: components.download
  }

  OfflineDownloadHub {
    id: offlineHub
    downloadComponent: components.download
    playerComponent: components.player
    hostWindow: mainWindow
    currentWebUrl: mainWindow.currentWebUrl
  }

  Action {
    enabled: mainWindow.webDesktopMode
    shortcut: "Ctrl+Shift+O"
    onTriggered: mainWindow.openOfflineLibrary()
  }

  Labs.SystemTrayIcon {
    visible: showSystemTrayIcon
    icon.source: "qrc:/images/icon.png"
    tooltip: mainWindow.trayTooltip

    onActivated: function(reason) {
      if (reason === Labs.SystemTrayIcon.DoubleClick) {
        trayMenu.closeMenu()
        restoreWindow()
        return
      }

      if (reason === Labs.SystemTrayIcon.Trigger || reason === Labs.SystemTrayIcon.Context) {
        trayMenu.toggleNearCursor()
        components.window.setCursorVisibility(true)
      }
    }
  }
}
