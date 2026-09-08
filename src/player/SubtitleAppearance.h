#ifndef SUBTITLEAPPEARANCE_H
#define SUBTITLEAPPEARANCE_H

#include <QString>
#include <QStringList>
#include <QVariantMap>
#include <QVariantList>

namespace SubtitleAppearance
{
struct Options
{
  bool assScaleBorderAndShadow = true;
  QString assStyleOverride;
  QString placement;
  QString color;
  QString borderColor;
  int borderSize = -1;
  QString backgroundColor;
  QString backgroundTransparency;
  int size = -1;
  QString font;
  bool bold = false;
  bool italic = false;
  int shadowSize = -1;
  QString shadowColor;
};

Options optionsFromSettings(const QVariantMap& values);
QVariantMap mpvProperties(const Options& options);

QString resolveFont(const QString& font);
QString combineColorWithAlpha(const QString& color, const QString& alphaHex);
QString backgroundColor(const QString& color, const QString& alphaHex);
bool appearanceCustomized(const Options& options);

QStringList preferredFonts();
QStringList systemFontFamilies();
QVariantList fontChoices(const QStringList& families, const QString& currentFont);
}

#endif
