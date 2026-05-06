export type MovementApprovalStatus = 'pending' | 'approved' | 'rejected';

type ApprovalLike = {
  approval_status?: string | null;
  pending_approval?: boolean | null;
  is_voided?: boolean | null;
  created_by_user_id?: string | null;
  source_user_id?: string | null;
};

function coerceStatus(status?: string | null): MovementApprovalStatus | null {
  if (status === 'pending' || status === 'approved' || status === 'rejected') {
    return status;
  }

  return null;
}

export function normalizeMovementApprovalStatus(
  value?: ApprovalLike | MovementApprovalStatus | null,
): MovementApprovalStatus {
  if (!value) {
    return 'approved';
  }

  if (typeof value === 'string') {
    return coerceStatus(value) ?? 'approved';
  }

  return (
    coerceStatus(value.approval_status) ??
    (value.pending_approval ? 'pending' : 'approved')
  );
}

export function isPendingMovement(value?: ApprovalLike | null): boolean {
  return normalizeMovementApprovalStatus(value) === 'pending';
}

export function isRejectedMovement(value?: ApprovalLike | null): boolean {
  return normalizeMovementApprovalStatus(value) === 'rejected';
}

export function isApprovedMovement(value?: ApprovalLike | null): boolean {
  return normalizeMovementApprovalStatus(value) === 'approved';
}

export function isPostedMovement(value?: ApprovalLike | null): boolean {
  return isApprovedMovement(value) && !value?.is_voided;
}

export function getMovementApprovalLabel(
  value?: ApprovalLike | MovementApprovalStatus | null,
): string {
  switch (normalizeMovementApprovalStatus(value)) {
    case 'pending':
      return 'بانتظار الموافقة';
    case 'rejected':
      return 'مرفوضة';
    default:
      return 'مقبولة';
  }
}

export function requiresCounterpartyApproval(
  linkedUserId?: string | null,
  _actorUserId?: string | null,
): boolean {
  return Boolean(linkedUserId);
}

export function getMovementCreatorId(value?: ApprovalLike | null): string | null {
  return value?.created_by_user_id || value?.source_user_id || null;
}

export function isMovementCreator(
  value?: ApprovalLike | null,
  currentUserId?: string | null,
): boolean {
  const creatorId = getMovementCreatorId(value);
  return Boolean(
    creatorId &&
      currentUserId &&
      String(creatorId).toLowerCase() === String(currentUserId).toLowerCase(),
  );
}
