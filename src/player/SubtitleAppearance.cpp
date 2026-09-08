#include "SubtitleAppearance.h"

#include <QFontDatabase>
#include <QSet>
#include <algorithm>

namespace SubtitleAppearance
{
namespace
{
QVariantMap choice(const QString& title, const QVariant& value)
{
  QVariantMap entry;
  entry["title"] = title;
  entry["value"] = value;
  return entry;
}

bool isHiddenFontFamily(const QString& family)
{
  if (family.isEmpty())
    return true;
  if (family.startsWith(QLatin1Char('.')))
    return true;
  if (family.compare(QLatin1String("LastResort"), Qt::CaseInsensitive) == 0)
    return true;
  return false;
}
}

Options optionsFromSettings(const QVariantMap& values)
{
  Options options;
  options.assScaleBorderAndShadow = values.value("ass_scale_border_and_shadow", true).toBool();
  options.assStyleOverride = values.value("ass_style_override").toString();
  options.placement = values.value("placement").toString();
  options.color = values.value("color").toString().trimmed();
  options.borderColor = values.value("border_color").toString().trimmed();
  options.borderSize = values.value("border_size", -1).toInt();
  options.backgroundColor = values.value("background_color").toString().trimmed();
  options.backgroundTransparency = values.value("background_transparency").toString().trimmed();
  options.size = values.value("size", -1).toInt();
  options.font = values.value("font").toString().trimmed();
  options.bold = values.value("bold", false).toBool();
  options.italic = values.value("italic", false).toBool();
  options.shadowSize = values.value("shadow_size", -1).toInt();
  options.shadowColor = values.value("shadow_color").toString().trimmed();
  return options;
}

bool appearanceCustomized(const Options& options)
{
  return !options.color.isEmpty()
      || !options.borderColor.isEmpty()
      || options.borderSize != -1
      || !options.backgroundColor.isEmpty()
      || !options.backgroundTransparency.isEmpty()
      || options.size != -1
      || !options.font.isEmpty()
      || options.bold
      || options.italic
      || options.shadowSize != -1
      || !options.shadowColor.isEmpty();
}

QString combineColorWithAlpha(const QString& color, const QString& alphaHex)
{
  QString combined = color.trimmed();
  if (combined.isEmpty())
    return QString();

  if (!combined.startsWith(QLatin1Char('#')))
    combined.prepend(QLatin1Char('#'));

  if (combined.size() == 9)
    return combined.toUpper();

  if (combined.size() != 7)
    return combined;

  QString alpha = alphaHex.trimmed();
  if (alpha.isEmpty())
    return combined.toUpper();

  if (alpha.startsWith(QLatin1Char('#')))
    alpha.remove(0, 1);
  if (alpha.size() == 1)
    alpha.prepend(QLatin1Char('0'));
  if (alpha.size() != 2)
    return combined.toUpper();

  combined.insert(1, alpha.toUpper());
  return combined.toUpper();
}

QString backgroundColor(const QString& color, const QString& alphaHex)
{
  if (color.trimmed().isEmpty() && alphaHex.trimmed().isEmpty())
    return QStringLiteral("#00000000");

  const QString resolvedColor = color.trimmed().isEmpty()
      ? QStringLiteral("#000000")
      : color;
  const QString resolvedAlpha = alphaHex.trimmed().isEmpty()
      ? QStringLiteral("80")
      : alphaHex;
  return combineColorWithAlpha(resolvedColor, resolvedAlpha);
}

QString resolveFont(const QString& font)
{
  const QString requested = font.trimmed();
  if (requested.isEmpty())
    return QString();

  const QString lowered = requested.toLower();
  if (lowered == QLatin1String("sans-serif") || lowered == QLatin1String("sans"))
  {
#ifdef Q_OS_MACOS
    return QStringLiteral("Helvetica Neue");
#elif defined(Q_OS_WIN)
    return QStringLiteral("Segoe UI");
#else
    return QStringLiteral("DejaVu Sans");
#endif
  }
  if (lowered == QLatin1String("serif"))
  {
#ifdef Q_OS_MACOS
    return QStringLiteral("Times");
#elif defined(Q_OS_WIN)
    return QStringLiteral("Times New Roman");
#else
    return QStringLiteral("DejaVu Serif");
#endif
  }
  if (lowered == QLatin1String("monospace"))
  {
#ifdef Q_OS_MACOS
    return QStringLiteral("Menlo");
#elif defined(Q_OS_WIN)
    return QStringLiteral("Consolas");
#else
    return QStringLiteral("DejaVu Sans Mono");
#endif
  }
  if (lowered == QLatin1String("cursive") || lowered == QLatin1String("script"))
  {
#ifdef Q_OS_MACOS
    return QStringLiteral("Apple Chancery");
#elif defined(Q_OS_WIN)
    return QStringLiteral("Comic Sans MS");
#else
    return QStringLiteral("Comic Sans MS");
#endif
  }
  if (lowered == QLatin1String("fantasy") || lowered == QLatin1String("display"))
  {
    return QStringLiteral("Impact");
  }

  return requested;
}

QVariantMap mpvProperties(const Options& options)
{
  QVariantMap properties;

  properties.insert(QStringLiteral("sub-ass-style-overrides"),
                    options.assScaleBorderAndShadow
                        ? QStringLiteral("ScaledBorderAndShadow=yes")
                        : QStringLiteral("ScaledBorderAndShadow=no"));

  QString assOverride = options.assStyleOverride.trimmed();
  if (assOverride.isEmpty())
    assOverride = appearanceCustomized(options) ? QStringLiteral("force") : QStringLiteral("scale");
  properties.insert(QStringLiteral("sub-ass-override"), assOverride);

  properties.insert(QStringLiteral("sub-scale"), options.size == -1 ? 1.0 : options.size / 32.0);

  const QString font = resolveFont(options.font);
  properties.insert(QStringLiteral("sub-font"),
                    font.isEmpty() ? QStringLiteral("sans-serif") : font);

  properties.insert(QStringLiteral("sub-color"),
                    options.color.isEmpty() ? QStringLiteral("#FFFFFFFF") : options.color);
  properties.insert(QStringLiteral("sub-border-color"),
                    options.borderColor.isEmpty() ? QStringLiteral("#FF000000") : options.borderColor);
  properties.insert(QStringLiteral("sub-border-size"),
                    options.borderSize == -1 ? 3 : options.borderSize);

  const bool hasBacking = !options.backgroundColor.isEmpty()
      || !options.backgroundTransparency.isEmpty();
  properties.insert(QStringLiteral("sub-back-color"),
                    backgroundColor(options.backgroundColor, options.backgroundTransparency));
  properties.insert(QStringLiteral("sub-border-style"),
                    hasBacking ? QStringLiteral("background-box")
                               : QStringLiteral("outline-and-shadow"));

  properties.insert(QStringLiteral("sub-bold"), options.bold);
  properties.insert(QStringLiteral("sub-italic"), options.italic);
  properties.insert(QStringLiteral("sub-shadow-offset"),
                    options.shadowSize == -1 ? 0.0 : double(options.shadowSize));
  properties.insert(QStringLiteral("sub-shadow-color"),
                    options.shadowColor.isEmpty() ? QStringLiteral("#FF000000") : options.shadowColor);

  const QStringList placement = options.placement.split(QLatin1Char(','));
  if (placement.size() == 2)
  {
    properties.insert(QStringLiteral("sub-align-x"), placement[0].trimmed());
    properties.insert(QStringLiteral("sub-pos"),
                      placement[1].trimmed() == QLatin1String("bottom") ? 100 : 10);
  }
  else
  {
    properties.insert(QStringLiteral("sub-align-x"), QStringLiteral("center"));
    properties.insert(QStringLiteral("sub-pos"), 100);
  }

  return properties;
}

QStringList preferredFonts()
{
  return {
      QStringLiteral("Arial"),
      QStringLiteral("Helvetica"),
      QStringLiteral("Helvetica Neue"),
      QStringLiteral("Segoe UI"),
      QStringLiteral("Tahoma"),
      QStringLiteral("Verdana"),
      QStringLiteral("Trebuchet MS"),
      QStringLiteral("Times New Roman"),
      QStringLiteral("Times"),
      QStringLiteral("Georgia"),
      QStringLiteral("Courier New"),
      QStringLiteral("Menlo"),
      QStringLiteral("Consolas"),
      QStringLiteral("Monaco"),
      QStringLiteral("Comic Sans MS"),
      QStringLiteral("Impact"),
      QStringLiteral("Avenir"),
      QStringLiteral("Avenir Next"),
      QStringLiteral("Gill Sans"),
      QStringLiteral("Palatino"),
      QStringLiteral("Optima"),
      QStringLiteral("Futura")
  };
}

QStringList systemFontFamilies()
{
  QStringList families = QFontDatabase::families();
  families.removeDuplicates();
  return families;
}

QVariantList fontChoices(const QStringList& families, const QString& currentFont)
{
  QSet<QString> available;
  for (const QString& family : families)
  {
    if (!isHiddenFontFamily(family))
      available.insert(family);
  }

  QVariantList choices;
  choices << choice(QStringLiteral("Default"), QString());
  choices << choice(QStringLiteral("Sans-Serif"), QStringLiteral("sans-serif"));
  choices << choice(QStringLiteral("Serif"), QStringLiteral("serif"));
  choices << choice(QStringLiteral("Monospace"), QStringLiteral("monospace"));
  choices << choice(QStringLiteral("Comic Sans MS"), QStringLiteral("Comic Sans MS"));

  QSet<QString> used {
      QString(),
      QStringLiteral("sans-serif"),
      QStringLiteral("serif"),
      QStringLiteral("monospace"),
      QStringLiteral("Comic Sans MS")
  };

  for (const QString& preferred : preferredFonts())
  {
    if (!available.contains(preferred) || used.contains(preferred))
      continue;
    choices << choice(preferred, preferred);
    used.insert(preferred);
  }

  QStringList remaining = available.values();
  std::sort(remaining.begin(), remaining.end(), [](const QString& a, const QString& b) {
    return QString::localeAwareCompare(a, b) < 0;
  });

  for (const QString& family : remaining)
  {
    if (used.contains(family))
      continue;
    choices << choice(family, family);
    used.insert(family);
  }

  const QString current = currentFont.trimmed();
  if (!current.isEmpty() && !used.contains(current))
    choices << choice(QStringLiteral("Current: ") + current, current);

  return choices;
}
}
