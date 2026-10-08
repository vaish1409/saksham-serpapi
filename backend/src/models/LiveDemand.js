const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/**
 * Cache of live job-market lookups (SerpApi Google Jobs), one row per state + trade.
 * Holds public job-listing counts only: no personal data, nothing from a person's interview.
 */
const LiveDemand = sequelize.define('LiveDemand', {
  state: { type: DataTypes.STRING, primaryKey: true },
  trade: { type: DataTypes.STRING, primaryKey: true },
  query: DataTypes.STRING, // the exact search that was sent
  count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // listings on page one (max 10)
  sample: { type: DataTypes.JSONB, defaultValue: [] }, // up to 3 { title, company, via }
  fetchedAt: { type: DataTypes.DATE, allowNull: false },
}, { tableName: 'live_demand', timestamps: false });

module.exports = LiveDemand;
