import { supabase } from '../lib/supabase';

export type NotificationSource = 'general' | 'customer' | 'customer-details';
export type NotificationFilter = 'all' | 'action' | 'unread';
export type NotificationVisualState = 'action' | 'pending' | 'approved' | 'rejected' | 'info';

export interface NotificationExtraData {
  reason?: string;
  reject_reason?: string;
  created_by_name?: string;
  created_by_user_id?: string;
  source_user_id?: string;
  creator_user_name?: string;
  creator_full_name?: string;
  approval_status?: string;
  requires_action?: boolean;
  [key: string]: unknown;
}

export interface NotificationCustomer {
  name?: string | null;
  user_id?: string | null;
  linked_user_id?: string | null;
}

export interface NotificationMovement {
  id?: string;
  customer_id?: string | null;
  movement_number?: string | null;
  amount?: number | null;
  currency?: string | null;
  movement_type?: string | null;
  is_voided?: boolean | null;
  approval_status?: string | null;
  pending_approval?: boolean | null;
  created_by_user_id?: string | null;
  created_by_user_name?: string | null;
  source_user_id?: string | null;
  reject_reason?: string | null;
  customer?: NotificationCustomer | null;
}

export interface MovementNotification {
  id: string;
  user_id?: string | null;
  recipient_user_id?: string | null;
  sender_user_id?: string | null;
  customer_id?: string | null;
  movement_id: string | null;
  notification_type: string;
  title?: string | null;
  message: string;
  is_read: boolean;
  status?: string | null;
  action_required?: boolean | null;
  created_at: string;
  read_at?: string | null;
  acted_at?: string | null;
  deleted_at?: string | null;
  movement_number?: string | null;
  amount?: number | null;
  currency?: string | null;
  movement_type?: string | null;
  customer_name?: string | null;
  actor_name?: string | null;
  extra_data?: NotificationExtraData | null;
  movement?: NotificationMovement | null;
}

export interface CurrentUserLike {
  userId?: string | null;
  userName?: string | null;
  fullName?: string | null;
}

export interface NotificationMeta {
  title: string;
  subtitle: string;
  customerName: string;
  actorName: string;
  amountText: string;
  directionLabel: string;
  directionColor: string;
  statusText: string;
  statusColor: string;
  statusBg: string;
  rowBorderColor: string;
  rowBg: string;
  visualState: NotificationVisualState;
  isUnread: boolean;
  canTakeAction: boolean;
  rejectReason?: string;
}

export const NOTIFICATION_SELECT = `
  id,
  user_id,
  recipient_user_id,
  sender_user_id,
  customer_id,
  movement_id,
  notification_type,
  title,
  message,
  is_read,
  status,
  action_required,
  created_at,
  read_at,
  acted_at,
  deleted_at,
  movement_number,
  amount,
  currency,
  movement_type,
  customer_name,
  actor_name,
  extra_data,
  movement:account_movements!movement_id(
    id,
    customer_id,
    movement_number,
    amount,
    currency,
    movement_type,
    is_voided,
    approval_status,
    pending_approval,
    created_by_user_id,
    created_by_user_name,
    source_user_id,
    reject_reason,
    customer:customers!customer_id(name, user_id, linked_user_id)
  )
`;

function normalizeNotification(item: MovementNotification): MovementNotification {
  const movement = item.movement || null;
  return {
    ...item,
    customer_id: item.customer_id || movement?.customer_id || null,
    customer_name: item.customer_name || movement?.customer?.name || null,
    movement_number: item.movement_number || movement?.movement_number || null,
    amount: item.amount ?? movement?.amount ?? null,
    currency: item.currency || movement?.currency || null,
    movement_type: item.movement_type || movement?.movement_type || null,
    extra_data: item.extra_data || {},
  };
}

function normalizeText(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function sameId(a?: string | null, b?: string | null) {
  return Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
}

export function formatNotificationAmount(amount?: number | null, currency?: string | null) {
  if (amount == null) return 'بدون مبلغ';
  return `${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency || ''}`.trim();
}

export function getNotificationCustomerId(item: MovementNotification) {
  return item.customer_id || item.movement?.customer_id || null;
}

export function getNotificationRawStatus(item: MovementNotification) {
  return String(
    item.status || item.extra_data?.approval_status || item.movement?.approval_status || '',
  ).toLowerCase();
}

export function isNotificationUnread(item: MovementNotification) {
  const rawStatus = getNotificationRawStatus(item);
  return !item.is_read || rawStatus === 'unread';
}

export function isNotificationPending(item: MovementNotification) {
  const rawStatus = getNotificationRawStatus(item);
  if (rawStatus === 'approved' || rawStatus === 'rejected' || rawStatus === 'done') return false;
  return (
    rawStatus === 'pending' ||
    item.notification_type === 'approval_needed' ||
    Boolean(item.movement?.pending_approval)
  );
}

export function isNotificationCreatedByCurrentUser(
  item: MovementNotification,
  currentUser?: CurrentUserLike | null,
) {
  if (!currentUser?.userId && !currentUser?.userName && !currentUser?.fullName) return false;

  const possibleCreatorIds = [
    item.movement?.source_user_id,
    item.movement?.created_by_user_id,
    item.extra_data?.source_user_id as string | undefined,
    item.extra_data?.created_by_user_id as string | undefined,
    item.sender_user_id,
  ].filter(Boolean);

  const possibleCreatorNames = [
    item.movement?.created_by_user_name,
    item.actor_name,
    item.extra_data?.created_by_name as string | undefined,
    item.extra_data?.creator_user_name as string | undefined,
    item.extra_data?.creator_full_name as string | undefined,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  const currentUserName = normalizeText(currentUser.userName);
  const currentFullName = normalizeText(currentUser.fullName);

  return (
    possibleCreatorIds.some((id) => sameId(id as string, currentUser.userId)) ||
    (Boolean(currentUserName) && possibleCreatorNames.includes(currentUserName)) ||
    (Boolean(currentFullName) && possibleCreatorNames.includes(currentFullName))
  );
}

export function canTakeNotificationAction(
  item: MovementNotification,
  currentUser?: CurrentUserLike | null,
) {
  const rawStatus = getNotificationRawStatus(item);
  const isRecipient =
    sameId(item.user_id, currentUser?.userId) || sameId(item.recipient_user_id, currentUser?.userId);

  return (
    item.notification_type === 'approval_needed' &&
    Boolean(item.movement_id) &&
    item.action_required !== false &&
    isRecipient &&
    !isNotificationCreatedByCurrentUser(item, currentUser) &&
    rawStatus !== 'approved' &&
    rawStatus !== 'rejected' &&
    rawStatus !== 'done'
  );
}

export function getNotificationMeta(
  item: MovementNotification,
  currentUser?: CurrentUserLike | null,
): NotificationMeta {
  const amount = item.amount ?? item.movement?.amount ?? null;
  const currency = item.currency || item.movement?.currency || '';
  const movementType = item.movement_type || item.movement?.movement_type || '';
  const amountText = formatNotificationAmount(amount, currency);
  const customerName = item.customer_name || item.movement?.customer?.name || 'العميل';
  const actorName = item.actor_name || item.movement?.created_by_user_name || 'الطرف الآخر';
  const rawStatus = getNotificationRawStatus(item);
  const pending = isNotificationPending(item);
  const canTakeAction = canTakeNotificationAction(item, currentUser);
  const rejectReason = item.extra_data?.reject_reason || item.extra_data?.reason || item.movement?.reject_reason || undefined;
  const isIncoming = movementType === 'incoming';
  const isOutgoing = movementType === 'outgoing';

  let directionLabel = 'حركة';
  let directionColor = '#2563EB';

  if (isIncoming) {
    directionLabel = 'له';
    directionColor = '#059669';
  } else if (isOutgoing) {
    directionLabel = 'عليه';
    directionColor = '#DC2626';
  } else if (movementType === 'internal_transfer') {
    directionLabel = 'تحويل داخلي';
    directionColor = '#7C3AED';
  }

  let title = item.title || 'إشعار جديد';
  let subtitle = item.message || 'يوجد تحديث جديد';
  let statusText = 'معلومات';
  let statusColor = '#475569';
  let statusBg = '#F1F5F9';
  let rowBorderColor = '#E5E7EB';
  let rowBg = '#FFFFFF';
  let visualState: NotificationVisualState = 'info';

  if (canTakeAction) {
    title = 'حركة تحتاج موافقتك';
    subtitle = `راجع حركة ${customerName} قبل اعتمادها.`;
    statusText = 'تحتاج إجراء';
    statusColor = '#B45309';
    statusBg = '#FEF3C7';
    rowBorderColor = '#F59E0B';
    rowBg = '#FFFBEB';
    visualState = 'action';
  } else if (rawStatus === 'approved' || item.notification_type === 'movement_approved') {
    title = item.title || 'تمت الموافقة على الحركة';
    subtitle = `تم اعتماد حركة ${customerName}.`;
    statusText = 'مقبولة';
    statusColor = '#047857';
    statusBg = '#DCFCE7';
    rowBorderColor = '#BBF7D0';
    rowBg = '#F0FDF4';
    visualState = 'approved';
  } else if (rawStatus === 'rejected' || item.notification_type === 'movement_rejected') {
    title = item.title || 'تم رفض الحركة';
    subtitle = `تم رفض حركة ${customerName}.`;
    statusText = 'مرفوضة';
    statusColor = '#B91C1C';
    statusBg = '#FEE2E2';
    rowBorderColor = '#FECACA';
    rowBg = '#FEF2F2';
    visualState = 'rejected';
  } else if (pending) {
    title = item.title || 'حركة بانتظار الموافقة';
    subtitle = `حركة ${customerName} ما زالت معلقة.`;
    statusText = 'معلقة';
    statusColor = '#B45309';
    statusBg = '#FEF3C7';
    rowBorderColor = '#FBBF24';
    rowBg = '#FFFBEB';
    visualState = 'pending';
  }

  return {
    title,
    subtitle,
    customerName,
    actorName,
    amountText,
    directionLabel,
    directionColor,
    statusText,
    statusColor,
    statusBg,
    rowBorderColor,
    rowBg,
    visualState,
    isUnread: isNotificationUnread(item),
    canTakeAction,
    rejectReason,
  };
}

export function filterNotifications(
  notifications: MovementNotification[],
  filter: NotificationFilter,
  currentUser?: CurrentUserLike | null,
) {
  if (filter === 'action') {
    return notifications.filter((item) => canTakeNotificationAction(item, currentUser));
  }

  if (filter === 'unread') {
    return notifications.filter((item) => isNotificationUnread(item));
  }

  return notifications;
}

export async function getGeneralNotifications(userId: string) {
  const { data, error } = await supabase
    .from('movement_notifications')
    .select(NOTIFICATION_SELECT)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data || []) as MovementNotification[]).map(normalizeNotification);
}

export async function getCustomerNotifications(userId: string, customerId: string) {
  const { data, error } = await supabase
    .from('movement_notifications')
    .select(NOTIFICATION_SELECT)
    .eq('user_id', userId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data || []) as MovementNotification[]).map(normalizeNotification);
}

export async function getNotificationById(notificationId: string) {
  const { data, error } = await supabase
    .from('movement_notifications')
    .select(NOTIFICATION_SELECT)
    .eq('id', notificationId)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizeNotification(data as MovementNotification) : null;
}

export async function markNotificationAsRead(notificationId: string, userId?: string | null, currentStatus?: string | null) {
  const normalizedStatus = String(currentStatus || '').toLowerCase();
  const updatePayload: { is_read: boolean; read_at: string; status?: string } = {
    is_read: true,
    read_at: new Date().toISOString(),
  };

  if (!normalizedStatus || normalizedStatus === 'unread') {
    updatePayload.status = 'read';
  }

  let query = supabase
    .from('movement_notifications')
    .update(updatePayload)
    .eq('id', notificationId);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { error } = await query;
  if (error) throw error;
}

export async function softDeleteNotification(notificationId: string, userId: string) {
  const { error } = await supabase
    .from('movement_notifications')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: userId,
    })
    .eq('id', notificationId)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function getCustomerNotificationAttentionCount(userId: string, customerId: string) {
  const { count, error } = await supabase
    .from('movement_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .or('is_read.eq.false,action_required.eq.true,status.eq.unread,status.eq.pending');

  if (error) throw error;
  return count || 0;
}

export async function getGeneralNotificationAttentionCount(userId: string) {
  const { count, error } = await supabase
    .from('movement_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .or('is_read.eq.false,action_required.eq.true,status.eq.unread,status.eq.pending');

  if (error) throw error;
  return count || 0;
}


export async function approveMovementNotification(
  item: MovementNotification,
  currentUser?: CurrentUserLike | null,
) {
  if (!item.movement_id) {
    throw new Error('لا يوجد رقم حركة مرتبط بهذا الإشعار');
  }

  const userName = currentUser?.userName || currentUser?.fullName;
  if (!userName) {
    throw new Error('تعذر معرفة اسم المستخدم الحالي');
  }

  const { error } = await supabase.rpc('approve_movement', {
    p_movement_id: item.movement_id,
    p_user_name: userName,
  });

  if (error) throw error;

  const latest = await getNotificationById(item.id);
  return latest || {
    ...item,
    status: 'approved',
    action_required: false,
    is_read: true,
    acted_at: new Date().toISOString(),
    read_at: new Date().toISOString(),
  };
}

export async function rejectMovementNotification(
  item: MovementNotification,
  currentUser: CurrentUserLike | null | undefined,
  rejectReason: string,
) {
  if (!item.movement_id) {
    throw new Error('لا يوجد رقم حركة مرتبط بهذا الإشعار');
  }

  const userName = currentUser?.userName || currentUser?.fullName;
  if (!userName) {
    throw new Error('تعذر معرفة اسم المستخدم الحالي');
  }

  const trimmedReason = rejectReason.trim();
  if (!trimmedReason) {
    throw new Error('يرجى كتابة سبب الرفض');
  }

  const { error } = await supabase.rpc('reject_movement_with_reason', {
    p_movement_id: item.movement_id,
    p_user_name: userName,
    p_reject_reason: trimmedReason,
  });

  if (error) throw error;

  const latest = await getNotificationById(item.id);
  return latest || {
    ...item,
    status: 'rejected',
    action_required: false,
    is_read: true,
    acted_at: new Date().toISOString(),
    read_at: new Date().toISOString(),
    extra_data: {
      ...(item.extra_data || {}),
      reject_reason: trimmedReason,
    },
  };
}
