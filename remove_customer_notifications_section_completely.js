const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'customer-details.tsx');

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

const backupPath = `${filePath}.backup-remove-notifications-section-completely-${Date.now()}`;
fs.copyFileSync(filePath, backupPath);
console.log('Backup created:', backupPath);

function cleanupLucideBellImport(source) {
  return source.replace(
    /import\s*\{([^}]+)\}\s*from\s*'lucide-react-native';/s,
    (full, imports) => {
      const names = imports
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => item !== 'Bell');

      return `import { ${names.join(', ')} } from 'lucide-react-native';`;
    },
  );
}

function removeNotificationServiceImport(source) {
  // Remove the dedicated import if it is only used for this removed box.
  return source.replace(
    /\n?import\s*\{\s*getCustomerNotificationAttentionCount\s*\}\s*from\s*['"]\.\.\/services\/notificationService['"];\s*/g,
    '',
  );
}

function removeStateAndLogic(source) {
  let next = source;

  // Remove state.
  next = next.replace(
    /\s*const\s*\[\s*unreadNotificationsCount\s*,\s*setUnreadNotificationsCount\s*\]\s*=\s*useState\([^)]*\);\s*/g,
    ' ',
  );

  // Remove customerNotificationsCount constant.
  next = next.replace(
    /\s*const\s+customerNotificationsCount\s*=\s*unreadNotificationsCount\s*;\s*/g,
    ' ',
  );

  // Remove loadUnreadNotifications function.
  next = next.replace(
    /\s*const\s+loadUnreadNotifications\s*=\s*useCallback\(\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[\s*currentUser\?\.userId\s*,\s*id\s*\]\s*\)\s*;\s*/g,
    ' ',
  );

  // Remove call inside focus effect.
  next = next.replace(/\s*loadUnreadNotifications\(\)\s*;\s*/g, ' ');

  // Remove dependency from focus effect.
  next = next.replace(/,\s*loadUnreadNotifications/g, '');

  // Remove realtime useEffect that listens to movement_notifications and updates the removed counter.
  next = next.replace(
    /\s*\/\/[^\n\r]*الإشعارات[^\n\r]*[\r\n\s]*useEffect\(\(\)\s*=>\s*\{[\s\S]*?movement_notifications[\s\S]*?removeChannel\(channel\)\s*;?\s*\}\s*;?\s*\}\s*,\s*\[\s*currentUser\?\.userId\s*\]\s*\)\s*;\s*/g,
    ' ',
  );

  next = next.replace(
    /\s*useEffect\(\(\)\s*=>\s*\{\s*if\s*\(!currentUser\?\.userId\)\s*return\s*;[\s\S]*?movement_notifications[\s\S]*?removeChannel\(channel\)\s*;?\s*\}\s*;?\s*\}\s*,\s*\[\s*currentUser\?\.userId\s*\]\s*\)\s*;\s*/g,
    ' ',
  );

  return next;
}

function findParentJsxBlock(source, markerIndex) {
  const searchStart = Math.max(0, markerIndex - 8000);
  const beforeMarker = source.slice(searchStart, markerIndex);

  const candidates = ['<TouchableOpacity', '<Pressable', '<View'];
  let best = null;

  for (const candidate of candidates) {
    const localIndex = beforeMarker.lastIndexOf(candidate);
    if (localIndex === -1) continue;

    const absoluteIndex = searchStart + localIndex;

    if (!best || absoluteIndex > best.index) {
      best = {
        index: absoluteIndex,
        tagName: candidate.replace('<', ''),
      };
    }
  }

  if (!best) return null;

  const tagName = best.tagName;
  const tagRegex = /<\/?([A-Za-z][A-Za-z0-9.]*)\b[^>]*\/?>/g;
  tagRegex.lastIndex = best.index;

  let depth = 0;
  let started = false;
  let match;

  while ((match = tagRegex.exec(source)) !== null) {
    const full = match[0];
    const currentTag = match[1];
    const isClosing = full.startsWith('</');
    const isSelfClosing = full.endsWith('/>');

    if (currentTag !== tagName) continue;

    if (!isClosing && !isSelfClosing) {
      depth += 1;
      started = true;
    } else if (isClosing) {
      depth -= 1;
    }

    if (started && depth === 0) {
      const lineStart = source.lastIndexOf('\n', best.index);
      const removeStart = lineStart === -1 ? best.index : lineStart;
      let removeEnd = tagRegex.lastIndex;

      if (source[removeEnd] === '\n') {
        removeEnd += 1;
      }

      return {
        start: removeStart,
        end: removeEnd,
        tagName,
      };
    }
  }

  return null;
}

function removeNotificationBox(source) {
  const markers = [
    'إشعارات هذا العميل فقط',
    'إشعارات العميل فقط',
    'customerNotificationsCount',
    'styles.notifications',
    'styles.notification',
  ];

  let next = source;
  let removedAny = false;

  for (const marker of markers) {
    const markerIndex = next.indexOf(marker);
    if (markerIndex === -1) continue;

    const block = findParentJsxBlock(next, markerIndex);
    if (!block) continue;

    const removed = next.slice(block.start, block.end);

    // Safety: remove only a block that clearly belongs to notifications.
    if (
      removed.includes('إشعارات') ||
      removed.includes('customerNotificationsCount') ||
      removed.includes('Bell')
    ) {
      next = next.slice(0, block.start) + next.slice(block.end);
      removedAny = true;
      console.log(`Removed notification JSX block: ${block.tagName}`);
      break;
    }
  }

  return {
    source: next,
    removedAny,
  };
}

function removeUnusedNotificationStyles(source) {
  // Remove common styles used by the old notification box if present.
  const styleNames = [
    'notificationsSummaryCard',
    'notificationSummaryCard',
    'notificationsCard',
    'notificationCard',
    'notificationsBox',
    'notificationBox',
    'notificationsSection',
    'notificationSection',
    'notificationsButton',
    'notificationButton',
    'notificationsCountBadge',
    'notificationCountBadge',
    'notificationsCountText',
    'notificationCountText',
    'notificationsIconBox',
    'notificationIconBox',
    'notificationsTextWrap',
    'notificationTextWrap',
    'notificationsTitle',
    'notificationTitle',
    'notificationsSubtitle',
    'notificationSubtitle',
    'customerNotificationsCard',
    'customerNotificationsBadge',
    'customerNotificationsTitle',
    'customerNotificationsSubtitle',
  ];

  let next = source;

  for (const name of styleNames) {
    next = next.replace(
      new RegExp(`\\n\\s{2}${name}:\\s*\\{[\\s\\S]*?\\},(?=\\n\\s{2}[A-Za-z_][A-Za-z0-9_]*\\s*:)`, 'g'),
      '',
    );
  }

  return next;
}

content = cleanupLucideBellImport(content);
content = removeNotificationServiceImport(content);

const removeResult = removeNotificationBox(content);
content = removeResult.source;

content = removeStateAndLogic(content);
content = removeUnusedNotificationStyles(content);

// Final safety: do not leave the old card visible even if its JSX had an unusual structure.
content = content.replace(
  /\{customerNotificationsCount\s*>\s*0\s*&&\s*\([\s\S]*?إشعارات[\s\S]*?\)\}/g,
  '',
);

fs.writeFileSync(filePath, content, 'utf8');

console.log('');
console.log('Done. Customer notification box and its counter logic were removed completely.');
console.log('');
console.log('Now run:');
console.log('npm run typecheck');
console.log('npx expo start -c --port 8082');
