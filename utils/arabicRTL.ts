import { I18nManager, Text, TextInput, View } from 'react-native';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

const rtlTextStyle = {
  writingDirection: 'rtl' as const,
  textAlign: 'right' as const,
};

const rtlViewStyle = {
  direction: 'rtl' as const,
};

function applyDefaultStyle(Component: unknown, style: object) {
  const target = Component as { defaultProps?: { style?: unknown } };
  target.defaultProps = target.defaultProps || {};
  const currentStyle = target.defaultProps.style;
  target.defaultProps.style = currentStyle ? [style, currentStyle] : style;
}

applyDefaultStyle(View, rtlViewStyle);
applyDefaultStyle(Text, rtlTextStyle);
applyDefaultStyle(TextInput, rtlTextStyle);
