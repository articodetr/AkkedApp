import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, ActivityIndicator, Modal, TextInput, } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowRight, MessageCircle, Settings, Plus, Receipt, ChartBar as BarChart3, Calculator, FileText, ChevronDown, ChevronUp, Search, X, Calendar, Link as LinkIcon, TrendingUp, TrendingDown } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { buildReadableCustomerFilter } from '@/services/userScopeService';
import { Customer, AccountMovement, CURRENCIES } from '@/types/database';
import { format, isSameMonth, isSameYear, startOfDay, endOfDay } from 'date-fns';
import { ar } from 'date-fns/locale';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { generateAccountStatementHTML } from '@/utils/accountStatementGenerator';
import { formatSmartNumber, formatCompactNumber } from '@/utils/arabicFormat';
import { getLogoBase64 } from '@/utils/logoHelper';
import QuickAddMovementSheet from '@/components/QuickAddMovementSheet';
import EditMovementSheet from '@/components/EditMovementSheet';
import CalendarRangePicker from '@/components/CalendarRangePicker';
import { MovementActionSheet } from '@/components/MovementActionSheet';
import { PreDeleteSettlementSheet } from '@/components/PreDeleteSettlementSheet';
import {
  fetchWhatsAppTemplates,
  replaceTemplateVariables,
  formatBalancesForWhatsApp,
  formatMovementsForWhatsApp,
  getFormattedDate,
} from '@/utils/whatsappTemplates';
import {
  getMovementApprovalLabel,
  isMovementCreator,
  isPendingMovement,
  isPostedMovement,
  isRejectedMovement,
  normalizeMovementApprovalStatus,
  requiresCounterpartyApproval,
} from '@/utils/movementApproval';


function sanitizeStatementPdfFileName(value: string | number | null | undefined): string {
  const safe = String(value || 'عميل')
    .trim()
    .replace(/[\\/:*?"<>|#%{}~&]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
  return safe || 'عميل';
}

function buildAccountStatementPdfName(customerName: string | null | undefined): string {
  const safeCustomerName = sanitizeStatementPdfFileName(customerName);
  const date = new Date().toISOString().slice(0, 10);
  return `كشف_حساب_${safeCustomerName}_${date}.pdf`;
}

async function prepareNamedStatementPdf(sourceUri: string, fileName: string): Promise<string> {
  const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;

  if (!baseDirectory) {
    return sourceUri;
  }

  const targetUri = `${baseDirectory}${fileName}`;

  if (targetUri === sourceUri) {
    return sourceUri;
  }

  try {
    const existing = await FileSystem.getInfoAsync(targetUri);
    if (existing.exists) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
    }
  } catch {
    // تجاهل خطأ فحص الملف القديم.
  }

  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
  return targetUri;
}

interface GroupedMovements {
  [key: string]: AccountMovement[];
}

interface CurrencyBalance {
  currency: string;
  incoming: number;
  outgoing: number;
  balance: number;
}

function groupMovementsByMonth(movements: AccountMovement[]): GroupedMovements {
  const grouped: GroupedMovements = {};

  movements.forEach((movement) => {
    const date = new Date(movement.created_at);
    const key = format(date, 'MMMM yyyy', { locale: ar });

    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(movement);
  });

  return grouped;
}

function getCurrencySymbol(code: string): string {
  const currency = CURRENCIES.find((c) => c.code === code);
  return currency?.symbol || code;
}

function getCurrencyName(code: string): string {
  const currency = CURRENCIES.find((c) => c.code === code);
  return currency?.name || code;
}

interface CurrencyTotals {
  currency: string;
  incoming: number;
  outgoing: number;
}

function calculateCurrencyTotals(
  movements: AccountMovement[],
): CurrencyTotals[] {
  const currencyMap: { [key: string]: CurrencyTotals } = {};

  movements.forEach((movement) => {
    const currency = movement.currency;
    if (!currencyMap[currency]) {
      currencyMap[currency] = {
        currency,
        incoming: 0,
        outgoing: 0,
      };
    }

    const amount = Number(movement.amount);
    if (movement.movement_type === 'incoming') {
      currencyMap[currency].incoming += amount;
    } else {
      currencyMap[currency].outgoing += amount;
    }
  });

  return Object.values(currencyMap);
}

function calculateBalanceByCurrency(
  movements: AccountMovement[],
): CurrencyBalance[] {
  const currencyMap: { [key: string]: CurrencyBalance } = {};

  movements.forEach((movement) => {
    const currency = movement.currency;
    if (!currencyMap[currency]) {
      currencyMap[currency] = {
        currency,
        incoming: 0,
        outgoing: 0,
        balance: 0,
      };
    }

    const amount = Number(movement.amount);

    if (movement.movement_type === 'incoming') {
      currencyMap[currency].incoming += amount;
    } else {
      currencyMap[currency].outgoing += amount;
    }
  });

  Object.values(currencyMap).forEach((item) => {
    item.balance = item.incoming - item.outgoing;
  });

  return Object.values(currencyMap).filter((item) => item.balance !== 0);
}

function shouldIncludeMovementInBalance(movement: AccountMovement): boolean {
  return !(movement as any).is_commission_movement && isPostedMovement(movement);
}

function calculateRunningBalanceAfterMovement(
  movement: AccountMovement,
  allMovements: AccountMovement[],
): number {
  const movementTime = new Date(movement.created_at).getTime();
  const movementId = String(movement.id || '');

  return allMovements
    .filter((item) => shouldIncludeMovementInBalance(item))
    .filter((item) => item.currency === movement.currency)
    .filter((item) => {
      const itemTime = new Date(item.created_at).getTime();
      if (itemTime < movementTime) return true;
      if (itemTime > movementTime) return false;
      return String(item.id || '') <= movementId;
    })
    .sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    })
    .reduce((sum, item) => {
      const amount = Number(item.amount) || 0;
      return item.movement_type === 'incoming' ? sum + amount : sum - amount;
    }, 0);
}

function shouldIncludeMovementInProjectedApprovalBalance(movement: AccountMovement): boolean {
  return (
    !(movement as any).is_commission_movement &&
    !(movement as any).is_voided &&
    (isPostedMovement(movement) || isPendingMovement(movement))
  );
}

function isMovementAtOrBefore(
  movement: AccountMovement,
  targetMovement: AccountMovement,
): boolean {
  const movementTime = new Date(movement.created_at).getTime();
  const targetTime = new Date(targetMovement.created_at).getTime();

  if (movementTime < targetTime) return true;
  if (movementTime > targetTime) return false;

  return String(movement.id || '') <= String(targetMovement.id || '');
}

function calculateProjectedBalanceIfApproved(
  movement: AccountMovement,
  allMovements: AccountMovement[],
): number {
  return allMovements
    .filter((item) => shouldIncludeMovementInProjectedApprovalBalance(item))
    .filter((item) => item.currency === movement.currency)
    .filter((item) => isMovementAtOrBefore(item, movement))
    .sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    })
    .reduce((sum, item) => {
      const amount = getCombinedAmount(item, allMovements);
      return item.movement_type === 'incoming' ? sum + amount : sum - amount;
    }, 0);
}

function formatBalanceAfterLabel(
  balance: number,
  currency: string,
  label: string,
): string {
  const symbol = getCurrencySymbol(currency);
  const amount = formatCompactNumber(Math.abs(balance));

  if (balance > 0) return `${label}: ${amount} ${symbol} له`;
  if (balance < 0) return `${label}: ${amount} ${symbol} عليه`;
  return `${label}: متساوي`;
}

function formatMovementBalanceLabel(
  movement: AccountMovement,
  allMovements: AccountMovement[],
): string {
  if (!shouldIncludeMovementInBalance(movement)) {
    const status = normalizeMovementApprovalStatus(movement);
    if (status === 'pending') return 'بانتظار التأكيد';
    if (status === 'rejected') return 'مرفوضة';
    return 'لا تؤثر في الرصيد';
  }

  const balance = calculateRunningBalanceAfterMovement(movement, allMovements);
  return formatBalanceAfterLabel(balance, movement.currency, 'الرصيد بعد الحركة');
}

function formatMovementAmountBalanceLabel(
  movement: AccountMovement,
  allMovements: AccountMovement[],
): string {
  if (isPendingMovement(movement) && !(movement as any).is_commission_movement) {
    const balance = calculateProjectedBalanceIfApproved(movement, allMovements);
    return formatBalanceAfterLabel(balance, movement.currency, 'الرصيد اذا أكد');
  }

  return formatMovementBalanceLabel(movement, allMovements);
}


function getCombinedAmount(
  movement: AccountMovement,
  allMovements: AccountMovement[],
): number {
  const baseAmount = Number(movement.amount);

  const relatedCommissions = allMovements.filter(
    (m) =>
      (m as any).is_commission_movement === true &&
      (m as any).related_commission_movement_id === movement.id &&
      m.customer_id === movement.customer_id &&
      m.movement_type === movement.movement_type &&
      m.currency === movement.currency
  );

  const commissionTotal = relatedCommissions.reduce(
    (sum, m) => sum + Number(m.amount),
    0,
  );

  return baseAmount + commissionTotal;
}

function getRelatedCommission(
  movement: AccountMovement,
  allMovements: AccountMovement[],
): number {
  const relatedCommissions = allMovements.filter(
    (m) =>
      (m as any).is_commission_movement === true &&
      (m as any).related_commission_movement_id === movement.id &&
      m.customer_id === movement.customer_id &&
      m.movement_type === movement.movement_type &&
      m.currency === movement.currency
  );

  return relatedCommissions.reduce((sum, m) => sum + Number(m.amount), 0);
}

function isMovementCreatedByCurrentUser(
  movement: AccountMovement,
  currentUser?: {
    userId?: string | null;
    userName?: string | null;
    fullName?: string | null;
  } | null,
): boolean {
  const createdByUserId = (movement as any).created_by_user_id;
  const sourceUserId = (movement as any).source_user_id;
  const createdByUserName = (movement as any).created_by_user_name?.trim();

  return (
    (Boolean(currentUser?.userId) && sourceUserId === currentUser?.userId) ||
    (Boolean(currentUser?.userId) && createdByUserId === currentUser?.userId) ||
    (Boolean(currentUser?.fullName) && createdByUserName === currentUser?.fullName) ||
    (Boolean(currentUser?.userName) && createdByUserName === currentUser?.userName)
  );
}

function getMovementCreatorLabel(
  movement: AccountMovement,
  currentUser?: {
    userId?: string | null;
    userName?: string | null;
    fullName?: string | null;
  } | null,
): string {
  if (isMovementCreatedByCurrentUser(movement, currentUser)) {
    return 'أنا';
  }

  return 'العميل';
}

function renderMovementApprovalBadge(movement: Pick<AccountMovement, 'approval_status' | 'pending_approval'>) {
  const normalizedStatus = normalizeMovementApprovalStatus(movement);
  const label = getMovementApprovalLabel(movement);

  if (normalizedStatus === 'pending') {
    return (
      <View style={[styles.movementStatusBadge, styles.movementStatusBadgePending]}>
        <Text style={[styles.movementStatusText, styles.movementStatusTextPending]}>
          {label}
        </Text>
      </View>
    );
  }

  if (normalizedStatus === 'rejected') {
    return (
      <View style={[styles.movementStatusBadge, styles.movementStatusBadgeRejected]}>
        <Text style={[styles.movementStatusText, styles.movementStatusTextRejected]}>
          {label}
        </Text>
      </View>
    );
  }

  if (normalizedStatus === 'approved') {
    return (
      <View style={[styles.movementStatusBadge, styles.movementStatusBadgeApproved]}>
        <Text style={[styles.movementStatusText, styles.movementStatusTextApproved]}>
          {label}
        </Text>
      </View>
    );
  }

  return null;
}


function getMovementApprovalLookupIds(movement: AccountMovement): string[] {
  return Array.from(
    new Set(
      [
        movement.id,
        movement.mirror_movement_id,
        movement.related_transfer_id,
        movement.related_commission_movement_id,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

export default function CustomerDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { lastRefreshTime, triggerRefresh } = useDataRefresh();
  const { settings, currentUser } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [movements, setMovements] = useState<AccountMovement[]>([]);
  const [totalIncoming, setTotalIncoming] = useState(0);
  const [totalOutgoing, setTotalOutgoing] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);
  const [showCurrencyDetails, setShowCurrencyDetails] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [editingMovement, setEditingMovement] = useState<AccountMovement | null>(null);
  const [selectedMovement, setSelectedMovement] = useState<AccountMovement | null>(null);
  const [quickAddInitialType, setQuickAddInitialType] = useState<'incoming' | 'outgoing' | undefined>(undefined);
  const [showSettlementSheet, setShowSettlementSheet] = useState(false);
  const [showResetSheet, setShowResetSheet] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchScrollRef = useRef<ScrollView>(null);

  const focusSearchInput = () => {
    setTimeout(() => {
      searchScrollRef.current?.scrollTo({ y: 230, animated: true });
    }, 220);
  };
  const [showDateRangeModal, setShowDateRangeModal] = useState(false);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null); const loadCustomerData = useCallback(async () => {
    try {
      if (!currentUser?.userId || !currentUser?.userName) {
        console.error('[CustomerDetails] Missing user data:', currentUser);
        Alert.alert('خطأ', 'لم يتم العثور على المستخدم');
        router.back();
        return;
      }

      console.log('[CustomerDetails] Loading data for user:', currentUser.userName);

      const [customerResult, movementsResult] = await Promise.all([
        supabase
          .from('customers')
          .select('*, linked_user:app_security!customers_linked_user_id_fkey(id, user_name, full_name, account_number)')
          .eq('id', id)
          .or(buildReadableCustomerFilter(currentUser.userId, true))
          .maybeSingle(),
        supabase.rpc('get_customer_movements_with_user', {
          p_user_name: currentUser.userName,
          p_customer_id: id
        })
      ]);

      console.log('[CustomerDetails] Customer result:', customerResult.error ? 'ERROR' : 'SUCCESS', customerResult.error?.message);
      console.log('[CustomerDetails] Movements result:', movementsResult.error ? 'ERROR' : 'SUCCESS', movementsResult.error?.message);

      if (customerResult.error || !customerResult.data) {
        Alert.alert('خطأ', 'لم يتم العثور على العميل');
        router.back();
        return;
      }

      if (movementsResult.error) {
        console.error('[CustomerDetails] Movements error details:', JSON.stringify(movementsResult.error, null, 2));
        Alert.alert('خطأ', 'حدث خطأ أثناء تحميل الحركات المالية');
        setCustomer(customerResult.data);
        setMovements([]);
        return;
      }

      // معالجة نتيجة الدالة - قد تكون array مباشرة أو داخل data
      const movementsData: AccountMovement[] = Array.isArray(movementsResult.data)
        ? movementsResult.data
        : (movementsResult.data || []);

      console.log('[CustomerDetails] Number of movements:', movementsData.length);

      setCustomer(customerResult.data);
      setMovements(movementsData);

      const approvedOnlyMovements = movementsData.filter((m) =>
        shouldIncludeMovementInBalance(m as AccountMovement)
      );

      const incoming =
        approvedOnlyMovements
          ?.filter((m) => m.movement_type === 'incoming')
          .reduce((sum, m) => sum + Number(m.amount), 0) || 0;

      const outgoing =
        approvedOnlyMovements
          ?.filter((m) => m.movement_type === 'outgoing')
          .reduce((sum, m) => sum + Number(m.amount), 0) || 0;

      setTotalIncoming(incoming);
      setTotalOutgoing(outgoing);
    } catch (error) {
      console.error('Error loading customer data:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء تحميل البيانات');
    } finally {
      setIsLoading(false);
    }
  }, [id, currentUser]); useFocusEffect(
    useCallback(() => {
      if (id) {
        setIsLoading(true);
        loadCustomerData(); }
    }, [id, loadCustomerData]),
  );

  useEffect(() => {
    if (id && !isLoading) {
      console.log('[CustomerDetails] Auto-refreshing due to data change');
      loadCustomerData();
    }
  }, [lastRefreshTime]);

  // الاستماع للتغييرات في الإشعارات لتحديث العداد تلقائياً
  useEffect(() => {
    if (!currentUser?.userId) return;

    const channel = supabase
      .channel(`notifications-counter-${currentUser.userId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'movement_notifications',
          filter: `user_id=eq.${currentUser.userId}`,
        },
        () => { },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // Ignore duplicate cleanup errors.
      }
    };
  }, [currentUser?.userId]);


  const handleWhatsApp = async () => {
    if (customer?.phone) {
      const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
      const approvedOnlyMovements = movements.filter(shouldIncludeMovementInBalance);
      const balances = calculateBalanceByCurrency(approvedOnlyMovements);

      const templates = await fetchWhatsAppTemplates();

      const balanceText = balances.length === 0
        ? 'الحساب متساوي'
        : formatBalancesForWhatsApp(
            balances.map(b => ({
              currency: getCurrencySymbol(b.currency),
              balance: b.balance
            }))
          );

      const message = replaceTemplateVariables(templates.account_statement, {
        customer_name: customer.name,
        account_number: customer.account_number,
        date: getFormattedDate(),
        balance: balanceText,
      });

      const encodedMessage = encodeURIComponent(message);
      Linking.openURL(
        `whatsapp://send?phone=${cleanPhone}&text=${encodedMessage}`,
      );
    } else {
      Alert.alert('تنبيه', 'لا يوجد رقم هاتف مسجل لهذا العميل');
    }
  };

  const handlePrint = () => {
    if (!customer) {
      return;
    }

    const approvedOnlyMovements = movements.filter(shouldIncludeMovementInBalance);

    if (approvedOnlyMovements.length === 0) {
      Alert.alert('تنبيه', 'لا توجد حركات معتمدة لطباعتها');
      return;
    }

    setShowDateRangeModal(true);
  };

  const executePrint = async (
    movementsToPrint: AccountMovement[],
    previousMovements: AccountMovement[] = [],
  ) => {
    if (!customer) {
      return;
    }

    if (movementsToPrint.length === 0 && previousMovements.length === 0) {
      Alert.alert('تنبيه', 'لا توجد حركات في الفترة المحددة');
      return;
    }

    setIsPrinting(true);
    setShowDateRangeModal(false);

    try {
      let logoDataUrl: string | undefined;
      try {
        console.log('[CustomerDetails] Loading logo for PDF...');
        logoDataUrl = await getLogoBase64(false, null, { userId: currentUser?.userId });

        if (logoDataUrl && logoDataUrl.length > 0) {
          console.log('[CustomerDetails] Logo loaded successfully. Length:', logoDataUrl.length);
        } else {
          console.warn('[CustomerDetails] Logo is empty, will use fallback');
          logoDataUrl = undefined;
        }
      } catch (logoError) {
        console.warn(
          '[CustomerDetails] Could not load logo, continuing without it:',
          logoError,
        );
        logoDataUrl = undefined;
      }

      console.log('[CustomerDetails] Generating HTML for PDF...');
      const html = generateAccountStatementHTML(
        customer.name,
        movementsToPrint,
        logoDataUrl,
        customer.is_profit_loss_account,
        previousMovements,
      );

      console.log('[CustomerDetails] Creating PDF file...');
      const { uri } = await Print.printToFileAsync({ html });
      const statementPdfName = buildAccountStatementPdfName(customer.name);
      const namedPdfUri = await prepareNamedStatementPdf(uri, statementPdfName);
      console.log('[CustomerDetails] PDF created at:', namedPdfUri);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(namedPdfUri, {
          mimeType: 'application/pdf',
          dialogTitle: `كشف حساب ${customer.name}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('نجح', 'تم إنشاء كشف الحساب بنجاح');
      }
    } catch (error) {
      console.error('[CustomerDetails] Error generating PDF:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء إنشاء كشف الحساب');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleCalendarConfirm = (selectedStartDate: Date, selectedEndDate: Date) => {
    setStartDate(selectedStartDate);
    setEndDate(selectedEndDate);
    setShowDateRangeModal(false);

    const rangeStart = startOfDay(selectedStartDate);
    const rangeEnd = endOfDay(selectedEndDate);

    const filtered: AccountMovement[] = [];
    const previous: AccountMovement[] = [];

    movements.forEach((movement) => {
      if (!shouldIncludeMovementInBalance(movement)) {
        return;
      }

      const movementDate = new Date(movement.created_at);
      if (movementDate < rangeStart) {
        previous.push(movement);
      } else if (movementDate <= rangeEnd) {
        filtered.push(movement);
      }
    });

    executePrint(filtered, previous);
  };

  const handlePrintAll = () => {
    executePrint(movements.filter(shouldIncludeMovementInBalance));
  };

  const handleSettleUp = () => {
    Alert.alert('تسوية الحساب', 'ميزة تسوية الحساب قيد التطوير');
  };

  const handleResetAccount = () => {
    if (!customer) return;
    if (customer.is_profit_loss_account) {
      Alert.alert('غير مسموح', 'حساب الأرباح والخسائر حساب ثابت ولا يمكن تصفيره.');
      return;
    }

    const effectiveMovements = movements.filter((m) => {
      const mAny = m as any;
      return !mAny.is_commission_movement && !mAny.is_voided && !isRejectedMovement(m);
    });
    const effectiveBalances = calculateBalanceByCurrency(effectiveMovements);
    const hasEffectiveBalance =
      effectiveBalances.length > 0 && effectiveBalances.some((b) => b.balance !== 0);

    if (!hasEffectiveBalance) {
      const hasPending = movements.some((m) => isPendingMovement(m));
      Alert.alert(
        'الحساب مصفّر',
        hasPending
          ? 'الحساب مصفّر فعلياً (يوجد حركات تسوية معلّقة بانتظار الموافقة).'
          : 'الحساب مصفّر بالفعل، لا يوجد رصيد لتصفيره.',
      );
      return;
    }

    setShowResetSheet(true);
  };

  const handleDeleteCustomer = () => {
    if (!customer) return;
    if (customer.is_profit_loss_account) {
      Alert.alert('غير مسموح', 'حساب الأرباح والخسائر حساب ثابت ولا يمكن حذفه.');
      return;
    }

    const approvedOnlyMovements = movements.filter(shouldIncludeMovementInBalance);
    const approvedBalances = calculateBalanceByCurrency(approvedOnlyMovements);
    const hasApprovedBalance =
      approvedBalances.length > 0 && approvedBalances.some((b) => b.balance !== 0);

    if (hasApprovedBalance) {
      // Calculate effective balance including pending movements
      const effectiveMovements = movements.filter((m) => {
        const mAny = m as any;
        return !mAny.is_commission_movement && !mAny.is_voided && !isRejectedMovement(m);
      });
      const effectiveBalances = calculateBalanceByCurrency(effectiveMovements);
      const hasEffectiveBalance =
        effectiveBalances.length > 0 && effectiveBalances.some((b) => b.balance !== 0);

      if (!hasEffectiveBalance) {
        Alert.alert(
          'حركات التسوية بانتظار الموافقة',
          'توجد حركات تسوية بانتظار موافقة الطرف الآخر تكفي لتصفير الحساب. تواصل معه ليقبلها، ثم يمكنك حذف العميل.',
        );
        return;
      }

      setShowSettlementSheet(true);
      return;
    }

    let warningMessage = `هل أنت متأكد من حذف ${customer.name} نهائياً؟\n\n`;
    warningMessage += `سيتم حذف:\n`;
    warningMessage += `• جميع بيانات العميل\n`;
    warningMessage += `• جميع الحركات (${movements.length} حركة)\n\n`;
    warningMessage += `لا يمكن التراجع عن هذه العملية!`;

    Alert.alert('حذف العميل', warningMessage, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: () => {
          Alert.alert('تأكيد نهائي', 'هل أنت متأكد تماماً من حذف هذا العميل؟', [
            { text: 'إلغاء', style: 'cancel' },
            {
              text: 'نعم، احذف',
              style: 'destructive',
              onPress: async () => {
                try {
                  const { data, error } = await supabase.rpc(
                    'delete_customer_completely',
                    {
                      p_customer_id: id,
                    },
                  );

                  if (error) {
                    Alert.alert('خطأ', 'حدث خطأ أثناء حذف العميل');
                    console.error('Error deleting customer:', error);
                    return;
                  }

                  const result = data as {
                    success: boolean;
                    message: string;
                    movements_deleted: number;
                  };

                  if (result.success) {
                    Alert.alert(
                      'تم الحذف',
                      `تم حذف العميل بنجاح\nتم حذف ${result.movements_deleted} حركة`,
                      [
                        {
                          text: 'حسناً',
                          onPress: () => router.back(),
                        },
                      ],
                    );
                  } else {
                    Alert.alert('خطأ', result.message);
                  }
                } catch (error) {
                  console.error('Error deleting customer:', error);
                  Alert.alert('خطأ', 'حدث خطأ غير متوقع');
                }
              },
            },
          ]);
        },
      },
    ]);
  };

  const handleShareAccount = async () => {
    if (!customer) return;

    const templates = await fetchWhatsAppTemplates();
    const approvedOnlyMovements = movements.filter(shouldIncludeMovementInBalance);
    const balances = calculateBalanceByCurrency(approvedOnlyMovements);

    const balancesText = balances.length === 0
      ? 'الحساب متساوي'
      : formatBalancesForWhatsApp(
          balances.map(b => ({
            currency: getCurrencySymbol(b.currency),
            balance: b.balance
          }))
        );

    const movementsFormatted = approvedOnlyMovements.map(m => ({
      created_at: m.created_at,
      movement_type: m.movement_type,
      amount: Number(m.amount),
      currency: getCurrencySymbol(m.currency),
      notes: m.notes,
    }));

    const movementsText = formatMovementsForWhatsApp(movementsFormatted);

    const message = replaceTemplateVariables(templates.share_account, {
      customer_name: customer.name,
      account_number: customer.account_number,
      date: getFormattedDate(),
      balances: balancesText,
      movements: movementsText,
      shop_name: settings?.shop_name || 'محل الصرافة',
    });

    try {
      await Linking.openURL(
        `whatsapp://send?text=${encodeURIComponent(message)}`,
      );
    } catch (error) {
      Alert.alert('واتساب', message, [
        { text: 'إغلاق', style: 'cancel' },
      ]);
    }
  };

  const handleAddMovement = () => {
    console.log('[CustomerDetails] handleAddMovement called');
    setEditingMovement(null);
    setShowQuickAdd(true);
    console.log('[CustomerDetails] setShowQuickAdd(true) called');
  };

  const openCustomerNotifications = useCallback(() => {
    if (!id) return;

    router.push({
      pathname: '/customer-notifications',
      params: {
        customerId: String(id),
        customerName: customer?.name || '',
      },
    });
  }, [customer?.name, id, router]);


const handleMovementPress = (movement: AccountMovement) => {
  setSelectedMovement(movement);
};

  const handleViewMovementDetails = (movement: AccountMovement) => {
    router.push({
      pathname: '/movement-details',
      params: {
        movementId: movement.id,
        customerId: customer?.id || movement.customer_id,
        customerName: customer?.name || '',
        customerAccountNumber: customer?.account_number || '',
        movementFallback: encodeURIComponent(JSON.stringify(movement)),
      },
    });
  };

  
const handleEditMovement = (_movement: AccountMovement) => {
    Alert.alert('تنبيه', 'تم إيقاف خاصية تعديل الحركات');
  };

  
const handleDeleteMovement = (_movement: AccountMovement) => {
  Alert.alert('تنبيه', 'تم إيقاف خاصية حذف الحركات');
};
  const confirmDeleteMovement = async (_movement: AccountMovement) => {
    Alert.alert('تنبيه', 'تم إيقاف خاصية حذف الحركات');
  };
  const handlePrintMovementReceipt = (movement: AccountMovement) => {
    router.push({
      pathname: '/receipt-preview',
      params: {
        movementId: movement.id,
        customerName: customer?.name,
        customerAccountNumber: customer?.account_number,
      },
    });
  };

  const balance = customer?.balance || 0;

  const filteredMovements = movements
    .filter((movement) => {
      if (customer?.is_profit_loss_account) {
        return true;
      }
      return (movement as any).is_commission_movement !== true;
    })
    .filter((movement) => {
      if (!searchQuery.trim()) return true;

      const query = searchQuery.toLowerCase();
      const movementNumber = movement.movement_number.toLowerCase();
      const notes = (movement.notes || '').toLowerCase();
      const amount = movement.amount.toString();
      const date = format(new Date(movement.created_at), 'dd/MM/yyyy');
      const movementTypeText =
        movement.movement_type === 'outgoing' ? 'عليه' : 'له';
      const senderName = (movement.sender_name || '').toLowerCase();
      const beneficiaryName = (movement.beneficiary_name || '').toLowerCase();

      return (
        movementNumber.includes(query) ||
        notes.includes(query) ||
        amount.includes(query) ||
        date.includes(query) ||
        movementTypeText.includes(query) ||
        senderName.includes(query) ||
        beneficiaryName.includes(query)
      );
    });

  const approvedMovements = movements.filter((movement) => shouldIncludeMovementInBalance(movement));

  const pendingMovements = movements.filter(
    (movement) =>
      !(movement as any).is_commission_movement &&
      isPendingMovement(movement) &&
      !(movement as any).is_voided
  ); const groupedMovements = groupMovementsByMonth(filteredMovements);
  const currencyBalances = calculateBalanceByCurrency(approvedMovements);
  const currencyTotals = calculateCurrencyTotals(approvedMovements);
  const balancesOwedToCustomer = currencyBalances.filter((currBalance) => currBalance.balance > 0);
  const balancesOwedFromCustomer = currencyBalances.filter((currBalance) => currBalance.balance < 0);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#059669', '#10B981', '#34D399']}
          style={styles.gradientHeader}
        >
          <View style={styles.headerContent}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <ArrowRight size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>تفاصيل العميل</Text>
            <View style={{ width: 40 }} />
          </View>
        </LinearGradient>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>جاري التحميل...</Text>
        </View>
      </View>
    );
  }

  if (!customer) return null;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#059669', '#10B981', '#34D399']}
        style={styles.gradientHeader}
      >
        <View style={styles.headerContent}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowRight size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
            {customer.name}
          </Text>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={() => setShowSettingsMenu(true)}
          >
            <Settings size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.headerInfo}>
          <View style={styles.headerBadge}>
            <Receipt size={14} color="#FFFFFF" />
            <Text style={styles.headerBadgeText}>{approvedMovements.length} حركة معتمدة</Text>
          </View>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>
              رقم الحساب: {customer.account_number}
            </Text>
          </View>
          {customer.linked_user_id && (customer as any).linked_user && (
            <TouchableOpacity
              style={[styles.headerBadge, styles.linkedUserBadge]}
              onPress={() => Alert.alert(
                'حساب مرتبط',
                `هذا العميل مرتبط بحساب المستخدم:\n\n${(customer as any).linked_user.full_name}\nرقم الحساب: ${(customer as any).linked_user.account_number}\n\nجميع الحركات متزامنة بشكل تلقائي مع حساب هذا المستخدم.`,
                [{ text: 'حسناً' }]
              )}
            >
              <LinkIcon size={14} color="#FFFFFF" />
              <Text style={styles.headerBadgeText}>
                مرتبط بحساب {(customer as any).linked_user?.full_name || 'مستخدم'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      <ScrollView
        ref={searchScrollRef}
        style={styles.content}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.contentScrollContainer}
      >
        <View style={styles.summarySection}>
          <View style={styles.summaryPanel}>
            <View style={styles.summarySectionHeader}>
              <Text style={styles.summarySectionTitle}>ملخص الحساب</Text>
              <View style={styles.summarySectionIcon}>
                <Calculator size={14} color="#7C3AED" />
              </View>
            </View>

            <View style={styles.summaryCardsRow}>
              <TouchableOpacity
                style={styles.summaryCardWrap}
                activeOpacity={0.85}
                onPress={() => {
                  setQuickAddInitialType('outgoing');
                  setShowQuickAdd(true);
                }}
              >
                <LinearGradient
                  colors={
                    balancesOwedFromCustomer.length > 0
                      ? ['#FEE2E2', '#FFF7F7']
                      : ['#FEF2F2', '#FFFFFF']
                  }
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={[
                    styles.summaryCard,
                    styles.summaryCardNegative,
                    balancesOwedFromCustomer.length > 0 && styles.summaryCardActive,
                  ]}
                >
                  <View style={styles.summaryCardHeader}>
                    <View style={styles.summaryCardIconCircleNegative}>
                      <TrendingDown size={14} color="#DC2626" />
                    </View>
                    <Text style={[styles.summaryCardTitle, styles.summaryCardTitleNegative]}>
                      عليه
                    </Text>
                  </View>

                  {balancesOwedFromCustomer.length === 0 ? (
                    <View style={styles.summaryCardEmptyBody}>
                      <Text style={styles.summaryCardEmptyDash}>—</Text>
                      <Text style={styles.summaryCardEmptyHint}>لا يوجد</Text>
                    </View>
                  ) : balancesOwedFromCustomer.length === 1 ? (
                    <View style={styles.summaryCardAmountList}>
                      <View style={styles.summaryCardAmountItem}>
                        <Text style={[styles.summaryCardBigAmount, styles.summaryCardAmountNegative]}>
                          {formatCompactNumber(Math.abs(balancesOwedFromCustomer[0].balance))}
                        </Text>
                        <Text style={[styles.summaryCardCurrencyCode, styles.summaryCardCurrencyNegative]}>
                          {getCurrencySymbol(balancesOwedFromCustomer[0].currency)} {balancesOwedFromCustomer[0].currency}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.summaryCardMultiList}>
                      {balancesOwedFromCustomer.map((currBalance) => (
                        <View key={`negative-${currBalance.currency}`} style={styles.summaryCardMultiRow}>
                          <Text style={[styles.summaryCardMultiAmount, styles.summaryCardAmountNegative]}>
                            {formatCompactNumber(Math.abs(currBalance.balance))}
                          </Text>
                          <Text style={[styles.summaryCardMultiCode, styles.summaryCardCurrencyNegative]}>
                            {currBalance.currency}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.summaryCardFooter}>
                    <Text style={styles.summaryCardFooterText}>+ اضغط للإضافة</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.summaryCardWrap}
                activeOpacity={0.85}
                onPress={() => {
                  setQuickAddInitialType('incoming');
                  setShowQuickAdd(true);
                }}
              >
                <LinearGradient
                  colors={
                    balancesOwedToCustomer.length > 0
                      ? ['#DCFCE7', '#F0FDF4']
                      : ['#F0FDF4', '#FFFFFF']
                  }
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={[
                    styles.summaryCard,
                    styles.summaryCardPositive,
                    balancesOwedToCustomer.length > 0 && styles.summaryCardActive,
                  ]}
                >
                  <View style={styles.summaryCardHeader}>
                    <View style={styles.summaryCardIconCirclePositive}>
                      <TrendingUp size={14} color="#16A34A" />
                    </View>
                    <Text style={[styles.summaryCardTitle, styles.summaryCardTitlePositive]}>
                      له
                    </Text>
                  </View>

                  {balancesOwedToCustomer.length === 0 ? (
                    <View style={styles.summaryCardEmptyBody}>
                      <Text style={styles.summaryCardEmptyDash}>—</Text>
                      <Text style={styles.summaryCardEmptyHint}>لا يوجد</Text>
                    </View>
                  ) : balancesOwedToCustomer.length === 1 ? (
                    <View style={styles.summaryCardAmountList}>
                      <View style={styles.summaryCardAmountItem}>
                        <Text style={[styles.summaryCardBigAmount, styles.summaryCardAmountPositive]}>
                          {formatCompactNumber(balancesOwedToCustomer[0].balance)}
                        </Text>
                        <Text style={[styles.summaryCardCurrencyCode, styles.summaryCardCurrencyPositive]}>
                          {getCurrencySymbol(balancesOwedToCustomer[0].currency)} {balancesOwedToCustomer[0].currency}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.summaryCardMultiList}>
                      {balancesOwedToCustomer.map((currBalance) => (
                        <View key={`positive-${currBalance.currency}`} style={styles.summaryCardMultiRow}>
                          <Text style={[styles.summaryCardMultiAmount, styles.summaryCardAmountPositive]}>
                            {formatCompactNumber(currBalance.balance)}
                          </Text>
                          <Text style={[styles.summaryCardMultiCode, styles.summaryCardCurrencyPositive]}>
                            {currBalance.currency}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.summaryCardFooter}>
                    <Text style={styles.summaryCardFooterText}>+ اضغط للإضافة</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>

        </View>

        {currencyTotals.length > 0 && (
          <View style={styles.currencyDetailsSection}>
            <TouchableOpacity
              style={styles.currencyDetailsToggle}
              onPress={() => setShowCurrencyDetails(!showCurrencyDetails)}
            >
              <View style={styles.currencyDetailsToggleContent}>
                {showCurrencyDetails ? (
                  <ChevronUp size={20} color="#6B7280" />
                ) : (
                  <ChevronDown size={20} color="#6B7280" />
                )}
                <Text style={styles.currencyDetailsToggleText}>
                  ملخص الحركات
                </Text>
              </View>
            </TouchableOpacity>

            {showCurrencyDetails && (
              <View style={styles.currencyDetailsContent}>
                {currencyTotals.map((total) => (
                  <View key={total.currency} style={styles.currencyDetailsCard}>
                    <Text style={styles.currencyDetailsName}>
                      {getCurrencyName(total.currency)}:
                    </Text>
                    <View style={styles.currencyDetailsRow}>
                      <Text style={styles.currencyDetailsValueGreen}>
                        {formatCompactNumber(total.incoming)}{' '}
                        {getCurrencySymbol(total.currency)}
                      </Text>
                      <Text style={styles.currencyDetailsLabelGreen}>
                        له:
                      </Text>
                    </View>
                    <View style={styles.currencyDetailsRow}>
                      <Text style={styles.currencyDetailsValueRed}>
                        {formatCompactNumber(total.outgoing)}{' '}
                        {getCurrencySymbol(total.currency)}
                      </Text>
                      <Text style={styles.currencyDetailsLabelRed}>عليه:</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.tabButtons}>
          <TouchableOpacity
            style={styles.tabButtonPrimary}
            onPress={handleWhatsApp}
          >
            <MessageCircle size={16} color="#FFFFFF" />

            <Text style={styles.tabButtonPrimaryText}>واتساب</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, isPrinting && styles.tabButtonDisabled]}
            onPress={handlePrint}
            disabled={isPrinting || movements.length === 0}
          >
            {isPrinting ? (
              <ActivityIndicator size="small" color="#6B7280" />
            ) : (
              <FileText size={16} color="#6B7280" />
            )}
            <Text style={styles.tabButtonText}>طباعة PDF</Text>
          </TouchableOpacity>

          
          <TouchableOpacity
            style={styles.tabButton}
            onPress={() => openCustomerNotifications()}
          >
            <Text style={styles.tabButtonText}>الإشعارات</Text>
            {pendingMovements.length > 0 && (
              <View style={styles.tabButtonCountBadge}>
                <Text style={styles.tabButtonCountText}>
                  {pendingMovements.length > 99 ? '99+' : pendingMovements.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.searchSection}>
          <View style={styles.searchContainer}>
            <Search size={20} color="#9CA3AF" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="ابحث في الحركات (رقم، مبلغ، تاريخ، ملاحظات...)"
              placeholderTextColor="#9CA3AF"
              value={searchQuery}
              onChangeText={setSearchQuery}
              textAlign="right"
          onFocus={focusSearchInput}
        />
            {searchQuery !== '' && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                style={styles.clearButton}
              >
                <X size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>
          {searchQuery !== '' && (
            <Text style={styles.searchResultText}>
              {filteredMovements.length} نتيجة
            </Text>
          )}
        </View>

        <View style={styles.movementsSection}>
          {filteredMovements.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>لا توجد حركات</Text>
            </View>
          ) : (
            Object.entries(groupedMovements).map(
              ([monthYear, monthMovements]) => (
	                <View key={monthYear}>
	                  <Text style={styles.monthHeader}>{monthYear}</Text>
                    <View style={styles.movementColumnsHeader}>
                      <View style={styles.movementDateHeader}>
                        <Text style={styles.movementColumnLabel}>التاريخ</Text>
                      </View>
                      <View style={styles.movementCreatorHeader}>
                        <Text style={styles.movementColumnLabel}>المنشأ</Text>
                      </View>
                      <View style={styles.movementTypeHeader}>
                        <Text style={styles.movementColumnLabel}>الحركة</Text>
                      </View>
                      <View style={styles.movementCurrencyHeader}>
                        <Text style={styles.movementColumnLabel}>العملة</Text>
                      </View>
                      <View style={styles.movementAmountHeader}>
                        <Text style={styles.movementColumnLabel}>المبلغ</Text>
                      </View>
                    </View>
	                  {monthMovements.map((movement) => {
                      const creatorLabel = getMovementCreatorLabel(movement, currentUser);
                      const isCurrentUserCreator = isMovementCreatedByCurrentUser(
                        movement,
                        currentUser,
                      );

                      return (
	                    <TouchableOpacity
	                      key={movement.id}
	                      style={[
	                        styles.movementRow,
	                        isPendingMovement(movement) && styles.movementRowPending,
	                        isRejectedMovement(movement) && styles.movementRowRejected,
	                      ]}
	                      activeOpacity={0.7}
	                      onPress={() => handleMovementPress(movement)}
	                    >
	                      <View style={styles.movementDate}>
	                        <Text style={styles.movementDateMonth}>
	                          {format(new Date(movement.created_at), 'MMM', {
	                            locale: ar,
	                          })}
	                        </Text>
	                        <Text style={styles.movementDateDay}>
	                          {format(new Date(movement.created_at), 'dd')}
	                        </Text>
	                      </View>

	                      <View style={styles.movementCreatorContainer}>
	                        <Text
	                          style={[
	                            styles.movementCreatorValue,
	                            isCurrentUserCreator &&
	                              styles.movementCreatorValueCurrent,
	                          ]}
	                          numberOfLines={1}
	                        >
	                          {creatorLabel}
	                        </Text>
                          {renderMovementApprovalBadge(movement)}
	                      </View>

	                      <View style={styles.movementTypeContainer}>
	                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
	                          <Text
	                            style={[
	                              styles.movementType,
	                              {
	                                color: (movement as any).is_internal_transfer
	                                  ? '#F59E0B'
	                                  : movement.movement_type === 'outgoing'
	                                    ? '#EF4444'
	                                    : '#10B981',
	                              },
	                            ]}
	                          >
	                            {(movement as any).is_internal_transfer
	                              ? 'تحويل داخلي'
	                              : movement.movement_type === 'outgoing'
	                                ? 'عليه'
	                                : 'له'}
	                          </Text>
	                        </View>
	                        {(movement as any).is_internal_transfer && (
	                          <Text style={styles.movementNotes} numberOfLines={1}>
	                            {movement.movement_type === 'outgoing'
	                              ? `إلى: ${movement.beneficiary_name || 'عميل آخر'}`
	                              : `من: ${movement.sender_name || 'عميل آخر'}`}
	                          </Text>
	                        )}
	                        {!(movement as any).is_internal_transfer &&
	                          !movement.mirror_movement_id &&
	                          movement.notes && (
	                            <Text
	                              style={styles.movementNotes}
	                              numberOfLines={1}
	                            >
	                              {movement.notes}
	                            </Text>
	                          )}
	                      </View>

	                      <View
	                        style={[
	                          styles.movementIcon,
	                          {
	                            backgroundColor: (movement as any)
	                              .is_internal_transfer
	                              ? '#FEF3C7'
	                              : movement.movement_type === 'outgoing'
	                                ? '#FEE2E2'
	                                : '#ECFDF5',
	                          },
	                        ]}
	                      >
	                        <Text
	                          style={[
	                            styles.currencySymbolText,
	                            {
	                              color: (movement as any).is_internal_transfer
	                                ? '#F59E0B'
	                                : movement.movement_type === 'outgoing'
	                                  ? '#EF4444'
	                                  : '#10B981',
	                            },
	                          ]}
	                        >
	                          {getCurrencySymbol(movement.currency)}
	                        </Text>
	                      </View>

	                      <View style={styles.movementAmount}>
	                        <Text
	                          style={[
	                            styles.movementAmountText,
	                            {
	                              color: (movement as any).is_internal_transfer
	                                ? '#F59E0B'
	                                : movement.movement_type === 'outgoing'
	                                  ? '#EF4444'
	                                  : '#10B981',
	                            },
	                          ]}
	                        >
	                          {formatSmartNumber(getCombinedAmount(movement, movements))}
	                        </Text>
	                        {getRelatedCommission(movement, movements) > 0 && (
	                          <Text style={styles.commissionBadge}>
	                            شامل {formatSmartNumber(getRelatedCommission(movement, movements))} عمولة
	                          </Text>
	                        )}
	                        <Text style={styles.movementLabel}>
	                          {(movement as any).is_internal_transfer
	                            ? 'تحويل'
	                            : formatMovementAmountBalanceLabel(movement, movements)}
	                        </Text>
	                      </View>
	                    </TouchableOpacity>
                      );
                    })}
	                </View>
	              ),
	            )
	          )}
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={handleAddMovement}>
        <Plus size={28} color="#FFFFFF" />
      </TouchableOpacity>

      {customer && (
        <>
          <QuickAddMovementSheet
          visible={showQuickAdd}
          onClose={() => {
            setShowQuickAdd(false);
            setQuickAddInitialType(undefined);
          }}
          customerId={customer.id}
          customerName={customer.name}
          customerAccountNumber={customer.account_number}
          currentBalances={currencyBalances}
          requiresApproval={requiresCounterpartyApproval(customer.linked_user_id, currentUser?.userId)}
          onSuccess={loadCustomerData}
          initialMovementType={quickAddInitialType}
        />
          <EditMovementSheet
          visible={Boolean(editingMovement)}
          onClose={() => setEditingMovement(null)}
          movement={editingMovement}
          customerId={customer.id}
          customerName={customer.name}
          currentBalances={currencyBalances}
          requiresApproval={requiresCounterpartyApproval(customer.linked_user_id, currentUser?.userId)}
          onSuccess={loadCustomerData}
        />
          <MovementActionSheet
            movement={selectedMovement}
            currentUserId={currentUser?.userId || null}
            currentUserName={currentUser?.userName || null}
            onClose={() => setSelectedMovement(null)}
            onViewDetails={(m) => {
              setSelectedMovement(null);
              handleViewMovementDetails(m);
            }}
            onActionDone={() => {
              loadCustomerData();
              triggerRefresh('all');
            }}
          />
          <PreDeleteSettlementSheet
            visible={showSettlementSheet}
            onClose={() => setShowSettlementSheet(false)}
            customerId={customer.id}
            customerName={customer.name}
            customerLinkedUserId={customer.linked_user_id || null}
            currentUserName={currentUser?.userName || null}
            currentUserFullName={currentUser?.fullName || null}
            balances={calculateBalanceByCurrency(
              movements.filter((m) => {
                const mAny = m as any;
                return !mAny.is_commission_movement && !mAny.is_voided && !isRejectedMovement(m);
              })
            ).filter((b) => Number(b.balance) !== 0)}
            pendingMovementsCount={movements.filter(isPendingMovement).length}
            onSuccess={() => {
              loadCustomerData();
              triggerRefresh('all');
            }}
          />
          <PreDeleteSettlementSheet
            visible={showResetSheet}
            onClose={() => setShowResetSheet(false)}
            customerId={customer.id}
            customerName={customer.name}
            customerLinkedUserId={customer.linked_user_id || null}
            currentUserName={currentUser?.userName || null}
            currentUserFullName={currentUser?.fullName || null}
            balances={calculateBalanceByCurrency(
              movements.filter((m) => {
                const mAny = m as any;
                return !mAny.is_commission_movement && !mAny.is_voided && !isRejectedMovement(m);
              })
            ).filter((b) => Number(b.balance) !== 0)}
            pendingMovementsCount={movements.filter(isPendingMovement).length}
            onSuccess={() => {
              loadCustomerData();
              triggerRefresh('all');
            }}
            labels={{
              title: 'تصفير الحساب',
              subtitle: 'إنشاء حركات معاكسة لتصفير الرصيد',
              buttonLabel: 'إنشاء حركات التصفير',
              noteText: 'تصفير الحساب',
              infoLinked:
                'سيتم إنشاء حركة معاكسة لكل عملة. ستكون بانتظار موافقة الطرف الآخر، وعند موافقته يكتمل تصفير الحساب. لن يتم حذف أي حركة من السابق.',
              infoUnlinked:
                'سيتم إنشاء حركة معاكسة لكل عملة لتصفير الرصيد فوراً. لن يتم حذف أي حركة من السابق.',
              successLinked:
                'تم إنشاء حركات التصفير. ستظهر بانتظار موافقة الطرف الآخر.',
              successUnlinked:
                'تم تصفير الحساب بنجاح.',
              confirmMessage: 'سيتم إنشاء {n} حركة معاكسة لتصفير الحساب. الحركات السابقة لن تُحذف.',
            }}
          />
        </>
      )}

      
      {/* Akked safe customer settings menu */}
      <Modal
        visible={showSettingsMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsMenu(false)}
      >
        <View style={styles.settingsOverlay}>
          <TouchableOpacity
            style={styles.settingsBackdrop}
            activeOpacity={1}
            onPress={() => setShowSettingsMenu(false)}
          />

          <View style={styles.settingsSheet}>
            <Text style={styles.settingsSheetTitle}>
              {customer?.is_profit_loss_account ? 'إدارة الحساب' : 'إدارة العميل'}
            </Text>
            <Text style={styles.settingsSheetSubtitle}>{customer?.name}</Text>

            {!customer?.is_profit_loss_account && (
              <>
                <TouchableOpacity
                  style={styles.settingsMenuItem}
                  activeOpacity={0.75}
                  onPress={() => {
                    setShowSettingsMenu(false);
                    router.push({
                      pathname: '/add-customer',
                      params: { id: String(customer?.id || id || '') },
                    });
                  }}
                >
                  <Text style={styles.settingsMenuItemText}>تعديل البيانات</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.settingsMenuItem}
                  activeOpacity={0.75}
                  onPress={() => {
                    setShowSettingsMenu(false);
                    setTimeout(handleResetAccount, 150);
                  }}
                >
                  <Text style={[styles.settingsMenuItemText, styles.settingsMenuItemDanger]}>
                    تصفير الحساب
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.settingsMenuItem}
                  activeOpacity={0.75}
                  onPress={() => {
                    setShowSettingsMenu(false);
                    setTimeout(handleDeleteCustomer, 150);
                  }}
                >
                  <Text style={[styles.settingsMenuItemText, styles.settingsMenuItemDanger]}>
                    حذف العميل
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={styles.settingsCancelButton}
              activeOpacity={0.75}
              onPress={() => setShowSettingsMenu(false)}
            >
              <Text style={styles.settingsCancelText}>إلغاء</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>


      <CalendarRangePicker
        visible={showDateRangeModal}
        onClose={() => setShowDateRangeModal(false)}
        onConfirm={handleCalendarConfirm}
        onPrintAll={handlePrintAll}
        initialStartDate={startDate}
        initialEndDate={endDate}
        maxDate={new Date()}
      />
    </View>
  );
}

const styles = StyleSheet.create({

  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  settingsBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  settingsSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 30,
  },
  settingsSheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
  },
  settingsSheetSubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 22,
  },
  settingsMenuItem: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  settingsMenuItemText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'right',
  },
  settingsMenuItemDanger: {
    color: '#DC2626',
  },
  settingsCancelButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsCancelText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#334155',
  },

  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  gradientHeader: {
    paddingTop: 16,
    paddingBottom: 36,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    flexShrink: 0,
  },
  settingsButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerInfo: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  headerBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  linkedUserBadge: {
    backgroundColor: 'rgba(79, 70, 229, 0.5)',
  },
  pendingHeaderBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.45)',
  },
  content: {
    flex: 1,
  },
  contentScrollContainer: {
    paddingBottom: 120,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  summarySection: {
    backgroundColor: '#FFFFFF',
    marginTop: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 6,
    borderRadius: 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  summaryPanel: {
    backgroundColor: '#FCFCFD',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 10,
  },
  summarySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 10,
  },
  summarySectionIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EDE9FE',
  },
  summarySectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
  },
  summaryCardsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryCardWrap: {
    flex: 1,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    minHeight: 130,
  },
  summaryCardPositive: {
    borderColor: '#A7F3D0',
  },
  summaryCardNegative: {
    borderColor: '#FCA5A5',
  },
  summaryCardActive: {
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  summaryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 4,
  },
  summaryCardIconCircleNegative: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCardIconCirclePositive: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryCardTitle: {
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  summaryCardTitlePositive: {
    color: '#15803D',
  },
  summaryCardTitleNegative: {
    color: '#B91C1C',
  },
  summaryCardEmptyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  summaryCardEmptyDash: {
    fontSize: 28,
    color: '#94A3B8',
    fontWeight: '700',
  },
  summaryCardEmptyHint: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
    marginTop: 2,
  },
  summaryCardAmountList: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  summaryCardAmountItem: {
    alignItems: 'center',
  },
  summaryCardBigAmount: {
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 22,
    textAlign: 'center',
  },
  summaryCardCurrencyCode: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  summaryCardMultiList: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
  },
  summaryCardMultiRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  summaryCardMultiAmount: {
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  summaryCardMultiCode: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    opacity: 0.85,
  },
  summaryCardFooter: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.06)',
    alignItems: 'center',
  },
  summaryCardFooterText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  summaryCardAmountPositive: {
    color: '#15803D',
  },
  summaryCardAmountNegative: {
    color: '#B91C1C',
  },
  summaryCardCurrencyPositive: {
    color: '#15803D',
  },
  summaryCardCurrencyNegative: {
    color: '#B91C1C',
  },
  currencyDetailsSection: {
    backgroundColor: '#FFFFFF',
    marginTop: 8,
    paddingVertical: 12,
  },
  currencyDetailsToggle: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  currencyDetailsToggleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  currencyDetailsToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginLeft: 8,
  },
  currencyDetailsContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  currencyDetailsCard: {
    marginBottom: 8,
  },
  currencyDetailsName: {
    fontSize: 12,
    fontWeight: '400',
    color: '#6B7280',
    marginBottom: 4,
    textAlign: 'right',
  },
  currencyDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  currencyDetailsLabelGreen: {
    fontSize: 12,
    color: '#10B981',
    textAlign: 'right',
  },
  currencyDetailsLabelRed: {
    fontSize: 12,
    color: '#EF4444',
    textAlign: 'right',
  },
  currencyDetailsValueGreen: {
    fontSize: 12,
    fontWeight: '400',
    color: '#10B981',
    textAlign: 'right',
  },
  currencyDetailsValueRed: {
    fontSize: 12,
    fontWeight: '400',
    color: '#EF4444',
    textAlign: 'right',
  },
  tabButtons: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
    backgroundColor: '#FFFFFF',
    flexWrap: 'wrap',
  },
  tabButtonPrimary: {
    backgroundColor: '#F97316',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 140,
  },
  tabButtonPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  tabButton: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flex: 1,
    minWidth: 100,
  },
  tabButtonDisabled: {
    opacity: 0.5,
  },
  tabButtonText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  tabButtonCountBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonCountText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
  movementsSection: {
    backgroundColor: '#FFFFFF',
    marginTop: 8,
    paddingBottom: 100,
  },
  monthHeader: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F9FAFB',
    textAlign: 'right',
  },
  movementColumnsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  movementColumnLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    textAlign: 'center',
  },
  movementDateHeader: {
    width: 44,
    alignItems: 'center',
  },
  movementTypeHeader: {
    width: 80,
    alignItems: 'center',
  },
  movementCreatorHeader: {
    width: 66,
    alignItems: 'center',
  },
  movementCurrencyHeader: {
    width: 34,
    alignItems: 'center',
  },
  movementAmountHeader: {
    width: 62,
    alignItems: 'center',
  },
  movementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  movementRowPending: {
    backgroundColor: '#FFFBEB',
    borderStartWidth: 3,
    borderStartColor: '#F59E0B',
  },
  movementRowRejected: {
    backgroundColor: '#FEF2F2',
    borderStartWidth: 3,
    borderStartColor: '#EF4444',
  },
  movementDate: {
    alignItems: 'center',
    width: 44,
  },
  movementDateMonth: {
    fontSize: 11,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  movementDateDay: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#374151',
    textAlign: 'center',
  },
  movementIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  currencySymbolText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  movementTypeContainer: {
    justifyContent: 'center',
    width: 80,
    alignItems: 'center',
  },
  movementType: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
    textAlign: 'center',
  },
  movementCreatorContainer: {
    width: 66,
    justifyContent: 'center',
    alignItems: 'center',
  },
  movementCreatorValue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
  },
  movementCreatorValueCurrent: {
    color: '#2563EB',
  },
  movementStatusBadge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    marginTop: 4,
    alignItems: 'center',
  },
  movementStatusBadgePending: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  movementStatusBadgeRejected: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
  },
  movementStatusBadgeApproved: {
    backgroundColor: '#DCFCE7',
    borderColor: '#22C55E',
  },
  movementStatusText: {
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
  movementStatusTextPending: {
    color: '#F59E0B',
  },
  movementStatusTextRejected: {
    color: '#B91C1C',
  },
  movementStatusTextApproved: {
    color: '#15803D',
  },
  movementNotes: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  movementAmount: {
    alignItems: 'center',
    width: 62,
  },
  movementAmountText: {
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 2,
    textAlign: 'center',
  },
  movementLabel: {
    fontSize: 10,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  commissionBadge: {
    fontSize: 9,
    color: '#9CA3AF',
    marginTop: 2,
    textAlign: 'center',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 24,
    paddingBottom: 32,
    paddingHorizontal: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
  },
  menuItem: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  menuItemText: {
    fontSize: 16,
    color: '#374151',
    textAlign: 'right',
  },
  menuItemDanger: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  menuItemDangerText: {
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'right',
    fontWeight: '600',
  },
  menuItemCancel: {
    paddingVertical: 16,
    marginTop: 8,
  },
  menuItemCancelText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    fontWeight: '600',
  },
  menuDivider: {
    height: 8,
    backgroundColor: '#F9FAFB',
    marginVertical: 8,
    marginHorizontal: -20,
  },
  searchSection: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchIcon: {
    marginLeft: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: '#111827',
  },
  clearButton: {
    padding: 4,
  },
  searchResultText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 8,
    textAlign: 'right',
  },
  dateRangeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  dateRangeModalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  dateRangeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  dateRangeTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  dateRangeCloseButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateRangeScroll: {
    maxHeight: 500,
  },
  quickOptionsSection: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
    textAlign: 'right',
  },
  quickOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  quickOptionButton: {
    backgroundColor: '#ECFDF5',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: '45%',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D1FAE5',
  },
  quickOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
  },
  customDateSection: {
    padding: 20,
  },
  dateFormatHint: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 16,
    textAlign: 'right',
  },
  dateInputContainer: {
    marginBottom: 16,
  },
  dateInputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    textAlign: 'right',
  },
  dateInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    textAlign: 'right',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateInputText: {
    fontSize: 16,
    color: '#111827',
    flex: 1,
  },
  applyCustomDateButton: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  applyCustomDateButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  selectedRangePreview: {
    margin: 20,
    marginTop: 0,
    padding: 16,
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  selectedRangeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0369A1',
    marginBottom: 8,
    textAlign: 'right',
  },
  selectedRangeText: {
    fontSize: 13,
    color: '#075985',
    marginBottom: 4,
    textAlign: 'right',
  },
  movementsCountText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0369A1',
    marginTop: 8,
    textAlign: 'right',
  },
  dateRangeActions: {
    padding: 20,
    paddingTop: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  printAllButton: {
    backgroundColor: '#10B981',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  printAllButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  printRangeButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  printRangeButtonDisabled: {
    backgroundColor: '#9CA3AF',
    opacity: 0.5,
  },
  printRangeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  linkedAccountInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  linkedAccountInfoText: {
    fontSize: 14,
    color: '#6366F1',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  notificationSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FCD34D',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  notificationSummaryContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  notificationSummaryTextWrap: {
    flex: 1,
  },
  notificationSummaryTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 4,
  },
  notificationSummarySubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B45309',
    textAlign: 'right',
  },
  notificationSummaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF3C7',
  },
  notificationSummaryCountBadge: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#B45309',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  notificationSummaryCountText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  pendingSection: {
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FCD34D',
    padding: 14,
  },
  pendingSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  pendingSectionTitleWrap: {
    flex: 1,
  },
  pendingSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 4,
  },
  pendingSectionSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'right',
    lineHeight: 20,
  },
  pendingSectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCD34D',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  pendingSectionButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  pendingMovementCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 12,
    marginBottom: 10,
  },
  pendingMovementTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  pendingMovementStatusBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#F59E0B',
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  pendingMovementStatusText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
  },
  pendingMovementNumber: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '700',
  },
  pendingMovementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pendingMovementAmount: {
    fontSize: 18,
    fontWeight: '800',
  },
  pendingMovementDirection: {
    fontSize: 13,
    fontWeight: '800',
  },
  pendingMovementAmountGreen: {
    color: '#10B981',
  },
  pendingMovementAmountRed: {
    color: '#EF4444',
  },
  pendingMovementHint: {
    fontSize: 12,
    color: '#92400E',
    textAlign: 'right',
    lineHeight: 20,
    marginBottom: 8,
    fontWeight: '600',
  },
  pendingMovementDate: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'right',
  },
  pendingMoreText: {
    marginTop: 4,
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'right',
  },
});
