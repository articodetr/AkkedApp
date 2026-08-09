import { useCallback, useRef } from 'react';
import { ScrollView, TextInput } from 'react-native';

/** المسافة التي تُترك فوق الحقل بعد رفعه، حتى تبقى تسميته ظاهرة. */
const SPACE_ABOVE_INPUT = 96;

/**
 * يرفع الحقل المُركَّز فوق لوحة المفاتيح داخل ScrollView.
 *
 * أندرويد لا يمرّر تلقائياً إلى الحقل المُركَّز داخل النوافذ المنبثقة، فيبقى
 * الحقل مختبئاً خلف اللوحة. نقيس موضع الحقل داخل محتوى التمرير بعد أن تأخذ
 * اللوحة مساحتها، ثم نمرّر إليه.
 */
export function useFocusedInputScroll() {
  const scrollRef = useRef<ScrollView>(null);

  const scrollInputIntoView = useCallback((input: TextInput | null) => {
    if (!input) return;

    // القياس قبل استقرار اللوحة يعطي موضعاً قديماً، فنؤجّله بعد حركة الفتح.
    const timer = setTimeout(() => {
      const scrollView = scrollRef.current;
      if (!scrollView) return;

      const innerNode = scrollView.getInnerViewNode();
      if (!innerNode) return;

      input.measureLayout(
        innerNode,
        (_x, y) => {
          scrollView.scrollTo({ y: Math.max(y - SPACE_ABOVE_INPUT, 0), animated: true });
        },
        () => {},
      );
    }, 250);

    return () => clearTimeout(timer);
  }, []);

  return { scrollRef, scrollInputIntoView };
}
