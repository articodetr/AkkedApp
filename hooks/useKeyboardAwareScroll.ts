import { useCallback, useEffect, useRef } from 'react';
import {
  Dimensions,
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  TextInput,
} from 'react-native';

type MeasurableInput = {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void
  ) => void;
};

interface KeyboardAwareScrollOptions {
  keyboardGap?: number;
  topGap?: number;
}

const getFocusedTextInput = () => {
  const state = (TextInput as typeof TextInput & {
    State?: { currentlyFocusedInput?: () => MeasurableInput | null };
  }).State;

  return state?.currentlyFocusedInput?.() ?? null;
};

export function useKeyboardAwareScroll({
  keyboardGap = 16,
  topGap = 88,
}: KeyboardAwareScrollOptions = {}) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const focusedInputRef = useRef<MeasurableInput | null>(null);
  const keyboardTopRef = useRef(Dimensions.get('window').height);

  const scrollFocusedInputIntoView = useCallback((input?: MeasurableInput | null) => {
    const target = input ?? focusedInputRef.current;
    if (!target) return;

    target.measureInWindow((_x, y, _width, height) => {
      const screenHeight = Dimensions.get('window').height;
      const keyboardTop = Math.min(keyboardTopRef.current || screenHeight, screenHeight);
      const bottomOverlap = y + height + keyboardGap - keyboardTop;

      if (bottomOverlap > 1) {
        scrollRef.current?.scrollTo({
          y: Math.max(0, scrollYRef.current + bottomOverlap),
          animated: true,
        });
        return;
      }

      const topOverlap = topGap - y;
      if (topOverlap > 1 && scrollYRef.current > 0) {
        scrollRef.current?.scrollTo({
          y: Math.max(0, scrollYRef.current - topOverlap),
          animated: true,
        });
      }
    });
  }, [keyboardGap, topGap]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      keyboardTopRef.current = event.endCoordinates.screenY;
      setTimeout(() => scrollFocusedInputIntoView(), Platform.OS === 'ios' ? 40 : 80);
    });

    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardTopRef.current = Dimensions.get('window').height;
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [scrollFocusedInputIntoView]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleInputFocus = useCallback(() => {
    focusedInputRef.current = getFocusedTextInput();
    setTimeout(() => scrollFocusedInputIntoView(), 90);
  }, [scrollFocusedInputIntoView]);

  return {
    scrollRef,
    handleScroll,
    handleInputFocus,
  };
}
