import QtQuick
import QtQuick.Controls

Item {
  id: root
  height: 36
  property string label
  property string glyph
  property bool accent: false
  property bool destructive: false
  signal clicked()

  Rectangle {
    anchors.fill: parent
    radius: 10
    color: {
      if (mouseArea.pressed)
        return destructive ? Qt.rgba(0.85, 0.25, 0.25, 0.35) : Qt.rgba(168, 93, 195, 0.35)
      if (mouseArea.containsMouse)
        return destructive ? Qt.rgba(0.85, 0.25, 0.25, 0.18) : Qt.rgba(168, 93, 195, 0.18)
      return "transparent"
    }

    Row {
      anchors.fill: parent
      anchors.leftMargin: 10
      anchors.rightMargin: 10
      spacing: 10

      Text {
        width: 18
        anchors.verticalCenter: parent.verticalCenter
        text: root.glyph
        color: root.destructive ? "#FF8A8A" : (root.accent ? "#D8A8F0" : Qt.rgba(1, 1, 1, 0.82))
        font.pixelSize: 13
        horizontalAlignment: Text.AlignHCenter
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width - 28
        text: root.label
        color: root.destructive ? "#FFB4B4" : "#FFFFFF"
        font.pixelSize: 13
        font.weight: root.accent ? Font.DemiBold : Font.Normal
        elide: Text.ElideRight
      }
    }

    MouseArea {
      id: mouseArea
      anchors.fill: parent
      hoverEnabled: true
      enabled: root.enabled
      z: 1
      propagateComposedEvents: false
      onClicked: function(mouse) {
        mouse.accepted = true
        root.clicked()
      }
    }
  }
}
