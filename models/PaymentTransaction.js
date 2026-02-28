const mongoose = require('mongoose');

const paymentTransactionSchema = new mongoose.Schema({
  orderId: { type: String, required: true },
  name: { type: String },
  email: { type: String },
  phone: { type: String },
  datasetDetails: { type: Object },
  amount: { type: Number },
  status: { type: String, required: true },
  rawResponse: { type: Object }
}, { timestamps: true });

module.exports = mongoose.model('PaymentTransaction', paymentTransactionSchema);
