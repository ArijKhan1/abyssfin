#ifndef DOWNLOADCOMPONENT_H
#define DOWNLOADCOMPONENT_H

#include "ComponentManager.h"
#include "utils/Utils.h"

#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QJsonArray>
#include <QJsonObject>
#include <QQueue>
#include <QSet>
#include <QTimer>
#include <QMultiHash>

class QFile;

class DownloadComponent : public ComponentBase
{
  Q_OBJECT
  DEFINE_SINGLETON(DownloadComponent);

  Q_PROPERTY(int activeDownloadCount READ activeDownloadCount NOTIFY downloadsChanged)
  Q_PROPERTY(int completedDownloadCount READ completedDownloadCount NOTIFY downloadsChanged)
  Q_PROPERTY(bool offlinePlaybackActive READ offlinePlaybackActive NOTIFY offlinePlaybackActiveChanged)
  Q_PROPERTY(bool offlineHasNext READ offlineHasNext NOTIFY offlinePlaylistChanged)
  Q_PROPERTY(bool offlineHasPrevious READ offlineHasPrevious NOTIFY offlinePlaylistChanged)
  Q_PROPERTY(QString libraryPath READ libraryPath CONSTANT)
  Q_PROPERTY(QString downloadsJson READ listDownloadsJson NOTIFY downloadsChanged)

public:
  const char* componentName() override { return "download"; }
  bool componentExport() override { return true; }
  bool componentInitialize() override;
  void componentPostInitialize() override;

  Q_INVOKABLE bool hasDownloads() const;
  Q_INVOKABLE int activeDownloadCount() const;
  Q_INVOKABLE QVariantList listDownloads() const;
  Q_INVOKABLE QString listDownloadsJson() const;
  Q_INVOKABLE QString getLocalPath(const QString& itemId) const;
  Q_INVOKABLE QVariantMap getLocalPlayback(const QString& itemId) const;
  Q_INVOKABLE QString getLocalPlaybackJson(const QString& itemId) const;
  Q_INVOKABLE void startDownload(const QVariantMap& request);
  Q_INVOKABLE void startDownloadFromJellyfinUrl(const QString& url, const QString& suggestedTitle, const QString& accessToken);
  Q_INVOKABLE void cancelDownload(const QString& itemId);
  Q_INVOKABLE void deleteDownload(const QString& itemId);
  Q_INVOKABLE bool playLocal(const QString& itemId);
  Q_INVOKABLE void stopLocalPlayback();
  Q_INVOKABLE bool playOfflineNext();
  Q_INVOKABLE bool playOfflinePrevious();
  Q_INVOKABLE QString playingOfflineItemId() const { return m_playingOfflineItemId; }
  bool offlinePlaybackActive() const { return m_offlinePlaybackActive; }
  bool offlineHasNext() const;
  bool offlineHasPrevious() const;
  Q_INVOKABLE void beginWebClientPlayback(const QString& itemId);
  Q_INVOKABLE void setPendingPlayItemId(const QString& itemId);
  Q_INVOKABLE QString pendingPlayItemId() const;
  Q_INVOKABLE QString takePendingPlayItemId();
  Q_INVOKABLE QString offlineLibraryUrl() const;
  Q_INVOKABLE QString libraryPath() const;
  Q_INVOKABLE int completedDownloadCount() const;

  Q_SIGNAL void downloadsChanged();
  Q_SIGNAL void downloadProgress(const QString& itemId, qint64 received, qint64 total);
  Q_SIGNAL void downloadComplete(const QString& itemId);
  Q_SIGNAL void downloadFailed(const QString& itemId, const QString& error);
  Q_SIGNAL void webClientPlaybackRequested(const QString& itemId);
  Q_SIGNAL void offlinePlaybackActiveChanged(bool active);
  Q_SIGNAL void localPlaybackStarted(const QString& itemId);
  Q_SIGNAL void localPlaybackStopped();
  Q_SIGNAL void offlinePlaylistChanged();

private Q_SLOTS:
  void flushPendingProgressSaves();

private:
  struct PendingDownloadRequest
  {
    QString itemId;
    QJsonObject entry;
    QString accessToken;
  };

  void clearOfflinePlaybackState();
  void invalidateManifestCache() const;
  void abortSubtitleDownloads(const QString& itemId);
  void processDownloadQueue();
  void tryStartMediaDownload(const QString& itemId, const QJsonObject& entry, const QString& accessToken);
  void fetchItemAndStartDownload(const QString& serverUrl, const QString& itemId, const QString& token, const QString& fallbackTitle);
  void interruptDownload(const QString& itemId, const QString& error);
  bool hasSufficientDiskSpace(qint64 requiredBytes) const;
  int maxConcurrentDownloads() const;
  bool isDownloadQueued(const QString& itemId) const;
  QStringList seriesEpisodeIds(const QString& itemId) const;
  QString adjacentSeriesEpisodeId(const QString& itemId, int direction) const;
  explicit DownloadComponent(QObject* parent = nullptr);

  QString libraryRoot() const;
  QString indexPath() const;
  QString mediaRoot() const;
  QString itemDir(const QString& itemId) const;
  QString itemMetadataPath(const QString& itemId) const;
  QString subtitlesDir(const QString& itemId) const;
  QString partFilePath(const QString& itemId) const;

  void ensureLibraryLayout() const;
  void migrateLegacyStorage() const;
  bool saveItemMetadata(const QString& itemId, const QJsonObject& entry) const;

  QJsonArray loadManifest() const;
  bool saveManifest(const QJsonArray& entries) const;
  QJsonObject findEntry(const QJsonArray& entries, const QString& itemId) const;
  QJsonObject loadEntryForItem(const QString& itemId) const;
  QJsonArray upsertEntry(const QJsonArray& entries, const QJsonObject& entry) const;
  QJsonArray removeEntry(const QJsonArray& entries, const QString& itemId) const;

  QNetworkRequest buildRequest(const QUrl& url, const QString& accessToken) const;

  void beginMediaDownload(const QString& itemId, const QJsonObject& entry, const QString& accessToken, bool retriedWithoutRange = false);
  void beginSubtitleDownloads(const QString& itemId, QJsonObject entry, const QString& accessToken);
  void finalizeDownload(const QString& itemId, QJsonObject entry);
  void failDownload(const QString& itemId, const QString& error);
  void recoverInterruptedDownloads();

  QNetworkAccessManager* m_networkManager = nullptr;
  QTimer* m_progressSaveTimer = nullptr;
  QHash<QString, QNetworkReply*> m_activeReplies;
  QMultiHash<QString, QNetworkReply*> m_activeSubtitleReplies;
  QHash<QString, QJsonObject> m_pendingEntries;
  QHash<QString, QFile*> m_activeFiles;
  QHash<QString, QJsonObject> m_pendingProgressUpdates;
  QQueue<PendingDownloadRequest> m_downloadQueue;
  QSet<QString> m_cancelledItems;
  mutable bool m_manifestCacheValid = false;
  mutable QJsonArray m_manifestCache;
  int m_activeDownloadCount = 0;
  QString m_pendingPlayItemId;
  bool m_offlinePlaybackActive = false;
  QString m_playingOfflineItemId;
  int m_offlineStopGuard = 0;
  QStringList m_pendingOfflineSubPaths;
};

#endif
