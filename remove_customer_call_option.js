const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'customer-details.tsx');

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

const backupPath = `${filePath}.backup-remove-call-option-${Date.now()}`;
fs.copyFileSync(filePath, backupPath);
console.log('Backup created:', backupPath);

function findParentJsxBlock(source, markerIndex) {
  const searchStart = Math.max(0, markerIndex - 3000);
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
        block: source.slice(removeStart, removeEnd),
      };
    }
  }

  return null;
}

function removeCallButton(source) {
  const markers = [
    '>اتصال<',
    'اتصال',
  ];

  for (const marker of markers) {
    let markerIndex = source.indexOf(marker);

    while (markerIndex !== -1) {
      const parent = findParentJsxBlock(source, markerIndex);

      if (
        parent &&
        parent.block.includes('اتصال') &&
        (
          parent.block.includes('Phone') ||
          parent.block.includes('Call') ||
          parent.block.includes('handleCall') ||
          parent.block.includes('tel:') ||
          parent.block.includes('اتصال')
        )
      ) {
        const nextSource = source.slice(0, parent.start) + source.slice(parent.end);
        return {
          source: nextSource,
          removed: true,
          reason: `Removed ${parent.tagName} call button block`,
        };
      }

      markerIndex = source.indexOf(marker, markerIndex + marker.length);
    }
  }

  return {
    source,
    removed: false,
    reason: 'Could not find call button JSX block',
  };
}

function removeCallHandlers(source) {
  let next = source;

  // Remove common call handler names if they exist.
  const handlerNames = [
    'handleCall',
    'handlePhoneCall',
    'handleCustomerCall',
    'callCustomer',
    'openPhoneCall',
  ];

  for (const name of handlerNames) {
    // const handleCall = useCallback(...)
    next = next.replace(
      new RegExp(`\\n\\s*const\\s+${name}\\s*=\\s*useCallback\\([\\s\\S]*?\\n\\s*\\);`, 'g'),
      '',
    );

    // const handleCall = async () => { ... };
    next = next.replace(
      new RegExp(`\\n\\s*const\\s+${name}\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?\\n\\s*\\};`, 'g'),
      '',
    );

    // const handleCall = () => { ... };
    next = next.replace(
      new RegExp(`\\n\\s*const\\s+${name}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?\\n\\s*\\};`, 'g'),
      '',
    );

    // function handleCall(...) { ... }
    next = next.replace(
      new RegExp(`\\n\\s*function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\s*\\}`, 'g'),
      '',
    );
  }

  return next;
}

function cleanupLucidePhoneImports(source) {
  // Remove phone icons from lucide import if no Phone usage remains.
  if (/<Phone|<PhoneCall|<PhoneOutgoing|<PhoneForwarded/.test(source)) {
    return source;
  }

  return source.replace(
    /import\s*\{([^}]+)\}\s*from\s*'lucide-react-native';/s,
    (full, imports) => {
      const names = imports
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => !['Phone', 'PhoneCall', 'PhoneOutgoing', 'PhoneForwarded'].includes(item));

      return `import { ${names.join(', ')} } from 'lucide-react-native';`;
    },
  );
}

function cleanupUnusedCallStyles(source) {
  // Remove only very specific call button styles if present.
  const styleNames = [
    'callButton',
    'phoneButton',
    'contactButton',
    'callButtonText',
    'phoneButtonText',
    'contactButtonText',
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

const removed = removeCallButton(content);
content = removed.source;
content = removeCallHandlers(content);
content = cleanupLucidePhoneImports(content);
content = cleanupUnusedCallStyles(content);

fs.writeFileSync(filePath, content, 'utf8');

console.log(removed.reason);
console.log('Updated:', filePath);
console.log('');
console.log('Done. Now run:');
console.log('npm run typecheck');
console.log('npx expo start -c --port 8082');
