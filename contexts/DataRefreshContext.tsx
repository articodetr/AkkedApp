import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

interface DataRefreshContextType {
  triggerRefresh: (type?: 'movements' | 'customers' | 'all') => void;
  lastRefreshTime: number;
  isRefreshing: boolean;
}

const DataRefreshContext = createContext<DataRefreshContextType | undefined>(undefined);

export function DataRefreshProvider({ children }: { children: React.ReactNode }) {
  const [lastRefreshTime, setLastRefreshTime] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // نُجمّع دفعات أحداث realtime المتتالية في تحديث واحد (debounce). بدون هذا
  // التجميع، إدخال حركة واحدة يُطلق عدة أحداث متلاحقة فتُعيد كل الشاشات الجلب
  // عدة مرات — وهو سبب ظهور "جاري التحميل" بشكل متكرر والبطء.
  const triggerRefresh = useCallback((type: 'movements' | 'customers' | 'all' = 'all') => {
    console.log('[DataRefresh] Triggering refresh:', type);
    setIsRefreshing(true);

    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      setLastRefreshTime(Date.now());
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 800);
  }, []);

  useEffect(() => {
    console.log('[DataRefresh] Setting up realtime subscriptions...');

    const realtimeChannel = supabase
      .channel('data-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'account_movements',
        },
        (payload) => {
          console.log('[DataRefresh] Account movement changed:', payload);
          triggerRefresh('movements');
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customers',
        },
        (payload) => {
          console.log('[DataRefresh] Customer changed:', payload);
          triggerRefresh('customers');
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions',
        },
        (payload) => {
          console.log('[DataRefresh] Transaction changed:', payload);
          triggerRefresh('all');
        }
      )
      .subscribe((status) => {
        console.log('[DataRefresh] Subscription status:', status);
      });

    setChannel(realtimeChannel);

    return () => {
      console.log('[DataRefresh] Cleaning up realtime subscriptions...');
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
      }
    };
  }, [triggerRefresh]);

  return (
    <DataRefreshContext.Provider
      value={{
        triggerRefresh,
        lastRefreshTime,
        isRefreshing,
      }}
    >
      {children}
    </DataRefreshContext.Provider>
  );
}

export function useDataRefresh() {
  const context = useContext(DataRefreshContext);
  if (context === undefined) {
    throw new Error('useDataRefresh must be used within a DataRefreshProvider');
  }
  return context;
}
