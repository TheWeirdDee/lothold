// Local administration: create a user/organisation, or enable testnet anchoring for an organisation.
//   node --env-file=.env scripts/admin.ts create-user <email> <name> <organisation>   (password read from LOTHOLD_PASSWORD)
//   node --env-file=.env scripts/admin.ts add-user <email> <name> <existing-member-email>  (adds to that member's organisation)
//   node --env-file=.env scripts/admin.ts enable-chain <email>
//   node --env-file=.env scripts/admin.ts disable-chain <email>
import { openDb, get, run, id, now, audit } from '../server/db.ts';
import { hashPassword, PASSWORD_MIN } from '../server/security.ts';

const [cmd, email, name, org] = process.argv.slice(2);
const db = openDb();
if (cmd === 'create-user') {
  const pw = process.env.LOTHOLD_PASSWORD;
  if (!email || !name || !org || !pw || pw.length < PASSWORD_MIN) throw new Error(`usage: LOTHOLD_PASSWORD=<min ${PASSWORD_MIN} chars> ... create-user <email> <name> <organisation>`);
  const orgId = id(), userId = id();
  run(db, 'INSERT INTO orgs (id, name, created_at) VALUES (?, ?, ?)', orgId, org, now());
  run(db, 'INSERT INTO users (id, org_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', userId, orgId, email, name, hashPassword(pw), 'admin', now());
  console.log(`created ${email} in organisation "${org}"`);
} else if (cmd === 'add-user') {
  const pw = process.env.LOTHOLD_PASSWORD;
  const member = get<{ org_id: string }>(db, 'SELECT org_id FROM users WHERE email = ?', org ?? '');
  if (!email || !name || !member || !pw || pw.length < PASSWORD_MIN) throw new Error(`usage: LOTHOLD_PASSWORD=<min ${PASSWORD_MIN} chars> ... add-user <email> <name> <existing-member-email>`);
  run(db, 'INSERT INTO users (id, org_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id(), member.org_id, email, name, hashPassword(pw), 'reviewer', now());
  audit(db, { orgId: member.org_id, type: 'admin.add_user', data: { email } });
  console.log(`added ${email} to the organisation of ${org}`);
} else if (cmd === 'enable-chain' || cmd === 'disable-chain') {
  const u = get<{ org_id: string }>(db, 'SELECT org_id FROM users WHERE email = ?', email ?? '');
  if (!u) throw new Error('no such user');
  run(db, 'UPDATE orgs SET chain_enabled = ? WHERE id = ?', cmd === 'enable-chain' ? 1 : 0, u.org_id);
  audit(db, { orgId: u.org_id, type: `admin.${cmd}`, data: {} });
  console.log(`${cmd} for organisation of ${email}`);
} else {
  console.log('commands: create-user | add-user | enable-chain | disable-chain');
}
db.close();
