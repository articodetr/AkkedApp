import { supabase } from '@/lib/supabase';
import { Customer } from '@/types/database';

export function buildOwnedCustomerFilter(
  userId: string,
  ownerField: string = 'user_id',
): string {
  return `${ownerField}.eq.${userId}`;
}

export function buildUserScopeFilter(
  userId: string,
  ownerField: string = 'user_id',
  linkedField: string = 'linked_user_id',
): string {
  void linkedField;
  return buildOwnedCustomerFilter(userId, ownerField);
}

export function buildScopedCustomerFilter(
  userId: string,
  includeProfitLoss: boolean = false,
): string {
  // User-facing customer lists should only show customers owned by the current user.
  const filters = [buildOwnedCustomerFilter(userId)];

  if (includeProfitLoss) {
    filters.push('phone.eq.PROFIT_LOSS_ACCOUNT');
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
    .or(buildScopedCustomerFilter(userId, includeProfitLoss))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as Customer | null) || null;
}
