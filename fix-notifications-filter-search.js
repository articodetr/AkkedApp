const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, content) {
  fs.writeFileSync(file, content, 'utf8');
}

function backup(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }

  const backupFile = `${file}.backup-${Date.now()}`;
  fs.copyFileSync(file, backupFile);
  console.log(`Backup created: ${backupFile}`);
}

function replaceOrThrow(content, regex, replacement, label) {
  const next = content.replace(regex, replacement);

  if (next === content) {
    throw new Error(`Failed to patch: ${label}`);
  }

  console.log(`Patched: ${label}`);
  return next;
}

function ensureTextInputImport(content) {
  if (content.includes('TextInput')) return content;

  return replaceOrThrow(
    content,
    /import\s*\{\s*ActivityIndicator,\s*Alert,\s*FlatList,\s*RefreshControl,\s*StyleSheet,\s*Text,\s*TouchableOpacity,\s*View,\s*\}\s*from\s*'react-native';/,
    `import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';`,
    'TextInput import',
  );
}

function ensureSearchIconsImport(content, screenType) {
  if (content.includes('Search') && content.includes('X')) return content;

  if (screenType === 'customer') {
    return replaceOrThrow(
      content,
      /import\s*\{\s*ArrowRight,\s*Bell\s*\}\s*from\s*'lucide-react-native';/,
      `import { ArrowRight, Bell, Search, X } from 'lucide-react-native';`,
      'Customer Search and X icons import',
    );
  }

  return replaceOrThrow(
    content,
    /import\s*\{\s*Bell\s*\}\s*from\s*'lucide-react-native';/,
    `import { Bell, Search, X } from 'lucide-react-native';`,
    'General Search and X icons import',
  );
}

function ensureSearchNotificationsImport(content) {
  if (content.includes('searchNotifications')) return content;

  return replaceOrThrow(
    content,
    /filterNotifications,/,
    `filterNotifications,
  searchNotifications,`,
    'searchNotifications import',
  );
}

function patchFiltersArray(content) {
  return replaceOrThrow(
    content,
    /const FILTERS:\s*Array<\{\s*key:\s*NotificationFilter;\s*label:\s*string\s*\}>\s*=\s*\[\s*\{\s*key:\s*'all',\s*label:\s*'الكل'\s*\},\s*\{\s*key:\s*'action',\s*label:\s*'بحاجة إجراء'\s*\},\s*\{\s*key:\s*'unread',\s*label:\s*'غير مقروءة'\s*\},\s*\];/s,
    `const FILTERS: Array<{ key: NotificationFilter; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'action', label: 'بحاجة إجراء' },
  { key: 'pending', label: 'معلقة' },
  { key: 'approved', label: 'مقبولة' },
  { key: 'rejected', label: 'مرفوضة' },
  { key: 'unread', label: 'غير مقروءة' },
];`,
    'Filters array',
  );
}

function ensureSearchQueryState(content) {
  if (content.includes('const [searchQuery, setSearchQuery]')) return content;

  return replaceOrThrow(
    content,
    /const\s*\[activeFilter,\s*setActiveFilter\]\s*=\s*useState<NotificationFilter>\('all'\);/,
    `const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');`,
    'searchQuery state with generic',
  );
}

function ensureSearchQueryStateLoose(content) {
  if (content.includes('const [searchQuery, setSearchQuery]')) return content;

  return replaceOrThrow(
    content,
    /const\s*\[activeFilter,\s*setActiveFilter\]\s*=\s*useState\('all'\);/,
    `const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');`,
    'searchQuery state loose',
  );
}

function patchVisibleNotifications(content) {
  return replaceOrThrow(
    content,
    /const visibleNotifications = useMemo\(\s*\(\) => filterNotifications\(notifications,\s*activeFilter,\s*currentUser\),\s*\[activeFilter,\s*currentUser,\s*notifications\],\s*\);/s,
    `const visibleNotifications = useMemo(
    () =>
      searchNotifications(
        filterNotifications(notifications, activeFilter, currentUser),
        searchQuery,
      ),
    [activeFilter, currentUser, notifications, searchQuery],
  );`,
    'visibleNotifications with search',
  );
}

function patchFilterCounts(content) {
  return replaceOrThrow(
    content,
    /const filterCounts = useMemo<Record<NotificationFilter,\s*number>>\(\s*\(\) => \(\{\s*all:\s*notifications\.length,\s*action:\s*filterNotifications\(notifications,\s*'action',\s*currentUser\)\.length,\s*unread:\s*filterNotifications\(notifications,\s*'unread',\s*currentUser\)\.length,\s*\}\),\s*\[currentUser,\s*notifications\],\s*\);/s,
    `const filterCounts = useMemo<Record<NotificationFilter, number>>(
    () => ({
      all: notifications.length,
      action: filterNotifications(notifications, 'action', currentUser).length,
      pending: filterNotifications(notifications, 'pending', currentUser).length,
      approved: filterNotifications(notifications, 'approved', currentUser).length,
      rejected: filterNotifications(notifications, 'rejected', currentUser).length,
      unread: filterNotifications(notifications, 'unread', currentUser).length,
    }),
    [currentUser, notifications],
  );`,
    'filterCounts',
  );
}

function patchFilterCountsBrokenGeneric(content) {
  return replaceOrThrow(
    content,
    /const filterCounts = useMemo>\(\s*\(\) => \(\{\s*all:\s*notifications\.length,\s*action:\s*filterNotifications\(notifications,\s*'action',\s*currentUser\)\.length,\s*unread:\s*filterNotifications\(notifications,\s*'unread',\s*currentUser\)\.length,\s*\}\),\s*\[currentUser,\s*notifications\],\s*\);/s,
    `const filterCounts = useMemo<Record<NotificationFilter, number>>(
    () => ({
      all: notifications.length,
      action: filterNotifications(notifications, 'action', currentUser).length,
      pending: filterNotifications(notifications, 'pending', currentUser).length,
      approved: filterNotifications(notifications, 'approved', currentUser).length,
      rejected: filterNotifications(notifications, 'rejected', currentUser).length,
      unread: filterNotifications(notifications, 'unread', currentUser).length,
    }),
    [currentUser, notifications],
  );`,
    'filterCounts broken generic',
  );
}

function insertSearchBox(content) {
  if (content.includes('styles.searchBox')) return content;

  const searchBox = `
      <View style={styles.searchBox}>
        <Search size={18} color="#64748B" />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="بحث بالاسم أو المبلغ أو رقم الحوالة أو الملاحظة"
          placeholderTextColor="#94A3B8"
          style={styles.searchInput}
          textAlign="right"
          returnKeyType="search"
        />
        {searchQuery.trim().length > 0 && (
          <TouchableOpacity
            style={styles.clearSearchButton}
            onPress={() => setSearchQuery('')}
            activeOpacity={0.75}
          >
            <X size={16} color="#64748B" />
          </TouchableOpacity>
        )}
      </View>
`;

  return replaceOrThrow(
    content,
    /(<View style=\{styles\.filtersRow\}>)/,
    `${searchBox}$1`,
    'Search box UI',
  );
}

function patchStyles(content) {
  if (content.includes('searchBox:')) {
    return content;
  }

  content = replaceOrThrow(
    content,
    /filtersRow:\s*\{\s*flexDirection:\s*'row',\s*gap:\s*8,\s*paddingHorizontal:\s*16,\s*paddingVertical:\s*12,\s*\},/,
    `searchBox: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: 10,
  },
  clearSearchButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },`,
    'Search styles and filters wrap',
  );

  content = replaceOrThrow(
    content,
    /filterButton:\s*\{\s*flex:\s*1,/,
    `filterButton: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 100,`,
    'Filter button wrap',
  );

  return content;
}

function patchNotificationScreen(filePath, screenType) {
  console.log(`\nPatching screen: ${filePath}`);

  let content = read(filePath);
  backup(filePath);

  content = ensureTextInputImport(content);
  content = ensureSearchIconsImport(content, screenType);
  content = ensureSearchNotificationsImport(content);

  if (!content.includes("{ key: 'pending', label: 'معلقة' }")) {
    content = patchFiltersArray(content);
  }

  content = ensureSearchQueryState(content);
  content = ensureSearchQueryStateLoose(content);

  if (!content.includes('searchNotifications(')) {
    content = patchVisibleNotifications(content);
  }

  if (
    content.includes("all: notifications.length") &&
    !content.includes("pending: filterNotifications(notifications, 'pending'")
  ) {
    try {
      content = patchFilterCounts(content);
    } catch (error) {
      content = patchFilterCountsBrokenGeneric(content);
    }
  }

  content = insertSearchBox(content);
  content = patchStyles(content);

  write(filePath, content);
}

function patchNotificationService() {
  const filePath = path.join(root, 'services', 'notificationService.ts');
  console.log(`\nPatching service: ${filePath}`);

  let content = read(filePath);
  backup(filePath);

  content = content.replace(
    /export type NotificationFilter = 'all' \| 'action' \| 'unread';/,
    `export type NotificationFilter = 'all' | 'action' | 'pending' | 'approved' | 'rejected' | 'unread';`,
  );

  if (!content.includes('export function getNotificationSearchText')) {
    content = replaceOrThrow(
      content,
      /export function filterNotifications\(\s*notifications:\s*MovementNotification\[],\s*filter:\s*NotificationFilter,\s*currentUser\?:\s*CurrentUserLike\s*\|\s*null,\s*\)\s*\{\s*if \(filter === 'action'\) \{\s*return notifications\.filter\(\(item\) => canTakeNotificationAction\(item,\s*currentUser\)\);\s*\}\s*if \(filter === 'unread'\) \{\s*return notifications\.filter\(\(item\) => isNotificationUnread\(item\)\);\s*\}\s*return notifications;\s*\}/s,
      `export function getNotificationSearchText(item: MovementNotification) {
  const movement = item.movement || null;
  const extra = item.extra_data || {};

  const values: unknown[] = [
    item.title,
    item.message,
    item.customer_name,
    item.actor_name,
    item.movement_number,
    item.amount,
    item.currency,
    item.movement_type,
    item.notification_type,
    item.status,

    movement?.customer?.name,
    movement?.created_by_user_name,
    movement?.movement_number,
    movement?.amount,
    movement?.currency,
    movement?.movement_type,
    movement?.approval_status,
    movement?.reject_reason,
    movement?.notes,

    extra.reason,
    extra.reject_reason,
    extra.created_by_name,
    extra.creator_user_name,
    extra.creator_full_name,
    extra.note,
    extra.notes,
    extra.description,
    extra.movement_note,
    extra.movement_notes,
  ];

  return values
    .map((value) => normalizeText(value == null ? '' : String(value)))
    .filter(Boolean)
    .join(' ');
}

export function notificationMatchesSearch(item: MovementNotification, searchQuery: string) {
  const query = normalizeText(searchQuery).replace(/\\s+/g, ' ');
  if (!query) return true;

  const searchableText = getNotificationSearchText(item);
  return searchableText.includes(query);
}

export function searchNotifications(
  notifications: MovementNotification[],
  searchQuery: string,
) {
  const query = normalizeText(searchQuery);
  if (!query) return notifications;

  return notifications.filter((item) => notificationMatchesSearch(item, query));
}

export function filterNotifications(
  notifications: MovementNotification[],
  filter: NotificationFilter,
  currentUser?: CurrentUserLike | null,
) {
  if (filter === 'action') {
    return notifications.filter((item) => canTakeNotificationAction(item, currentUser));
  }

  if (filter === 'pending') {
    return notifications.filter((item) => isNotificationPending(item));
  }

  if (filter === 'approved') {
    return notifications.filter((item) => {
      const rawStatus = getNotificationRawStatus(item);
      return rawStatus === 'approved' || item.notification_type === 'movement_approved';
    });
  }

  if (filter === 'rejected') {
    return notifications.filter((item) => {
      const rawStatus = getNotificationRawStatus(item);
      return rawStatus === 'rejected' || item.notification_type === 'movement_rejected';
    });
  }

  if (filter === 'unread') {
    return notifications.filter((item) => isNotificationUnread(item));
  }

  return notifications;
}`,
      'service search and filters',
    );
  } else {
    content = content.replace(
      /export function filterNotifications\(\s*notifications:\s*MovementNotification\[],\s*filter:\s*NotificationFilter,\s*currentUser\?:\s*CurrentUserLike\s*\|\s*null,\s*\)\s*\{[\s\S]*?\n\}/,
      `export function filterNotifications(
  notifications: MovementNotification[],
  filter: NotificationFilter,
  currentUser?: CurrentUserLike | null,
) {
  if (filter === 'action') {
    return notifications.filter((item) => canTakeNotificationAction(item, currentUser));
  }

  if (filter === 'pending') {
    return notifications.filter((item) => isNotificationPending(item));
  }

  if (filter === 'approved') {
    return notifications.filter((item) => {
      const rawStatus = getNotificationRawStatus(item);
      return rawStatus === 'approved' || item.notification_type === 'movement_approved';
    });
  }

  if (filter === 'rejected') {
    return notifications.filter((item) => {
      const rawStatus = getNotificationRawStatus(item);
      return rawStatus === 'rejected' || item.notification_type === 'movement_rejected';
    });
  }

  if (filter === 'unread') {
    return notifications.filter((item) => isNotificationUnread(item));
  }

  return notifications;
}`,
    );
  }

  write(filePath, content);
}

try {
  patchNotificationService();

  patchNotificationScreen(
    path.join(root, 'app', 'customer-notifications.tsx'),
    'customer',
  );

  patchNotificationScreen(
    path.join(root, 'app', '(tabs)', 'notifications.tsx'),
    'general',
  );

  console.log('\nDone. Notifications search and filters were fully rewritten.');
  console.log('Now run: npm run typecheck');
} catch (error) {
  console.error('\nPatch failed:');
  console.error(error.message);
  process.exit(1);
}