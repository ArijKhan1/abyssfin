//
// Created by Tobias Hieta on 24/08/15.
//

#include <QCoreApplication>
#include <QDebug>
#include "InputSocket.h"
#include "Version.h"
#include "Paths.h"
#include "input/InputComponent.h"
#include "settings/SettingsComponent.h"
#include "settings/SettingsSection.h"
#include "ui/WindowManager.h"

namespace {

void sendAutomationReply(LocalJsonServer* server, QLocalSocket* socket, bool ok, const QString& message)
{
  if (!server || !socket)
    return;

  QVariantMap response;
  response.insert("ok", ok);
  response.insert("message", message);
  server->sendMessage(response, socket);
}

bool handleAutomationCommand(LocalJsonServer* server, QLocalSocket* socket, const QVariantMap& map)
{
  if (!SettingsComponent::Get().value(SETTINGS_SECTION_MAIN, "enableAutomationApi").toBool())
  {
    sendAutomationReply(server, socket, false, "Automation API disabled");
    return true;
  }

  const QString cmd = map.value("cmd").toString().toLower();
  if (cmd.isEmpty())
    return false;

  if (cmd == "play")
    InputComponent::Get().sendAction("play");
  else if (cmd == "pause")
    InputComponent::Get().sendAction("pause");
  else if (cmd == "play_pause" || cmd == "toggle_playback")
    InputComponent::Get().sendAction("play_pause");
  else if (cmd == "next")
    InputComponent::Get().sendAction("next");
  else if (cmd == "previous" || cmd == "prev")
    InputComponent::Get().sendAction("previous");
  else if (cmd == "skip_intro")
    InputComponent::Get().sendAction("skip_intro");
  else if (cmd == "pip" || cmd == "toggle_pip")
    WindowManager::Get().togglePiP();
  else if (cmd == "show" || cmd == "raise")
    WindowManager::Get().raiseWindow();
  else if (cmd == "quit" || cmd == "exit")
    QCoreApplication::quit();
  else if (cmd == "fullscreen" || cmd == "toggle_fullscreen")
    WindowManager::Get().toggleFullscreen();
  else if (cmd == "seek")
    InputComponent::Get().seekTo(map.value("position_ms").toLongLong());
  else if (cmd == "volume")
    InputComponent::Get().setVolume(map.value("level").toInt());
  else
  {
    sendAutomationReply(server, socket, false, "Unknown cmd: " + cmd);
    return true;
  }

  sendAutomationReply(server, socket, true, "ok");
  return true;
}

} // namespace

/////////////////////////////////////////////////////////////////////////////////////////
bool InputSocket::initInput()
{
  return m_server->listen();
}

/////////////////////////////////////////////////////////////////////////////////////////
void InputSocket::clientConnected(QLocalSocket* socket)
{
  QVariantMap welcome;
  welcome.insert("version", Version::GetVersionString());
  welcome.insert("builddate", Version::GetBuildDate());
  welcome.insert("automation", true);
  welcome.insert("socket", Paths::socketName("input"));
  welcome.insert("commands", QVariantList{
    "play", "pause", "play_pause", "next", "previous", "skip_intro", "pip", "show", "quit",
    "fullscreen", "seek", "volume"
  });

  m_server->sendMessage(welcome, socket);
}

/////////////////////////////////////////////////////////////////////////////////////////
void InputSocket::messageReceived(QLocalSocket* socket, const QVariant& message)
{
  QVariantMap map = message.toMap();

  if (map.contains("cmd"))
  {
    handleAutomationCommand(m_server, socket, map);
    return;
  }

  if (!map.contains("client") || !map.contains("source") || !map.contains("keycode"))
  {
    qWarning() << "Got packet from client but it was missing the important fields";
    sendAutomationReply(m_server, socket, false, "Missing client/source/keycode fields");
    return;
  }

  qDebug() << "Input from client:" << map.value("client").toString() << " - " <<
               map.value("source").toString() << map.value("keycode").toString();

  emit receivedInput(map.value("source").toString(), map.value("keycode").toString(), KeyPressed);
  sendAutomationReply(m_server, socket, true, "ok");
}
