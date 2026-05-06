import { supabase } from '@/lib/supabase';
import { AccountMovement } from '@/types/database';

type EditableMovementType = 'incoming' | 'outgoing';

interface EditedMovementSnapshot {
  movement_type: EditableMovementType;
  amount: number;
  currency: string;
  notes: string;
  sender_name?: string | null;
  beneficiary_name?: string | null;
  transfer_number?: string | null;
}

interface SyncEditedMovementNotificationsParams {
  movementId: string;
  movement?: Pick<AccountMovement, 'id' | 'mirror_movement_id'> | null;
  snapshot: EditedMovementSnapshot;
}

function getMirrorMovementType(type: EditableMovementType): EditableMovementType {
  return type === 'incoming' ? 'outgoing' : 'incoming';
}

async function updateNotificationSnapshots(
  movementId: string,
  snapshot: EditedMovementSnapshot,
) {
  const { data: notifications, error: loadError } = await supabase
    .from('movement_notifications')
    .select('id, extra_data')
    .eq('movement_id', movementId)
    .is('deleted_at', null);

  if (loadError) {
    throw loadError;
  }

  await Promise.all(
    (notifications || []).map((notification: any) =>
      supabase
        .from('movement_notifications')
        .update({
          amount: snapshot.amount,
          currency: snapshot.currency,
          movement_type: snapshot.movement_type,
          extra_data: {
            ...(notification.extra_data || {}),
            movement_notes: snapshot.notes,
            movement_note: snapshot.notes,
            updated_movement_at: new Date().toISOString(),
          },
        })
        .eq('id', notification.id),
    ),
  );
}

export async function syncEditedMovementNotifications({
  movementId,
  movement,
  snapshot,
}: SyncEditedMovementNotificationsParams) {
  const primaryId = String(movementId || movement?.id || '');
  const mirrorId = movement?.mirror_movement_id
    ? String(movement.mirror_movement_id)
    : '';

  const updates = [
    {
      id: primaryId,
      snapshot,
    },
    mirrorId && mirrorId !== primaryId
      ? {
          id: mirrorId,
          snapshot: {
            ...snapshot,
            movement_type: getMirrorMovementType(snapshot.movement_type),
          },
        }
      : null,
  ].filter((item): item is { id: string; snapshot: EditedMovementSnapshot } =>
    Boolean(item?.id),
  );

  await Promise.all(
    updates.map(async (item) => {
      await supabase
        .from('account_movements')
        .update({
          movement_type: item.snapshot.movement_type,
          amount: item.snapshot.amount,
          currency: item.snapshot.currency,
          commission: null,
          commission_currency: null,
          notes: item.snapshot.notes,
          sender_name: item.snapshot.sender_name || null,
          beneficiary_name: item.snapshot.beneficiary_name || null,
          transfer_number: item.snapshot.transfer_number || null,
        })
        .eq('id', item.id);

      await updateNotificationSnapshots(item.id, item.snapshot);
    }),
  );
}
