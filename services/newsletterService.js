const Subscriber = require("../model/subscriber");

const subscribe = async (email) => {
  // Idempotent: subscribing twice with the same email just confirms the existing row,
  // so the response never reveals whether the address was already on the list.
  await Subscriber.findOneAndUpdate(
    { email: email.toLowerCase() },
    { email: email.toLowerCase() },
    { upsert: true, setDefaultsOnInsert: true }
  );
};

module.exports = { subscribe };
