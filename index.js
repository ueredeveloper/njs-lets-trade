const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const {ichimokuCloudRouter} = require('./technicals-indicators');

//const {client} = require('./services/fetchClient');
const { fetchCandles, fetchIchimokuCloud } = require('./services');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const router = express.Router();

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

app.use('/services', fetchCandles);
app.use('/services', fetchIchimokuCloud);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});