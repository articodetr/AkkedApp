const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', '(tabs)', '_layout.tsx');

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

const backupPath = `${filePath}.backup-pending-badge-${Date.now()}`;
fs.copyFileSync(filePath, backupPath);
console.log('Backup created:', backupPath);

const helperBlock = `
// =========================================================
// Pending notifications badge helpers
// The tab badge should count still-pending approvals,
// not only unread notifications.
// =========================================================
type PendingNotificationRow = {
  id: string;
  status?: string | null;
  action_required?: boolean | null;
  notification_type?: string | null;
  extra_data?: {
    approval_status?: string | null;
    [key: string]: unknown;
  } | null;
  movement?: {
    approval_status?: string | null;
    pending_approval?: boolean | null;
  } | null;
};

function isStillPendingNotification(item: PendingNotificationRow) {
  const status = String(
    item.status ||
      item.extra_data?.approval_status ||
      item.movement?.approval_status ||
      '',
  ).toLowerCase();

  if (
    status === 'approved' ||
    status === 'rejected' ||
    status === 'done' ||
    status === 'cancelled' ||
    status === 'canceled'
  ) {
    return false;
  }

  return (
    status === 'pending' ||
    item.notification_type === 'approval_needed' ||
    item.action_required === true ||
    item.movement?.pending_approval === true
  );
}
`;

const newLoadUnreadCount = `const loadUnreadCount = useCallback(async () => {
    if (!currentUser?.userId) {
      setUnreadCount(0);
      return;
    }

    const { data, error } = await supabase
      .from('movement_notifications')
      .select(\`
        id,
        status,
        action_required,
        notification_type,
        extra_data,
        movement:account_movements!movement_id(
          approval_status,
          pending_approval
        )
      \`)
      .eq('user_id', currentUser.userId)
      .is('deleted_at', null);

    if (error) {
      console.error('[TabsLayout] Error loading pending notifications count:', error);
      setUnreadCount(0);
      return;
    }

    const pendingCount = ((data || []) as PendingNotificationRow[]).filter(
      isStillPendingNotification,
    ).length;

    setUnreadCount(pendingCount);
  }, [currentUser?.userId]);`;

// 1) Insert helper block before TabsLayout once.
if (!content.includes('type PendingNotificationRow')) {
  const exportMarker = 'export default function TabsLayout()';
  if (!content.includes(exportMarker)) {
    console.error('Could not find: export default function TabsLayout()');
    process.exit(1);
  }

  content = content.replace(exportMarker, `${helperBlock}\n${exportMarker}`);
  console.log('Added pending badge helper functions.');
} else {
  console.log('Pending badge helper functions already exist.');
}

// 2) Replace loadUnreadCount function.
const loadUnreadCountRegex =
  /const\s+loadUnreadCount\s*=\s*useCallback\(\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\},\s*\[currentUser\?\.userId\]\s*\);/;

if (!loadUnreadCountRegex.test(content)) {
  console.error('Could not find the current loadUnreadCount function.');
  console.error('Please open app/(tabs)/_layout.tsx and replace loadUnreadCount manually using the README code.');
  fs.writeFileSync(filePath, content, 'utf8');
  process.exit(1);
}

content = content.replace(loadUnreadCountRegex, newLoadUnreadCount);
console.log('Updated loadUnreadCount to count pending approvals.');

fs.writeFileSync(filePath, content, 'utf8');

console.log('');
console.log('Done. Now run:');
console.log('npm run typecheck');
console.log('npx expo start -c --port 8082');
