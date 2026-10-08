const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

/** SerpApi searches counted per calendar month, so the free tier is never overspent. */
const SerpApiUsage = sequelize.define('SerpApiUsage', {
  month: { type: DataTypes.STRING, primaryKey: true }, // e.g. "2026-10"
  calls: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { tableName: 'serpapi_usage', timestamps: false });

module.exports = SerpApiUsage;
