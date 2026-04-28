const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'customer-details.tsx');

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

const backupPath = `${filePath}.backup-realtime-counter-${Date.now()}`;
fs.copyFileSync(filePath, backupPath);
console.log('Backup created:', backupPath);

const oldBlock = `useEffect(() => {
    if (!currentUser?.userId) return;

    const channel = supabase
      .channel('notifications-counter')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'movement_notifications',
          filter: \`user_id=eq.\${currentUser.userId}\`,
        },
        () => {
          loadUnreadNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.userId, loadUnreadNotifications]);`;

const newBlock = `useEffect(() => {
    if (!currentUser?.userId) return;

    const channel = supabase
      .channel(\`notifications-counter-\${currentUser.userId}-\${Date.now()}\`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'movement_notifications',
          filter: \`user_id=eq.\${currentUser.userId}\`,
        },
        () => {
          loadUnreadNotifications();
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // Ignore duplicate cleanup errors.
      }
    };
  }, [currentUser?.userId, loadUnreadNotifications]);`;

if (content.includes(oldBlock)) {
  content = content.replace(oldBlock, newBlock);
  console.log('Replaced exact notifications-counter realtime block.');
} else {
  // More flexible replacement for formatting differences.
  const regex = /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(!currentUser\?\.userId\)\s*return;\s*const\s+channel\s*=\s*supabase\s*\.channel\('notifications-counter'\)[\s\S]*?return\s*\(\)\s*=>\s*\{\s*supabase\.removeChannel\(channel\);\s*\};\s*\},\s*\[currentUser\?\.userId,\s*loadUnreadNotifications\]\s*\);/;

  if (!regex.test(content)) {
    console.error('Could not find the notifications-counter useEffect block.');
    console.error('Please replace it manually using README.txt.');
    process.exit(1);
  }

  content = content.replace(regex, newBlock);
  console.log('Replaced notifications-counter realtime block using flexible match.');
}

fs.writeFileSync(filePath, content, 'utf8');

console.log('');
console.log('Done. Now run:');
console.log('npm run typecheck');
console.log('npx expo start -c --port 8082');
