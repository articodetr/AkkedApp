import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';

declare global {
  interface Window {
    frameworkReady?: () => void;
  }
}

SplashScreen.preventAutoHideAsync();

export function useFrameworkReady() {
  useEffect(() => {
    const prepare = async () => {
      try {
        window.frameworkReady?.();
        await SplashScreen.hideAsync();
      } catch (error) {
        console.error('Error hiding splash screen:', error);
      }
    };

    prepare();
  }, []);
}
