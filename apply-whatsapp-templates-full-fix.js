const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupDir = path.join(root, '.whatsapp-templates-full-backup');

const files = [
  {
    path: path.join(root, 'components', 'ArabicTemplateTokenBar.tsx'),
    content: `import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type ArabicTemplateTokenItem = {
  label: string;
  value?: string;
  token?: string;
};

type ArabicTemplateTokenBarProps = {
  items?: ArabicTemplateTokenItem[];
  tokens?: ArabicTemplateTokenItem[];
  onInsert: (value: string) => void;
};

export function ArabicTemplateTokenBar({
  items,
  tokens,
  onInsert,
}: ArabicTemplateTokenBarProps) {
  const sourceItems = items ?? tokens ?? [];

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {sourceItems.map((item, index) => {
          const insertValue = item.value ?? item.token ?? '';

          return (
            <TouchableOpacity
              key={item.label + '-' + insertValue + '-' + index}
              style={styles.tokenButton}
              onPress={() => onInsert(insertValue)}
              activeOpacity={0.85}
            >
              <Text style={styles.tokenText}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default ArabicTemplateTokenBar;

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 12,
  },
  content: {
    flexDirection: 'row-reverse',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  tokenButton: {
    backgroundColor: '#F2F4F7',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginLeft: 8,
  },
  tokenText: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
    textAlign: 'center',
  },
});
`,
  },
  {
    path: path.join(root, 'utils', 'whatsappTemplates.ts'),
    content: `import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';

export const APP_SETTINGS_FIXED_ID = '00000000-0000-0000-0000-000000000000';

export interface TemplateVariables {
  customer_name?: string;
  account_number?: string;
  date?: string;
  balance?: string;
  balances?: string;
  movements?: string;
  shop_name?: string;
}

export interface WhatsAppTemplates {
  account_statement: string;
  share_account: string;
}

export const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppTemplates = {
  account_statement: [
    'مرحبا {الاسم}',
    '',
    '{الرصيد}',
  ].join('\\n'),
  share_account: [
    'مرحبا {الاسم}',
    '',
    'كشف الحساب التفصيلي',
    '',
    '{الأرصدة}',
    '',
    'الحركات المالية',
    '',
    '{الحركات المالية}',
    '',
    '{اسم_المحل}',
  ].join('\\n'),
};

const PLACEHOLDER_ALIASES: Record<keyof TemplateVariables, string[]> = {
  customer_name: ['customer_name', 'الاسم'],
  account_number: ['account_number', 'رقم_الحساب'],
  date: ['date', 'التاريخ'],
  balance: ['balance', 'الرصيد'],
  balances: ['balances', 'الأرصدة'],
  movements: ['movements', 'الحركات المالية'],
  shop_name: ['shop_name', 'اسم_المحل'],
};

export async function fetchWhatsAppTemplates(): Promise<WhatsAppTemplates> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('whatsapp_account_statement_template, whatsapp_share_account_template')
      .eq('id', APP_SETTINGS_FIXED_ID)
      .maybeSingle();

    if (error) {
      console.error('Error fetching WhatsApp templates:', error);
      return DEFAULT_WHATSAPP_TEMPLATES;
    }

    if (!data) {
      return DEFAULT_WHATSAPP_TEMPLATES;
    }

    return {
      account_statement:
        data.whatsapp_account_statement_template ||
        DEFAULT_WHATSAPP_TEMPLATES.account_statement,
      share_account:
        data.whatsapp_share_account_template ||
        DEFAULT_WHATSAPP_TEMPLATES.share_account,
    };
  } catch (error) {
    console.error('Error fetching WhatsApp templates:', error);
    return DEFAULT_WHATSAPP_TEMPLATES;
  }
}

export function replaceTemplateVariables(
  template: string,
  variables: TemplateVariables
): string {
  let result = template;

  (Object.keys(PLACEHOLDER_ALIASES) as Array<keyof TemplateVariables>).forEach((key) => {
    const value = variables[key];
    if (value === undefined || value === null) return;

    const aliases = PLACEHOLDER_ALIASES[key];
    aliases.forEach((alias) => {
      const escaped = alias.replace(/[.*+?^\\\${}()|[\\]\\\\]/g, '\\\\$&');
      result = result.replace(new RegExp('\\\\{' + escaped + '\\\\}', 'g'), String(value));
    });
  });

  return result;
}

export function formatHumanNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';

  const fixed = Number(value).toFixed(2);
  return fixed.replace(/\\.00$/, '').replace(/(\\.\\d)0$/, '$1');
}

export function getArabicCurrencyName(currency: string): string {
  const upper = String(currency || '').toUpperCase();

  const map: Record<string, string> = {
    USD: 'دولار',
    SAR: 'ريال سعودي',
    TRY: 'ليرة تركية',
    YER: 'ريال يمني',
  };

  return map[upper] || upper;
}

export function formatBalancesForWhatsApp(
  balances: Array<{ currency: string; balance: number }>
): string {
  if (!balances.length) {
    return 'لا توجد أرصدة';
  }

  return balances
    .map((item) => {
      const value = Number(item.balance || 0);
      const amount = formatHumanNumber(Math.abs(value));
      const currency = getArabicCurrencyName(item.currency);

      if (value > 0) {
        return 'لكم ' + amount + ' ' + currency;
      }

      if (value < 0) {
        return 'عليكم ' + amount + ' ' + currency;
      }

      return amount + ' ' + currency;
    })
    .join('\\n');
}

export function formatMovementsForWhatsApp(
  movements: Array<{
    created_at: string;
    movement_type: string;
    amount: number;
    currency: string;
    notes?: string;
  }>
): string {
  if (!movements.length) {
    return 'لا توجد حركات';
  }

  return movements
    .map((movement) => {
      const date = format(new Date(movement.created_at), 'dd/MM/yyyy', { locale: ar });
      const type = movement.movement_type === 'incoming' ? 'وارد' : 'صادر';
      const amount = formatHumanNumber(Number(movement.amount || 0));
      const currency = getArabicCurrencyName(movement.currency);
      const notes = movement.notes?.trim();

      const lines = [
        type + ': ' + amount + ' ' + currency,
        'التاريخ: ' + date,
      ];

      if (notes) {
        lines.push('الملاحظة: ' + notes);
      }

      return lines.join('\\n');
    })
    .join('\\n\\n');
}

export function getFormattedDate(): string {
  return format(new Date(), 'dd/MM/yyyy', { locale: ar });
}

export function validateTemplate(template: string, requiredVariables: string[]): boolean {
  return requiredVariables.every((variable) => {
    return template.includes('{' + variable + '}');
  });
}

export function getAccountStatementVariables(): Array<{
  key: string;
  description: string;
  example: string;
}> {
  return [
    {
      key: '{الاسم}',
      description: 'اسم العميل',
      example: 'محمد أحمد',
    },
    {
      key: '{رقم_الحساب}',
      description: 'رقم الحساب',
      example: 'A-001',
    },
    {
      key: '{التاريخ}',
      description: 'التاريخ الحالي',
      example: '27/04/2026',
    },
    {
      key: '{الرصيد}',
      description: 'الأرصدة المختصرة',
      example: 'لكم 500 دولار\\nعليكم 600 ريال سعودي',
    },
  ];
}

export function getShareAccountVariables(): Array<{
  key: string;
  description: string;
  example: string;
}> {
  return [
    {
      key: '{الاسم}',
      description: 'اسم العميل',
      example: 'محمد أحمد',
    },
    {
      key: '{رقم_الحساب}',
      description: 'رقم الحساب',
      example: 'A-001',
    },
    {
      key: '{التاريخ}',
      description: 'التاريخ الحالي',
      example: '27/04/2026',
    },
    {
      key: '{الأرصدة}',
      description: 'الأرصدة التفصيلية',
      example: 'لكم 500 دولار\\nعليكم 600 ريال سعودي',
    },
    {
      key: '{الحركات المالية}',
      description: 'الحركات التفصيلية',
      example: 'وارد: 500 دولار\\nالتاريخ: 27/04/2026\\nالملاحظة: دفعة',
    },
    {
      key: '{اسم_المحل}',
      description: 'اسم المحل',
      example: 'ArtiCode Exchange',
    },
  ];
}

export function generatePreviewMessage(
  template: string,
  templateType: 'account_statement' | 'share_account'
): string {
  const sampleVariables: TemplateVariables = {
    customer_name: 'محمد أحمد',
    account_number: 'A-001',
    date: getFormattedDate(),
    balance: 'لكم 500 دولار\\nعليكم 600 ريال سعودي',
    balances: 'لكم 500 دولار\\nعليكم 600 ريال سعودي\\nلكم 1250 ليرة تركية',
    movements: [
      'وارد: 500 دولار',
      'التاريخ: 27/04/2026',
      'الملاحظة: دفعة أولى',
      '',
      'صادر: 300 ريال سعودي',
      'التاريخ: 26/04/2026',
      'الملاحظة: تسليم',
    ].join('\\n'),
    shop_name: 'ArtiCode Exchange',
  };

  const safeTemplate =
    templateType === 'account_statement'
      ? template || DEFAULT_WHATSAPP_TEMPLATES.account_statement
      : template || DEFAULT_WHATSAPP_TEMPLATES.share_account;

  return replaceTemplateVariables(safeTemplate, sampleVariables);
}
`,
  },
  {
    path: path.join(root, 'app', 'whatsapp-templates.tsx'),
    content: `import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Save, RotateCcw, Eye } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import {
  APP_SETTINGS_FIXED_ID,
  DEFAULT_WHATSAPP_TEMPLATES,
  fetchWhatsAppTemplates,
  generatePreviewMessage,
  WhatsAppTemplates,
} from '@/utils/whatsappTemplates';
import { ArabicTemplateTokenBar } from '../components/ArabicTemplateTokenBar';

type TemplateKey = keyof WhatsAppTemplates;

type SelectionRange = {
  start: number;
  end: number;
};

export default function WhatsAppTemplatesScreen() {
  const router = useRouter();

  const [templates, setTemplates] = useState<WhatsAppTemplates>({
    account_statement: '',
    share_account: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<TemplateKey>('account_statement');
  const [selections, setSelections] = useState<Record<TemplateKey, SelectionRange>>({
    account_statement: { start: 0, end: 0 },
    share_account: { start: 0, end: 0 },
  });

  const accountToolbarItems = useMemo(
    () => [
      { label: 'الاسم', token: '{الاسم}' },
      { label: 'رقم الحساب', token: '{رقم_الحساب}' },
      { label: 'التاريخ', token: '{التاريخ}' },
      { label: 'الرصيد', token: '{الرصيد}' },
    ],
    []
  );

  const shareToolbarItems = useMemo(
    () => [
      { label: 'الاسم', token: '{الاسم}' },
      { label: 'رقم الحساب', token: '{رقم_الحساب}' },
      { label: 'التاريخ', token: '{التاريخ}' },
      { label: 'الأرصدة', token: '{الأرصدة}' },
      { label: 'الحركات المالية', token: '{الحركات المالية}' },
      { label: 'اسم المحل', token: '{اسم_المحل}' },
    ],
    []
  );

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const loadedTemplates = await fetchWhatsAppTemplates();
      setTemplates(loadedTemplates);
      setSelections({
        account_statement: {
          start: loadedTemplates.account_statement.length,
          end: loadedTemplates.account_statement.length,
        },
        share_account: {
          start: loadedTemplates.share_account.length,
          end: loadedTemplates.share_account.length,
        },
      });
    } catch (error) {
      console.error('Error loading templates:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء تحميل القوالب');
    } finally {
      setIsLoading(false);
    }
  }

  function updateTemplate(key: TemplateKey, text: string) {
    setTemplates((prev) => ({
      ...prev,
      [key]: text,
    }));
  }

  function handleSelectionChange(key: TemplateKey, event: any) {
    const selection = event?.nativeEvent?.selection;
    if (!selection) return;

    setSelections((prev) => ({
      ...prev,
      [key]: {
        start: selection.start ?? 0,
        end: selection.end ?? selection.start ?? 0,
      },
    }));
  }

  function handleInsertToken(key: TemplateKey, token: string) {
    const currentText = templates[key] || '';
    const currentSelection = selections[key] || {
      start: currentText.length,
      end: currentText.length,
    };

    const start = Math.max(0, Math.min(currentSelection.start, currentText.length));
    const end = Math.max(0, Math.min(currentSelection.end, currentText.length));

    const nextValue =
      currentText.slice(0, start) + token + currentText.slice(end);

    const nextCursor = start + token.length;

    setTemplates((prev) => ({
      ...prev,
      [key]: nextValue,
    }));

    setSelections((prev) => ({
      ...prev,
      [key]: {
        start: nextCursor,
        end: nextCursor,
      },
    }));

    setActiveTemplate(key);
  }

  async function handleSave() {
    if (!templates.account_statement.trim() || !templates.share_account.trim()) {
      Alert.alert('تنبيه', 'يجب تعبئة القالبين قبل الحفظ');
      return;
    }

    setIsSaving(true);

    try {
      const { error } = await supabase.from('app_settings').upsert(
        {
          id: APP_SETTINGS_FIXED_ID,
          whatsapp_account_statement_template: templates.account_statement,
          whatsapp_share_account_template: templates.share_account,
        },
        { onConflict: 'id' }
      );

      if (error) throw error;

      Alert.alert('تم', 'تم حفظ القوالب بنجاح');
    } catch (error) {
      console.error('Error saving templates:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء حفظ القوالب');
    } finally {
      setIsSaving(false);
    }
  }

  function handleReset(key: TemplateKey) {
    const title =
      key === 'account_statement'
        ? 'استعادة القالب الافتراضي للرسالة السريعة'
        : 'استعادة القالب الافتراضي لكشف الحساب التفصيلي';

    Alert.alert('تأكيد', title, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'استعادة',
        style: 'destructive',
        onPress: () => {
          const defaultValue = DEFAULT_WHATSAPP_TEMPLATES[key];
          setTemplates((prev) => ({
            ...prev,
            [key]: defaultValue,
          }));
          setSelections((prev) => ({
            ...prev,
            [key]: {
              start: defaultValue.length,
              end: defaultValue.length,
            },
          }));
        },
      },
    ]);
  }

  function handlePreview(key: TemplateKey) {
    const preview = generatePreviewMessage(templates[key], key);
    Alert.alert('معاينة الرسالة', preview);
  }

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronRight size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>قوالب رسائل الواتساب</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>الرسالة السريعة</Text>
          <Text style={styles.cardSubtitle}>
            رسالة مختصرة تُرسل من صفحة العميل.
          </Text>

          <ArabicTemplateTokenBar
            items={accountToolbarItems}
            onInsert={(token) => handleInsertToken('account_statement', token)}
          />

          <TextInput
            style={styles.textArea}
            multiline
            textAlignVertical="top"
            value={templates.account_statement}
            onChangeText={(text) => updateTemplate('account_statement', text)}
            onFocus={() => setActiveTemplate('account_statement')}
            onSelectionChange={(event) =>
              handleSelectionChange('account_statement', event)
            }
            placeholder="اكتب القالب هنا"
            placeholderTextColor="#9CA3AF"
          />

          <Text style={styles.helperText}>
            اضغط على أي عنصر في الأعلى وسيُضاف مباشرة داخل النص.
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.previewButton]}
              onPress={() => handlePreview('account_statement')}
            >
              <Eye size={16} color="#2563EB" />
              <Text style={[styles.secondaryButtonText, styles.previewButtonText]}>
                معاينة
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, styles.resetButton]}
              onPress={() => handleReset('account_statement')}
            >
              <RotateCcw size={16} color="#DC2626" />
              <Text style={[styles.secondaryButtonText, styles.resetButtonText]}>
                إعادة الافتراضي
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>كشف الحساب التفصيلي</Text>
          <Text style={styles.cardSubtitle}>
            رسالة مفصلة مع الأرصدة والحركات المالية.
          </Text>

          <ArabicTemplateTokenBar
            items={shareToolbarItems}
            onInsert={(token) => handleInsertToken('share_account', token)}
          />

          <TextInput
            style={styles.textAreaLarge}
            multiline
            textAlignVertical="top"
            value={templates.share_account}
            onChangeText={(text) => updateTemplate('share_account', text)}
            onFocus={() => setActiveTemplate('share_account')}
            onSelectionChange={(event) =>
              handleSelectionChange('share_account', event)
            }
            placeholder="اكتب القالب هنا"
            placeholderTextColor="#9CA3AF"
          />

          <Text style={styles.helperText}>
            يفضّل أن تضع عنوانًا قبل الحركات مثل: الحركات المالية
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.previewButton]}
              onPress={() => handlePreview('share_account')}
            >
              <Eye size={16} color="#2563EB" />
              <Text style={[styles.secondaryButtonText, styles.previewButtonText]}>
                معاينة
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, styles.resetButton]}
              onPress={() => handleReset('share_account')}
            >
              <RotateCcw size={16} color="#DC2626" />
              <Text style={[styles.secondaryButtonText, styles.resetButtonText]}>
                إعادة الافتراضي
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.smallInfoCard}>
          <Text style={styles.smallInfoTitle}>ملاحظة</Text>
          <Text style={styles.smallInfoText}>
            الأرقام ستظهر بدون فواصل عشرية إلا إذا كان هناك كسر فعلي.
          </Text>
          <Text style={styles.smallInfoText}>
            مثال: 500 دولار بدل 500.00 دولار
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Save size={18} color="#FFFFFF" />
              <Text style={styles.saveButtonText}>حفظ</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 120,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'right',
    marginBottom: 14,
    lineHeight: 20,
  },
  textArea: {
    minHeight: 150,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    textAlign: 'right',
  },
  textAreaLarge: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    textAlign: 'right',
  },
  helperText: {
    marginTop: 10,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row-reverse',
    marginTop: 14,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row-reverse',
  },
  previewButton: {
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    marginLeft: 8,
  },
  resetButton: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 6,
  },
  previewButtonText: {
    color: '#2563EB',
  },
  resetButtonText: {
    color: '#DC2626',
  },
  smallInfoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  smallInfoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 8,
  },
  smallInfoText: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'right',
    lineHeight: 22,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  saveButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row-reverse',
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginRight: 8,
  },
});
`,
  },
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  ensureDir(backupDir);
  const backupName =
    path.basename(filePath) + '.' + Date.now() + '.bak';
  const backupPath = path.join(backupDir, backupName);
  fs.copyFileSync(filePath, backupPath);
  console.log('Backup created:', backupPath);
}

function writeFile(targetPath, content) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, 'utf8');
  console.log('Updated:', targetPath);
}

try {
  files.forEach((file) => {
    backupFile(file.path);
    writeFile(file.path, file.content);
  });

  console.log('');
  console.log('Done successfully.');
  console.log('Next steps:');
  console.log('1) npm run typecheck');
  console.log('2) npx expo start -c');
  console.log('');
  console.log('Optional cleanup:');
  console.log('- Delete temporary patch files you no longer need');
} catch (error) {
  console.error('Patch failed:', error.message);
  process.exit(1);
}