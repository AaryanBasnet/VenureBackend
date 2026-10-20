const AppError = require("./AppError");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Reads ?page and ?limit. `paged` is true when the client asked for a page, so older callers keep getting a plain array. */
const readPage = (query = {}) => {
  const limit = Math.min(Math.max(parseInt(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(parseInt(query.page) || 1, 1);
  return { paged: query.page !== undefined || query.group !== undefined, page, limit, skip: (page - 1) * limit };
};

/** One page of a list, with the size of every group so tabs can show their counts. `groups` maps a name to a Mongo filter. */
const pagedList = async ({ model, base, groups, group = "all", page, limit, skip, sort, populate = [] }) => {
  const filterFor = (name) => (name === "all" ? base : { $and: [base, groups[name]] });
  if (group !== "all" && !groups[group]) throw new AppError(`Unknown group "${group}"`, 400);

  const names = ["all", ...Object.keys(groups)];
  const find = model.find(filterFor(group)).sort(sort).skip(skip).limit(limit);
  populate.forEach(([path, select]) => find.populate(path, select));
  const [items, ...totals] = await Promise.all([find, ...names.map((name) => model.countDocuments(filterFor(name)))]);

  const counts = Object.fromEntries(names.map((name, i) => [name, totals[i]]));
  const total = counts[group];
  return { items, total, page, pages: Math.max(Math.ceil(total / limit), 1), counts };
};

module.exports = { readPage, pagedList };
