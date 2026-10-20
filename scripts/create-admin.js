/* eslint-disable no-console */
// Creates an admin account. Run it once against the database you want an admin in:
//
//   node scripts/create-admin.js                       # asks for name, email and password (the password is not shown)
//   ADMIN_NAME="Aaryan" ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' node scripts/create-admin.js
//
// Admins can never be created through the website or the API, and scripts/seed.js (which uses a well known password)
// must not be run on a live database, so this is the way to get the first admin. The password must be at least
// 12 characters with an uppercase letter, a lowercase letter and a number. It is never written to a file or printed.
const readline = require("readline");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
require("dotenv").config();

const MIN_LENGTH = 12;

const checkPassword = (password) => {
  if (typeof password !== "string" || password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters`;
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) return "Use an uppercase letter, a lowercase letter and a number";
  return "";
};

/** Creates the admin. Throws a message-only Error when something is wrong; nothing is created in that case. */
const createAdmin = async ({ name, email, password }) => {
  const User = require("../model/user");
  const address = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) throw new Error("Enter a valid email address");
  if (String(name ?? "").trim().length < 2) throw new Error("Enter the admin's name");
  const weak = checkPassword(password);
  if (weak) throw new Error(weak);
  if (await User.exists({ email: { $eq: address } })) throw new Error("An account with this email already exists");

  const user = await User.create({ name: String(name).trim(), email: address, password: await bcrypt.hash(password, 10), role: "Admin" });
  return { id: user._id, email: user.email };
};

// A prompt that does not echo what is typed (for the password)
const ask = (question, { hidden = false } = {}) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.startsWith(question)) rl.output.write(text);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });

if (require.main === module) {
  (async () => {
    const name = process.env.ADMIN_NAME || (await ask("Admin name: "));
    const email = process.env.ADMIN_EMAIL || (await ask("Admin email: "));
    const password = process.env.ADMIN_PASSWORD || (await ask(`Password (at least ${MIN_LENGTH} characters, not shown): `, { hidden: true }));
    await mongoose.connect(process.env.DB_URL);
    console.log("Creating an admin on", mongoose.connection.name);
    const admin = await createAdmin({ name, email, password });
    console.log(`Done: ${admin.email} is an admin. Sign in on the site with that email and the password you chose.`);
    await mongoose.disconnect();
  })().catch(async (error) => {
    console.error(error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { createAdmin, checkPassword, MIN_LENGTH };
