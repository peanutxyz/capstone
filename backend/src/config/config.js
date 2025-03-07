// src/config/config.js
const config = {
    development: {
      mongodb_uri: 'mongodb://localhost:27017/bangbangan_copra',
      jwt_secret: process.env.JWT_SECRET,
      jwt_expiration: '24h',
      port: process.env.PORT || 5000
    },
    production: {
      mongodb_uri: process.env.MONGODB_URI,
      jwt_secret: process.env.JWT_SECRET,
      jwt_expiration: '24h',
      port: process.env.PORT || 5000
    }
  };
  
  const env = process.env.NODE_ENV || 'development';
  module.exports = config[env];