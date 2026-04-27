import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { FileText } from 'lucide-react-native';
import { LetterheadSettings } from '../services/letterheadService';
const LETTERHEAD_WIDTH = 534;
const LETTERHEAD_HEIGHT = 106;
const ASPECT_RATIO = LETTERHEAD_WIDTH / LETTERHEAD_HEIGHT;

interface LetterheadPreviewProps {
  settings: LetterheadSettings;
  previewWidth?: number;
  showSizeLabel?: boolean;
}

export function LetterheadPreview({
  settings,
  previewWidth = LETTERHEAD_WIDTH,
  showSizeLabel = false,
}: LetterheadPreviewProps) {
  const width = Math.min(previewWidth, LETTERHEAD_WIDTH);
  const height = width / ASPECT_RATIO;
  const scale = width / LETTERHEAD_WIDTH;

  const logoSize = 68 * scale;
  const iconSize = 32 * scale;
  const titleFontSize = Math.max(13, 22 * scale);
  const phoneFontSize = Math.max(10, 16 * scale);
  const paddingHorizontal = 18 * scale;
  const borderRadius = 14 * scale;

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.preview,
          {
            width,
            height,
            backgroundColor: settings.background_color,
            borderColor: settings.border_color,
            borderRadius,
            paddingHorizontal,
          },
        ]}
      >
        <View style={styles.logoSide}>
          {settings.show_logo && settings.logo_url ? (
            <Image
              source={{ uri: settings.logo_url }}
              style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
              resizeMode="cover"
            />
          ) : settings.show_logo ? (
            <View
              style={[
                styles.logoPlaceholder,
                {
                  width: logoSize,
                  height: logoSize,
                  borderRadius: logoSize / 2,
                  backgroundColor: `${settings.accent_color}18`,
                  borderColor: settings.accent_color,
                },
              ]}
            >
              <FileText size={iconSize} color={settings.accent_color} />
            </View>
          ) : null}
        </View>

        <View style={styles.textSide}>
          <Text
            numberOfLines={1}
            style={[
              styles.businessName,
              {
                color: settings.primary_color,
                fontSize: titleFontSize,
              },
            ]}
          >
            {settings.business_name?.trim() || 'اسم الشركة'}
          </Text>

          {settings.show_phone && !!settings.phone_number?.trim() && (
            <Text
              numberOfLines={1}
              style={[
                styles.phone,
                {
                  color: settings.text_color,
                  fontSize: phoneFontSize,
                },
              ]}
            >
              رقم الهاتف: {settings.phone_number}
            </Text>
          )}
        </View>
      </View>

      {showSizeLabel && (
        <Text style={styles.sizeLabel}>المقاس الأصلي: {LETTERHEAD_WIDTH} × {LETTERHEAD_HEIGHT}</Text>
      )}
    </View>
  );
}

export { LETTERHEAD_WIDTH, LETTERHEAD_HEIGHT };

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  preview: {
    borderWidth: 1.5,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  logoSide: {
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 14,
  },
  logoPlaceholder: {
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textSide: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  businessName: {
    fontWeight: '800',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  phone: {
    marginTop: 6,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sizeLabel: {
    marginTop: 8,
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
});
