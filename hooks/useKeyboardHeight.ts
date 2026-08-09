import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * ارتفاع لوحة المفاتيح الحالي، و0 عندما تكون مخفية.
 *
 * يُستخدم في النوافذ المنبثقة (bottom sheets) لتقرير ما إذا كانت لمسة الخلفية
 * تعني إخفاء اللوحة أم إغلاق النافذة، ولتقليص الهامش السفلي أثناء ظهورها.
 */
export function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return keyboardHeight;
}
