import { useCallback, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, TextInput, View } from 'react-native';

/** المسافة التي تُترك فوق الحقل بعد رفعه، حتى تبقى تسميته ظاهرة معه. */
const SPACE_ABOVE_INPUT = 44;

/** لا نحرّك الشاشة لمسافة تافهة، فالحركة الصغيرة تبدو ارتجاجاً. */
const MIN_WORTHWHILE_SHIFT = 8;

/**
 * يرفع الحقل المُركَّز إلى أعلى منطقة التمرير عند فتح لوحة المفاتيح.
 *
 * أندرويد لا يمرّر تلقائياً إلى الحقل المُركَّز داخل النوافذ المنبثقة، فيبقى
 * الحقل مختبئاً خلف اللوحة.
 *
 * الحساب يعتمد على **الفرق** بين قياسَي measureInWindow للحقل ولإطار التمرير،
 * أي موضع الحقل داخل الإطار. هذا مقصود:
 *
 * - الفرق بين قياسين في نفس النظام الإحداثي صحيح دائماً، دون الحاجة لمعرفة
 *   أين تبدأ النافذة أو أين يقف الكيبورد.
 * - نافذة Modal على أندرويد لا تنكمش دائماً أمام لوحة المفاتيح، فأسفل إطار
 *   التمرير قد يقع خلف اللوحة. لذلك لا نقارن الحقل بأسفل الإطار — بل نرفعه
 *   إلى أعلاه، وأعلى الإطار ظاهر دائماً فوق اللوحة.
 *
 * ولا نمرّر إلا إلى الأمام، حتى لا تقفز الشاشة للخلف عند لمس حقل أعلى.
 */
export function useFocusedInputScroll() {
  const scrollRef = useRef<ScrollView>(null);
  /** غلاف حول ScrollView — يوفّر عرضاً أصلياً قابلاً للقياس على أندرويد. */
  const scrollAreaRef = useRef<View>(null);
  const scrollOffset = useRef(0);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffset.current = event.nativeEvent.contentOffset.y;
  }, []);

  const scrollInputIntoView = useCallback((input: TextInput | null) => {
    if (!input) return;

    // القياس قبل استقرار اللوحة يعطي إطاراً قديماً، فنؤجّله بعد حركة الفتح.
    setTimeout(() => {
      const scrollArea = scrollAreaRef.current;
      const scrollView = scrollRef.current;
      if (!scrollArea || !scrollView) return;

      input.measureInWindow((_inputX, inputY) => {
        scrollArea.measureInWindow((_areaX, areaY) => {
          const inputYWithinArea = inputY - areaY;
          const target = scrollOffset.current + inputYWithinArea - SPACE_ABOVE_INPUT;

          if (target > scrollOffset.current + MIN_WORTHWHILE_SHIFT) {
            scrollView.scrollTo({ y: target, animated: true });
          }
        });
      });
    }, 300);
  }, []);

  return { scrollRef, scrollAreaRef, handleScroll, scrollInputIntoView };
}
