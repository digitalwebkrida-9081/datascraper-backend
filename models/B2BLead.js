const mongoose = require('mongoose');

const B2BLeadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  totalRecords: {
    type: String, 
    required: true,
  },
  emailCount: {
    type: String,
  },
  phoneCount: {
    type: String,
  },
  price: {
    type: String,
    default: "$299"
  },
  lastUpdate: {
    type: String,
    default: new Date().toLocaleDateString()
  },
  sampleList: [
    {
      name: String,
      address: String,
      city: String,
      state: String,
      country: String,
      email: String,
      phone: String,
      rating: String,
      reviews: String
    }
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('B2BLead', B2BLeadSchema);
