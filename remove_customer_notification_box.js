const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'customer-details.tsx');

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

const backupPath = `${filePath}.backup-remove-notification-box-${Date.now()}`;
fs.copyFileSync(filePath, backupPath);
console.log('Backup created:', backupPath);

function findParentJsxBlock(source, markerIndex) {
  const searchStart = Math.max(0, markerIndex - 5000);
  const beforeMarker = source.slice(searchStart, markerIndex);

  const candidates = [
    '<TouchableOpacity',
    '<Pressable',
    '<View',
  ];

  let best = null;

  for (const candidate of candidates) {
    const localIndex = beforeMarker.lastIndexOf(candidate);
    if (localIndex !== -1) {
      const absoluteIndex = searchStart + localIndex;
      if (!best || absoluteIndex > best.index || candidate === '<TouchableOpacity') {
        best = {
          index: absoluteIndex,
          tagName: candidate.replace('<', ''),
        };
      }
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
  ];

  let markerIndex = -1;

  for (const marker of markers) {
    markerIndex = source.indexOf(marker);
    if (markerIndex !== -1) break;
  }

  if (markerIndex === -1) {
    return {
      changed: false,
      source,
      reason: 'لم أجد نص صندوق الإشعارات داخل customer-details.tsx',
    };
  }

  const block = findParentJsxBlock(source, markerIndex);

  if (!block) {
    return {
      changed: false,
      source,
      reason: 'وجدت النص، لكن لم أستطع تحديد صندوق JSX المحيط به',
    };
  }

  const nextSource = source.slice(0, block.start) + source.slice(block.end);

  return {
    changed: true,
    source: nextSource,
    reason: `Removed ${block.tagName} notification box`,
  };
}

function removeClearlyUnusedNotificationBoxStyles(source) {
  // هذه تنظيفات آمنة للأسماء الشائعة إذا كانت موجودة.
  // إذا لم تكن موجودة، لا يحدث شيء.
  const styleNames = [
    'notificationsSummaryCard',
    'notificationSummaryCard',
    'notificationsCard',
    'notificationBox',
    'notificationsBox',
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
  ];

  let next = source;

  for (const name of styleNames) {
    const regex = new RegExp(`\\n\\s{2}${name}:\\s*\\{[\\s\\S]*?\\},(?=\\n\\s{2}[A-Za-z_][A-Za-z0-9_]*:)`, 'g');
    next = next.replace(regex, '');
  }

  return next;
}

const result = removeNotificationBox(content);

if (!result.changed) {
  console.error(result.reason);
  console.error('No changes were applied. Backup is still available.');
  process.exit(1);
}

content = removeClearlyUnusedNotificationBoxStyles(result.source);

fs.writeFileSync(filePath, content, 'utf8');

console.log(result.reason);
console.log('Updated:', filePath);
console.log('');
console.log('Done. Now run:');
console.log('npm run typecheck');
console.log('npx expo start -c --port 8082');
