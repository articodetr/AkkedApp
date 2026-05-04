import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Crown, MessageCircle, ShieldCheck, X } from 'lucide-react-native';

import {
  getAdminSubscriptionWhatsAppDisplayNumber,
  openSubscriptionUpgradeWhatsApp,
} from '@/utils/subscriptionUpgradeRequest';

type CurrentUserInfo = {
  userId?: string | null;
  userName?: string | null;
  fullName?: string | null;
  accountNumber?: string | null;
};

type QuotaInfo = {
  customerCount?: number | null;
  customerLimit?: number | null;
  customer_count?: number | null;
  customer_limit?: number | null;
  message?: string | null;
};

type Props = {
  visible: boolean;
  currentUser?: CurrentUserInfo | null;
  quota?: QuotaInfo | null;
  onClose: () => void;
};

const normalizeQuota = (quota?: QuotaInfo | null) => {
  const customerCount = quota?.customerCount ?? quota?.customer_count ?? null;
  const customerLimit = quota?.customerLimit ?? quota?.customer_limit ?? null;
  return { customerCount, customerLimit };
};

export function SubscriptionLimitUpgradeModal({
  visible,
  currentUser,
  quota,
  onClose,
}: Props) {
  const { customerCount, customerLimit } = normalizeQuota(quota);
  const adminPhoneDisplay = getAdminSubscriptionWhatsAppDisplayNumber();
  const hasQuotaNumbers =
    typeof customerCount === 'number' || typeof customerLimit === 'number';

  const handleUpgrade = async () => {
    await openSubscriptionUpgradeWhatsApp(currentUser, quota);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.topRow}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              activeOpacity={0.75}
            >
              <X size={18} color="#64748B" />
            </TouchableOpacity>

            <View style={styles.iconCircle}>
              <Crown size={28} color="#FFFFFF" />
            </View>

            <View style={styles.closePlaceholder} />
          </View>

          <Text style={styles.title}>يجب عليك الاشتراك في التطبيق</Text>

          <Text style={styles.subtitle}>
            لقد وصلت إلى الحد المجاني المسموح به. لا يمكنك إضافة عميل جديد بعد الآن
            إلا بعد تفعيل الاشتراك.
          </Text>

          {hasQuotaNumbers ? (
            <View style={styles.quotaBox}>
              <ShieldCheck size={18} color="#4338CA" />
              <Text style={styles.quotaText}>
                الاستخدام الحالي: {customerCount ?? 'غير معروف'} من{' '}
                {customerLimit ?? 'غير محدد'} عميل
              </Text>
            </View>
          ) : null}

          <Text style={styles.description}>
            للتفعيل، تواصل معنا عبر واتساب على الرقم التالي، وعند الضغط على الزر
            سيتم تحويلك مباشرة إلى واتساب.
          </Text>

          <View style={styles.phoneBox}>
            <Text style={styles.phoneLabel}>رقم التواصل</Text>
            <Text style={styles.phoneValue}>{adminPhoneDisplay}</Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleUpgrade}
            activeOpacity={0.9}
          >
            <MessageCircle size={20} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>التواصل عبر واتساب</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onClose}
            activeOpacity={0.75}
          >
            <Text style={styles.secondaryButtonText}>إغلاق</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 390,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 18,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  closePlaceholder: {
    width: 36,
    height: 36,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4F46E5',
    marginBottom: 14,
  },
  title: {
    marginTop: 14,
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 24,
    color: '#475569',
    textAlign: 'center',
  },
  quotaBox: {
    marginTop: 18,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#EEF2FF',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
  },
  quotaText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#3730A3',
    textAlign: 'right',
    lineHeight: 21,
  },
  description: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 24,
    color: '#475569',
    textAlign: 'center',
  },
  phoneBox: {
    marginTop: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#F8FAFC',
  },
  phoneLabel: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 6,
  },
  phoneValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 20,
    borderRadius: 18,
    backgroundColor: '#22C55E',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row-reverse',
    gap: 10,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  secondaryButton: {
    marginTop: 12,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
});
