const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'customer-details.tsx');

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

const backupPath = `${filePath}.backup-remove-handlecall-leftover-${Date.now()}`;
fs.copyFileSync(filePath, backupPath);
console.log('Backup created:', backupPath);

function findParentJsxBlock(source, markerIndex) {
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

function removeHandleCallButton(source) {
  let next = source;
  let removedCount = 0;

  let markerIndex = next.indexOf('handleCall()');

  while (markerIndex !== -1) {
    const parent = findParentJsxBlock(next, markerIndex);

    if (!parent) {
      break;
    }

    next = next.slice(0, parent.start) + next.slice(parent.end);
    removedCount += 1;
    markerIndex = next.indexOf('handleCall()');
  }

  return { source: next, removedCount };
}

function removeHandleCallFunction(source) {
  let next = source;

  // Remove any remaining handleCall function or callback definition.
  next = next.replace(
    /\n\s*const\s+handleCall\s*=\s*useCallback\([\s\S]*?\n\s*\);\s*/g,
    '\n',
  );

  next = next.replace(
    /\n\s*const\s+handleCall\s*=\s*async\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\s*\};\s*/g,
    '\n',
  );

  next = next.replace(
    /\n\s*const\s+handleCall\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\s*\};\s*/g,
    '\n',
  );

  next = next.replace(
    /\n\s*function\s+handleCall\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}\s*/g,
    '\n',
  );

  return next;
}

function cleanupPhoneImport(source) {
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

const result = removeHandleCallButton(content);
content = result.source;
content = removeHandleCallFunction(content);
content = cleanupPhoneImport(content);

fs.writeFileSync(filePath, content, 'utf8');

console.log(`Removed ${result.removedCount} remaining handleCall button block(s).`);
console.log('Updated:', filePath);
console.log('');
console.log('Done. Now run:');
console.log('npm run typecheck');
console.log('npx expo start -c --port 8082');
