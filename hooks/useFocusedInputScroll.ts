import { useCallback, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, TextInput, View } from 'react-native';

/** المسافة التي تُترك تحت الحقل بعد رفعه، حتى لا يلتصق بحافة لوحة المفاتيح. */
const SPACE_BELOW_INPUT = 24;

/**
 * يرفع الحقل المُركَّز فوق لوحة المفاتيح داخل ScrollView.
 *
 * أندرويد لا يمرّر تلقائياً إلى الحقل المُركَّز داخل النوافذ المنبثقة، فيبقى
 * الحقل مختبئاً خلف اللوحة.
 *
 * القياس يتم بـ measureInWindow على الحقل وعلى إطار التمرير معاً، ثم نمرّر
 * بمقدار التداخل بينهما. تعمد استخدام measureInWindow دون measureLayout:
 * الأخيرة مع رقم عقدة (getInnerViewNode) لا تعمل في المعمارية الجديدة
 * (Fabric) المفعّلة افتراضياً في SDK 57، وتفشل بصمت فلا يحدث تمرير.
 */
export function useFocusedInputScroll() {
  const scrollRef = useRef<ScrollView>(null);
  /** غلاف حول ScrollView — إطاره هو المساحة المرئية فعلاً بعد انكماش النافذة. */
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

      input.measureInWindow((_inputX, inputY, _inputWidth, inputHeight) => {
        scrollArea.measureInWindow((_areaX, areaY, _areaWidth, areaHeight) => {
          const inputBottom = inputY + inputHeight + SPACE_BELOW_INPUT;
          const visibleBottom = areaY + areaHeight;
          const hiddenBy = inputBottom - visibleBottom;

          if (hiddenBy > 0) {
            scrollView.scrollTo({ y: scrollOffset.current + hiddenBy, animated: true });
          }
        });
      });
    }, 300);
  }, []);

  return { scrollRef, scrollAreaRef, handleScroll, scrollInputIntoView };
}
