// In-memory stand-in for the subset of the Mongoose model API used by the order
// services. It enforces unique indexes so idempotency and dedupe paths behave
// like MongoDB (duplicate key -> error.code 11000). Tests never touch a real DB.
const { Types } = require("mongoose");

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !(value instanceof Date) && !(value instanceof Types.ObjectId) && !Array.isArray(value);

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value instanceof Date) return new Date(value);
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) if (typeof entry !== "function") out[key] = clone(entry);
    return out;
  }
  return value;
};

const getPath = (doc, path) => path.split(".").reduce((current, key) => (current == null ? undefined : current[key]), doc);

const setPath = (doc, path, value) => {
  const keys = path.split(".");
  let current = doc;
  keys.slice(0, -1).forEach((key) => {
    if (!isPlainObject(current[key])) current[key] = {};
    current = current[key];
  });
  current[keys[keys.length - 1]] = value;
};

const unsetPath = (doc, path) => {
  const keys = path.split(".");
  const parent = keys.slice(0, -1).reduce((current, key) => (current == null ? undefined : current[key]), doc);
  if (parent) delete parent[keys[keys.length - 1]];
};

const normalize = (value) => (value instanceof Types.ObjectId ? String(value) : value instanceof Date ? value.getTime() : value);

const equals = (left, right) => {
  if (Array.isArray(left)) return left.some((entry) => equals(entry, right));
  if (right === null) return left === null || left === undefined;
  return normalize(left) === normalize(right);
};

const matchesCondition = (value, condition) => {
  if (condition instanceof RegExp) return typeof value === "string" && condition.test(value);
  if (!isPlainObject(condition) || !Object.keys(condition).some((key) => key.startsWith("$"))) return equals(value, condition);
  return Object.entries(condition).every(([operator, operand]) => {
    switch (operator) {
      case "$in":
        return operand.some((entry) => equals(value, entry));
      case "$nin":
        return !operand.some((entry) => equals(value, entry));
      case "$ne":
        return !equals(value, operand);
      case "$exists":
        return operand ? value !== undefined : value === undefined;
      case "$type":
        return operand === "string" ? typeof value === "string" : true;
      case "$lt":
        return value !== undefined && normalize(value) < normalize(operand);
      case "$lte":
        return value !== undefined && normalize(value) <= normalize(operand);
      case "$gt":
        return value !== undefined && normalize(value) > normalize(operand);
      case "$gte":
        return value !== undefined && normalize(value) >= normalize(operand);
      case "$regex":
        return typeof value === "string" && new RegExp(operand, condition.$options).test(value);
      case "$options":
        return true;
      default:
        throw new Error(`memoryModel: unsupported operator ${operator}`);
    }
  });
};

const matches = (doc, filter = {}) =>
  Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return condition.some((part) => matches(doc, part));
    if (key === "$and") return condition.every((part) => matches(doc, part));
    return matchesCondition(getPath(doc, key), condition);
  });

const applyUpdate = (doc, update) => {
  const operators = Object.keys(update).some((key) => key.startsWith("$")) ? update : { $set: update };
  Object.entries(operators).forEach(([operator, fields]) => {
    Object.entries(fields).forEach(([path, value]) => {
      if (operator === "$set") setPath(doc, path, clone(value));
      else if (operator === "$unset") unsetPath(doc, path);
      else if (operator === "$inc") setPath(doc, path, (getPath(doc, path) || 0) + value);
      else if (operator === "$push") {
        const list = getPath(doc, path) || [];
        list.push(clone(value));
        setPath(doc, path, list);
      } else throw new Error(`memoryModel: unsupported update ${operator}`);
    });
  });
};

const replaceContents = (doc, next) => {
  Object.keys(doc).forEach((key) => delete doc[key]);
  Object.assign(doc, next, { updatedAt: tick() });
};

let clockOffset = 0;
const tick = () => new Date(Date.now() + clockOffset++);

const createMemoryModel = ({ uniques = [], hooks = {} } = {}) => {
  const docs = [];

  const checkUniques = (candidate, ignore) => {
    uniques.forEach((path) => {
      const value = getPath(candidate, path);
      if (value === undefined || value === null) return;
      if (docs.some((doc) => doc !== ignore && equals(getPath(doc, path), value))) {
        const error = new Error(`E11000 duplicate key error: ${path}`);
        error.code = 11000;
        error.keyPattern = { [path]: 1 };
        throw error;
      }
    });
  };

  const wrap = (doc) => {
    const copy = clone(doc);
    Object.defineProperty(copy, "toObject", { value: () => clone(doc), enumerable: false });
    return copy;
  };

  const query = (executor) => {
    const state = { sort: null, skip: 0, limit: null };
    const api = {
      sort(spec) {
        state.sort = spec;
        return api;
      },
      skip(count) {
        state.skip = count;
        return api;
      },
      limit(count) {
        state.limit = count;
        return api;
      },
      select() {
        return api;
      },
      lean() {
        return api;
      },
      then(resolve, reject) {
        return Promise.resolve()
          .then(() => executor(state))
          .then(resolve, reject);
      },
    };
    return api;
  };

  const sorted = (list, spec) => {
    if (!spec) return list;
    const entries = Object.entries(spec);
    return [...list].sort((a, b) => {
      for (const [path, direction] of entries) {
        const left = normalize(getPath(a, path));
        const right = normalize(getPath(b, path));
        if (left < right) return -direction;
        if (left > right) return direction;
      }
      return 0;
    });
  };

  const Model = {
    docs,
    async create(data) {
      if (hooks.beforeCreate) await hooks.beforeCreate(data);
      const now = tick();
      const doc = { _id: new Types.ObjectId(), createdAt: now, updatedAt: now, ...clone(data) };
      checkUniques(doc);
      docs.push(doc);
      return wrap(doc);
    },
    findOne(filter) {
      return query(() => {
        const doc = docs.find((entry) => matches(entry, filter));
        return doc ? clone(doc) : null;
      });
    },
    findById(id) {
      return Model.findOne({ _id: id });
    },
    find(filter) {
      return query((state) => {
        let list = sorted(docs.filter((entry) => matches(entry, filter)), state.sort);
        list = list.slice(state.skip, state.limit === null ? undefined : state.skip + state.limit);
        return list.map(clone);
      });
    },
    async countDocuments(filter) {
      return docs.filter((entry) => matches(entry, filter)).length;
    },
    async updateOne(filter, update) {
      if (hooks.beforeUpdate) await hooks.beforeUpdate(filter, update);
      const doc = docs.find((entry) => matches(entry, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      const next = clone(doc);
      applyUpdate(next, update);
      checkUniques(next, doc);
      replaceContents(doc, next);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(filter) {
      const index = docs.findIndex((entry) => matches(entry, filter));
      if (index === -1) return { deletedCount: 0 };
      docs.splice(index, 1);
      return { deletedCount: 1 };
    },
    async updateMany(filter, update) {
      const targets = docs.filter((entry) => matches(entry, filter));
      targets.forEach((doc) => {
        applyUpdate(doc, update);
        doc.updatedAt = tick();
      });
      return { matchedCount: targets.length, modifiedCount: targets.length };
    },
    findOneAndUpdate(filter, update, options = {}) {
      return query(async () => {
        if (hooks.beforeUpdate) await hooks.beforeUpdate(filter, update);
        const doc = sorted(docs.filter((entry) => matches(entry, filter)), options.sort)[0];
        if (!doc) return null;
        const before = clone(doc);
        const next = clone(doc);
        applyUpdate(next, update);
        checkUniques(next, doc);
        replaceContents(doc, next);
        return options.new ? clone(doc) : before;
      });
    },
  };
  return Model;
};

module.exports = { createMemoryModel };
