import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

const DAILY_AD_IMAGE = require('@/assets/images/daily-startup-ad.png');
const DAILY_AD_ASPECT_RATIO = 1856 / 2304;

type DailyStartupAdProps = {
  enabled: boolean;
};

export function DailyStartupAd({ enabled }: DailyStartupAdProps) {
  const [visible, setVisible] = useState(false);
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }

    setVisible(true);
  }, [enabled]);

  const cardWidth = Math.min(width - 72, 340);
  const cardHeight = Math.min(height - 180, cardWidth / DAILY_AD_ASPECT_RATIO);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setVisible(false)}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} />

        <View style={[styles.card, { width: cardWidth, height: cardHeight }]}>
          <Image source={DAILY_AD_IMAGE} style={styles.image} resizeMode="contain" />

          <TouchableOpacity
            style={styles.closeButton}
            activeOpacity={0.85}
            onPress={() => setVisible(false)}
          >
            <X size={22} color="#0F172A" strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.68)',
  },
  card: {
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: '#F8F6F1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.24,
    shadowRadius: 28,
    elevation: 12,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
});
