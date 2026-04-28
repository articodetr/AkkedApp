const fs = require('fs');
const path = require('path');

const root = process.cwd();

const servicePath = path.join(root, 'services', 'notificationService.ts');
const detailPath = path.join(root, 'app', 'notification-detail.tsx');

function backup(filePath) {
  const backupPath = `${filePath}.backup-direction-text-${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);
}

function patchFile(filePath, patcher) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf8');
  backup(filePath);

  const next = patcher(content);

  if (next === content) {
    console.log(`No changes applied to: ${filePath}`);
  } else {
    fs.writeFileSync(filePath, next, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

function patchNotificationService(content) {
  let next = content;

  // 1) Fix title for the creator side.
  // Old:
  // incoming => "قيدت لـ"
  // outgoing => "قيدت على"
  // Correct:
  // incoming => "قيدت على"
  // outgoing => "قيدت لـ"
  next = next.replace(
    /if\s*\(isOutgoing\)\s*return\s*`أنت قيدت على \$\{customerName\} مبلغ \$\{amountSentenceText\}`;\s*if\s*\(isIncoming\)\s*return\s*`أنت قيدت لـ \$\{customerName\} مبلغ \$\{amountSentenceText\}`;/,
    "if (isIncoming) return `أنت قيدت على ${customerName} مبلغ ${amountSentenceText}`;\n  if (isOutgoing) return `أنت قيدت لـ ${customerName} مبلغ ${amountSentenceText}`;",
  );

  // 2) Fix title for the other party / notification recipient.
  // Old:
  // incoming => "قيد لك"
  // outgoing => "قيد عليك"
  // Correct:
  // incoming => "قيد عليك"
  // outgoing => "قيد لك"
  next = next.replace(
    /if\s*\(isOutgoing\)\s*return\s*`\$\{actorName\} قيد عليك مبلغ \$\{amountSentenceText\}`;\s*if\s*\(isIncoming\)\s*return\s*`\$\{actorName\} قيد لك مبلغ \$\{amountSentenceText\}`;/,
    "if (isIncoming) return `${actorName} قيد عليك مبلغ ${amountSentenceText}`;\n  if (isOutgoing) return `${actorName} قيد لك مبلغ ${amountSentenceText}`;",
  );

  // 3) Fix amount direction label and color.
  // incoming should display "عليه" in red.
  // outgoing should display "له" in green.
  next = next.replace(
    /if\s*\(isIncoming\)\s*\{\s*directionLabel\s*=\s*'له';\s*directionColor\s*=\s*'#059669';\s*\}\s*else\s*if\s*\(isOutgoing\)\s*\{\s*directionLabel\s*=\s*'عليه';\s*directionColor\s*=\s*'#DC2626';\s*\}/,
    "if (isIncoming) {\n    directionLabel = 'عليه';\n    directionColor = '#DC2626';\n  } else if (isOutgoing) {\n    directionLabel = 'له';\n    directionColor = '#059669';\n  }",
  );

  return next;
}

function patchNotificationDetail(content) {
  let next = content;

  // The DB message may contain the old reversed text.
  // In the detail screen, show the generated corrected title instead.
  next = next.replace(
    /\{notification\.message\s*\|\|\s*meta\.subtitle\}/g,
    "{meta.title || notification.message || meta.subtitle}",
  );

  return next;
}

try {
  patchFile(servicePath, patchNotificationService);
  patchFile(detailPath, patchNotificationDetail);

  console.log('');
  console.log('Done. Notification direction text has been fixed.');
  console.log('');
  console.log('Now run:');
  console.log('npm run typecheck');
  console.log('npx expo start -c --port 8082');
} catch (error) {
  console.error('');
  console.error('Patch failed:');
  console.error(error.message || error);
  process.exit(1);
}
