const { sequelize } = require('../config/db');
const User = require('./User');
const Scheme = require('./Scheme');
const Lesson = require('./Lesson');
const UserProgress = require('./UserProgress');
const EligibilityCheck = require('./EligibilityCheck');
const LivelihoodSession = require('./LivelihoodSession');
const ChannelSession = require('./ChannelSession');
const LiveDemand = require('./LiveDemand');
const SerpApiUsage = require('./SerpApiUsage');

// Associations
User.hasMany(UserProgress, { foreignKey: 'userId', as: 'progress' });
UserProgress.belongsTo(User, { foreignKey: 'userId' });

Lesson.hasMany(UserProgress, { foreignKey: 'lessonId', as: 'progressEntries' });
UserProgress.belongsTo(Lesson, { foreignKey: 'lessonId' });

User.hasMany(EligibilityCheck, { foreignKey: 'userId', as: 'eligibilityChecks' });
EligibilityCheck.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  User,
  Scheme,
  Lesson,
  UserProgress,
  EligibilityCheck,
  LivelihoodSession,
  ChannelSession,
  LiveDemand,
  SerpApiUsage,
};
