import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowRight, Download } from 'lucide-react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { supabase } from '@/lib/supabase';
import { CustomerBalanceByCurrency, CURRENCIES } from '@/types/database';
import { generatePDFHeaderHTML, generatePDFHeaderStyles } from '@/utils/pdfHeaderGenerator';
import { getLogoBase64 } from '@/utils/logoHelper';
import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { buildUserScopeFilter, fetchAccessibleCustomers } from '@/services/userScopeService';

interface CustomerDebtItem {
  customerId: string;
  customerName: string;
  accountNumber: string;
  balances: CustomerBalanceByCurrency[];
}

function formatAmount(value: number) {
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
}

function getCurrencyInfo(code: string) {
  return (
    CURRENCIES.find((currency) => currency.code === code) || {
      code,
      name: code,
      symbol: code,
    }
  );
}

function getBalanceMeta(amount: number) {
  if (amount > 0) {
    return { label: 'له', color: '#16A34A', bg: '#ECFDF3', sign: '+' };
  }
  if (amount < 0) {
    return { label: 'عليه', color: '#DC2626', bg: '#FEF2F2', sign: '-' };
  }
  return { label: 'متساوي', color: '#6B7280', bg: '#F3F4F6', sign: '' };
}

export default function DebtSummaryScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { lastRefreshTime } = useDataRefresh();

  const [data, setData] = useState<CustomerDebtItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (currentUser?.userId) {
      loadData();
    } else {
      setData([]);
      setIsLoading(false);
    }
  }, [currentUser?.userId]);

  useEffect(() => {
    if (!isLoading && currentUser?.userId) {
      loadData();
    }
  }, [lastRefreshTime, currentUser?.userId]);

  const loadData = async () => {
    try {
      setIsLoading(true);

      if (!currentUser?.userId) {
        setData([]);
        return;
      }

      const [customers, balancesResult] = await Promise.all([
        fetchAccessibleCustomers(currentUser.userId, true),
        supabase
          .from('customer_balances_by_currency')
          .select('*')
          .or(buildUserScopeFilter(currentUser.userId))
          .order('customer_name'),
      ]);

      if (balancesResult.error) throw balancesResult.error;

      const visibleCustomers = customers.filter((customer) => !customer.is_profit_loss_account);
      const customerMap = new Map(
        visibleCustomers.map((customer) => [
          customer.id,
          { name: customer.name, accountNumber: customer.account_number },
        ]),
      );

      const grouped = new Map<string, CustomerDebtItem>();

      (balancesResult.data || []).forEach((balance) => {
        const customerInfo = customerMap.get(balance.customer_id);
        if (!customerInfo) return;

        if (!grouped.has(balance.customer_id)) {
          grouped.set(balance.customer_id, {
            customerId: balance.customer_id,
            customerName: customerInfo.name,
            accountNumber: customerInfo.accountNumber,
            balances: [],
          });
        }

        grouped.get(balance.customer_id)!.balances.push(balance);
      });

      const result = Array.from(grouped.values()).sort((a, b) =>
        a.customerName.localeCompare(b.customerName, 'ar'),
      );

      setData(result);
    } catch (error) {
      console.error('Error loading debt summary:', error);
      Alert.alert('خطأ', 'تعذر تحميل تقرير الديون');
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const generatePDF = async () => {
    try {
      let logoDataUrl: string | undefined;

      try {
        logoDataUrl = await getLogoBase64(false, null, { userId: currentUser?.userId });
      } catch (logoError) {
        console.warn('[DebtSummary] Could not load logo:', logoError);
      }

      const headerHTML = generatePDFHeaderHTML({
        title: 'تقرير الديون الشامل',
        logoDataUrl,
        primaryColor: '#5B5AF7',
        darkColor: '#3730A3',
        height: 150,
        showPhones: true,
      });

      const rows = data
        .flatMap((customer) =>
          customer.balances.map((balance) => {
            const amount = Number(balance.balance);
            const meta = getBalanceMeta(amount);
            const currencyInfo = getCurrencyInfo(balance.currency);

            return `
              <tr>
                <td>${customer.customerName}</td>
                <td>${customer.accountNumber}</td>
                <td>${currencyInfo.name}</td>
                <td style="color:${meta.color}; font-weight:bold;">${meta.label}</td>
                <td style="color:${meta.color}; font-weight:bold;">
                  ${formatAmount(Math.abs(amount))} ${currencyInfo.symbol}
                </td>
              </tr>
            `;
          }),
        )
        .join('');

      const html = `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
          <head>
            <meta charset="utf-8" />
            <style>
              @page { size: A4; margin: 12mm; }
              body { font-family: Arial, Tahoma, sans-serif; background: #fff; margin: 0; color: #111827; }
              table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
              th, td { border: 1px solid #D1D5DB; padding: 10px; text-align: center; }
              th { background: #F3F4F6; font-weight: bold; }
              ${generatePDFHeaderStyles()}
            </style>
          </head>
          <body>
            ${headerHTML}
            <table>
              <thead>
                <tr>
                  <th>اسم العميل</th>
                  <th>رقم الحساب</th>
                  <th>العملة</th>
                  <th>الحالة</th>
                  <th>المبلغ</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td colspan="5">لا توجد بيانات</td></tr>'}
              </tbody>
            </table>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('نجح', 'تم إنشاء التقرير بنجاح');
      }
    } catch (error) {
      console.error('[DebtSummary] Error generating PDF:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء إنشاء التقرير');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topHeader}>
          <TouchableOpacity style={styles.topActionButton} onPress={generatePDF}>
            <Download size={16} color="#5B5AF7" />
            <Text style={styles.topActionText}>PDF</Text>
          </TouchableOpacity>

          <Text style={styles.pageTitle}>تقرير الديون الشامل</Text>

          <TouchableOpacity style={styles.topIconButton} onPress={() => router.back()}>
            <ArrowRight size={18} color="#1E1B4B" />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>جاري التحميل...</Text>
          </View>
        ) : data.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>لا توجد بيانات</Text>
          </View>
        ) : (
          data.map((customer) => (
            <View key={customer.customerId} style={styles.sectionCard}>
              <Text style={styles.customerName}>{customer.customerName}</Text>
              <Text style={styles.accountNumber}>رقم الحساب: {customer.accountNumber}</Text>

              <View style={styles.balanceList}>
                {customer.balances.map((balance) => {
                  const amount = Number(balance.balance);
                  const meta = getBalanceMeta(amount);
                  const currencyInfo = getCurrencyInfo(balance.currency);

                  return (
                    <View key={`${customer.customerId}-${balance.currency}`} style={styles.balanceRow}>
                      <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
                      </View>

                      <View style={styles.balanceInfo}>
                        <Text style={styles.currencyName}>{currencyInfo.name}</Text>
                        <Text style={[styles.balanceAmount, { color: meta.color }]}>
                          {meta.sign} {formatAmount(Math.abs(amount))} {currencyInfo.symbol}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}

        <View style={{ height: 10 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7FC' },
  screen: { flex: 1 },
  contentContainer: { padding: 14, paddingBottom: 24 },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    marginTop: 6,
  },
  topIconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  topActionButton: {
    minWidth: 64,
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  topActionText: { fontSize: 13, color: '#5B5AF7', fontWeight: '800' },
  pageTitle: { fontSize: 22, fontWeight: '900', color: '#1E1B4B' },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ECECF7',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  customerName: { fontSize: 16, fontWeight: '900', color: '#1E1B4B', textAlign: 'right' },
  accountNumber: { fontSize: 12, color: '#7C84A3', textAlign: 'right', marginTop: 4, marginBottom: 10 },
  balanceList: { gap: 10 },
  balanceRow: {
    borderWidth: 1,
    borderColor: '#E3E7F2',
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginLeft: 10,
  },
  statusPillText: { fontSize: 12, fontWeight: '800' },
  balanceInfo: { flex: 1, alignItems: 'flex-end' },
  currencyName: { fontSize: 13, fontWeight: '700', color: '#1F2937', marginBottom: 4 },
  balanceAmount: { fontSize: 16, fontWeight: '900', textAlign: 'right' },
  emptyBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ECECF7',
  },
  emptyText: { fontSize: 14, color: '#7C84A3', fontWeight: '600' },
});
