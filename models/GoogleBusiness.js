const mongoose = require('mongoose');

const GoogleBusinessSchema = new mongoose.Schema({
  query: {
    type: String,
    required: true
  },
  place_id: {
    type: String,
    unique: true,
    sparse: true
  },
  name: String,
  full_address: String,
  phone_number: String,
  website: String,
  rating: Number,
  review_count: Number,
  latitude: Number,
  longitude: Number,
  type: String,
  timezone: String,
  opening_status: String,
  photos_sample: [String],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('GoogleBusiness', GoogleBusinessSchema);
