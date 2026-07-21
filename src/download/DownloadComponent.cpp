#include "DownloadComponent.h"

#include "core/ProfileManager.h"
#include "player/PlayerComponent.h"
#include "settings/SettingsComponent.h"
#include "system/SystemComponent.h"

#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QSaveFile>
#include <QTimer>
#include <QSet>
#include <QPointer>
#include <QMultiHash>
#include <QStorageInfo>
#include <memory>
#include <algorithm>
#include <QUrl>
#include <QUrlQuery>

namespace
{
constexpr int kMetadataRequestTimeoutMs = 30000;
constexpr int kDownloadIdleTimeoutMs = 120000;
constexpr int kLibraryFormatVersion = 1;
constexpr char kLibraryDirName[] = "offline-library";
constexpr char kIndexFileName[] = "offline-library.json";
constexpr char kMediaDirName[] = "media";
constexpr char kSubtitlesDirName[] = "subtitles";
constexpr char kItemMetadataFileName[] = "item.json";

QString normalizeServerBase(QString serverUrl)
{
  serverUrl = serverUrl.trimmed();
  if (serverUrl.isEmpty())
    return serverUrl;
  if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://"))
    serverUrl = "http://" + serverUrl;
  while (serverUrl.endsWith('/'))
    serverUrl.chop(1);
  return serverUrl;
}

QString displayTitle(const QJsonObject& item)
{
  if (item.value("Type").toString() == "Episode")
  {
    const QString series = item.value("SeriesName").toString();
    const int season = item.value("ParentIndexNumber").toInt();
    const int episode = item.value("IndexNumber").toInt();
    const QString name = item.value("Name").toString();
    if (!series.isEmpty())
      return QString("%1 S%2E%3 — %4").arg(series).arg(season, 2, 10, QChar('0')).arg(episode, 2, 10, QChar('0')).arg(name);
  }
  return item.value("Name").toString();
}

QString guessExtension(const QNetworkReply* reply, const QJsonObject& item)
{
  const QString disposition = reply->header(QNetworkRequest::ContentDispositionHeader).toString();
  QRegularExpression re(R"(filename=\"?([^\";]+))");
  auto match = re.match(disposition);
  if (match.hasMatch())
  {
    const QString fileName = match.captured(1);
    const int dot = fileName.lastIndexOf('.');
    if (dot >= 0)
      return fileName.mid(dot);
  }

  const QString container = item.value("Container").toString();
  if (!container.isEmpty())
    return "." + container.split(',').value(0).trimmed();

  return ".mkv";
}

QJsonObject compactItemForPlayback(const QJsonObject& item)
{
  if (item.isEmpty())
    return item;

  static const char* kKeys[] = {
    "Id", "Name", "Type", "SeriesName", "SeriesId", "SeasonId", "ServerId",
    "ParentIndexNumber", "IndexNumber", "RunTimeTicks", "Container",
    "MediaSources", "Chapters", "MediaType", "IsFolder"
  };

  QJsonObject compact;
  for (const char* key : kKeys)
  {
    if (item.contains(key))
      compact.insert(key, item.value(key));
  }

  return compact.isEmpty() ? item : compact;
}

bool isValidItemId(const QString& itemId)
{
  if (itemId.isEmpty())
    return false;

  static const QRegularExpression dashedGuidRe(
    QStringLiteral("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"));
  static const QRegularExpression compactGuidRe(QStringLiteral("^[0-9a-fA-F]{32}$"));
  return dashedGuidRe.match(itemId).hasMatch() || compactGuidRe.match(itemId).hasMatch();
}

void setReplyTimeout(QNetworkReply* reply, int ms)
{
  QPointer<QNetworkReply> replyPtr(reply);
  QTimer::singleShot(ms, reply, [replyPtr]() {
    if (replyPtr && !replyPtr->isFinished())
      replyPtr->abort();
  });
}

void attachIdleTimeout(QNetworkReply* reply, QObject* owner, int idleMs)
{
  if (!reply || !owner)
    return;

  QPointer<QNetworkReply> replyPtr(reply);
  auto* idleTimer = new QTimer(owner);
  idleTimer->setSingleShot(true);
  idleTimer->setInterval(idleMs);

  const auto bump = [idleTimer]() {
    idleTimer->start();
  };

  QObject::connect(idleTimer, &QTimer::timeout, owner, [replyPtr]() {
    if (replyPtr && !replyPtr->isFinished())
      replyPtr->abort();
  });
  QObject::connect(reply, &QNetworkReply::downloadProgress, owner, bump);
  QObject::connect(reply, &QNetworkReply::readyRead, owner, bump);
  QObject::connect(reply, &QNetworkReply::finished, owner, [idleTimer]() {
    idleTimer->deleteLater();
  });
  idleTimer->start();
}

QString friendlyDownloadError(const QString& error)
{
  if (error.contains(QStringLiteral("cancel"), Qt::CaseInsensitive)
      || error.contains(QStringLiteral("abort"), Qt::CaseInsensitive))
  {
    return QStringLiteral("Download interrupted. Open Offline Downloads to retry.");
  }
  return error;
}
}

///////////////////////////////////////////////////////////////////////////////////////////////////
DownloadComponent::DownloadComponent(QObject* parent)
  : ComponentBase(parent)
{
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::componentInitialize()
{
  m_networkManager = new QNetworkAccessManager(this);
  m_progressSaveTimer = new QTimer(this);
  m_progressSaveTimer->setSingleShot(true);
  m_progressSaveTimer->setInterval(1000);
  connect(m_progressSaveTimer, &QTimer::timeout, this, &DownloadComponent::flushPendingProgressSaves);
  ensureLibraryLayout();
  migrateLegacyStorage();
  recoverInterruptedDownloads();
  return true;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::componentPostInitialize()
{
  connect(&PlayerComponent::Get(), &PlayerComponent::stopped, this, [this]() {
    if (m_offlineStopGuard > 0)
    {
      m_offlineStopGuard--;
      return;
    }
    if (m_offlinePlaybackActive)
      clearOfflinePlaybackState();
  });

  connect(&PlayerComponent::Get(), &PlayerComponent::playing, this, [this]() {
    if (m_pendingOfflineSubPaths.isEmpty())
      return;

    const QStringList paths = m_pendingOfflineSubPaths;
    m_pendingOfflineSubPaths.clear();
    for (const QString& path : paths)
      PlayerComponent::Get().addExternalSubtitle(path);
  });

  processDownloadQueue();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::clearOfflinePlaybackState()
{
  if (!m_offlinePlaybackActive)
    return;

  m_offlinePlaybackActive = false;
  m_playingOfflineItemId.clear();
  PlayerComponent::Get().setVideoOnlyMode(false);
  emit offlinePlaybackActiveChanged(false);
  emit localPlaybackStopped();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::libraryRoot() const
{
  return ProfileManager::activeProfile().dataDir(QString::fromLatin1(kLibraryDirName));
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::libraryPath() const
{
  return libraryRoot();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::indexPath() const
{
  return libraryRoot() + "/" + QString::fromLatin1(kIndexFileName);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::mediaRoot() const
{
  return libraryRoot() + "/" + QString::fromLatin1(kMediaDirName);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::itemDir(const QString& itemId) const
{
  if (!isValidItemId(itemId))
    return {};
  return mediaRoot() + "/" + itemId;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::invalidateManifestCache() const
{
  m_manifestCacheValid = false;
  m_manifestCache = {};
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::flushPendingProgressSaves()
{
  if (m_pendingProgressUpdates.isEmpty())
    return;

  QJsonArray entries = loadManifest();
  for (auto it = m_pendingProgressUpdates.constBegin(); it != m_pendingProgressUpdates.constEnd(); ++it)
  {
    QJsonObject current = findEntry(entries, it.key());
    if (current.isEmpty())
      continue;

    for (auto field = it.value().constBegin(); field != it.value().constEnd(); ++field)
      current.insert(field.key(), field.value());
    entries = upsertEntry(entries, current);
  }

  m_pendingProgressUpdates.clear();
  saveManifest(entries);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::abortSubtitleDownloads(const QString& itemId)
{
  m_cancelledItems.insert(itemId);
  const auto replies = m_activeSubtitleReplies.values(itemId);
  for (QNetworkReply* reply : replies)
  {
    reply->abort();
    reply->deleteLater();
  }
  m_activeSubtitleReplies.remove(itemId);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::itemMetadataPath(const QString& itemId) const
{
  return itemDir(itemId) + "/" + QString::fromLatin1(kItemMetadataFileName);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::subtitlesDir(const QString& itemId) const
{
  return itemDir(itemId) + "/" + QString::fromLatin1(kSubtitlesDirName);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::ensureLibraryLayout() const
{
  QDir().mkpath(mediaRoot());
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::migrateLegacyStorage() const
{
  const QString legacyRoot = ProfileManager::activeProfile().dataDir("downloads");
  const QString legacyManifest = legacyRoot + "/manifest.json";
  if (!QFile::exists(legacyManifest) || QFile::exists(indexPath()))
    return;

  QFile legacyFile(legacyManifest);
  if (!legacyFile.open(QIODevice::ReadOnly))
    return;

  const QJsonDocument legacyDoc = QJsonDocument::fromJson(legacyFile.readAll());
  if (!legacyDoc.isArray())
    return;

  ensureLibraryLayout();
  QJsonArray migratedItems;
  const QString legacyItems = legacyRoot + "/items";
  for (const QJsonValue& value : legacyDoc.array())
  {
    QJsonObject entry = value.toObject();
    const QString itemId = entry.value("itemId").toString();
    if (itemId.isEmpty())
      continue;

    const QString legacyDir = legacyItems + "/" + itemId;
    const QString newDir = itemDir(itemId);
    QDir().mkpath(newDir);
    if (QDir(legacyDir).exists())
    {
      for (const QFileInfo& file : QDir(legacyDir).entryInfoList(QDir::Files))
      {
        const QString target = newDir + "/" + file.fileName().replace("media.", "video.");
        QFile::rename(file.absoluteFilePath(), target);
        if (entry.value("mediaFile").toString().startsWith("media"))
          entry.insert("mediaFile", file.fileName().replace("media.", "video."));
      }
    }

    saveItemMetadata(itemId, entry);
    migratedItems.append(entry);
  }

  QJsonObject index;
  index.insert("version", kLibraryFormatVersion);
  index.insert("updatedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODate));
  index.insert("libraryPath", libraryRoot());
  index.insert("items", migratedItems);

  QSaveFile indexFile(indexPath());
  if (indexFile.open(QIODevice::WriteOnly))
  {
    indexFile.write(QJsonDocument(index).toJson(QJsonDocument::Indented));
    indexFile.commit();
  }

  QFile::remove(legacyManifest);
  QDir(legacyItems).removeRecursively();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::partFilePath(const QString& itemId) const
{
  return itemDir(itemId) + "/video.part";
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::recoverInterruptedDownloads()
{
  m_activeDownloadCount = 0;
  m_pendingEntries.clear();
  m_downloadQueue.clear();

  for (const QJsonValue& value : loadManifest())
  {
    const QJsonObject entry = value.toObject();
    if (entry.value("status").toString() != "downloading")
      continue;

    const QString itemId = entry.value("itemId").toString();
    const QString accessToken = entry.value("accessToken").toString();
    if (itemId.isEmpty() || accessToken.isEmpty() || !isValidItemId(itemId))
    {
      qWarning() << "DownloadComponent: dropping unrecoverable download entry" << itemId;
      QJsonArray entries = loadManifest();
      saveManifest(removeEntry(entries, itemId));
      if (!itemId.isEmpty())
        QDir(itemDir(itemId)).removeRecursively();
      continue;
    }

    m_pendingEntries.insert(itemId, entry);
    m_downloadQueue.enqueue({ itemId, entry, accessToken });
  }
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::saveItemMetadata(const QString& itemId, const QJsonObject& entry) const
{
  QSaveFile file(itemMetadataPath(itemId));
  if (!file.open(QIODevice::WriteOnly))
    return false;
  file.write(QJsonDocument(entry).toJson(QJsonDocument::Indented));
  return file.commit();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::offlineLibraryUrl() const
{
  return QStringLiteral("qrc:///web-client/extension/offline-library.html");
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QJsonArray DownloadComponent::loadManifest() const
{
  if (m_manifestCacheValid)
    return m_manifestCache;

  QFile file(indexPath());
  if (!file.open(QIODevice::ReadOnly))
  {
    m_manifestCache = {};
    m_manifestCacheValid = true;
    return m_manifestCache;
  }

  const QJsonDocument doc = QJsonDocument::fromJson(file.readAll());
  if (doc.isObject())
    m_manifestCache = doc.object().value("items").toArray();
  else if (doc.isArray())
    m_manifestCache = doc.array();
  else
    m_manifestCache = {};

  m_manifestCacheValid = true;
  return m_manifestCache;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::saveManifest(const QJsonArray& entries) const
{
  QJsonObject index;
  index.insert("version", kLibraryFormatVersion);
  index.insert("updatedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODate));
  index.insert("libraryPath", libraryRoot());
  index.insert("items", entries);

  QSaveFile file(indexPath());
  if (!file.open(QIODevice::WriteOnly))
    return false;

  file.write(QJsonDocument(index).toJson(QJsonDocument::Indented));
  const bool committed = file.commit();
  if (committed)
  {
    m_manifestCache = entries;
    m_manifestCacheValid = true;
  }
  else
  {
    invalidateManifestCache();
  }
  return committed;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QJsonObject DownloadComponent::findEntry(const QJsonArray& entries, const QString& itemId) const
{
  for (const QJsonValue& value : entries)
  {
    const QJsonObject entry = value.toObject();
    if (entry.value("itemId").toString() == itemId)
      return entry;
  }
  return {};
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QJsonObject DownloadComponent::loadEntryForItem(const QString& itemId) const
{
  QJsonObject entry = findEntry(loadManifest(), itemId);
  if (!entry.isEmpty())
    return entry;

  QFile metaFile(itemMetadataPath(itemId));
  if (!metaFile.open(QIODevice::ReadOnly))
    return {};

  return QJsonDocument::fromJson(metaFile.readAll()).object();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QJsonArray DownloadComponent::upsertEntry(const QJsonArray& entries, const QJsonObject& entry) const
{
  QJsonArray updated;
  const QString itemId = entry.value("itemId").toString();
  bool replaced = false;
  for (const QJsonValue& value : entries)
  {
    const QJsonObject existing = value.toObject();
    if (existing.value("itemId").toString() == itemId)
    {
      updated.append(entry);
      replaced = true;
    }
    else
    {
      updated.append(existing);
    }
  }
  if (!replaced)
    updated.append(entry);
  return updated;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QJsonArray DownloadComponent::removeEntry(const QJsonArray& entries, const QString& itemId) const
{
  QJsonArray updated;
  for (const QJsonValue& value : entries)
  {
    if (value.toObject().value("itemId").toString() != itemId)
      updated.append(value);
  }
  return updated;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::hasDownloads() const
{
  return completedDownloadCount() > 0;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
int DownloadComponent::completedDownloadCount() const
{
  int count = 0;
  for (const QJsonValue& value : loadManifest())
  {
    if (value.toObject().value("status").toString() == "complete")
      count++;
  }
  return count;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
int DownloadComponent::activeDownloadCount() const
{
  return m_activeDownloadCount + m_downloadQueue.size();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QVariantList DownloadComponent::listDownloads() const
{
  QVariantList result;
  const QJsonArray entries = loadManifest();
  for (const QJsonValue& value : entries)
  {
    const QJsonObject entry = value.toObject();
    const QString status = entry.value("status").toString();
    if (status == "complete" || status == "downloading")
    {
      QVariantMap row = entry.toVariantMap();
      row.remove(QStringLiteral("accessToken"));
      result.append(row);
    }
  }
  return result;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::listDownloadsJson() const
{
  QJsonArray entries;
  for (const QJsonValue& value : loadManifest())
  {
    const QJsonObject entry = value.toObject();
    const QString status = entry.value("status").toString();
    if (status != "complete" && status != "downloading")
      continue;

    QJsonObject summary;
    summary.insert("itemId", entry.value("itemId").toString());
    summary.insert("title", entry.value("title").toString());
    summary.insert("status", status);
    summary.insert("progress", entry.value("progress").toInt());
    summary.insert("bytesReceived", entry.value("bytesReceived"));
    summary.insert("bytesTotal", entry.value("bytesTotal"));
    summary.insert("fileSize", entry.value("fileSize"));
    summary.insert("downloadedAt", entry.value("downloadedAt").toString());
    summary.insert("type", entry.value("type"));
    const QJsonObject itemJson = entry.value("item").toObject();
    const QString seriesName = entry.value("seriesName").toString().isEmpty()
      ? itemJson.value("SeriesName").toString()
      : entry.value("seriesName").toString();
    const QString seriesId = entry.value("seriesId").toString().isEmpty()
      ? itemJson.value("SeriesId").toString()
      : entry.value("seriesId").toString();
    summary.insert("seriesName", seriesName);
    summary.insert("seriesId", seriesId);
    summary.insert("seasonNumber", itemJson.value("ParentIndexNumber").toInt());
    summary.insert("episodeNumber", itemJson.value("IndexNumber").toInt());
    entries.append(summary);
  }
  return QString::fromUtf8(QJsonDocument(entries).toJson(QJsonDocument::Compact));
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::getLocalPath(const QString& itemId) const
{
  QJsonObject entry = loadEntryForItem(itemId);

  if (entry.isEmpty() || entry.value("status").toString() != "complete")
    return {};

  const QString relativePath = entry.value("mediaFile").toString();
  if (relativePath.isEmpty())
    return {};

  const QString absolutePath = itemDir(itemId) + "/" + relativePath;
  return QFileInfo::exists(absolutePath) ? absolutePath : QString();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QVariantMap DownloadComponent::getLocalPlayback(const QString& itemId) const
{
  QVariantMap result;
  const QJsonObject entry = loadEntryForItem(itemId);
  if (entry.isEmpty() || entry.value("status").toString() != "complete")
    return result;

  const QString mediaPath = getLocalPath(itemId);
  if (mediaPath.isEmpty())
    return result;

  result.insert("mediaPath", mediaPath);
  result.insert("title", entry.value("title"));
  result.insert("metadata", compactItemForPlayback(entry.value("item").toObject()));

  const QJsonArray subtitles = entry.value("subtitles").toArray();
  if (!subtitles.isEmpty())
  {
    const QJsonObject firstSub = subtitles.first().toObject();
    const QString subPath = itemDir(itemId) + "/" + firstSub.value("path").toString();
    if (QFileInfo::exists(subPath))
      result.insert("defaultSubtitlePath", subPath);
    result.insert("subtitles", subtitles.toVariantList());
  }

  return result;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::getLocalPlaybackJson(const QString& itemId) const
{
  const QJsonObject entry = loadEntryForItem(itemId);
  if (entry.isEmpty() || entry.value("status").toString() != "complete")
    return {};

  const QString mediaPath = getLocalPath(itemId);
  if (mediaPath.isEmpty())
    return {};

  QJsonObject payload;
  payload.insert("mediaPath", mediaPath);
  payload.insert("title", entry.value("title"));
  payload.insert("metadata", compactItemForPlayback(entry.value("item").toObject()));

  const QJsonArray subtitles = entry.value("subtitles").toArray();
  if (!subtitles.isEmpty())
  {
    const QJsonObject firstSub = subtitles.first().toObject();
    const QString subPath = itemDir(itemId) + "/" + firstSub.value("path").toString();
    if (QFileInfo::exists(subPath))
      payload.insert("defaultSubtitlePath", subPath);
    payload.insert("subtitles", subtitles);
  }

  return QString::fromUtf8(QJsonDocument(payload).toJson(QJsonDocument::Compact));
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QNetworkRequest DownloadComponent::buildRequest(const QUrl& url, const QString& accessToken) const
{
  QNetworkRequest request(url);
  request.setHeader(QNetworkRequest::UserAgentHeader, SystemComponent::Get().getUserAgent());
  if (!accessToken.isEmpty())
    request.setRawHeader("X-Emby-Token", accessToken.toUtf8());
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
  request.setSslConfiguration(SystemComponent::Get().getSSLConfiguration());
  return request;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
int DownloadComponent::maxConcurrentDownloads() const
{
  const int configured = SettingsComponent::Get().value(SETTINGS_SECTION_MAIN, "maxConcurrentDownloads").toInt();
  return qBound(1, configured > 0 ? configured : 2, 5);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::hasSufficientDiskSpace(qint64 requiredBytes) const
{
  QStorageInfo storage(libraryRoot());
  if (!storage.isValid())
    return true;

  const int bufferMb = SettingsComponent::Get().value(SETTINGS_SECTION_MAIN, "offlineDownloadMinFreeMb").toInt();
  const qint64 bufferBytes = static_cast<qint64>(bufferMb > 0 ? bufferMb : 512) * 1024 * 1024;
  const qint64 estimatedNeed = (requiredBytes > 0 ? requiredBytes : 500LL * 1024 * 1024) + bufferBytes;
  return storage.bytesAvailable() >= estimatedNeed;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::isDownloadQueued(const QString& itemId) const
{
  for (const PendingDownloadRequest& request : m_downloadQueue)
  {
    if (request.itemId == itemId)
      return true;
  }
  return false;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::processDownloadQueue()
{
  while (!m_downloadQueue.isEmpty() && m_activeReplies.size() < maxConcurrentDownloads())
  {
    const PendingDownloadRequest request = m_downloadQueue.dequeue();
    if (m_activeReplies.contains(request.itemId))
      continue;
    if (!getLocalPath(request.itemId).isEmpty())
      continue;

    tryStartMediaDownload(request.itemId, request.entry, request.accessToken);
  }

  emit downloadsChanged();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::tryStartMediaDownload(const QString& itemId, const QJsonObject& entry, const QString& accessToken)
{
  if (m_activeReplies.contains(itemId))
    return;

  m_activeDownloadCount++;
  beginMediaDownload(itemId, entry, accessToken);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::startDownload(const QVariantMap& request)
{
  const QVariantMap itemMap = request.value("item").toMap();
  const QString itemId = itemMap.value("Id").toString();
  const QString accessToken = request.value("accessToken").toString();
  const QString serverUrl = normalizeServerBase(request.value("serverUrl").toString());

  if (itemId.isEmpty() || accessToken.isEmpty() || serverUrl.isEmpty())
  {
    emit downloadFailed(itemId, "Missing item, server URL, or access token");
    return;
  }

  if (!isValidItemId(itemId))
  {
    emit downloadFailed(itemId, "Invalid item ID");
    return;
  }

  if (m_activeReplies.contains(itemId) || isDownloadQueued(itemId))
  {
    emit downloadFailed(itemId, "Download already in progress");
    return;
  }

  m_cancelledItems.remove(itemId);

  if (!getLocalPath(itemId).isEmpty())
  {
    emit downloadComplete(itemId);
    return;
  }

  const QJsonObject existingEntry = findEntry(loadManifest(), itemId);
  if (existingEntry.value("status").toString() == "downloading"
      && !m_activeReplies.contains(itemId) && !isDownloadQueued(itemId))
  {
    QJsonObject resumedEntry = existingEntry;
    resumedEntry.insert("accessToken", accessToken);
    resumedEntry.insert("serverUrl", serverUrl);

    QJsonObject itemJson = QJsonObject::fromVariantMap(itemMap);
    const QVariantMap mediaSourceMap = request.value("mediaSource").toMap();
    if (!mediaSourceMap.isEmpty())
    {
      QJsonArray mediaSources;
      mediaSources.append(QJsonObject::fromVariantMap(mediaSourceMap));
      itemJson.insert("MediaSources", mediaSources);
      if (mediaSourceMap.contains("MediaStreams"))
        itemJson.insert("MediaStreams", QJsonArray::fromVariantList(mediaSourceMap.value("MediaStreams").toList()));
    }
    if (!itemJson.isEmpty())
      resumedEntry.insert("item", itemJson);

    saveManifest(upsertEntry(loadManifest(), resumedEntry));
    m_pendingEntries.insert(itemId, resumedEntry);
    emit downloadsChanged();

    if (m_activeReplies.size() >= maxConcurrentDownloads())
    {
      m_downloadQueue.enqueue({ itemId, resumedEntry, accessToken });
      emit downloadsChanged();
      return;
    }

    tryStartMediaDownload(itemId, resumedEntry, accessToken);
    return;
  }

  qint64 requiredBytes = 0;
  const QVariantMap mediaSourceMap = request.value("mediaSource").toMap();
  if (mediaSourceMap.contains("Size"))
    requiredBytes = mediaSourceMap.value("Size").toLongLong();
  if (requiredBytes <= 0 && itemMap.contains("RunTimeTicks"))
  {
    const qint64 runtimeTicks = itemMap.value("RunTimeTicks").toLongLong();
    if (runtimeTicks > 0)
      requiredBytes = runtimeTicks / 8000;
  }

  if (!hasSufficientDiskSpace(requiredBytes))
  {
    emit downloadFailed(itemId, "Not enough free disk space to save this download");
    return;
  }

  QDir().mkpath(itemDir(itemId));

  QJsonObject itemJson = QJsonObject::fromVariantMap(itemMap);
  if (!mediaSourceMap.isEmpty())
  {
    QJsonArray mediaSources;
    mediaSources.append(QJsonObject::fromVariantMap(mediaSourceMap));
    itemJson.insert("MediaSources", mediaSources);
    if (mediaSourceMap.contains("MediaStreams"))
      itemJson.insert("MediaStreams", QJsonArray::fromVariantList(mediaSourceMap.value("MediaStreams").toList()));
  }

  const qint64 existingBytes = QFileInfo(partFilePath(itemId)).size();
  QJsonObject entry;
  entry.insert("itemId", itemId);
  entry.insert("title", displayTitle(itemJson));
  entry.insert("type", QJsonValue::fromVariant(itemMap.value("Type")));
  entry.insert("seriesName", QJsonValue::fromVariant(itemMap.value("SeriesName")));
  entry.insert("seriesId", QJsonValue::fromVariant(itemMap.value("SeriesId")));
  entry.insert("status", "downloading");
  entry.insert("progress", 0);
  entry.insert("bytesReceived", existingBytes);
  entry.insert("item", itemJson);
  entry.insert("serverUrl", serverUrl);
  entry.insert("accessToken", accessToken);
  entry.insert("downloadedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODate));

  saveManifest(upsertEntry(loadManifest(), entry));
  m_pendingEntries.insert(itemId, entry);
  emit downloadsChanged();

  if (m_activeReplies.size() >= maxConcurrentDownloads())
  {
    m_downloadQueue.enqueue({ itemId, entry, accessToken });
    emit downloadsChanged();
    return;
  }

  tryStartMediaDownload(itemId, entry, accessToken);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::startDownloadFromJellyfinUrl(const QString& urlString, const QString& suggestedTitle, const QString& accessToken)
{
  const QUrl url(urlString);
  const QRegularExpression itemRe(QStringLiteral("/Items/([^/]+)/Download"), QRegularExpression::CaseInsensitiveOption);
  const auto match = itemRe.match(url.path());
  if (!match.hasMatch())
  {
    qWarning() << "startDownloadFromJellyfinUrl: unrecognized URL" << urlString;
    return;
  }

  QString token = accessToken;
  if (token.isEmpty())
  {
    QUrlQuery query(url.query());
    token = query.queryItemValue(QStringLiteral("api_key"));
    if (token.isEmpty())
      token = query.queryItemValue(QStringLiteral("ApiKey"));
  }

  QString serverUrl = url.scheme() + QStringLiteral("://") + url.host();
  if (url.port() > 0)
    serverUrl += QStringLiteral(":") + QString::number(url.port());

  const QString itemId = match.captured(1);
  if (!isValidItemId(itemId))
  {
    qWarning() << "startDownloadFromJellyfinUrl: invalid item ID" << itemId;
    return;
  }

  QString title = suggestedTitle.trimmed();
  if (title.isEmpty())
    title = QStringLiteral("Download %1").arg(itemId.left(8));

  fetchItemAndStartDownload(normalizeServerBase(serverUrl), itemId, token, title);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::fetchItemAndStartDownload(const QString& serverUrl, const QString& itemId, const QString& token, const QString& fallbackTitle)
{
  if (serverUrl.isEmpty() || itemId.isEmpty() || token.isEmpty())
  {
    qWarning() << "fetchItemAndStartDownload: missing server, item, or token";
    return;
  }

  const QUrl itemUrl(serverUrl + "/Items/" + itemId
    + "?Fields=MediaSources,MediaStreams,Chapters,Path,SeriesName,SeriesId,ParentIndexNumber,IndexNumber,Type,Name,RunTimeTicks");

  QNetworkReply* reply = m_networkManager->get(buildRequest(itemUrl, token));
  setReplyTimeout(reply, kMetadataRequestTimeoutMs);

  connect(reply, &QNetworkReply::finished, this, [this, reply, serverUrl, itemId, token, fallbackTitle]() {
    reply->deleteLater();

    QJsonObject item;
    if (reply->error() == QNetworkReply::NoError)
    {
      const QJsonDocument doc = QJsonDocument::fromJson(reply->readAll());
      if (doc.isObject())
        item = doc.object();
    }

    if (item.isEmpty())
    {
      item.insert(QStringLiteral("Id"), itemId);
      item.insert(QStringLiteral("Name"), fallbackTitle);
      item.insert(QStringLiteral("Type"), QStringLiteral("Movie"));
    }

    QVariantMap request;
    request.insert(QStringLiteral("item"), item.toVariantMap());
    request.insert(QStringLiteral("accessToken"), token);
    request.insert(QStringLiteral("serverUrl"), serverUrl);

    const QJsonArray mediaSources = item.value(QStringLiteral("MediaSources")).toArray();
    if (!mediaSources.isEmpty())
      request.insert(QStringLiteral("mediaSource"), mediaSources.first().toObject().toVariantMap());

    startDownload(request);
  });
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::beginMediaDownload(const QString& itemId, const QJsonObject& entry, const QString& accessToken, bool retriedWithoutRange)
{
  const QString serverUrl = entry.value("serverUrl").toString();
  const QUrl url(serverUrl + "/Items/" + itemId + "/Download");

  QDir().mkpath(itemDir(itemId));

  const QString partPath = partFilePath(itemId);
  const qint64 existingBytes = QFileInfo(partPath).size();

  auto* partFile = new QFile(partPath);
  const QIODevice::OpenMode openMode = existingBytes > 0
    ? (QIODevice::WriteOnly | QIODevice::Append)
    : QIODevice::WriteOnly;
  if (!partFile->open(openMode))
  {
    delete partFile;
    failDownload(itemId, "Failed to create download file in offline library");
    return;
  }

  m_activeFiles.insert(itemId, partFile);

  QNetworkRequest request = buildRequest(url, accessToken);
  if (existingBytes > 0)
  {
    request.setRawHeader("Range", QByteArray("bytes=") + QByteArray::number(existingBytes) + "-");
  }

  QNetworkReply* reply = m_networkManager->get(request);
  attachIdleTimeout(reply, this, kDownloadIdleTimeoutMs);
  m_activeReplies.insert(itemId, reply);

  struct StreamState
  {
    QJsonObject entry;
    QString accessToken;
    QString itemId;
    qint64 resumeOffset = 0;
    bool retriedWithoutRange = false;
  };
  auto state = std::make_shared<StreamState>();
  state->entry = entry;
  state->accessToken = accessToken;
  state->itemId = itemId;
  state->resumeOffset = existingBytes;
  state->retriedWithoutRange = retriedWithoutRange;

  connect(reply, &QNetworkReply::readyRead, this, [this, itemId, reply]() {
    QFile* partFile = m_activeFiles.value(itemId);
    if (!partFile)
      return;

    const QByteArray chunk = reply->readAll();
    if (chunk.isEmpty())
      return;

    if (partFile->write(chunk) != chunk.size())
      reply->abort();
  });

  connect(reply, &QNetworkReply::downloadProgress, this, [this, itemId, state](qint64 received, qint64 total) {
    const qint64 absoluteReceived = state->resumeOffset + received;
    const qint64 absoluteTotal = state->resumeOffset + total;
    QJsonObject update;
    update.insert("progress", absoluteTotal > 0 ? static_cast<int>((absoluteReceived * 100) / absoluteTotal) : 0);
    update.insert("bytesReceived", absoluteReceived);
    update.insert("bytesTotal", absoluteTotal);
    m_pendingProgressUpdates.insert(itemId, update);
    if (!m_progressSaveTimer->isActive())
      m_progressSaveTimer->start();
    emit downloadProgress(itemId, absoluteReceived, absoluteTotal);
  });

  connect(reply, &QNetworkReply::finished, this, [this, itemId, state, reply]() {
    flushPendingProgressSaves();
    m_activeReplies.remove(itemId);
    QFile* partFile = m_activeFiles.take(itemId);
    reply->deleteLater();

    const QString partPath = partFilePath(itemId);
    const bool cancelled = m_cancelledItems.contains(itemId);

    if (reply->error() != QNetworkReply::NoError)
    {
      if (partFile)
      {
        partFile->close();
        delete partFile;
      }

      if (state->resumeOffset > 0 && !state->retriedWithoutRange)
      {
        state->retriedWithoutRange = true;
        QFile::remove(partPath);
        beginMediaDownload(itemId, state->entry, state->accessToken, true);
        return;
      }

      const qint64 partialSize = QFileInfo(partPath).size();
      if (!cancelled && partialSize > 0)
      {
        interruptDownload(itemId, QStringLiteral("Download interrupted. Open Offline Downloads to retry."));
        return;
      }

      QFile::remove(partPath);
      failDownload(itemId, friendlyDownloadError(reply->errorString()));
      return;
    }

    if (partFile)
    {
      partFile->close();
      delete partFile;
    }

    const QString extension = guessExtension(reply, state->entry.value("item").toObject());
    const QString mediaFileName = QString("video%1").arg(extension);
    const QString finalPath = itemDir(itemId) + "/" + mediaFileName;
    if (!QFile::rename(partPath, finalPath))
    {
      failDownload(itemId, "Failed to finalize downloaded video file");
      return;
    }

    QJsonObject updatedEntry = m_pendingEntries.value(itemId, state->entry);
    updatedEntry.insert("mediaFile", mediaFileName);
    updatedEntry.insert("fileSize", QFileInfo(finalPath).size());
    updatedEntry.insert("progress", 100);
    m_pendingEntries.insert(itemId, updatedEntry);

    beginSubtitleDownloads(itemId, updatedEntry, state->accessToken);
  });
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::beginSubtitleDownloads(const QString& itemId, QJsonObject entry, const QString& accessToken)
{
  const QJsonObject item = entry.value("item").toObject();
  QJsonArray streams = item.value("MediaStreams").toArray();
  const QJsonArray mediaSources = item.value("MediaSources").toArray();
  if (streams.isEmpty() && !mediaSources.isEmpty())
    streams = mediaSources.at(0).toObject().value("MediaStreams").toArray();
  const QString serverUrl = entry.value("serverUrl").toString();
  const QString mediaSourceId = mediaSources.isEmpty()
      ? QString()
      : mediaSources.at(0).toObject().value("Id").toString();

  struct SubtitleState
  {
    QJsonObject entry;
    QJsonArray subtitles;
    int pending = 0;
  };

  auto state = std::make_shared<SubtitleState>();
  state->entry = entry;

  const auto finishIfDone = [this, itemId, state]() {
    state->pending--;
    if (state->pending > 0)
      return;
    if (m_cancelledItems.contains(itemId))
      return;
    state->entry.insert("subtitles", state->subtitles);
    finalizeDownload(itemId, state->entry);
  };

  for (const QJsonValue& streamValue : streams)
  {
    const QJsonObject stream = streamValue.toObject();
    if (stream.value("Type").toString() != "Subtitle")
      continue;

    const int index = stream.value("Index").toInt();
    const bool isExternal = stream.value("IsExternal").toBool()
        || stream.value("DeliveryMethod").toString() == "External";
    if (!isExternal)
      continue;

    state->pending++;
    QString language = stream.value("Language").toString();
    if (language.isEmpty())
      language = stream.value("DisplayTitle").toString();
    const QString fileName = QString("subtitle_%1.vtt").arg(index);
    const QString relativePath = QString::fromLatin1(kSubtitlesDirName) + "/" + fileName;
    QDir().mkpath(subtitlesDir(itemId));
    const QString localPath = itemDir(itemId) + "/" + relativePath;

    QUrl subUrl;
    const QString deliveryUrl = stream.value("DeliveryUrl").toString();
    if (deliveryUrl.startsWith("http"))
      subUrl = QUrl(deliveryUrl);
    else if (!mediaSourceId.isEmpty())
      subUrl = QUrl(serverUrl + "/Videos/" + itemId + "/" + mediaSourceId + "/Subtitles/" + QString::number(index) + "/Stream.vtt");
    else if (!deliveryUrl.isEmpty())
      subUrl = QUrl(serverUrl + deliveryUrl);
    else
    {
      state->pending--;
      continue;
    }

    QNetworkReply* reply = m_networkManager->get(buildRequest(subUrl, accessToken));
    setReplyTimeout(reply, kMetadataRequestTimeoutMs);
    m_activeSubtitleReplies.insert(itemId, reply);
    connect(reply, &QNetworkReply::finished, this, [this, itemId, reply, localPath, relativePath, language, index, state, finishIfDone]() {
      m_activeSubtitleReplies.remove(itemId, reply);
      if (m_cancelledItems.contains(itemId))
      {
        reply->deleteLater();
        return;
      }
      if (reply->error() == QNetworkReply::NoError)
      {
        QSaveFile subFile(localPath);
        if (subFile.open(QIODevice::WriteOnly))
        {
          subFile.write(reply->readAll());
          if (subFile.commit())
          {
            QJsonObject subEntry;
            subEntry.insert("path", relativePath);
            subEntry.insert("language", language);
            subEntry.insert("index", index);
            state->subtitles.append(subEntry);
          }
        }
      }
      reply->deleteLater();
      finishIfDone();
    });
  }

  if (state->pending == 0 && !m_cancelledItems.contains(itemId))
    finalizeDownload(itemId, entry);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::finalizeDownload(const QString& itemId, QJsonObject entry)
{
  entry.insert("status", "complete");
  entry.insert("progress", 100);
  entry.insert("downloadedAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODate));
  entry.remove("accessToken");

  saveItemMetadata(itemId, entry);
  saveManifest(upsertEntry(loadManifest(), entry));
  m_pendingEntries.remove(itemId);
  m_activeDownloadCount = qMax(0, m_activeDownloadCount - 1);

  emit downloadComplete(itemId);
  emit downloadsChanged();
  processDownloadQueue();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::interruptDownload(const QString& itemId, const QString& error)
{
  m_pendingProgressUpdates.remove(itemId);
  m_pendingEntries.remove(itemId);
  m_activeDownloadCount = qMax(0, m_activeDownloadCount - 1);

  emit downloadFailed(itemId, error);
  emit downloadsChanged();
  processDownloadQueue();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::failDownload(const QString& itemId, const QString& error)
{
  m_pendingProgressUpdates.remove(itemId);
  abortSubtitleDownloads(itemId);

  if (QFile* partFile = m_activeFiles.take(itemId))
  {
    partFile->close();
    delete partFile;
  }

  QQueue<PendingDownloadRequest> keptQueue;
  while (!m_downloadQueue.isEmpty())
  {
    const PendingDownloadRequest request = m_downloadQueue.dequeue();
    if (request.itemId != itemId)
      keptQueue.enqueue(request);
  }
  m_downloadQueue = keptQueue;

  QJsonArray entries = loadManifest();
  entries = removeEntry(entries, itemId);
  saveManifest(entries);

  QDir(itemDir(itemId)).removeRecursively();
  m_pendingEntries.remove(itemId);
  m_activeDownloadCount = qMax(0, m_activeDownloadCount - 1);
  m_cancelledItems.remove(itemId);

  emit downloadFailed(itemId, error);
  emit downloadsChanged();
  processDownloadQueue();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::cancelDownload(const QString& itemId)
{
  m_pendingProgressUpdates.remove(itemId);
  abortSubtitleDownloads(itemId);

  if (QNetworkReply* reply = m_activeReplies.take(itemId))
  {
    reply->abort();
    reply->deleteLater();
  }
  if (QFile* partFile = m_activeFiles.take(itemId))
  {
    partFile->close();
    delete partFile;
  }

  QQueue<PendingDownloadRequest> keptQueue;
  while (!m_downloadQueue.isEmpty())
  {
    const PendingDownloadRequest request = m_downloadQueue.dequeue();
    if (request.itemId != itemId)
      keptQueue.enqueue(request);
  }
  m_downloadQueue = keptQueue;

  deleteDownload(itemId);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::deleteDownload(const QString& itemId)
{
  if (m_playingOfflineItemId == itemId && m_offlinePlaybackActive)
    stopLocalPlayback();

  m_pendingProgressUpdates.remove(itemId);
  abortSubtitleDownloads(itemId);

  if (QNetworkReply* reply = m_activeReplies.take(itemId))
  {
    reply->abort();
    reply->deleteLater();
  }
  if (QFile* partFile = m_activeFiles.take(itemId))
  {
    partFile->close();
    delete partFile;
  }

  QQueue<PendingDownloadRequest> keptQueue;
  while (!m_downloadQueue.isEmpty())
  {
    const PendingDownloadRequest request = m_downloadQueue.dequeue();
    if (request.itemId != itemId)
      keptQueue.enqueue(request);
  }
  m_downloadQueue = keptQueue;

  const QJsonObject existing = findEntry(loadManifest(), itemId);
  if (existing.value("status").toString() == "downloading")
    m_activeDownloadCount = qMax(0, m_activeDownloadCount - 1);

  saveManifest(removeEntry(loadManifest(), itemId));
  QDir(itemDir(itemId)).removeRecursively();
  m_pendingEntries.remove(itemId);
  m_cancelledItems.remove(itemId);
  emit downloadsChanged();
  processDownloadQueue();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::playLocal(const QString& itemId)
{
  if (itemId.isEmpty())
    return false;

  const QVariantMap playback = getLocalPlayback(itemId);
  if (playback.isEmpty())
    return false;

  if (!PlayerComponent::Get().isMpvReady())
  {
    qWarning() << "DownloadComponent::playLocal: mpv not ready for" << itemId;
    return false;
  }

  const QString mediaPath = playback.value("mediaPath").toString();
  const QUrl fileUrl = QUrl::fromLocalFile(mediaPath);

  QVariantMap options;
  options.insert("startMilliseconds", 0);
  options.insert("autoplay", true);

  QVariantMap metadata;
  metadata.insert("type", "video");
  metadata.insert("metadata", playback.value("metadata"));

  QVariant subtitleParam = QVariant(1);
  m_pendingOfflineSubPaths.clear();
  const QJsonArray subtitles = loadEntryForItem(itemId).value("subtitles").toArray();
  bool attachedPrimarySubtitle = false;
  for (const QJsonValue& subValue : subtitles)
  {
    const QJsonObject sub = subValue.toObject();
    const QString relativePath = sub.value("path").toString();
    if (relativePath.isEmpty())
      continue;

    const QString subPath = itemDir(itemId) + "/" + relativePath;
    if (!QFileInfo::exists(subPath))
      continue;

    if (!attachedPrimarySubtitle)
    {
      subtitleParam = QString("#,") + QUrl::fromLocalFile(subPath).toString(QUrl::FullyEncoded);
      attachedPrimarySubtitle = true;
    }
    else
    {
      m_pendingOfflineSubPaths.append(subPath);
    }
  }

  const QVariantMap item = playback.value("metadata").toMap();
  PlayerComponent::Get().setVideoRectangle(-1, -1, -1, -1);
  PlayerComponent::Get().setVideoOnlyMode(true);
  PlayerComponent::Get().notifyMetadata(item);
  m_offlineStopGuard++;
  PlayerComponent::Get().load(fileUrl.toString(QUrl::FullyEncoded), options, metadata, 1, subtitleParam);

  m_offlinePlaybackActive = true;
  m_playingOfflineItemId = itemId;
  emit offlinePlaybackActiveChanged(true);
  emit localPlaybackStarted(itemId);
  emit offlinePlaylistChanged();
  return true;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QStringList DownloadComponent::seriesEpisodeIds(const QString& itemId) const
{
  QStringList ids;
  const QJsonArray manifest = loadManifest();
  const QJsonObject reference = findEntry(manifest, itemId);
  if (reference.isEmpty() || reference.value("status").toString() != "complete")
    return ids;

  const QJsonObject referenceItem = reference.value("item").toObject();
  const QString referenceType = reference.value("type").toString().isEmpty()
    ? referenceItem.value("Type").toString()
    : reference.value("type").toString();
  if (referenceType.compare("Episode", Qt::CaseInsensitive) != 0)
    return ids;

  const QString referenceSeriesId = reference.value("seriesId").toString().isEmpty()
    ? referenceItem.value("SeriesId").toString()
    : reference.value("seriesId").toString();
  const QString referenceSeriesName = reference.value("seriesName").toString().isEmpty()
    ? referenceItem.value("SeriesName").toString()
    : reference.value("seriesName").toString();

  struct EpisodeRow
  {
    QString itemId;
    int season = 0;
    int episode = 0;
  };

  QVector<EpisodeRow> rows;
  for (const QJsonValue& value : manifest)
  {
    const QJsonObject entry = value.toObject();
    if (entry.value("status").toString() != "complete")
      continue;

    const QJsonObject item = entry.value("item").toObject();
    const QString type = entry.value("type").toString().isEmpty()
      ? item.value("Type").toString()
      : entry.value("type").toString();
    if (type.compare("Episode", Qt::CaseInsensitive) != 0)
      continue;

    const QString seriesId = entry.value("seriesId").toString().isEmpty()
      ? item.value("SeriesId").toString()
      : entry.value("seriesId").toString();
    const QString seriesName = entry.value("seriesName").toString().isEmpty()
      ? item.value("SeriesName").toString()
      : entry.value("seriesName").toString();

    const bool sameSeries = (!referenceSeriesId.isEmpty() && seriesId == referenceSeriesId)
      || (referenceSeriesId.isEmpty() && !referenceSeriesName.isEmpty() && seriesName == referenceSeriesName);
    if (!sameSeries)
      continue;

    const QString candidateId = entry.value("itemId").toString();
    if (candidateId.isEmpty() || getLocalPath(candidateId).isEmpty())
      continue;

    EpisodeRow row;
    row.itemId = candidateId;
    row.season = item.value("ParentIndexNumber").toInt();
    row.episode = item.value("IndexNumber").toInt();
    rows.append(row);
  }

  std::sort(rows.begin(), rows.end(), [](const EpisodeRow& a, const EpisodeRow& b) {
    if (a.season != b.season)
      return a.season < b.season;
    return a.episode < b.episode;
  });

  ids.reserve(rows.size());
  for (const EpisodeRow& row : rows)
    ids.append(row.itemId);

  return ids;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::adjacentSeriesEpisodeId(const QString& itemId, int direction) const
{
  if (itemId.isEmpty() || direction == 0)
    return {};

  const QStringList ids = seriesEpisodeIds(itemId);
  const int index = ids.indexOf(itemId);
  if (index < 0)
    return {};

  const int nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= ids.size())
    return {};

  return ids.at(nextIndex);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::offlineHasNext() const
{
  return !adjacentSeriesEpisodeId(m_playingOfflineItemId, 1).isEmpty();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::offlineHasPrevious() const
{
  return !adjacentSeriesEpisodeId(m_playingOfflineItemId, -1).isEmpty();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::playOfflineNext()
{
  const QString nextId = adjacentSeriesEpisodeId(m_playingOfflineItemId, 1);
  return nextId.isEmpty() ? false : playLocal(nextId);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
bool DownloadComponent::playOfflinePrevious()
{
  const QString previousId = adjacentSeriesEpisodeId(m_playingOfflineItemId, -1);
  return previousId.isEmpty() ? false : playLocal(previousId);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::stopLocalPlayback()
{
  if (!m_offlinePlaybackActive)
    return;

  clearOfflinePlaybackState();
  PlayerComponent::Get().stop();
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::setPendingPlayItemId(const QString& itemId)
{
  m_pendingPlayItemId = itemId;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::pendingPlayItemId() const
{
  return m_pendingPlayItemId;
}

///////////////////////////////////////////////////////////////////////////////////////////////////
void DownloadComponent::beginWebClientPlayback(const QString& itemId)
{
  if (itemId.isEmpty())
    return;

  setPendingPlayItemId(itemId);
  emit webClientPlaybackRequested(itemId);
}

///////////////////////////////////////////////////////////////////////////////////////////////////
QString DownloadComponent::takePendingPlayItemId()
{
  const QString itemId = m_pendingPlayItemId;
  m_pendingPlayItemId.clear();
  return itemId;
}
