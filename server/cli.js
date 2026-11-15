// User management:  node server/cli.js add|passwd|list|remove [username]
import readline from 'node:readline';
import { db } from './db.js';
import { createUser, findUserByName, listUsers, setPassword } from './users.js';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.startsWith(question) || s.includes('\n')) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function askNewPassword() {
  // Non-interactive use: BUYLIST_PASSWORD=... node server/cli.js add name
  if (process.env.BUYLIST_PASSWORD) return process.env.BUYLIST_PASSWORD;
  const a = await askHidden('Password: ');
  const b = await askHidden('Repeat password: ');
  if (a !== b) throw new Error('Passwords do not match');
  return a;
}

const need = (name) => {
  if (!name) throw new Error('Username required');
  const user = findUserByName(name);
  if (!user) throw new Error(`No user "${name}"`);
  return user;
};

const [cmd, name] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'add': {
      if (!name) throw new Error('Usage: add <username>');
      if (findUserByName(name)) throw new Error(`User "${name}" already exists`);
      createUser(name, await askNewPassword());
      console.log(`Created user "${name}".`);
      break;
    }
    case 'passwd': {
      const user = need(name);
      setPassword(user.id, await askNewPassword());
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      console.log(`Password changed for "${name}"; all sessions logged out.`);
      break;
    }
    case 'list':
      for (const u of listUsers()) console.log(`${u.username}\t${new Date(u.created_at).toISOString().slice(0, 10)}`);
      break;
    case 'remove': {
      const user = need(name);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      console.log(`Removed "${name}" and all their lists.`);
      break;
    }
    default:
      console.log('Usage: node server/cli.js add|passwd|list|remove [username]');
      process.exitCode = cmd ? 1 : 0;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
