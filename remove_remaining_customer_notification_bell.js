const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'customer-details.tsx');

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

const backupPath = `${filePath}.backup-remove-remaining-bell-${Date.now()}`;
fs.copyFileSync(filePath, backupPath);
console.log('Backup created:', backupPath);

function findAndRemoveJsxParent(source, marker) {
  const markerIndex = source.indexOf(marker);

  if (markerIndex === -1) {
    return { source, removed: false, reason: `Marker not found: ${marker}` };
  }

  const searchStart = Math.max(0, markerIndex - 5000);
  const before = source.slice(searchStart, markerIndex);

  const candidates = ['<TouchableOpacity', '<Pressable', '<View'];
  let best = null;

  for (const candidate of candidates) {
    const localIndex = before.lastIndexOf(candidate);
    if (localIndex === -1) continue;

    const absoluteIndex = searchStart + localIndex;

    if (!best || absoluteIndex > best.index) {
      best = {
        index: absoluteIndex,
        tagName: candidate.replace('<', ''),
      };
    }
  }

  if (!best) {
    return { source, removed: false, reason: 'Could not find JSX parent block' };
  }

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

      if (source[removeEnd] === '\n') removeEnd += 1;

      const removedBlock = source.slice(removeStart, removeEnd);

      if (
        removedBlock.includes('unreadNotificationsCount') ||
        removedBlock.includes('<Bell')
      ) {
        return {
          source: source.slice(0, removeStart) + source.slice(removeEnd),
          removed: true,
          reason: `Removed ${tagName} block`,
        };
      }

      return {
        source,
        removed: false,
        reason: 'Found parent block, but it did not look like notification block',
      };
    }
  }

  return { source, removed: false, reason: 'Could not find end of JSX parent block' };
}

function removeStyleBlock(source, name) {
  const regex = new RegExp(
    `\\n\\s{2}${name}:\\s*\\{[\\s\\S]*?\\},(?=\\n\\s{2}[A-Za-z_][A-Za-z0-9_]*\\s*:)`,
    'g',
  );

  return source.replace(regex, '');
}

let result = findAndRemoveJsxParent(content, 'unreadNotificationsCount');

if (!result.removed) {
  result = findAndRemoveJsxParent(content, '<Bell size={16} color="#6B7280" />');
}

content = result.source;

// Remove any remaining small unread badge JSX if the parent block was unusual.
content = content.replace(
  /\{unreadNotificationsCount\s*>\s*0\s*&&\s*\([\s\S]*?\)\}/g,
  '',
);

// Remove common leftover styles for that removed notification button.
[
  'notificationButton',
  'notificationsButton',
  'notificationBadge',
  'notificationsBadge',
  'notificationBadgeText',
  'notificationsBadgeText',
  'notificationIcon',
  'notificationsIcon',
].forEach((name) => {
  content = removeStyleBlock(content, name);
});

// Remove Bell from lucide import if still present.
content = content.replace(
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

fs.writeFileSync(filePath, content, 'utf8');

console.log(result.reason);
console.log('Updated:', filePath);
console.log('');
console.log('Done. Now run:');
console.log('npm run typecheck');
console.log('npx expo start -c --port 8082');
