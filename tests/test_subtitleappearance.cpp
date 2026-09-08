#include <QtTest/QtTest>
#include "../src/player/SubtitleAppearance.h"

class TestSubtitleAppearance : public QObject
{
  Q_OBJECT

private slots:
  void combineColorInsertsAlpha();
  void combineColorKeepsExistingAlpha();
  void combineColorUppercases();
  void backgroundNoneIsTransparent();
  void backgroundColorDefaultsToHalfOpacity();
  void backgroundOpacityDefaultsToBlack();
  void defaultOptionsAreNotCustomized();
  void colorCustomizesAppearance();
  void mpvUsesBackgroundBoxWhenBackingSet();
  void mpvUsesOutlineWhenNoBacking();
  void mpvForcesAssOverrideWhenCustomized();
  void mpvKeepsExplicitAssOverride();
  void mpvResetsScaleWhenSizeDefault();
  void mpvScalesSizeRelativeToNormal();
  void mpvMapsPlacement();
  void mpvAppliesBoldItalicAndShadow();
  void resolveGenericFonts();
  void fontChoicesPutsDefaultAndAliasesFirst();
  void fontChoicesIncludesCurrentIfMissing();
  void fontChoicesHidesSystemInternalFamilies();
  void optionsFromSettingsReadsNewKeys();
};

void TestSubtitleAppearance::combineColorInsertsAlpha()
{
  QCOMPARE(SubtitleAppearance::combineColorWithAlpha("#ffffff", "80"),
           QString("#80FFFFFF"));
}

void TestSubtitleAppearance::combineColorKeepsExistingAlpha()
{
  QCOMPARE(SubtitleAppearance::combineColorWithAlpha("#80FFFFFF", "40"),
           QString("#80FFFFFF"));
}

void TestSubtitleAppearance::combineColorUppercases()
{
  QCOMPARE(SubtitleAppearance::combineColorWithAlpha("#00ffff", "c0"),
           QString("#C000FFFF"));
}

void TestSubtitleAppearance::backgroundNoneIsTransparent()
{
  QCOMPARE(SubtitleAppearance::backgroundColor("", ""), QString("#00000000"));
}

void TestSubtitleAppearance::backgroundColorDefaultsToHalfOpacity()
{
  QCOMPARE(SubtitleAppearance::backgroundColor("#000000", ""),
           QString("#80000000"));
}

void TestSubtitleAppearance::backgroundOpacityDefaultsToBlack()
{
  QCOMPARE(SubtitleAppearance::backgroundColor("", "C0"),
           QString("#C0000000"));
}

void TestSubtitleAppearance::defaultOptionsAreNotCustomized()
{
  QVERIFY(!SubtitleAppearance::appearanceCustomized(SubtitleAppearance::Options{}));
}

void TestSubtitleAppearance::colorCustomizesAppearance()
{
  SubtitleAppearance::Options options;
  options.color = "#FFFF00";
  QVERIFY(SubtitleAppearance::appearanceCustomized(options));
}

void TestSubtitleAppearance::mpvUsesBackgroundBoxWhenBackingSet()
{
  SubtitleAppearance::Options options;
  options.backgroundColor = "#000000";
  const QVariantMap properties = SubtitleAppearance::mpvProperties(options);
  QCOMPARE(properties.value("sub-border-style").toString(), QString("background-box"));
  QCOMPARE(properties.value("sub-back-color").toString(), QString("#80000000"));
}

void TestSubtitleAppearance::mpvUsesOutlineWhenNoBacking()
{
  const QVariantMap properties = SubtitleAppearance::mpvProperties({});
  QCOMPARE(properties.value("sub-border-style").toString(), QString("outline-and-shadow"));
  QCOMPARE(properties.value("sub-back-color").toString(), QString("#00000000"));
}

void TestSubtitleAppearance::mpvForcesAssOverrideWhenCustomized()
{
  SubtitleAppearance::Options options;
  options.size = 42;
  const QVariantMap properties = SubtitleAppearance::mpvProperties(options);
  QCOMPARE(properties.value("sub-ass-override").toString(), QString("force"));
}

void TestSubtitleAppearance::mpvKeepsExplicitAssOverride()
{
  SubtitleAppearance::Options options;
  options.color = "#FFFFFF";
  options.assStyleOverride = "no";
  const QVariantMap properties = SubtitleAppearance::mpvProperties(options);
  QCOMPARE(properties.value("sub-ass-override").toString(), QString("no"));
}

void TestSubtitleAppearance::mpvResetsScaleWhenSizeDefault()
{
  QCOMPARE(SubtitleAppearance::mpvProperties({}).value("sub-scale").toDouble(), 1.0);
}

void TestSubtitleAppearance::mpvScalesSizeRelativeToNormal()
{
  SubtitleAppearance::Options options;
  options.size = 32;
  QCOMPARE(SubtitleAppearance::mpvProperties(options).value("sub-scale").toDouble(), 1.0);

  options.size = 64;
  QCOMPARE(SubtitleAppearance::mpvProperties(options).value("sub-scale").toDouble(), 2.0);
}

void TestSubtitleAppearance::mpvMapsPlacement()
{
  SubtitleAppearance::Options options;
  options.placement = "left,top";
  const QVariantMap properties = SubtitleAppearance::mpvProperties(options);
  QCOMPARE(properties.value("sub-align-x").toString(), QString("left"));
  QCOMPARE(properties.value("sub-pos").toInt(), 10);
}

void TestSubtitleAppearance::mpvAppliesBoldItalicAndShadow()
{
  SubtitleAppearance::Options options;
  options.bold = true;
  options.italic = true;
  options.shadowSize = 4;
  options.shadowColor = "#FF0000";
  const QVariantMap properties = SubtitleAppearance::mpvProperties(options);
  QCOMPARE(properties.value("sub-bold").toBool(), true);
  QCOMPARE(properties.value("sub-italic").toBool(), true);
  QCOMPARE(properties.value("sub-shadow-offset").toDouble(), 4.0);
  QCOMPARE(properties.value("sub-shadow-color").toString(), QString("#FF0000"));
}

void TestSubtitleAppearance::resolveGenericFonts()
{
  QVERIFY(!SubtitleAppearance::resolveFont("sans-serif").isEmpty());
  QVERIFY(SubtitleAppearance::resolveFont("sans-serif") != QString("sans-serif"));
  QCOMPARE(SubtitleAppearance::resolveFont("Impact"), QString("Impact"));
  QVERIFY(SubtitleAppearance::resolveFont("").isEmpty());
}

void TestSubtitleAppearance::fontChoicesPutsDefaultAndAliasesFirst()
{
  const QVariantList choices = SubtitleAppearance::fontChoices(
      QStringList{ "Arial", "Impact", "Comic Sans MS" }, QString());
  QVERIFY(choices.size() >= 5);
  QCOMPARE(choices[0].toMap().value("title").toString(), QString("Default"));
  QCOMPARE(choices[0].toMap().value("value").toString(), QString());
  QCOMPARE(choices[1].toMap().value("value").toString(), QString("sans-serif"));
  QCOMPARE(choices[2].toMap().value("value").toString(), QString("serif"));
  QCOMPARE(choices[3].toMap().value("value").toString(), QString("monospace"));
  QCOMPARE(choices[4].toMap().value("value").toString(), QString("Comic Sans MS"));

  QStringList values;
  for (const QVariant& choice : choices)
    values << choice.toMap().value("value").toString();
  QVERIFY(values.contains("Arial"));
  QVERIFY(values.contains("Impact"));
}

void TestSubtitleAppearance::fontChoicesIncludesCurrentIfMissing()
{
  const QVariantList choices = SubtitleAppearance::fontChoices(
      QStringList{ "Arial" }, QString("Fancy Joke Font"));
  QCOMPARE(choices.last().toMap().value("value").toString(), QString("Fancy Joke Font"));
}

void TestSubtitleAppearance::fontChoicesHidesSystemInternalFamilies()
{
  const QVariantList choices = SubtitleAppearance::fontChoices(
      QStringList{ ".AppleSystemUIFont", "LastResort", "Verdana" }, QString());
  QStringList values;
  for (const QVariant& choice : choices)
    values << choice.toMap().value("value").toString();
  QVERIFY(!values.contains(".AppleSystemUIFont"));
  QVERIFY(!values.contains("LastResort"));
  QVERIFY(values.contains("Verdana"));
}

void TestSubtitleAppearance::optionsFromSettingsReadsNewKeys()
{
  QVariantMap values;
  values["bold"] = true;
  values["italic"] = true;
  values["shadow_size"] = 3;
  values["font"] = "Comic Sans MS";
  values["background_color"] = "#000000";
  const auto options = SubtitleAppearance::optionsFromSettings(values);
  QCOMPARE(options.bold, true);
  QCOMPARE(options.italic, true);
  QCOMPARE(options.shadowSize, 3);
  QCOMPARE(options.font, QString("Comic Sans MS"));
  QCOMPARE(options.backgroundColor, QString("#000000"));
}

QTEST_MAIN(TestSubtitleAppearance)
#include "test_subtitleappearance.moc"
