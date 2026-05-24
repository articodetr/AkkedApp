import { useCallback, useEffect, useRef, useState } from 'react';
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

type FocusableInput = MeasurableInput & {
  focus: () => void;
};

interface KeyboardAwareScrollOptions {
  keyboardGap?: number;
  topGap?: number;
}

const isMeasurableInput = (value: unknown): value is MeasurableInput => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MeasurableInput).measureInWindow === 'function'
  );
};

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
  const scrollTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

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

  const clearQueuedScrolls = useCallback(() => {
    scrollTimeoutsRef.current.forEach(clearTimeout);
    scrollTimeoutsRef.current = [];
  }, []);

  const queueScrollFocusedInputIntoView = useCallback((input?: MeasurableInput | null) => {
    const target = input ?? focusedInputRef.current;
    if (target) {
      focusedInputRef.current = target;
    }

    clearQueuedScrolls();
    [0, 50, 120, 220].forEach((delay) => {
      const timeout = setTimeout(() => {
        scrollFocusedInputIntoView(target ?? focusedInputRef.current);
      }, delay);

      scrollTimeoutsRef.current.push(timeout);
    });
  }, [clearQueuedScrolls, scrollFocusedInputIntoView]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      const windowHeight = Dimensions.get('window').height;
      const keyboardTop = event.endCoordinates.screenY > 0
        ? Math.min(event.endCoordinates.screenY, windowHeight)
        : Math.max(0, windowHeight - event.endCoordinates.height);

      keyboardTopRef.current = keyboardTop;
      setKeyboardHeight(Math.max(0, event.endCoordinates.height || windowHeight - keyboardTop));
      queueScrollFocusedInputIntoView();
    });

    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardTopRef.current = Dimensions.get('window').height;
      setKeyboardHeight(0);
      clearQueuedScrolls();
    });

    return () => {
      clearQueuedScrolls();
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [clearQueuedScrolls, queueScrollFocusedInputIntoView]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const handleInputFocus = useCallback((input?: unknown) => {
    focusedInputRef.current = isMeasurableInput(input)
      ? input
      : getFocusedTextInput();
    queueScrollFocusedInputIntoView();
  }, [queueScrollFocusedInputIntoView]);

  const focusInput = useCallback((input?: FocusableInput | null) => {
    if (!input) return;

    focusedInputRef.current = input;
    input.focus();
    queueScrollFocusedInputIntoView(input);
  }, [queueScrollFocusedInputIntoView]);

  return {
    scrollRef,
    handleScroll,
    handleInputFocus,
    focusInput,
    scrollFocusedInputIntoView: queueScrollFocusedInputIntoView,
    keyboardHeight,
  };
}
