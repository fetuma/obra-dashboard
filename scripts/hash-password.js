const crypto = require('node:crypto');
// Read password through stdin; do not put credentials in command history.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const password = input.replace(/\r?\n$/, '');
  if (password.length < 12 || password.length > 256) throw new Error('Use uma senha entre 12 e 256 caracteres.');
  const salt = crypto.randomBytes(16).toString('hex');
  crypto.scrypt(password, salt, 64, (err, key) => {
    if (err) throw err;
    console.log(`scrypt$${salt}$${key.toString('hex')}`);
  });
});
