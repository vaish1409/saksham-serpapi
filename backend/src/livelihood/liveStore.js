'use strict';

/**
 * Where live-demand results are cached, and where SerpApi usage is counted.
 *
 * Store interface (both implementations):
 *   get(state, trade)            -> { query, count, sample, fetchedAt } | null
 *   set(state, trade, record)    -> void
 *   reserve(month, limit)        -> boolean  (true = one call was counted and may be spent)
 *   usage(month)                 -> number   (calls counted so far this month)
 *
 * The Postgres store is additive: it only touches its own two tables
 * (live_demand, serpapi_usage), which Sequelize creates on first start.
 */

function createMemoryStore() {
  const rows = new Map();
  const usage = new Map();
  return {
    async get(state, trade) {
      const r = rows.get(`${state}|${trade}`);
      return r ? { ...r } : null;
    },
    async set(state, trade, record) {
      rows.set(`${state}|${trade}`, { ...record });
    },
    async reserve(month, limit) {
      const used = usage.get(month) || 0;
      if (!(limit > 0) || used >= limit) return false;
      usage.set(month, used + 1);
      return true;
    },
    async usage(month) {
      return usage.get(month) || 0;
    },
  };
}

function createSequelizeStore() {
  // required lazily so unit tests never need a database
  const models = () => require('../models');

  return {
    async get(state, trade) {
      const row = await models().LiveDemand.findOne({ where: { state, trade } });
      return row ? row.toJSON() : null;
    },

    async set(state, trade, record) {
      await models().LiveDemand.upsert({
        state,
        trade,
        query: record.query,
        count: record.count,
        sample: record.sample || [],
        fetchedAt: record.fetchedAt,
      });
    },

    // One atomic statement: insert the month's row, or bump it only while it is under the limit.
    // If the limit is already reached the UPDATE is skipped and no row comes back.
    async reserve(month, limit) {
      if (!(limit > 0)) return false;
      const { sequelize } = models();
      const [rows] = await sequelize.query(
        `INSERT INTO serpapi_usage ("month", "calls") VALUES (:month, 1)
         ON CONFLICT ("month") DO UPDATE SET "calls" = serpapi_usage."calls" + 1
         WHERE serpapi_usage."calls" < :limit
         RETURNING "calls"`,
        { replacements: { month, limit } },
      );
      return Array.isArray(rows) && rows.length > 0;
    },

    async usage(month) {
      const row = await models().SerpApiUsage.findByPk(month);
      return row ? row.calls : 0;
    },
  };
}

module.exports = { createMemoryStore, createSequelizeStore };
