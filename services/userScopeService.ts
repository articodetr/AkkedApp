import { supabase } from '@/lib/supabase';
import { Customer } from '@/types/database';

/**
 * Customers owned by the current app user only.
 * Use this for normal customer lists so a user does not see the other side's
 * private customer records as editable records.
 */
export function buildOwnedCustomerFilter(
  userId: string,
  ownerField: string = 'user_id',
): string {
  return `${ownerField}.eq.${userId}`;
}

/**
 * Customers where the current user is either the owner or the linked counterparty.
 * Use this for statistics, notifications, and approval dashboards.
 */
export function buildUserScopeFilter(
  userId: string,
  ownerField: string = 'user_id',
  linkedField: string = 'linked_user_id',
): string {
  return `${ownerField}.eq.${userId},${linkedField}.eq.${userId}`;
}

/**
 * Main app customer filter.
 * Keep customer pages owner-only to avoid showing duplicate/foreign records.
 */
export function buildScopedCustomerFilter(
  userId: string,
  includeProfitLoss: boolean = false,
): string {
  const filters = [buildOwnedCustomerFilter(userId)];

  if (includeProfitLoss) {
    filters.push('phone.eq.PROFIT_LOSS_ACCOUNT');
    filters.push('is_profit_loss_account.eq.true');
  }

  return filters.join(',');
}

/**
 * Statistics/approvals filter.
 * This must include both owned customers and customers where the current user is
 * the linked counterparty, otherwise pending approvals and cash flow can appear
 * as zero even when movements exist.
 */
export function buildStatisticsCustomerFilter(
  userId: string,
  includeProfitLoss: boolean = true,
): string {
  const filters = [buildUserScopeFilter(userId)];

  if (includeProfitLoss) {
    filters.push('phone.eq.PROFIT_LOSS_ACCOUNT');
    filters.push('is_profit_loss_account.eq.true');
  }

  return filters.join(',');
}

/**
 * Read/detail customer filter.
 * Use this when a user opens a specific customer/movement coming from
 * notifications or linked-account approvals. It allows the record when the
 * current user is either the owner or the linked counterparty, while keeping the
 * normal customer list owner-only.
 */
export function buildReadableCustomerFilter(
  userId: string,
  includeProfitLoss: boolean = false,
): string {
  const filters = [buildUserScopeFilter(userId)];

  if (includeProfitLoss) {
    filters.push('phone.eq.PROFIT_LOSS_ACCOUNT');
    filters.push('is_profit_loss_account.eq.true');
  }

  return filters.join(',');
}

export async function fetchAccessibleCustomers(
  userId: string,
  includeProfitLoss: boolean = false,
): Promise<Customer[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(buildScopedCustomerFilter(userId, includeProfitLoss))
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []) as Customer[];
}

export async function fetchAccessibleCustomerIds(
  userId: string,
  includeProfitLoss: boolean = false,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .or(buildScopedCustomerFilter(userId, includeProfitLoss));

  if (error) {
    throw error;
  }

  return (data || []).map((item) => item.id as string);
}

export async function fetchAccessibleCustomerById(
  userId: string,
  customerId: string,
  includeProfitLoss: boolean = false,
): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .or(buildReadableCustomerFilter(userId, includeProfitLoss))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Customer | null) || null;
}
