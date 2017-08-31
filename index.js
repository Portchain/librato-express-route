
const os = require('os')
const _ = require('lodash')
const stats = require('stats-lite')

function diffHrtime(a, b) {
  return (a[0] - b[0]) * 1000 + (a[1] - b[1]) / 1000000
}

const GLOBAL_TAGS = {
  host: os.hostname()
}

function Middleware(options) {
  options = options || {}

  let libratoEmail = options.libratoEmail || process.env.LIBRATO_EMAIL
  let libratoToken = options.libratoToken || process.env.LIBRATO_TOKEN

  if(!libratoEmail || !libratoToken) {
    console.log('Disabling performance monitoring because librato email and/or token are not set')
    return (req, res, next) => {next()}
  }
  
  var client = require('librato-metrics').createClient({
    email: libratoEmail,
    token: libratoToken
  });
  
  var queuedMeasurements = {}

  function addMeasurement(key, value) {
    if(!queuedMeasurements[key]) {
      queuedMeasurements[key] = {
        values: []
      }
    }
    queuedMeasurements[key].values.push(value)
  }

  function processMeasurement(req, measurement) {
    setTimeout(() => {
      let pathElements = req.url.split('/')
      let responseTime = diffHrtime(measurement.end, measurement.start)
      let path = ''
      addMeasurement('http', responseTime)
      
      pathElements.forEach(pathElement => {
        if(pathElement) {
          path += '.' + pathElement
          let key = `http${path}`
          addMeasurement(key, responseTime)
        }
      })
    })
  }

  setInterval(() => {
      let measurementsToFlush = []
      for(var key in queuedMeasurements) {
        measurementsToFlush.push({
          name: key + '.response_time_mean_ms',
          value: stats.mean(queuedMeasurements[key].values),
          tags: GLOBAL_TAGS
        })
        measurementsToFlush.push({
          name: key + '.response_time_median_ms',
          value: stats.median(queuedMeasurements[key].values),
          tags: GLOBAL_TAGS
        })
        measurementsToFlush.push({
          name: key + '.response_time_75_percentile_ms',
          value: stats.percentile(queuedMeasurements[key].values, .75),
          tags: GLOBAL_TAGS
        })
        measurementsToFlush.push({
          name: key + '.response_time_90_percentile_ms',
          value: stats.percentile(queuedMeasurements[key].values, .9),
          tags: GLOBAL_TAGS
        })
        measurementsToFlush.push({
          name: key + '.response_time_95_percentile_ms',
          value: stats.percentile(queuedMeasurements[key].values, .95),
          tags: GLOBAL_TAGS
        })
        measurementsToFlush.push({
          name: key + 'response_time_99_percentile_ms',
          value: stats.percentile(queuedMeasurements[key].values, .99),
          tags: GLOBAL_TAGS
        })
      }
      queuedMeasurements = {}
      //return;
    if(measurementsToFlush.length > 0) {
      client.post('/measurements', {
        measurements: measurementsToFlush,
      }, function(response) {
        if(response && response.statusCode >= 200 && response.statusCode < 300) {
          
        } else {
          //console.log(response);
        }
      });
    }
  }, options.flushInterval || 10000)
  
  function interceptResponse(req, res, measurement) {
    var oldSend = res.send
    res.send = function() {
      if(!measurement.end) {
        measurement.end = process.hrtime()
        processMeasurement(req, measurement)
      }
      oldSend.apply(res, arguments)
    }
    var oldEnd = res.end
    res.end = function() {
      if(!measurement.end) {
        measurement.end = process.hrtime()
        processMeasurement(req, measurement)
      }
      oldEnd.apply(res, arguments)
    }
  }
  
  return function(req, res, next) {
    if(!/\.[a-z]+$/.test(req.url)) {
      var measurement = {
        start: process.hrtime()
      }
      interceptResponse(req, res, measurement)
    }
    next()
  }
  
}

module.exports = Middleware
