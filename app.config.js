/**
 * إعدادات ديناميكية فوق app.json.
 *
 * عند تعيين APP_VARIANT=development (ملف eas.json، ملف تعريف development)
 * يُبنى التطبيق بمعرّف حزمة ورابط مخصص منفصلين، فيُثبَّت **بجانب** التطبيق
 * الأصلي على نفس الجهاز بدل أن يحل محله — فيبقى التطبيق الفعلي صالحاً للعمل
 * أثناء التطوير.
 */
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'development') {
    return config;
  }

  return {
    ...config,
    name: 'أكِّد (تطوير)',
    scheme: 'akkeddev',
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}.dev`,
    },
    android: {
      ...config.android,
      package: `${config.android.package}.dev`,
    },
  };
};
