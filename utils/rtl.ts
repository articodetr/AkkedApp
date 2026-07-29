import { I18nManager, Platform, TextStyle, ViewStyle } from 'react-native';

export const ARABIC_DIRECTION = 'rtl' as const;

export function setupArabicRTL() {
  if (Platform.OS === 'web') {
    const constants = I18nManager.getConstants();
    if (!constants.isRTL) {
      I18nManager.getConstants = () => ({
        ...constants,
        isRTL: true,
        doLeftAndRightSwapInRTL: true,
        localeIdentifier: 'ar',
      });
      I18nManager.isRTL = true;
      I18nManager.doLeftAndRightSwapInRTL = true;
    }

    if (typeof document !== 'undefined') {
      document.documentElement.lang = 'ar';
      document.documentElement.dir = ARABIC_DIRECTION;
      document.body?.setAttribute('dir', ARABIC_DIRECTION);
      document.body?.setAttribute('lang', 'ar');
    }
    return;
  }

  I18nManager.allowRTL(true);
  I18nManager.swapLeftAndRightInRTL(true);
  if (!I18nManager.isRTL) {
    I18nManager.forceRTL(true);
  }
}

export const rtlText: TextStyle = {
  textAlign: 'right',
  writingDirection: 'rtl',
};

export const rtlCenterText: TextStyle = {
  textAlign: 'center',
  writingDirection: 'rtl',
};

export const ltrNumberText: TextStyle = {
  textAlign: 'right',
  writingDirection: 'ltr',
};

export const rtlRow: ViewStyle = {
  flexDirection: 'row',
  direction: 'rtl',
};

export const rtlScreen: ViewStyle = {
  direction: 'rtl',
};
